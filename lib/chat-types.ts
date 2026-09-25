export type KnowledgeSource = {
  score: number;
  documentId: string;
  documentName: string;
  sectionTitle: string;
  chunkIndex: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: KnowledgeSource[];
};

export type TraceItem = {
  id: string;
  label: string;
  detail: string;
  tone: "neutral" | "tool" | "success" | "error";
};

export type ServerEvent =
  | { type: "meta"; model: string; approximateTokens: number }
  | { type: "retrieval"; hits: KnowledgeSource[] }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: Record<string, string>; ok: boolean }
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type KnowledgeDocument = {
  id: string;
  name: string;
  mimeType: string;
  status: "processing" | "ready" | "failed";
  chunkCount: number;
  errorMessage?: string;
  createdAt: string;
};
