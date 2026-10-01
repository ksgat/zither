import { z } from 'zod';
import type { FeatureSnapshot, OnshapeTarget, ParameterEdit } from '../shared/contracts.js';

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
  if (list.sourceMicroversion !== edit.expectedMicroversion) throw new Error('The Part Studio changed. Read its features again before editing.');
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
    return `/partstudios/d/${t.documentId}/w/${t.workspaceId}/e/${t.elementId}`;
  }
  private async request(path: string, body?: unknown) {
    const response = await this.fetcher(`https://cad.onshape.com/api/${this.version}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Onshape API limit reached. Wait before trying again.');
      if (response.status === 401) throw new Error('Onshape authorization expired. Reconnect Onshape.');
      if (response.status === 403) throw new Error('Onshape denied access. Check document permissions and OAuth read/write scopes.');
      if (response.status === 409) throw new Error('The Part Studio changed. Read its features again before editing.');
      throw new Error(`Onshape request failed (${response.status}). Check that the link points to a Part Studio.`);
    }
    return response.json();
  }
  async read(target: OnshapeTarget) { return featureListSchema.parse(await this.request(`${this.path(target)}/features`)); }
  async inspect(target: OnshapeTarget) { return summarizeFeatures(await this.read(target)); }
  async edit(edit: ParameterEdit) {
    const body = buildParameterUpdate(await this.read(edit.target), edit);
    const result = await this.request(`${this.path(edit.target)}/features/featureid/${encodeURIComponent(edit.featureId)}`, body);
    const status = result?.featureState?.featureStatus;
    // An HTTP 200 can still represent a broken CAD feature. Never call it a successful rebuild.
    return { featureStatus: typeof status === 'string' ? status : 'UNKNOWN',
      message: status === 'OK' ? 'Parameter updated and feature rebuilt.' : 'The edit was submitted, but the feature did not report an OK rebuild. Inspect Onshape before continuing.',
      snapshot: await this.inspect(edit.target) };
  }
}
