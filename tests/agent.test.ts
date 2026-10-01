import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { expect, it, vi } from 'vitest';
import { cadAgent } from '../electron/agent.js';
import type { CadClient, ChatEvent, FeatureSnapshot } from '../shared/contracts.js';

const target = { documentId: 'a'.repeat(24), workspaceId: 'b'.repeat(24), elementId: 'c'.repeat(24) };
const snapshot: FeatureSnapshot = { microversion: 'm1', features: [{ id: 'extrude1', name: 'Extrude 1', type: 'extrude',
  suppressed: false, parameters: [{ id: 'depth', expression: '10 mm' }] }] };
const args = { featureId: 'extrude1', parameterId: 'depth', expression: '25 mm' };
const other = 'd'.repeat(24), assembly = 'e'.repeat(24);
const tool = (name: string, values = {}) => fauxAssistantMessage(fauxToolCall(name,
  { ...(['read_features', 'set_parameter'].includes(name) ? { elementId: target.elementId } : {}), ...values }), { stopReason: 'toolUse' });
function setup() {
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const models = createModels(); models.setProvider(faux.provider);
  const cad: CadClient = { documents: vi.fn(), document: vi.fn(), elements: vi.fn().mockResolvedValue([
    { id: target.elementId, name: 'Base', elementType: 'PARTSTUDIO' },
    { id: other, name: 'Cover', elementType: 'PARTSTUDIO' }, { id: assembly, name: 'Assembly', elementType: 'ASSEMBLY' },
  ]), inspect: vi.fn().mockResolvedValue(snapshot), edit: vi.fn().mockResolvedValue({
    ...args, before: '10 mm', after: '25 mm', featureStatus: 'OK', message: 'Updated', snapshot: { ...snapshot, microversion: 'm2' },
  }) };
  const events: ChatEvent[] = [];
  return { faux, cad, events, agent: cadAgent(faux.getModel(), models.streamSimple.bind(models), cad, target, event => events.push(event)) };
}
it('runs a real Pi tool loop and carries the observed document revision into a write', async () => {
  const { faux, cad, events, agent } = setup();
  faux.setResponses([tool('list_elements'), tool('read_features'), tool('set_parameter', args), fauxAssistantMessage('Depth changed to 25 mm.')]);
  await agent.prompt('Change Extrude 1 to 25 mm');
  expect(cad.edit).toHaveBeenCalledWith({ target, ...args, expectedMicroversion: 'm1' }, expect.any(AbortSignal));
  expect(events.some(e => e.type === 'text')).toBe(true);
  expect(events.some(e => e.type === 'snapshot' && e.snapshot.microversion === 'm2')).toBe(true);
});
it('blocks an invented feature and requires a read on every new request', async () => {
  const { faux, cad, agent } = setup();
  faux.setResponses([tool('list_elements'), tool('read_features'), tool('set_parameter', { ...args, featureId: 'invented' }), fauxAssistantMessage('Need a valid feature.')]);
  await agent.prompt('Edit');
  expect(cad.edit).not.toHaveBeenCalled();
  faux.setResponses([tool('set_parameter', args), fauxAssistantMessage('Need to read first.')]);
  await agent.prompt('Try again');
  expect(cad.edit).not.toHaveBeenCalled();
});
it('blocks further writes after an uncertain outcome even when the model asks again', async () => {
  const { faux, cad, agent } = setup();
  vi.mocked(cad.edit).mockRejectedValue(new Error('Response lost'));
  faux.setResponses([tool('list_elements'), tool('read_features'), tool('set_parameter', args), tool('read_features', { elementId: other }), tool('set_parameter', { ...args, elementId: other })]);
  await agent.prompt('Edit the depth');
  expect(cad.edit).toHaveBeenCalledTimes(1);
});
it('scopes identical feature IDs to their tabs and invalidates other observations after a write', async () => {
  const { faux, cad, agent } = setup();
  vi.mocked(cad.inspect).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({ ...snapshot, microversion: 'm2' });
  faux.setResponses([tool('list_elements'), tool('read_features'), tool('read_features', { elementId: other }),
    tool('set_parameter', args), tool('set_parameter', { ...args, elementId: other }),
    tool('read_features', { elementId: other }), tool('set_parameter', { ...args, elementId: other }), fauxAssistantMessage('Updated both.')]);
  await agent.prompt('Change Base and Cover depth to 25 mm');
  expect(cad.elements).toHaveBeenCalledWith({ documentId: target.documentId, workspaceId: target.workspaceId }, expect.any(AbortSignal));
  expect(cad.edit).toHaveBeenCalledTimes(2);
  expect(cad.edit).toHaveBeenNthCalledWith(1, { target, ...args, expectedMicroversion: 'm1' }, expect.any(AbortSignal));
  expect(cad.edit).toHaveBeenNthCalledWith(2, { target: { ...target, elementId: other }, ...args, expectedMicroversion: 'm2' }, expect.any(AbortSignal));
});
it('rejects undiscovered tabs, unsupported tab types, and using another tab’s feature observation', async () => {
  const { faux, cad, agent } = setup();
  faux.setResponses([tool('read_features'), tool('list_elements'), tool('read_features', { elementId: 'f'.repeat(24) }),
    tool('read_features', { elementId: assembly }), tool('read_features'), tool('set_parameter', { ...args, elementId: other }), fauxAssistantMessage('Need a valid read.')]);
  await agent.prompt('Edit');
  expect(cad.inspect).toHaveBeenCalledTimes(1);
  expect(cad.edit).not.toHaveBeenCalled();
});
