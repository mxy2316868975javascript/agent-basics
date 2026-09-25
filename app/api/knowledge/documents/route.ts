import { indexKnowledgeFile, KnowledgeError, getKnowledgeDocuments } from "../../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const status = error instanceof KnowledgeError ? error.status : 503;
  const message = error instanceof Error ? error.message : "知识库暂时不可用。";
  return Response.json({ error: message }, { status });
}

export async function GET() {
  return Response.json({ documents: await getKnowledgeDocuments() });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new KnowledgeError("字段 file 必须是 Markdown 或 TXT 文件。", 400);

    const document = await indexKnowledgeFile(file, request.signal);
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
