import { createHash, randomUUID } from "node:crypto";
import { chunkMarkdown, normalizeSourceText } from "./chunking";
import { deleteDocumentChunks, DEMO_USER_ID, searchChunks, upsertChunks } from "./chroma";
import { requestEmbeddings } from "./llm";
import {
  createDocument,
  deleteDocument as deleteStoredDocument,
  findDocumentByHash,
  getDocument,
  listDocuments,
  updateDocument,
} from "./knowledge-store";
import type { KnowledgeDocument, KnowledgeHit } from "./knowledge-types";

export const MAX_FILE_BYTES = 1024 * 1024;
export const DEFAULT_TOP_K = 5;
const EMBEDDING_BATCH_SIZE = 32;
const MAX_QUERY_LENGTH = 4000;
const ALLOWED_MIME_TYPES = new Set(["", "text/plain", "text/markdown", "application/octet-stream"]);

export class KnowledgeError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "KnowledgeError";
    this.status = status;
  }
}

function getExtension(fileName: string): "md" | "txt" {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension !== "md" && extension !== "txt") {
    throw new KnowledgeError("只支持 Markdown（.md）和纯文本（.txt）文件。", 400);
  }
  return extension;
}

function validateFile(file: File) {
  if (!file || typeof file.name !== "string") {
    throw new KnowledgeError("请上传一个文件。", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new KnowledgeError("文件不能超过 1 MB。", 413);
  }

  const extension = getExtension(file.name);
  if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new KnowledgeError("文件 MIME 类型不受支持，只允许 Markdown 或纯文本。", 400);
  }

  return extension;
}

function hashContent(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function displayName(fileName: string) {
  const name = fileName.split(/[\\/]/u).pop()?.trim();
  return name ? name.slice(0, 180) : "未命名文档";
}

export async function indexKnowledgeFile(file: File, signal?: AbortSignal) {
  const extension = validateFile(file);
  const source = normalizeSourceText(await file.text());
  if (!source) throw new KnowledgeError("文件内容为空，无法建立知识库索引。", 400);

  const contentHash = hashContent(source);
  const duplicate = await findDocumentByHash(contentHash, DEMO_USER_ID);
  if (duplicate) return duplicate;

  const now = new Date().toISOString();
  const document: KnowledgeDocument = {
    id: `doc_${randomUUID()}`,
    ownerId: DEMO_USER_ID,
    name: displayName(file.name),
    mimeType: file.type || (extension === "md" ? "text/markdown" : "text/plain"),
    extension,
    contentHash,
    version: 1,
    status: "processing",
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await createDocument(document, source);

  try {
    const chunks = chunkMarkdown(source, document.id);
    if (chunks.length === 0) throw new KnowledgeError("文件没有可索引的文本片段。", 422);

    const embeddings: number[][] = [];
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      if (signal?.aborted) throw new Error("请求已取消。");
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
      embeddings.push(...(await requestEmbeddings(batch.map((chunk) => chunk.content), signal)));
    }

    await upsertChunks(chunks, embeddings, document.name, DEMO_USER_ID);
    return (await updateDocument(document.id, DEMO_USER_ID, {
      status: "ready",
      chunkCount: chunks.length,
      errorMessage: undefined,
    })) as KnowledgeDocument;
  } catch (error) {
    await deleteDocumentChunks(document.id, DEMO_USER_ID).catch(() => undefined);
    await updateDocument(document.id, DEMO_USER_ID, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : "文档索引失败。",
    });
    throw error;
  }
}

export async function getKnowledgeDocuments() {
  return listDocuments(DEMO_USER_ID);
}

export async function getKnowledgeDocument(documentId: string) {
  return getDocument(documentId, DEMO_USER_ID);
}

export async function removeKnowledgeDocument(documentId: string) {
  const document = await getDocument(documentId, DEMO_USER_ID);
  if (!document) return null;

  await deleteDocumentChunks(documentId, DEMO_USER_ID);
  return deleteStoredDocument(documentId, DEMO_USER_ID);
}

export async function searchKnowledge(query: string, topK = DEFAULT_TOP_K): Promise<KnowledgeHit[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new KnowledgeError("检索问题不能为空。", 400);
  if (normalizedQuery.length > MAX_QUERY_LENGTH) {
    throw new KnowledgeError("检索问题请控制在 4000 字以内。", 400);
  }

  const safeTopK = Number.isFinite(topK) ? Math.min(Math.max(Math.floor(topK), 1), 10) : DEFAULT_TOP_K;
  const documents = (await listDocuments(DEMO_USER_ID)).filter((document) => document.status === "ready");
  if (documents.length === 0) return [];

  const [embedding] = await requestEmbeddings([normalizedQuery]);
  const readyDocumentIds = new Set(documents.map((document) => document.id));
  const hits = await searchChunks(embedding, safeTopK, DEMO_USER_ID);
  return hits.filter((hit) => readyDocumentIds.has(hit.documentId));
}

export function buildKnowledgePrompt(hits: KnowledgeHit[]) {
  if (hits.length === 0) {
    return `
知识库检索结果：未命中足够相关的资料。
回答规则：只能依据实际提供的知识库资料回答业务事实；当前没有足够资料时，明确回答“知识库中没有足够资料”，不要使用模型常识补写。不要伪造 [S1] 等来源标记。`;
  }

  const context = hits
    .map(
      (hit, index) =>
        `[S${index + 1}] 文档：${hit.documentName}；章节：${hit.sectionTitle}；片段：\n${hit.content}`,
    )
    .join("\n\n");

  return `
知识库检索资料：
${context}

回答规则：只能根据上面的知识库资料回答，不要使用模型常识补写业务事实。资料不足时明确回答“知识库中没有足够资料”。如果引用资料，请使用 [S1]、[S2] 形式标记来源；来源标记只能使用实际提供的片段。`;
}
