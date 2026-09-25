"use client";

import { FormEvent, useMemo, useState } from "react";
import { approximateTokens } from "../lib/tokens";
import type { Message } from "../lib/chat-types";

type ChatPanelProps = {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSend: (content: string) => void;
  onStop: () => void;
};

export function ChatPanel({ messages, isLoading, error, onSend, onStop }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const inputTokens = useMemo(() => approximateTokens(input), [input]);

  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || isLoading) return;
    setInput("");
    onSend(content);
  }

  return (
    <section className="chat-column" aria-label="流式对话">
      <div className="flow-strip" aria-label="请求流程">
        <span>浏览器</span><b>→</b><span>检索</span><b>→</b><span>Node API</span><b>→</b><span>LLM</span><b>→</b><span>SSE</span>
      </div>

      <div className="messages" aria-live="polite">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-meta">
              <span>{message.role === "user" ? "你" : "AI 教练"}</span>
              {message.role === "assistant" && message.id !== "welcome" && isLoading && !message.content && <i className="typing-dot" />}
            </div>
            <p>{message.content || "正在等待模型返回…"}</p>
            {message.sources && message.sources.length > 0 && (
              <div className="message-sources">
                <span>回答来源</span>
                <div>
                  {message.sources.map((source, index) => (
                    <span className="source-chip" key={`${source.documentId}-${source.chunkIndex}`}>
                      [S{index + 1}] {source.documentName} · {source.sectionTitle} · {source.score.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="composer" onSubmit={sendMessage}>
        <textarea
          aria-label="输入问题"
          disabled={isLoading}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder="试试：Token 是什么？或者：退款期限是多久？"
          rows={3}
          value={input}
        />
        <div className="composer-footer">
          <span>当前输入约 {inputTokens} tokens · 仅为教学估算</span>
          {isLoading ? (
            <button className="stop-button" onClick={onStop} type="button">■ 停止</button>
          ) : (
            <button className="send-button" disabled={!input.trim()} type="submit">发送问题 <span>↗</span></button>
          )}
        </div>
      </form>
    </section>
  );
}
