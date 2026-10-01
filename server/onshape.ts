import { z } from 'zod';
import { targetSchema, editSchema, type EditResult, type FeatureSnapshot, type OnshapeTarget, type ParameterEdit } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';
import { unavailableKernel, type CadKernel } from './kernel.js';

// Preserve the complete feature payload, including fields unknown to this client.
export const featureListSchema = z.object({
  features: z.array(z.record(z.string(), z.unknown())), sourceMicroversion: z.string().min(1),
  serializationVersion: z.string().min(1), libraryVersion: z.number().optional(),
}).passthrough();
type FeatureList = z.infer<typeof featureListSchema>;
function failedFeatures(list: FeatureList): string[] | null {
  const states = z.record(z.string(), z.object({ featureStatus: z.string() }).passthrough()).safeParse(list.featureStates);
  if (!states.success || list.features.some(feature => typeof feature.featureId !== 'string' || !states.data[feature.featureId])) return null;
  return Object.entries(states.data).filter(([, state]) => !['OK', 'SUPPRESSED'].includes(state.featureStatus)).map(([id]) => id);
}

export class OnshapeClient {
  constructor(private accessToken: string, private version = 'v17', private fetcher: typeof fetch = fetch,
    private kernel: CadKernel = unavailableKernel) {}
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
      if (response.status === 429) throw new AppError('rate_limit', 'Onshape API limit reached. Wait before trying again.', 429);
      if (response.status === 401) throw new AppError('expired_connection', 'Onshape authorization expired. Reconnect Onshape.', 401);
      if (response.status === 403) throw new AppError('access_denied', 'Onshape denied access. Check document permissions and OAuth read/write scopes.', 403);
      if (response.status === 409) throw new AppError('stale_workspace', 'The Part Studio changed. Read its features again before editing.', 409);
      if (body && response.status >= 500) throw new AppError('write_outcome_unknown', 'Onshape failed during an edit. Inspect the workspace before issuing another edit.', 502);
      throw new Error(`Onshape request failed (${response.status}). Check that the link points to a Part Studio.`);
    }
    try { return await response.json(); }
    catch { throw new AppError(body ? 'write_outcome_unknown' : 'invalid_response', 'Onshape returned an unreadable response. Inspect the workspace before continuing.', 502); }
  }
  async read(target: OnshapeTarget, signal?: AbortSignal) {
    return featureListSchema.parse(await this.request(`${this.path(target)}/features?rollbackBarIndex=-1&includeGeometryIds=true&noSketchGeometry=false`, undefined, signal));
  }
  async inspect(target: OnshapeTarget, signal?: AbortSignal) { return this.kernel.inspect(await this.read(target, signal), signal); }
  async edit(input: ParameterEdit, signal?: AbortSignal): Promise<EditResult> {
    const edit = editSchema.parse(input);
    const list = await this.read(edit.target, signal);
    const plan = await this.kernel.compile(list, edit, signal);
    const before = plan.changes[0].before;
    if (!plan.changed) return { featureId: edit.featureId, parameterId: edit.parameterId, before, after: edit.expression,
      featureStatus: 'UNCHANGED', message: 'The expression already matches. No write was made.', snapshot: await this.kernel.inspect(list, signal) };
    const result = await this.request(`${this.path(edit.target)}/features/featureid/${encodeURIComponent(edit.featureId)}`, plan.body, signal);
    let status = typeof result?.featureState?.featureStatus === 'string' ? result.featureState.featureStatus as string : 'UNKNOWN';
    // An HTTP 200 can still represent a broken CAD feature. Never call it a successful rebuild.
    // A failed follow-up read does not turn an acknowledged write into a retryable failure.
    let snapshot: FeatureSnapshot | null = null;
    try {
      const after = await this.read(edit.target, signal);
      snapshot = await this.kernel.inspect(after, signal);
      const observed = snapshot.features.find(f => f.id === edit.featureId)?.parameters.find(p => p.id === edit.parameterId)?.expression;
      if (status === 'OK' && (observed !== edit.expression || snapshot.microversion === list.sourceMicroversion || result.microversionSkew === true ||
        (typeof result.sourceMicroversion === 'string' && result.sourceMicroversion !== snapshot.microversion))) status = 'UNVERIFIED';
      const previousFailures = failedFeatures(list), currentFailures = failedFeatures(after);
      if (status === 'OK' && (!previousFailures || !currentFailures)) status = 'UNVERIFIED';
      if (status === 'OK' && currentFailures!.some(id => id === edit.featureId || !previousFailures!.includes(id))) status = 'DOWNSTREAM_ERROR';
    } catch { if (status === 'OK') status = 'UNVERIFIED'; }
    return { featureId: edit.featureId, parameterId: edit.parameterId, before, after: edit.expression,
      featureStatus: status,
      message: status === 'OK' ? 'Parameter updated, read back, and feature rebuilt.'
        : status === 'DOWNSTREAM_ERROR' ? 'The parameter changed, but the feature tree now reports a rebuild problem. Inspect Onshape before continuing.'
        : 'The edit was submitted, but a successful rebuild and read-back could not be verified. Inspect Onshape before continuing.',
      snapshot };
  }
}
