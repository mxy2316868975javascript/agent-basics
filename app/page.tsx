"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { approximateTokens } from "../lib/tokens";

type Message = { id: string; role: "user" | "assistant"; content: string };
type TraceItem = { id: string; label: string; detail: string; tone: "neutral" | "tool" | "success" | "error" };
type ServerEvent =
  | { type: "meta"; model: string; approximateTokens: number }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: Record<string, string>; ok: boolean }
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

const CONCEPTS = [
  { key: "LLM", mark: "01", title: "LLM", body: "负责理解上下文并生成下一段内容。它是回答者，不是你的业务数据库。", tone: "coral" },
  { key: "Token", mark: "02", title: "Token", body: "模型处理文本的计量单位，影响上下文长度、速度和费用。", tone: "yellow" },
  { key: "Embedding", mark: "03", title: "Embedding", body: "把文本变成表达语义的数字向量，适合做相似度搜索。", tone: "mint" },
  { key: "SSE", mark: "04", title: "SSE", body: "服务端生成一小段就推一小段，让答案不必等全部生成完。", tone: "blue" },
  { key: "Function Calling", mark: "05", title: "Function Calling", body: "模型提出工具调用请求，Node 真正执行函数并把结果交回模型。", tone: "purple" },
] as const;

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: "你好。试着问我“Token 是什么”，或者问“现在几点”，观察右侧的流式输出和工具调用轨迹。",
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseSse(buffer: string): { events: ServerEvent[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/u);
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const data = block
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();
    if (!data) return [];
    try {
      return [JSON.parse(data) as ServerEvent];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [model, setModel] = useState("尚未请求");
  const [requestTokens, setRequestTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const inputTokens = useMemo(() => approximateTokens(input), [input]);

  function appendTrace(label: string, detail: string, tone: TraceItem["tone"] = "neutral") {
    setTrace((current) => [...current, { id: createId("trace"), label, detail, tone }]);
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([WELCOME]);
    setTrace([]);
    setInput("");
    setError(null);
    setModel("尚未请求");
    setRequestTokens(0);
    setIsLoading(false);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || isLoading) return;

    const userMessage: Message = { id: createId("user"), role: "user", content };
    const assistantId = createId("assistant");
    const assistantMessage: Message = { id: assistantId, role: "assistant", content: "" };
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, assistantMessage]);
    setInput("");
    setTrace([]);
    setError(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `请求失败（${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const parsed = parseSse(buffer);
        buffer = parsed.rest;

        for (const eventData of parsed.events) {
          if (eventData.type === "meta") {
            setModel(eventData.model);
            setRequestTokens(eventData.approximateTokens);
            appendTrace("请求已进入服务端", `模型 ${eventData.model} · 约 ${eventData.approximateTokens} tokens`);
          }
          if (eventData.type === "tool_call") {
            appendTrace("模型请求工具", `${eventData.name}(${eventData.arguments})`, "tool");
          }
          if (eventData.type === "tool_result") {
            appendTrace(
              "Node 执行工具",
              eventData.ok ? JSON.stringify(eventData.result) : `执行失败：${JSON.stringify(eventData.result)}`,
              eventData.ok ? "success" : "error",
            );
          }
          if (eventData.type === "token") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${eventData.content}` }
                  : message,
              ),
            );
          }
          if (eventData.type === "error") throw new Error(eventData.message);
        }

        if (done) break;
      }
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") {
        const message = requestError instanceof Error ? requestError.message : "请求失败，请稍后重试。";
        setError(message);
        appendTrace("请求失败", message, "error");
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }

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
          <p className="eyebrow">THE FIVE BUILDING BLOCKS</p>
          <h2>先看懂一条请求怎么跑</h2>
          <p>左边是概念地图，右边是可以亲手发送的最小链路。</p>
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
          <p>本 Demo 不接数据库和向量库，先把一次对话的真实链路看清楚。</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">LIVE REQUEST LAB</p>
            <h2>AI 应用的第一条链路</h2>
          </div>
          <button className="reset-button" onClick={reset} type="button">清空会话</button>
        </header>

        <div className="workspace-grid">
          <section className="chat-column" aria-label="流式对话">
            <div className="flow-strip" aria-label="请求流程">
              <span>浏览器</span><b>→</b><span>Node API</span><b>→</b><span>LLM</span><b>→</b><span>SSE</span>
            </div>

            <div className="messages" aria-live="polite">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-meta">
                    <span>{message.role === "user" ? "你" : "AI 教练"}</span>
                    {message.role === "assistant" && message.id !== "welcome" && isLoading && !message.content && <i className="typing-dot" />}
                  </div>
                  <p>{message.content || "正在等待模型返回..."}</p>
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
                    void sendMessage();
                  }
                }}
                placeholder="试试：Token 是什么？或者：现在几点？"
                rows={3}
                value={input}
              />
              <div className="composer-footer">
                <span>当前输入约 {inputTokens} tokens · 仅为教学估算</span>
                {isLoading ? (
                  <button className="stop-button" onClick={() => abortRef.current?.abort()} type="button">■ 停止</button>
                ) : (
                  <button className="send-button" disabled={!input.trim()} type="submit">发送问题 <span>↗</span></button>
                )}
              </div>
            </form>
          </section>

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
                <div className="trace-empty"><span>01</span><p>发送一个问题后，这里会显示浏览器、Node、模型和工具之间的真实事件。</p></div>
              ) : (
                trace.map((item, index) => (
                  <div className={`trace-item ${item.tone}`} key={item.id}>
                    <span className="trace-index">{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                  </div>
                ))
              )}
            </div>

            <div className="learning-tip">
              <span>先记住</span>
              <p>SSE 只负责“把结果送回来”；Function Calling 决定“模型想让后端做什么”。真正执行函数的是 Node。</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
