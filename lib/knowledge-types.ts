export type DocumentStatus = "processing" | "ready" | "failed";

export type KnowledgeDocument = {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  extension: "md" | "txt";
  contentHash: string;
  version: number;
  status: DocumentStatus;
  chunkCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  sectionTitle: string;
};

export type KnowledgeHit = {
  content: string;
  score: number;
  documentId: string;
  documentName: string;
  sectionTitle: string;
  chunkIndex: number;
};
