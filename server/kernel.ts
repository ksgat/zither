import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import type { FeatureSnapshot, ParameterEdit } from '../shared/contracts.js';

const limit = 16 * 1024 * 1024;
const snapshotSchema = z.object({ microversion: z.string().min(1), features: z.array(z.object({
  id: z.string(), name: z.string(), type: z.string(), suppressed: z.boolean(),
  parameters: z.array(z.object({ id: z.string(), expression: z.string() })),
}).passthrough()) });
const planSchema = z.object({ version: z.literal(1), operationId: z.literal('updatePartStudioFeature'), featureId: z.string(),
  body: z.object({ feature: z.record(z.string(), z.unknown()), sourceMicroversion: z.string(),
    serializationVersion: z.string(), rejectMicroversionSkew: z.literal(true) }).passthrough(),
  changes: z.array(z.object({ parameterId: z.string(), before: z.string(), after: z.string() })).length(1), changed: z.boolean(),
});
export type EditPlan = z.infer<typeof planSchema>;
export interface CadKernel {
  inspect(tree: unknown, signal?: AbortSignal): Promise<FeatureSnapshot>;
  compile(tree: unknown, edit: ParameterEdit, signal?: AbortSignal): Promise<EditPlan>;
}

export function kernelRequest(executable: string, request: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!isAbsolute(executable)) throw new Error('ZITHER_KERNEL_PATH must be an absolute executable path.');
  signal?.throwIfAborted();
  const input = JSON.stringify({ version: 1, ...request as object });
  if (Buffer.byteLength(input) > limit) throw new AppError('tree_too_large', 'The feature tree exceeds the 16 MiB limit.', 413);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]) });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { child.kill(); reject(new AppError('kernel_output_limit', 'The kernel output exceeded its limit.', 502)); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => reject(new AppError('kernel_unavailable', 'The CAD kernel could not run. Check the server kernel configuration.', 503)));
    child.stdin.on('error', () => reject(new AppError('kernel_unavailable', 'The CAD kernel closed its input.', 503)));
    child.on('close', code => {
      if (code !== 0) return reject(new AppError('kernel_failed', 'The CAD kernel failed before producing a plan.', 502));
      try {
        const output = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof output?.error === 'string') reject(new AppError('invalid_edit', output.error, 409));
        else resolve(output);
      } catch { reject(new AppError('kernel_invalid', 'The CAD kernel returned invalid output.', 502)); }
    });
    child.stdin.end(input);
  });
}

export function haskellKernel(executable: string): CadKernel {
  if (!isAbsolute(executable)) throw new Error('ZITHER_KERNEL_PATH must be an absolute executable path.');
  return {
    async inspect(tree, signal) { return snapshotSchema.parse(await kernelRequest(executable, { action: 'inspect', tree }, signal)); },
    async compile(tree, edit, signal) {
      const plan = planSchema.parse(await kernelRequest(executable, { action: 'compile', tree,
        featureId: edit.featureId, expectedMicroversion: edit.expectedMicroversion,
        edits: [{ parameterId: edit.parameterId, expression: edit.expression }] }, signal));
      if (plan.featureId !== edit.featureId || plan.body.feature.featureId !== edit.featureId ||
        plan.body.sourceMicroversion !== edit.expectedMicroversion || plan.changes[0].parameterId !== edit.parameterId ||
        plan.changes[0].after !== edit.expression) throw new AppError('kernel_invalid', 'The CAD kernel returned a mismatched plan.', 502);
      return plan;
    },
  };
}

export const unavailableKernel: CadKernel = {
  async inspect() { throw new AppError('kernel_unavailable', 'Configure ZITHER_KERNEL_PATH on the server to read and edit CAD.', 503); },
  async compile() { throw new AppError('kernel_unavailable', 'Configure ZITHER_KERNEL_PATH on the server to read and edit CAD.', 503); },
};
