import { z } from 'zod';

export const targetSchema = z.object({
  documentId: z.string().regex(/^[a-f0-9]{24}$/i),
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/i),
  elementId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict();
export type OnshapeTarget = z.infer<typeof targetSchema>;

export function parseOnshapeUrl(value: string): OnshapeTarget {
  const url = new URL(value.trim());
  if (url.origin !== 'https://cad.onshape.com' || url.username || url.password) {
    throw new Error('Use an https://cad.onshape.com Part Studio link.');
  }
  const match = url.pathname.match(/^\/documents\/([a-f0-9]{24})\/w\/([a-f0-9]{24})\/e\/([a-f0-9]{24})\/?$/i);
  if (!match) throw new Error('Open a Part Studio in an editable workspace and paste its full link. Version and microversion links are read-only.');
  if (url.searchParams.has('configuration')) throw new Error('Configured Part Studios are not supported yet. Open the default configuration.');
  return targetSchema.parse({ documentId: match[1], workspaceId: match[2], elementId: match[3] });
}

export function targetUrl(target: OnshapeTarget): string {
  const t = targetSchema.parse(target);
  return `https://cad.onshape.com/documents/${t.documentId}/w/${t.workspaceId}/e/${t.elementId}`;
}

export const editSchema = z.object({
  target: targetSchema,
  featureId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_+\-=]+$/),
  parameterId: z.string().min(1).max(200),
  expression: z.string().trim().min(1).max(500),
  expectedMicroversion: z.string().min(1).max(100),
}).strict();
export type ParameterEdit = z.infer<typeof editSchema>;
export type FeatureParameter = { id: string; expression: string };
export type Feature = { id: string; name: string; type: string; suppressed: boolean; parameters: FeatureParameter[] };
export type FeatureSnapshot = { microversion: string; features: Feature[] };
export type ModelOption = { provider: string; id: string; name: string };
export type PublicState = {
  serverUrl: string;
  user: { name: string; email: string } | null;
  onshapeConnected: boolean;
  providers: string[];
  model: ModelOption | null;
  target: OnshapeTarget | null;
  busy: boolean;
};
export type ChatEvent =
  | { type: 'text'; id: string; delta: string }
  | { type: 'activity'; id: string; name: string; status: 'running' | 'done' | 'error'; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
export interface DesktopBridge {
  state(): Promise<PublicState>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  connectOnshape(): Promise<void>;
  disconnectOnshape(): Promise<void>;
  setTarget(url: string): Promise<FeatureSnapshot>;
  inspect(): Promise<FeatureSnapshot>;
  openOnshape(): Promise<void>;
  models(): Promise<ModelOption[]>;
  setModel(model: ModelOption): Promise<void>;
  saveKey(provider: string, key: string): Promise<void>;
  loginChatGPT(): Promise<void>;
  removeProvider(provider: string): Promise<void>;
  prompt(text: string): Promise<void>;
  stop(): Promise<void>;
  newChat(): Promise<void>;
  onEvent(callback: (event: ChatEvent) => void): () => void;
}
