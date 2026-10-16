import { z } from 'zod';

export const onshapeId = z.string().regex(/^[a-f0-9]{24}$/i);
export const workspaceSchema = z.object({ documentId: onshapeId, workspaceId: onshapeId }).strict();
export type OnshapeWorkspace = z.infer<typeof workspaceSchema>;
export const targetSchema = workspaceSchema.extend({ elementId: onshapeId });
export type OnshapeTarget = z.infer<typeof targetSchema>;
export const documentSearchSchema = z.object({
  query: z.string().trim().max(200).default(''),
  filter: z.enum(['all', 'shared', 'recent']).default('all'),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();
export type DocumentSearch = z.infer<typeof documentSearchSchema>;
export type DocumentPage = { items: { id: string; name: string }[]; nextOffset: number | null };
export type CadElement = { id: string; name: string; elementType: string };
export type CadDocument = OnshapeWorkspace & { name: string; workspaceName?: string; elements: CadElement[] };

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
export type EditResult = {
  featureId: string; parameterId: string; before: string; after: string;
  featureStatus: string; message: string; snapshot: FeatureSnapshot | null;
};
export interface CadClient {
  documents(search: DocumentSearch, signal?: AbortSignal): Promise<DocumentPage>;
  document(documentId: string, workspaceId?: string, signal?: AbortSignal): Promise<CadDocument>;
  elements(workspace: OnshapeWorkspace, signal?: AbortSignal): Promise<CadElement[]>;
  inspect(target: OnshapeTarget, signal?: AbortSignal): Promise<FeatureSnapshot>;
  edit(edit: ParameterEdit, signal?: AbortSignal): Promise<EditResult>;
}
export type ModelOption = { provider: string; id: string; name: string };
export type PublicState = {
  serverUrl: string;
  user: { name: string; email: string } | null;
  onshapeConnected: boolean;
  providers: string[];
  model: ModelOption | null;
  target: OnshapeTarget | null;
  document: CadDocument | null;
  busy: boolean;
  serverError?: string;
};
export type ChatEvent =
  | { type: 'text'; id: string; delta: string }
  | { type: 'activity'; id: string; name: string; status: 'running' | 'done' | 'error'; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'auth_prompt'; id: string | null }
  | { type: 'snapshot'; target: OnshapeTarget; snapshot: FeatureSnapshot }
  | { type: 'done' };
export interface DesktopBridge {
  state(): Promise<PublicState>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  connectOnshape(): Promise<void>;
  disconnectOnshape(): Promise<void>;
  documents(search: DocumentSearch): Promise<DocumentPage>;
  openDocument(documentId: string): Promise<void>;
  closeDocument(): Promise<void>;
  selectElement(elementId: string): Promise<FeatureSnapshot>;
  setTarget(url: string): Promise<FeatureSnapshot>;
  inspect(): Promise<FeatureSnapshot>;
  openOnshape(): Promise<void>;
  models(): Promise<ModelOption[]>;
  setModel(model: ModelOption): Promise<void>;
  saveKey(provider: string, key: string): Promise<void>;
  loginCodex(): Promise<void>;
  submitCodexCallback(id: string, value: string): Promise<void>;
  removeProvider(provider: string): Promise<void>;
  prompt(text: string): Promise<void>;
  stop(): Promise<void>;
  newChat(): Promise<void>;
  onEvent(callback: (event: ChatEvent) => void): () => void;
}
