import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { expect, it, vi } from 'vitest';
import { cadAgent } from '../electron/agent.js';
import { haskellKernel } from '../server/kernel.js';
import { OnshapeClient } from '../server/onshape.js';
import fixture from '../kernel/test/fixtures/partstudio.json';

it.runIf(!!process.env.ZITHER_KERNEL_PATH)('carries one sparse Pi instruction through Haskell to a preserved Onshape edit', async () => {
  const target = { documentId: 'a'.repeat(24), workspaceId: 'b'.repeat(24), elementId: 'c'.repeat(24) };
  const after = structuredClone(fixture);
  after.sourceMicroversion = 'm2'; Object.assign(after.features[1].parameters[0], { expression: '25 mm' });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ id: target.elementId, name: 'Base', elementType: 'PARTSTUDIO' }]))
    .mockResolvedValueOnce(Response.json(fixture)) // model observation
    .mockResolvedValueOnce(Response.json(fixture)) // fresh compiler input
    .mockResolvedValueOnce(Response.json({ featureState: { featureStatus: 'OK' }, sourceMicroversion: 'm2' }))
    .mockResolvedValueOnce(Response.json(after));
  const cad = new OnshapeClient('test-token', 'v17', fetcher, haskellKernel(process.env.ZITHER_KERNEL_PATH!));
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('list_elements', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('read_features', { elementId: target.elementId }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('set_parameter', { elementId: target.elementId, featureId: 'extrude1', parameterId: 'depth', expression: '25 mm' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Updated.'),
  ]);
  await cadAgent(faux.getModel(), models.streamSimple.bind(models), cad, target, () => {}).prompt('Change Extrude 1 depth to 25 mm');
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1]!.body as string).feature).toEqual(after.features[1]);
  expect(fetcher).toHaveBeenCalledTimes(5);
});
