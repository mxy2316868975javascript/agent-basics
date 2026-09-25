import type { KnowledgeChunk } from "./knowledge-types";

const MAX_CHUNK_CHARACTERS = 1200;
const OVERLAP_CHARACTERS = 160;

export function normalizeSourceText(value: string) {
  return value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trim();
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARACTERS) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_CHARACTERS, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = end - OVERLAP_CHARACTERS;
  }

  return chunks.filter(Boolean);
}

export function chunkMarkdown(source: string, documentId: string): KnowledgeChunk[] {
  const text = normalizeSourceText(source);
  if (!text) return [];

  const chunks: KnowledgeChunk[] = [];
  let sectionTitle = "未命名章节";
  let paragraphLines: string[] = [];

  const flush = () => {
    const paragraph = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!paragraph) return;

    const content = sectionTitle === "未命名章节" ? paragraph : `【${sectionTitle}】\n${paragraph}`;
    for (const piece of splitLongText(content)) {
      chunks.push({
        id: `${documentId}:${chunks.length}`,
        documentId,
        content: piece,
        chunkIndex: chunks.length,
        sectionTitle,
      });
    }
  };

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/u);
    if (heading) {
      flush();
      sectionTitle = heading[1].trim();
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    paragraphLines.push(line);
  }

  flush();
  return chunks;
}
