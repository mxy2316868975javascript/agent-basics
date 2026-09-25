import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeDocument } from "./knowledge-types";

const DATA_DIRECTORY = path.join(process.cwd(), "data", "knowledge");
const FILE_DIRECTORY = path.join(DATA_DIRECTORY, "files");
const INDEX_FILE = path.join(DATA_DIRECTORY, "documents.json");

let storeLock = Promise.resolve();

// ponytail: process-local lock is enough for this single-process demo; use a database transaction for multi-instance writes.
async function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = storeLock;
  let release!: () => void;
  storeLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function ensureStore() {
  await mkdir(FILE_DIRECTORY, { recursive: true });
  try {
    await readFile(INDEX_FILE, "utf8");
  } catch {
    await writeFile(INDEX_FILE, "[]\n", "utf8");
  }
}

async function readDocumentsUnsafe(): Promise<KnowledgeDocument[]> {
  await ensureStore();
  const raw = await readFile(INDEX_FILE, "utf8");
  return JSON.parse(raw) as KnowledgeDocument[];
}

async function writeDocumentsUnsafe(documents: KnowledgeDocument[]) {
  const temporaryFile = `${INDEX_FILE}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(documents, null, 2)}\n`, "utf8");
  await rename(temporaryFile, INDEX_FILE);
}

export function getSourceFilePath(documentId: string, extension: "md" | "txt") {
  return path.join(FILE_DIRECTORY, `${documentId}.${extension}`);
}

export async function listDocuments(ownerId: string) {
  return withStoreLock(async () =>
    (await readDocumentsUnsafe())
      .filter((document) => document.ownerId === ownerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
}

export async function getDocument(documentId: string, ownerId: string) {
  return withStoreLock(async () => {
    const documents = await readDocumentsUnsafe();
    return documents.find((document) => document.id === documentId && document.ownerId === ownerId) ?? null;
  });
}

export async function findDocumentByHash(contentHash: string, ownerId: string) {
  return withStoreLock(async () => {
    const documents = await readDocumentsUnsafe();
    return documents.find(
      (document) => document.ownerId === ownerId && document.contentHash === contentHash,
    ) ?? null;
  });
}

export async function createDocument(document: KnowledgeDocument, source: string) {
  return withStoreLock(async () => {
    const documents = await readDocumentsUnsafe();
    await writeFile(getSourceFilePath(document.id, document.extension), source, "utf8");
    documents.push(document);
    await writeDocumentsUnsafe(documents);
    return document;
  });
}

export async function updateDocument(documentId: string, ownerId: string, update: Partial<KnowledgeDocument>) {
  return withStoreLock(async () => {
    const documents = await readDocumentsUnsafe();
    const index = documents.findIndex((document) => document.id === documentId && document.ownerId === ownerId);
    if (index === -1) return null;

    const next = { ...documents[index], ...update, updatedAt: new Date().toISOString() };
    documents[index] = next;
    await writeDocumentsUnsafe(documents);
    return next;
  });
}

export async function deleteDocument(documentId: string, ownerId: string) {
  return withStoreLock(async () => {
    const documents = await readDocumentsUnsafe();
    const document = documents.find((item) => item.id === documentId && item.ownerId === ownerId);
    if (!document) return null;

    const remaining = documents.filter((item) => item.id !== documentId);
    await writeDocumentsUnsafe(remaining);
    await unlink(getSourceFilePath(document.id, document.extension)).catch(() => undefined);
    return document;
  });
}
