import { describe, expect, it, vi } from 'vitest';
import { parseOnshapeUrl, targetUrl } from '../shared/contracts.js';
import { OnshapeClient } from '../server/onshape.js';
import { haskellKernel } from '../server/kernel.js';
import fixture from '../kernel/test/fixtures/partstudio.json';

const target = { documentId: 'a'.repeat(24), workspaceId: 'b'.repeat(24), elementId: 'c'.repeat(24) };
const edit = { target, featureId: 'extrude1', parameterId: 'depth', expression: '25 mm', expectedMicroversion: 'm1' };
const list = () => structuredClone(fixture);
const rebuilt = () => {
  const after = list(); after.sourceMicroversion = 'm2'; Object.assign(after.features[1].parameters[0], { expression: '25 mm' }); return after;
};
const reply = (status = 'OK') => Response.json({ featureState: { featureStatus: status }, sourceMicroversion: 'm2' });
const executable = process.env.ZITHER_KERNEL_PATH;
const client = (fetcher: typeof fetch) => new OnshapeClient('token', 'v17', fetcher, haskellKernel(executable!));

describe('Onshape document links', () => {
  it('round trips an editable workspace URL', () => expect(parseOnshapeUrl(targetUrl(target))).toEqual(target));
  it.each([
    targetUrl(target).replace('/w/', '/v/'), targetUrl(target).replace('cad.onshape.com', 'cad.onshape.com.evil.com'),
    targetUrl(target).replace('https:', 'http:'), `${targetUrl(target)}?configuration=x`,
  ])('rejects unsupported target %s', url => expect(() => parseOnshapeUrl(url)).toThrow());
});

it('limits authentication recovery to one read retry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { status: 401 }));
  const refresh = vi.fn().mockResolvedValue('new-token');
  const cad = new OnshapeClient('old-token', 'v17', fetcher, undefined, refresh);
  await expect(cad.documents({ query: '', filter: 'all', offset: 0 })).rejects.toMatchObject({ code: 'expired_connection' });
  expect(refresh).toHaveBeenCalledExactlyOnceWith('old-token');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('honors cancellation after refresh without resending the read', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 401 }));
  const cad = new OnshapeClient('old-token', 'v17', fetcher, undefined, async () => { controller.abort(); return 'new-token'; });
  await expect(cad.documents({ query: '', filter: 'all', offset: 0 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

// Linux CI supplies the compiled binary: these exercise the real edit compiler,
// not a TypeScript reimplementation. Onshape alone is mocked.
describe.runIf(!!executable)('Haskell → Onshape edits', () => {
  it('does not retry an unauthorized CAD write', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }));
    const refresh = vi.fn();
    const cad = new OnshapeClient('token', 'v17', fetcher, haskellKernel(executable!), refresh);
    await expect(cad.edit(edit)).rejects.toMatchObject({ code: 'expired_connection' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });
  it('POSTs the preserved feature and verifies the new expression and revision', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(rebuilt()));
    const result = await client(fetcher).edit(edit);
    expect(result.featureStatus).toBe('OK');
    const body = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(body.feature).toEqual(rebuilt().features[1]);
    expect(body.rejectMicroversionSkew).toBe(true);
    expect(body.sourceMicroversion).toBe('m1');
  });
  it('does not POST after a concurrent browser edit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...list(), sourceMicroversion: 'm2' }));
    await expect(client(fetcher).edit(edit)).rejects.toThrow('changed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not rebuild a no-op', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(list()));
    expect(await client(fetcher).edit({ ...edit, expression: '10 mm' })).toMatchObject({ featureStatus: 'UNCHANGED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports an invalid rebuild despite HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply('ERROR')).mockResolvedValueOnce(Response.json(rebuilt()));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'ERROR', before: '10 mm', after: '25 mm' });
  });
  it('stops when the edited feature breaks a downstream feature', async () => {
    const after = rebuilt(); after.featureStates.fillet1.featureStatus = 'ERROR';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(after));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'DOWNSTREAM_ERROR' });
  });
  it('does not call a mismatched read-back verified', async () => {
    const after = rebuilt(); Object.assign(after.features[1].parameters[0], { expression: '50 mm' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(after));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'UNVERIFIED' });
  });
  it('requires complete feature states to verify a rebuild', async () => {
    const after = { ...rebuilt(), featureStates: {} };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(after));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'UNVERIFIED' });
  });
  it('does not blame an unchanged pre-existing downstream failure on this edit', async () => {
    const before = list(), after = rebuilt();
    before.featureStates.fillet1.featureStatus = 'ERROR'; after.featureStates.fillet1.featureStatus = 'ERROR';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(before))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(after));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'OK' });
  });
  it('does not verify against a later browser microversion', async () => {
    const after = rebuilt(); after.sourceMicroversion = 'm3';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockResolvedValueOnce(Response.json(after));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'UNVERIFIED' });
  });
  it('does not retry a write whose response is lost', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list())).mockRejectedValueOnce(new Error('timeout'));
    await expect(client(fetcher).edit(edit)).rejects.toMatchObject({ code: 'write_outcome_unknown' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps an acknowledged write unverified when its subsequent read fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('offline'));
    expect(await client(fetcher).edit(edit)).toMatchObject({ featureStatus: 'UNVERIFIED', snapshot: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
