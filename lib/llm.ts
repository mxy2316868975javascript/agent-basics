export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type CompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
};

type ChatChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
};

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export function getModelConfig() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError("服务端尚未配置 LLM_API_KEY，请先复制 .env.example 为 .env.local 并填写。");
  }

  return {
    apiKey,
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/u, ""),
  };
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const timer = setTimeout(() => controller.abort(new Error("模型请求超时。")), timeoutMs);

  if (parentSignal?.aborted) abortFromParent();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function postCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ response: Response; cleanup: () => void }> {
  const config = getModelConfig();
  const requestSignal = createRequestSignal(signal, 90_000);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: config.model, ...body }),
      signal: requestSignal.signal,
    });
    return { response, cleanup: requestSignal.cleanup };
  } catch (error) {
    requestSignal.cleanup();
    throw error;
  }
}

async function readProviderError(response: Response) {
  const detail = (await response.text()).slice(0, 300);
  return `模型服务返回 ${response.status}: ${detail || "无错误详情"}`;
}

export async function requestCompletion(
  messages: ModelMessage[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<CompletionResponse> {
  const pending = await postCompletion(
    {
      messages,
      tools,
      tool_choice: "auto",
      stream: false,
      temperature: 0.2,
      max_tokens: 300,
    },
    signal,
  );

  try {
    if (!pending.response.ok) throw new Error(await readProviderError(pending.response));
    return (await pending.response.json()) as CompletionResponse;
  } finally {
    pending.cleanup();
  }
}

function parseSsePayload(block: string): string | null {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  return data && data !== "[DONE]" ? data : null;
}

export async function* streamCompletion(
  messages: ModelMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const pending = await postCompletion(
    {
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 600,
    },
    signal,
  );

  try {
    if (!pending.response.ok) throw new Error(await readProviderError(pending.response));
    if (!pending.response.body) throw new Error("模型服务没有返回可读取的流。");

    const reader = pending.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const blocks = buffer.split(/\r?\n\r?\n/u);
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const payload = parseSsePayload(block);
          if (!payload) continue;

          try {
            const chunk = JSON.parse(payload) as ChatChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Provider 的 SSE 数据可能跨网络分片；不让单个坏事件击穿整次对话。
          }
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    pending.cleanup();
  }
}

export function getModelName() {
  return getModelConfig().model;
}
