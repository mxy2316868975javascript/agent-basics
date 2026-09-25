import { KnowledgeError, searchKnowledge } from "../../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; topK?: unknown };
    if (typeof body.query !== "string") throw new KnowledgeError("query 必须是字符串。", 400);

    const topK = body.topK === undefined ? 5 : Number(body.topK);
    if (!Number.isFinite(topK)) throw new KnowledgeError("topK 必须是数字。", 400);

    return Response.json({ hits: await searchKnowledge(body.query, topK) });
  } catch (error) {
    const status = error instanceof KnowledgeError ? error.status : 503;
    return Response.json(
      { error: error instanceof Error ? error.message : "知识库检索失败。" },
      { status },
    );
  }
}
