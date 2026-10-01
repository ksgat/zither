import { z } from 'zod';
import { targetSchema, editSchema, type EditResult, type FeatureSnapshot, type OnshapeTarget, type ParameterEdit } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';

// Preserve the complete feature payload, including fields unknown to this client.
const parameterSchema = z.object({ parameterId: z.string(), expression: z.string().optional() }).passthrough();
const featureSchema = z.object({
  featureId: z.string(), name: z.string(), featureType: z.string(),
  suppressed: z.boolean().optional(), parameters: z.array(parameterSchema).default([]),
}).passthrough();
export const featureListSchema = z.object({
  features: z.array(featureSchema), sourceMicroversion: z.string().min(1),
  serializationVersion: z.string().min(1), libraryVersion: z.number().optional(),
}).passthrough();
type FeatureList = z.infer<typeof featureListSchema>;

export function summarizeFeatures(list: FeatureList): FeatureSnapshot {
  return { microversion: list.sourceMicroversion, features: list.features.map(f => ({
    id: f.featureId, name: f.name, type: f.featureType, suppressed: f.suppressed ?? false,
    parameters: f.parameters.filter(p => typeof p.expression === 'string').map(p => ({ id: p.parameterId, expression: p.expression! })),
  })) };
}
export function buildParameterUpdate(list: FeatureList, edit: ParameterEdit) {
  if (list.sourceMicroversion !== edit.expectedMicroversion) throw new AppError('stale_workspace', 'The Part Studio changed. Read its features again before editing.', 409);
  const feature = structuredClone(list.features.find(f => f.featureId === edit.featureId));
  if (!feature) throw new Error('Feature not found in the current Part Studio.');
  const parameter = feature.parameters.find(p => p.parameterId === edit.parameterId);
  if (!parameter || typeof parameter.expression !== 'string') throw new Error('This parameter does not support expression edits.');
  parameter.expression = edit.expression;
  return { feature, sourceMicroversion: list.sourceMicroversion,
    serializationVersion: list.serializationVersion, libraryVersion: list.libraryVersion,
    rejectMicroversionSkew: true };
}

export class OnshapeClient {
  constructor(private accessToken: string, private version = 'v9', private fetcher: typeof fetch = fetch) {}
  private path(t: OnshapeTarget) {
    targetSchema.parse(t);
    return `/partstudios/d/${t.documentId}/w/${t.workspaceId}/e/${t.elementId}`;
  }
  private async request(path: string, body?: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(`https://cad.onshape.com/api/${this.version}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AppError(body ? 'write_outcome_unknown' : 'onshape_unavailable', body
        ? 'The edit response was lost. It may have applied. Inspect Onshape before issuing another edit.'
        : 'Could not reach Onshape.', 502);
    }
    if (!response.ok) {
      if (response.status === 429) throw new Error('Onshape API limit reached. Wait before trying again.');
      if (response.status === 401) throw new Error('Onshape authorization expired. Reconnect Onshape.');
      if (response.status === 403) throw new Error('Onshape denied access. Check document permissions and OAuth read/write scopes.');
      if (response.status === 409) throw new Error('The Part Studio changed. Read its features again before editing.');
      if (body && response.status >= 500) throw new AppError('write_outcome_unknown', 'Onshape failed during an edit. Inspect the workspace before issuing another edit.', 502);
      throw new Error(`Onshape request failed (${response.status}). Check that the link points to a Part Studio.`);
    }
    try { return await response.json(); }
    catch { throw new AppError(body ? 'write_outcome_unknown' : 'invalid_response', 'Onshape returned an unreadable response. Inspect the workspace before continuing.', 502); }
  }
  async read(target: OnshapeTarget, signal?: AbortSignal) { return featureListSchema.parse(await this.request(`${this.path(target)}/features`, undefined, signal)); }
  async inspect(target: OnshapeTarget, signal?: AbortSignal) { return summarizeFeatures(await this.read(target, signal)); }
  async edit(input: ParameterEdit, signal?: AbortSignal): Promise<EditResult> {
    const edit = editSchema.parse(input);
    const list = await this.read(edit.target, signal);
    const body = buildParameterUpdate(list, edit);
    const before = list.features.find(f => f.featureId === edit.featureId)!.parameters.find(p => p.parameterId === edit.parameterId)!.expression!;
    const result = await this.request(`${this.path(edit.target)}/features/featureid/${encodeURIComponent(edit.featureId)}`, body, signal);
    const status = result?.featureState?.featureStatus;
    // An HTTP 200 can still represent a broken CAD feature. Never call it a successful rebuild.
    // A failed follow-up read does not turn an acknowledged write into a retryable failure.
    const snapshot = await this.inspect(edit.target, signal).catch(() => null);
    return { featureId: edit.featureId, parameterId: edit.parameterId, before, after: edit.expression,
      featureStatus: typeof status === 'string' ? status : 'UNKNOWN',
      message: status === 'OK' ? 'Parameter updated and feature rebuilt.' : 'The edit was submitted, but the feature did not report an OK rebuild. Inspect Onshape before continuing.',
      snapshot };
  }
}
