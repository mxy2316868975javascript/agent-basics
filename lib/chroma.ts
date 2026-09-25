import { ChromaClient, type Metadata, type Where } from "chromadb";
import type { KnowledgeChunk, KnowledgeHit } from "./knowledge-types";

const DEMO_USER_ID = "demo-user";
const DEFAULT_COLLECTION = "ai_basics_demo_chunks";
const DEFAULT_TOP_K = 5;
const DEFAULT_DISTANCE_THRESHOLD = 0.8;

let client: ChromaClient | null = null;

function getChromaConfig() {
  const rawUrl = process.env.CHROMA_URL || "http://localhost:8000";
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 8000)),
    ssl: url.protocol === "https:",
    collection: process.env.CHROMA_COLLECTION || DEFAULT_COLLECTION,
  };
}

function getClient() {
  if (!client) {
    const config = getChromaConfig();
    client = new ChromaClient({ host: config.host, port: config.port, ssl: config.ssl });
  }
  return client;
}

async function getCollection() {
  const config = getChromaConfig();
  return getClient().getOrCreateCollection({
    name: config.collection,
    embeddingFunction: null,
    metadata: { "hnsw:space": "cosine" },
  });
}

function ownerFilter(ownerId: string): Where {
  return { owner_id: { $eq: ownerId } };
}

function documentFilter(ownerId: string, documentId: string): Where {
  return {
    $and: [
      { owner_id: { $eq: ownerId } },
      { document_id: { $eq: documentId } },
    ],
  };
}

export async function checkChroma() {
  await getClient().heartbeat();
}

export async function upsertChunks(
  chunks: KnowledgeChunk[],
  embeddings: number[][],
  documentName: string,
  ownerId = DEMO_USER_ID,
) {
  const collection = await getCollection();
  const metadatas: Metadata[] = chunks.map((chunk) => ({
    owner_id: ownerId,
    document_id: chunk.documentId,
    document_name: documentName,
    section_title: chunk.sectionTitle,
    chunk_index: chunk.chunkIndex,
  }));

  await collection.upsert({
    ids: chunks.map((chunk) => chunk.id),
    documents: chunks.map((chunk) => chunk.content),
    embeddings,
    metadatas,
  });
}

export async function deleteDocumentChunks(documentId: string, ownerId = DEMO_USER_ID) {
  const collection = await getCollection();
  await collection.delete({ where: documentFilter(ownerId, documentId) });
}

export async function searchChunks(
  embedding: number[],
  topK = DEFAULT_TOP_K,
  ownerId = DEMO_USER_ID,
): Promise<KnowledgeHit[]> {
  const collection = await getCollection();
  const result = await collection.query<{ document_id: string; document_name: string; section_title: string; chunk_index: number }>({
    queryEmbeddings: [embedding],
    nResults: Math.min(Math.max(topK, 1), 10),
    where: ownerFilter(ownerId),
    include: ["documents", "metadatas", "distances"],
  });

  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];
  const hits: KnowledgeHit[] = [];

  for (let index = 0; index < documents.length; index += 1) {
    const content = documents[index];
    const metadata = metadatas[index];
    const distance = distances[index];
    if (!content || !metadata || typeof distance !== "number" || distance > DEFAULT_DISTANCE_THRESHOLD) continue;

    hits.push({
      content,
      score: Number(Math.max(0, 1 - distance).toFixed(4)),
      documentId: String(metadata.document_id),
      documentName: String(metadata.document_name),
      sectionTitle: String(metadata.section_title),
      chunkIndex: Number(metadata.chunk_index),
    });
  }

  return hits;
}

export { DEMO_USER_ID };
