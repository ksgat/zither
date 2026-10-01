import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { haskellKernel, kernelRequest } from '../server/kernel.js';
import fixture from '../kernel/test/fixtures/partstudio.json';
import source from '../kernel/schema/source.json';

const executable = process.env.ZITHER_KERNEL_PATH;
const target = { documentId: 'a'.repeat(24), workspaceId: 'b'.repeat(24), elementId: 'c'.repeat(24) };
const edit = { target, featureId: 'extrude1', parameterId: 'depth', expression: '25 mm', expectedMicroversion: 'm1' };

it('requires an explicit absolute binary path', () => expect(() => haskellKernel('zither-kernel')).toThrow('absolute'));
it('pins the complete official operation catalog and all referenced schemas', () => {
  const bytes = readFileSync('kernel/schema/onshape-openapi.json');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
  const spec = JSON.parse(bytes.toString());
  const operations = Object.values(spec.paths).flatMap((item: any) => Object.values(item).filter((o: any) => o.operationId));
  const generated = readFileSync('kernel/src/Zither/Operations.hs', 'utf8');
  expect(operations).toHaveLength(source.operations);
  expect(Object.keys(spec.components.schemas)).toHaveLength(source.schemas);
  for (const op of operations as any[]) expect(generated).toContain(`Operation "${op.operationId}"`);
});
it.runIf(!!executable)('runs the actual Haskell tree importer and compiler across the process boundary', async () => {
  const kernel = haskellKernel(executable!);
  const observed = await kernel.inspect(fixture);
  expect(observed.microversion).toBe('m1');
  expect(observed.features.map(f => f.id)).toEqual(['sketch1', 'extrude1', 'fillet1']);
  expect(observed.features[1]).toMatchObject({ children: [{ id: 'owned1', namespace: 'maker' }] });
  const plan = await kernel.compile(fixture, edit);
  const expected = structuredClone(fixture.features[1]);
  Object.assign(expected.parameters[0], { expression: '25 mm' });
  expect(plan.body.feature).toEqual(expected);
  expect(plan.body).toMatchObject({ sourceMicroversion: 'm1', rejectMicroversionSkew: true, libraryVersion: 2500 });
  await expect(kernel.compile(fixture, { ...edit, expectedMicroversion: 'old' })).rejects.toThrow('changed');
  await expect(kernel.compile(fixture, { ...edit, parameterId: 'entities' })).rejects.toThrow('expression');
});
it.runIf(!!executable)('imports documented operations and resolves their request/response schema graph', async () => {
  const result = await kernelRequest(executable!, { action: 'catalog', operationId: 'updatePartStudioFeature' }) as any;
  expect(result.method).toBe('POST');
  expect(result.schemas['BTFeatureDefinitionCall-1406'].properties.rejectMicroversionSkew).toBeDefined();
  expect(result.schemas['BTMFeature-134']).toBeDefined();
  const assembly = await kernelRequest(executable!, { action: 'catalog', operationId: 'getAssemblyDefinition' }) as any;
  expect(assembly.method).toBe('GET');
  await expect(kernelRequest(executable!, { action: 'catalog', operationId: 'invented' })).rejects.toThrow('Unknown');
});
