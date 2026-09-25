import {
  getKnowledgeDocument,
  KnowledgeError,
  removeKnowledgeDocument,
} from "../../../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const document = await getKnowledgeDocument(id);
  if (!document) return Response.json({ error: "文档不存在。" }, { status: 404 });
  return Response.json({ document });
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await removeKnowledgeDocument(id);
    if (!document) throw new KnowledgeError("文档不存在。", 404);
    return Response.json({ document });
  } catch (error) {
    const status = error instanceof KnowledgeError ? error.status : 503;
    return Response.json(
      { error: error instanceof Error ? error.message : "文档删除失败。" },
      { status },
    );
  }
}
