export const GET_CURRENT_TIME_TOOL = {
  type: "function" as const,
  function: {
    name: "get_current_time",
    description: "获取当前时间。用户询问现在几点、今天日期或当前时间时使用。",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA 时区，例如 Asia/Shanghai 或 UTC。默认使用 Asia/Shanghai。",
        },
      },
      additionalProperties: false,
    },
  },
};

export type ToolResult = {
  name: string;
  ok: boolean;
  data: Record<string, string>;
};

export function executeTool(name: string, rawArguments: string): ToolResult {
  if (name !== "get_current_time") {
    return { name, ok: false, data: { error: `未知工具：${name}` } };
  }

  let timezone = "Asia/Shanghai";
  try {
    const args = JSON.parse(rawArguments || "{}") as { timezone?: unknown };
    if (typeof args.timezone === "string" && args.timezone.trim()) {
      timezone = args.timezone.trim();
    }
  } catch {
    return { name, ok: false, data: { error: "工具参数不是合法 JSON。" } };
  }

  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: timezone,
    }).format(now);

    return {
      name,
      ok: true,
      data: { timezone, iso: now.toISOString(), formatted },
    };
  } catch {
    return { name, ok: false, data: { error: `不支持的时区：${timezone}` } };
  }
}
