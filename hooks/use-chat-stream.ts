"use client";

import { useCallback, useRef, useState } from "react";
import type { KnowledgeSource, Message, ServerEvent, TraceItem } from "../lib/chat-types";

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: "你好。试着问我“Token 是什么”，或者打开知识库后问文档里的问题，观察检索、流式输出和工具调用轨迹。",
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

export function useChatStream() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [isLoading, setIsLoading] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [retrievalHits, setRetrievalHits] = useState<KnowledgeSource[]>([]);
  const [model, setModel] = useState("尚未请求");
  const [requestTokens, setRequestTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const appendTrace = useCallback((label: string, detail: string, tone: TraceItem["tone"] = "neutral") => {
    setTrace((current) => [...current, { id: createId("trace"), label, detail, tone }]);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([WELCOME]);
    setTrace([]);
    setRetrievalHits([]);
    setError(null);
    setModel("尚未请求");
    setRequestTokens(0);
    setIsLoading(false);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (content: string, knowledgeBase: boolean) => {
      if (!content || isLoading) return;

      const userMessage: Message = { id: createId("user"), role: "user", content };
      const assistantId = createId("assistant");
      const assistantMessage: Message = { id: assistantId, role: "assistant", content: "" };
      const nextMessages = [...messages, userMessage];
      setMessages([...nextMessages, assistantMessage]);
      setTrace([]);
      setRetrievalHits([]);
      setError(null);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
            knowledgeBase,
          }),
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
            if (eventData.type === "retrieval") {
              setRetrievalHits(eventData.hits);
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, sources: eventData.hits } : message,
                ),
              );
              appendTrace(
                eventData.hits.length > 0 ? "知识库检索完成" : "知识库未命中",
                eventData.hits.length > 0
                  ? `命中 ${eventData.hits.length} 个片段：${eventData.hits.map((hit) => hit.documentName).join("、")}`
                  : "没有超过相似度阈值的片段，模型必须回答资料不足。",
                eventData.hits.length > 0 ? "success" : "neutral",
              );
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
    },
    [appendTrace, isLoading, messages],
  );

  return {
    messages,
    isLoading,
    trace,
    retrievalHits,
    model,
    requestTokens,
    error,
    reset,
    stop,
    sendMessage,
  };
}
