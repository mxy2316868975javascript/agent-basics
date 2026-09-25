"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import type { KnowledgeDocument } from "../lib/chat-types";

type KnowledgePanelProps = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

export function KnowledgePanel({ enabled, onEnabledChange }: KnowledgePanelProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/knowledge/documents", { cache: "no-store" });
        const body = (await response.json()) as { documents?: KnowledgeDocument[]; error?: string };
        if (!response.ok) throw new Error(body.error || "知识库列表加载失败。");
        setDocuments(body.documents ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "知识库列表加载失败。");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/knowledge/documents", { method: "POST", body: formData });
      const body = (await response.json()) as { document?: KnowledgeDocument; error?: string };
      if (!response.ok || !body.document) throw new Error(body.error || "文档上传失败。");
      setDocuments((current) => [body.document!, ...current.filter((document) => document.id !== body.document!.id)]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文档上传失败。");
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(document: KnowledgeDocument) {
    setError(null);
    try {
      const response = await fetch(`/api/knowledge/documents/${document.id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "文档删除失败。");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "文档删除失败。");
    }
  }

  return (
    <section className="knowledge-panel" aria-label="RAG 知识库">
      <div className="knowledge-header">
        <div>
          <p className="eyebrow">P1 · RETRIEVAL</p>
          <h3>知识库</h3>
        </div>
        <label className="switch-label">
          <input checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} type="checkbox" />
          <span className="switch-track" aria-hidden="true"><i /></span>
          <span>使用知识库</span>
        </label>
      </div>

      <div className="knowledge-upload">
        <div>
          <strong>{documents.length} 个文档</strong>
          <p>Markdown / TXT · 单文件不超过 1 MB</p>
        </div>
        <button className="upload-button" disabled={uploading} onClick={() => inputRef.current?.click()} type="button">
          {uploading ? "索引中…" : "上传文档"}
        </button>
        <input ref={inputRef} accept=".md,.txt,text/markdown,text/plain" hidden onChange={uploadFile} type="file" />
      </div>

      {error && <div className="knowledge-error">{error}</div>}

      <div className="document-list">
        {isLoading ? (
          <p className="document-empty">正在读取文档列表…</p>
        ) : documents.length === 0 ? (
          <p className="document-empty">还没有文档。上传一份包含退款规则的 Markdown，马上试试检索。</p>
        ) : (
          documents.map((document) => (
            <div className="document-row" key={document.id}>
              <div className="document-icon">{document.name.toLowerCase().endsWith(".md") ? "MD" : "TXT"}</div>
              <div className="document-info">
                <strong title={document.name}>{document.name}</strong>
                <span>{document.status === "ready" ? `${document.chunkCount} 个片段 · ${formatDate(document.createdAt)}` : document.errorMessage || document.status}</span>
              </div>
              <span className={`document-status ${document.status}`}>{document.status}</span>
              <button aria-label={`删除 ${document.name}`} className="delete-button" onClick={() => void removeFile(document)} type="button">×</button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
