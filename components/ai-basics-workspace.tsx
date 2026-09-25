"use client";

import { useState } from "react";
import { ChatPanel } from "./chat-panel";
import { KnowledgePanel } from "./knowledge-panel";
import { TracePanel } from "./trace-panel";
import { useChatStream } from "../hooks/use-chat-stream";

const CONCEPTS = [
  { key: "LLM", mark: "01", title: "LLM", body: "负责理解上下文并生成下一段内容。它是回答者，不是你的业务数据库。", tone: "coral" },
  { key: "Token", mark: "02", title: "Token", body: "模型处理文本的计量单位，影响上下文长度、速度和费用。", tone: "yellow" },
  { key: "Embedding", mark: "03", title: "Embedding", body: "把文本变成表达语义的数字向量，适合做相似度搜索。", tone: "mint" },
  { key: "SSE", mark: "04", title: "SSE", body: "服务端生成一小段就推一小段，让答案不必等全部生成完。", tone: "blue" },
  { key: "Function Calling", mark: "05", title: "Function Calling", body: "模型提出工具调用请求，Node 真正执行函数并把结果交回模型。", tone: "purple" },
] as const;

export function AiBasicsWorkspace() {
  const [knowledgeBase, setKnowledgeBase] = useState(true);
  const chat = useChatStream();

  return (
    <main className="app-shell">
      <aside className="concept-sidebar">
        <div className="brand-row">
          <div className="brand-mark">AI</div>
          <div>
            <p className="eyebrow">FRONTEND → AI</p>
            <h1>基础实验室</h1>
          </div>
        </div>

        <div className="sidebar-intro">
          <p className="eyebrow">P0 → P1 · BUILDING BLOCKS</p>
          <h2>先看懂一条请求怎么跑</h2>
          <p>左边是核心概念，右边可以亲手跑通聊天、检索、工具和流式输出。</p>
        </div>

        <div className="concept-list">
          {CONCEPTS.map((concept) => (
            <article className="concept-item" key={concept.key}>
              <span className={`concept-mark ${concept.tone}`}>{concept.mark}</span>
              <div>
                <div className="concept-title-row">
                  <h3>{concept.title}</h3>
                  <span className="concept-status">基础</span>
                </div>
                <p>{concept.body}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="sidebar-note">
          <span className="note-dot" />
          <p>P1 增加真实 Embedding、Chroma 向量检索和来源引用；数据仍只属于固定 demo-user。</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">LIVE REQUEST LAB</p>
            <h2>AI 应用的第一条链路</h2>
          </div>
          <button className="reset-button" onClick={chat.reset} type="button">清空会话</button>
        </header>

        <div className="workspace-grid">
          <div className="chat-column">
            <KnowledgePanel enabled={knowledgeBase} onEnabledChange={setKnowledgeBase} />
            <ChatPanel
              error={chat.error}
              isLoading={chat.isLoading}
              messages={chat.messages}
              onSend={(content) => void chat.sendMessage(content, knowledgeBase)}
              onStop={chat.stop}
            />
          </div>
          <TracePanel
            isLoading={chat.isLoading}
            model={chat.model}
            requestTokens={chat.requestTokens}
            retrievalHits={chat.retrievalHits}
            trace={chat.trace}
          />
        </div>
      </section>
    </main>
  );
}
