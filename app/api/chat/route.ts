import { getModelName, getModelConfig, requestCompletion, streamCompletion, type ModelMessage } from "../../../lib/llm";
import { approximateTokens } from "../../../lib/tokens";
import { executeTool, GET_CURRENT_TIME_TOOL } from "../../../lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

type ClientMessage = { role: "user" | "assistant"; content: string };

type ServerEvent =
  | { type: "meta"; model: string; approximateTokens: number }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: Record<string, string>; ok: boolean }
  | { type: "token"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SYSTEM_PROMPT = `你是一个面向前端工程师的 AI 入门教练。
请使用简洁、自然的中文回答，优先解释 LLM、Token、Embedding、SSE 和 Function Calling 的关系。
如果用户询问当前时间、现在几点或今天日期，调用 get_current_time 工具后再回答。
不要声称自己已经访问了没有提供的文件、数据库或网络数据。`;

function validateMessages(value: unknown): ClientMessage[] {
  if (!value || typeof value !== "object") throw new Error("请求格式不正确。");
  const body = value as { messages?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("至少需要一条消息。");
  }

  const messages = body.messages.slice(-20).filter((message): message is ClientMessage => {
    return Boolean(
      message &&
        typeof message === "object" &&
        ((message as ClientMessage).role === "user" || (message as ClientMessage).role === "assistant") &&
        typeof (message as ClientMessage).content === "string" &&
        (message as ClientMessage).content.trim(),
    );
  });

  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) throw new Error("至少需要一条用户消息。");
  if (latest.content.length > 4000) throw new Error("单次问题请控制在 4000 字以内。");
  return messages;
}

function eventLine(event: ServerEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  let messages: ClientMessage[];

  try {
    messages = validateMessages(await request.json());
    getModelConfig();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "请求无法处理。" },
      { status: error instanceof Error && error.name === "LlmConfigurationError" ? 503 : 400 },
    );
  }

  const modelMessages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: ServerEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(eventLine(event)));
        } catch {
          closed = true;
        }
      };

      void (async () => {
        try {
          send({
            type: "meta",
            model: getModelName(),
            approximateTokens: approximateTokens(messages.map((message) => message.content).join("\n")),
          });

          const first = await requestCompletion(modelMessages, [GET_CURRENT_TIME_TOOL], request.signal);
          const assistant = first.choices?.[0]?.message;
          const toolCalls = assistant?.tool_calls ?? [];
          const followUpMessages: ModelMessage[] = [...modelMessages];

          if (toolCalls.length > 0) {
            followUpMessages.push({
              role: "assistant",
              content: assistant?.content ?? null,
              tool_calls: toolCalls,
            });

            for (const toolCall of toolCalls) {
              send({
                type: "tool_call",
                name: toolCall.function.name,
                arguments: toolCall.function.arguments || "{}",
              });

              const result = executeTool(toolCall.function.name, toolCall.function.arguments || "{}");
              send({ type: "tool_result", name: result.name, result: result.data, ok: result.ok });
              followUpMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: result.name,
                content: JSON.stringify(result.data),
              });
            }
          }

          // 首轮负责判断是否调用工具，第二轮关闭工具并真正以流式方式生成答案。
          for await (const token of streamCompletion(followUpMessages, request.signal)) {
            send({ type: "token", content: token });
          }

          send({ type: "done" });
        } catch (error) {
          if (!request.signal.aborted) {
            send({
              type: "error",
              message: error instanceof Error ? error.message : "模型服务暂时不可用。",
            });
          }
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // 客户端主动停止时，流可能已经关闭。
            }
          }
        }
      })();
    },
    cancel() {
      // 浏览器取消 fetch 后，request.signal 会负责中止上游模型请求。
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
