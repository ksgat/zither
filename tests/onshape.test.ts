import { describe, expect, it, vi } from 'vitest';
import { parseOnshapeUrl, targetUrl } from '../shared/contracts.js';
import { buildParameterUpdate, featureListSchema, OnshapeClient } from '../server/onshape.js';

export const target = { documentId: 'a'.repeat(24), workspaceId: 'b'.repeat(24), elementId: 'c'.repeat(24) };
const edit = { target, featureId: 'extrude1', parameterId: 'depth', expression: '25 mm', expectedMicroversion: 'm1' };
const list = () => featureListSchema.parse({
  sourceMicroversion: 'm1', serializationVersion: '1.2.4', libraryVersion: 0,
  features: [{ featureId: 'extrude1', name: 'Extrude 1', featureType: 'extrude', btType: 'BTMFeature-134',
    parameters: [{ parameterId: 'depth', expression: '10 mm', btType: 'BTMParameterQuantity-147', nodeId: 'keep' },
      { parameterId: 'entities', queries: [{ geometryIds: ['edge1'] }] }], namespace: '', subFeatures: [] }],
});

describe('Onshape document links', () => {
  it('round trips an editable workspace URL', () => expect(parseOnshapeUrl(targetUrl(target))).toEqual(target));
  it.each([
    targetUrl(target).replace('/w/', '/v/'), targetUrl(target).replace('cad.onshape.com', 'cad.onshape.com.evil.com'),
    targetUrl(target).replace('https:', 'http:'), `${targetUrl(target)}?configuration=x`,
  ])('rejects unsupported target %s', url => expect(() => parseOnshapeUrl(url)).toThrow());
});

describe('feature edits', () => {
  it('changes only the requested expression and retains unknown CAD fields', () => {
    const original = list();
    const result = buildParameterUpdate(original, edit);
    expect(result.rejectMicroversionSkew).toBe(true);
    expect(result.sourceMicroversion).toBe('m1');
    const expected = structuredClone(original.features[0]);
    expected.parameters[0].expression = '25 mm';
    expect(result.feature).toEqual(expected);
    expect(original.features[0].parameters[0].expression).toBe('10 mm');
  });
  it('rejects stale observations and non-expression parameters', () => {
    expect(() => buildParameterUpdate(list(), { ...edit, expectedMicroversion: 'old' })).toThrow('changed');
    expect(() => buildParameterUpdate(list(), { ...edit, parameterId: 'entities' })).toThrow('expression');
  });
  it('does not POST after a concurrent browser edit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...list(), sourceMicroversion: 'm2' }));
    await expect(new OnshapeClient('token', 'v9', fetcher).edit(edit)).rejects.toThrow('changed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports an invalid rebuild despite HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({ featureState: { featureStatus: 'ERROR' } }))
      .mockResolvedValueOnce(Response.json({ ...list(), sourceMicroversion: 'm2' }));
    const result = await new OnshapeClient('token', 'v9', fetcher).edit(edit);
    expect(result.featureStatus).toBe('ERROR');
    expect(result.before).toBe('10 mm');
    expect(result.after).toBe('25 mm');
  });
  it('does not retry a write whose response is lost', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list())).mockRejectedValueOnce(new Error('timeout'));
    await expect(new OnshapeClient('token', 'v9', fetcher).edit(edit)).rejects.toMatchObject({ code: 'write_outcome_unknown' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('preserves an acknowledged write when the subsequent read fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({ featureState: { featureStatus: 'OK' } }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await new OnshapeClient('token', 'v9', fetcher).edit(edit)).toMatchObject({ featureStatus: 'OK', snapshot: null });
  });
});
