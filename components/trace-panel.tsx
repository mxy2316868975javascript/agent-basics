"use client";

import type { KnowledgeSource, TraceItem } from "../lib/chat-types";

type TracePanelProps = {
  trace: TraceItem[];
  retrievalHits: KnowledgeSource[];
  model: string;
  requestTokens: number;
  isLoading: boolean;
};

export function TracePanel({ trace, retrievalHits, model, requestTokens, isLoading }: TracePanelProps) {
  return (
    <aside className="trace-column" aria-label="请求轨迹">
      <div className="trace-header">
        <div>
          <p className="eyebrow">OBSERVATION</p>
          <h3>这次请求发生了什么</h3>
        </div>
        <span className={`live-status ${isLoading ? "active" : ""}`}><i />{isLoading ? "运行中" : "就绪"}</span>
      </div>

      <div className="metrics-row">
        <div><span>模型</span><strong>{model}</strong></div>
        <div><span>输入 Token</span><strong>{requestTokens || "—"}</strong></div>
      </div>

      <div className="trace-list">
        {trace.length === 0 ? (
          <div className="trace-empty"><span>01</span><p>发送一个问题后，这里会显示检索、浏览器、Node、模型和工具之间的真实事件。</p></div>
        ) : (
          trace.map((item, index) => (
            <div className={`trace-item ${item.tone}`} key={item.id}>
              <span className="trace-index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{item.label}</strong><p>{item.detail}</p></div>
            </div>
          ))
        )}
      </div>

      {retrievalHits.length > 0 && (
        <div className="retrieval-summary">
          <span>本次检索来源</span>
          {retrievalHits.map((hit, index) => (
            <div key={`${hit.documentId}-${hit.chunkIndex}`}>
              <b>[S{index + 1}]</b>
              <p>{hit.documentName}<small>{hit.sectionTitle} · 片段 {hit.chunkIndex} · 相似度 {hit.score.toFixed(2)}</small></p>
            </div>
          ))}
        </div>
      )}

      <div className="learning-tip">
        <span>先记住</span>
        <p>Embedding 负责找资料，LLM 负责组织答案，SSE 负责把答案逐段送回浏览器。工具仍然由 Node 执行。</p>
      </div>
    </aside>
  );
}
