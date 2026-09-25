# P1：RAG 知识库

状态：**已实现，学习型版本**

P1 的目标是让 AI 不只依赖模型训练时学到的内容，而是能够根据用户上传的私有文档回答问题，并且给出可追溯的来源。

## 1. P1 要解决的问题

P0 只能依赖：

```text
模型已有知识 + 用户当前输入 + 历史对话
```

企业场景还需要回答：

- 公司退款规则是什么？
- 这份产品说明书的第三章讲了什么？
- 这个客户的合同中有没有特殊条款？
- 这个答案来自哪份文档、哪一页？

RAG 的全称是 Retrieval-Augmented Generation，意思是“先检索资料，再增强生成”。它不是重新训练模型，而是在每次回答前把相关资料找出来，放进 Prompt。

## 2. P1 的目标能力

| 能力 | 当前实现 |
| --- | --- |
| 文档上传 | 已实现，仅接收 Markdown、TXT，单文件最大 1 MB |
| 文本解析 | 已实现，统一换行、移除 BOM、保留原始文本 |
| 文档分片 | 已实现，按标题/段落切分，最大约 1200 字符并保留重叠 |
| Embedding | 已实现，服务端批量调用 OpenAI-compatible `/embeddings` |
| 向量检索 | 已实现，本地 Chroma cosine Top-K，距离阈值 0.8 |
| 来源引用 | 已实现，返回文档名、章节、片段序号和相似度 |
| 权限过滤 | 已实现，所有本地列表和 Chroma 查询固定过滤 `demo-user` |
| RAG 对话 | 已实现，检索结果通过 `retrieval` SSE 事件和 `[S1]` 来源进入页面 |

P1 先解决“能找对资料并引用来源”，不在第一版加入 Agent、自主规划或复杂重排序。

## 3. 整体数据流

### 3.1 文档入库

```text
浏览器上传文件
  ↓
Node 校验文件类型、大小和用户权限
  ↓
文本解析器提取正文
  ↓
按标题、段落和长度分片
  ↓
调用 Embedding API
  ↓
保存文档、片段、向量和来源元数据
  ↓
文档状态变为 ready
```

### 3.2 用户问答

```text
用户问题
  ↓
权限范围过滤
  ↓
问题生成 Embedding
  ↓
向量数据库查询最相似片段
  ↓
拼接带来源的检索上下文
  ↓
LLM 根据上下文回答
  ↓
SSE 返回答案和引用
```

## 4. 建议的最小数据模型

### Document

| 字段 | 作用 |
| --- | --- |
| `id` | 文档唯一 ID |
| `owner_id` | 所属用户或租户 |
| `name` | 原始文件名 |
| `mime_type` | 文件类型 |
| `version` | 文档版本 |
| `status` | `processing`、`ready`、`failed` |
| `created_at` | 上传时间 |

### DocumentChunk

| 字段 | 作用 |
| --- | --- |
| `id` | 片段唯一 ID |
| `document_id` | 所属文档 |
| `content` | 片段正文 |
| `embedding` | 向量数据 |
| `chunk_index` | 原文顺序 |
| `section_title` | 章节标题 |
| `page_number` | 页码，可为空 |
| `content_hash` | 防止重复处理 |

权限字段必须在片段上可查询，不能只在最终回答阶段检查。否则检索阶段就可能把无权限资料送进模型。

## 5. 文档分片策略

分片的目标是让每个片段“足够完整、足够小、可以被准确找回”。

推荐 P1 默认顺序：

1. 优先按标题和段落切分。
2. 单段过长时，再按 Token 长度切分。
3. 相邻片段保留少量重叠，避免一句话被切断。
4. 保存章节、页码和原文顺序。

不要只按字符数机械截断，因为标题和上下文会被拆散；也不要把整本文档作为一个向量，否则检索无法定位重点。

## 6. 检索策略

P1 最小实现可以采用：

```text
问题 Embedding
  → 过滤 owner_id / tenant_id
  → 向量相似度 Top-K
  → 去重
  → 拼接上下文
```

推荐把 `Top-K` 作为配置，而不是写死在页面里。返回结果必须保留相似度和来源信息，便于调试“为什么找到了这段资料”。

后续可以再加：

- 关键词检索和向量检索混合
- 重排序模型
- 问题改写
- 按文档类型、时间和标签过滤
- 引用片段完整性检查

这些属于效果优化，不应先于基本的来源和权限链路。

## 7. Prompt 组装

模型不应该只收到一串没有来源的文本。推荐明确区分用户问题和检索资料：

```text
系统规则：
只能根据提供的资料回答；资料不足时明确说不知道。

检索资料：
[来源：退款政策.md，第 3 节]
购买后七天内可以申请退款……

用户问题：
退款期限是多久？
```

回答可以同时返回：

```json
{
  "answer": "购买后七天内可以申请退款。",
  "citations": [
    { "document": "退款政策.md", "section": "第 3 节" }
  ]
}
```

模型说“资料里没有答案”时，不能自动用模型常识补一个看似合理的答案。

## 8. 已实现接口

| 接口 | 作用 |
| --- | --- |
| `POST /api/knowledge/documents` | 上传并创建文档处理任务 |
| `GET /api/knowledge/documents` | 查询当前用户可见的文档 |
| `GET /api/knowledge/documents/:id` | 查看文档处理状态和元数据 |
| `DELETE /api/knowledge/documents/:id` | 删除文档及其全部片段 |
| `POST /api/knowledge/search` | 调试检索结果和来源 |
| `POST /api/chat` | 在已有聊天接口中接入 RAG 上下文 |

检索调试接口很重要。没有它时，回答错误只能看到最终文本，无法判断是分片错误、向量错误还是 Prompt 错误。

### 8.1 启动 Chroma

```bash
docker compose up -d
curl http://localhost:8000/api/v2/heartbeat
```

`.env.local` 至少需要配置：

```text
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=ai_basics_demo_chunks
```

### 8.2 上传、检索和删除示例

上传会同步完成解析、Embedding 和 Chroma 写入；只有全部成功才返回 `ready`。

```bash
curl -X POST http://localhost:3000/api/knowledge/documents \
  -F 'file=@./refund-policy.md;type=text/markdown'

curl http://localhost:3000/api/knowledge/documents

curl -X POST http://localhost:3000/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"退款期限是多久？","topK":5}'

curl -X DELETE http://localhost:3000/api/knowledge/documents/doc_xxx
```

检索返回的 `score` 是 `1 - cosine distance`，只保留距离不超过 `0.8` 的片段。空结果是正常结果，表示没有足够相关的资料，不会把最低分片段强行交给模型。

### 8.3 RAG 聊天和 SSE

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"knowledgeBase":true,"messages":[{"role":"user","content":"退款期限是多久？"}]}'
```

响应为 `text/event-stream`，P1 在 P0 的 `meta`、`tool_call`、`tool_result`、`token`、`done`、`error` 之外增加：

```text
data: {"type":"retrieval","hits":[{"documentName":"refund-policy.md","sectionTitle":"退款规则","chunkIndex":0,"score":0.86}]}
```

没有命中时仍会发送 `retrieval`，但 `hits` 为空；系统 Prompt 会要求模型回答“知识库中没有足够资料”。将 `knowledgeBase` 设为 `false` 时，聊天回到 P0 的普通对话路径。

## 9. 当前代码结构和生命周期

| 文件 | 责任 |
| --- | --- |
| `lib/knowledge.ts` | 文件校验、哈希去重、索引编排、检索和 RAG Prompt |
| `lib/chunking.ts` | Markdown/TXT 规范化和标题/段落分片 |
| `lib/knowledge-store.ts` | 本地文档元数据、原文文件和原子写入 |
| `lib/chroma.ts` | Chroma collection、owner 过滤、向量写入/检索/删除 |
| `app/api/knowledge/documents/route.ts` | 上传和文档列表 |
| `app/api/knowledge/documents/[id]/route.ts` | 文档详情和删除 |
| `app/api/knowledge/search/route.ts` | 检索调试接口 |
| `app/api/chat/route.ts` | RAG 检索、Prompt 拼装、Function Calling 和 SSE |
| `components/knowledge-panel.tsx` | 上传、列表、状态和删除交互 |
| `hooks/use-chat-stream.ts` | SSE 读取、消息状态和检索/工具轨迹 |

索引生命周期是：

```text
校验文件 → SHA-256 查重 → processing → 分片 → 批量 Embedding → Chroma upsert → ready
                                                        ↘ 任一步失败 → 清理向量 → failed
```

文档重复上传时按 `owner_id + content_hash` 复用已有记录。同名但内容不同的文件会生成不同文档 ID，能够在检索结果中区分。

## 10. 失败场景

| 场景 | 处理方式 |
| --- | --- |
| 文件类型不支持 | 上传阶段拒绝，并返回允许类型 |
| 文件过大 | 上传阶段拒绝，不进入解析任务 |
| 文本解析失败 | 文档标记 `failed`，保留错误原因 |
| Embedding API 超时 | 可重试，不能把半成品标记为 `ready` |
| 向量库不可用 | 直接提示知识库暂时不可用 |
| 没有相关片段 | 明确告诉用户资料不足 |
| 用户无权访问文档 | 检索前过滤，不向模型暴露片段 |
| 删除文档 | 文档和所有片段必须一起失效或删除 |

## 11. P1 常见业务坑

RAG 最容易出现的误判是：“模型回答错了，所以模型不行。”实际上很多错误发生在文档解析、分片、权限过滤和索引生命周期，而不是生成阶段。

| 常见坑 | 解决方案 | 为什么要这么做 |
| --- | --- | --- |
| 文档状态显示 `ready`，实际正文没有被正确解析 | 入库前保留解析预览、字符数、页数和异常信息；质量不合格就标记 `failed` | PDF 双栏、扫描件、表格和页眉页脚很容易让解析结果与人眼看到的内容不同 |
| 只按固定字符数切片 | 优先按标题和段落切，再按 Token 上限兜底，并保留少量重叠 | 太小会失去上下文，太大会混入无关内容；结构化切片更容易命中完整事实 |
| 片段命中了，但回答仍然不相关 | 保留相似度，设置最低阈值，必要时混合关键词检索和重排序 | Top-K 一定会返回结果，不代表结果真的相关；没有阈值就会把“最不差的结果”误当答案 |
| 先查所有向量，再在回答阶段判断权限 | 在向量查询条件中加入 `tenant_id`、用户和文档 ACL | 无权限片段一旦进入模型上下文，就已经发生了数据泄露，事后隐藏引用也无法补救 |
| 文档更新后，旧内容仍被检索到 | 给文档做版本号和发布状态；新版本全部处理成功后再切换；删除使用失效标记 | 异步索引会产生新旧版本并存，不能让半成品或旧政策继续回答用户 |
| 删除文件只删了 Document，没有删 Chunk | 使用文档级级联删除或统一 tombstone 过滤，并验证检索结果 | 孤儿片段仍可能被向量检索命中，造成“文件明明删了但 AI 还能说出来” |
| 没有命中资料时，模型用常识补答案 | 设置检索阈值；低于阈值时明确回答“知识库没有足够资料” | RAG 的价值是可追溯事实，不是让模型用更自信的语气继续猜 |
| 引用显示了文档名，但引用内容没有支持答案 | 引用必须来自实际参与 Prompt 的片段，保存章节、页码和必要的原文摘录 | 只显示一个文件名不等于可验证来源，错误引用会让用户产生虚假信任 |
| 同一个文件反复上传，产生重复向量和重复答案 | 使用文件哈希、版本号和幂等入库键；重复任务复用已有结果 | 重复索引会浪费 Embedding 成本，也会让检索结果重复、排序不稳定 |
| 上传接口只检查扩展名 | 当前同时检查扩展名、允许的 MIME 和 1 MB 大小；扩展到 PDF/压缩包时再增加文件头和解析沙箱 | 扩展名可以伪造，解析能力扩大后恶意文件和资源消耗风险会增加 |
| 把同步索引误当成生产方案 | 当前明确限制 1 MB 和单进程；生产改成队列、任务状态、幂等键和重试 | Embedding 和向量写入耗时不可控，同步请求容易超时并造成重复提交 |
| 只拿几条“标准问题”评估效果 | 同时准备有答案、无答案、同义表达、跨文档和权限边界问题 | 真实用户不会只用文档标题里的原词提问，单一测试集会掩盖召回缺陷 |

## 12. P1 验收标准

- 上传一个 Markdown 文档后，可以看到从 `processing` 到 `ready` 的状态变化。
- 用户问题可以检索到相关片段。
- 回答中显示文档名称、章节或页码来源。
- 用户无法通过问题检索到无权限文档。
- 删除文档后，新的检索结果不再包含该文档。
- 检索调试接口可以独立查看 Top-K 片段。
- 准备至少 20 条问题作为基础回归集，覆盖有答案、无答案和相似表达。

## 13. 当前限制和升级方向

- `demo-user` 只是演示 owner 过滤，不是登录或生产权限系统。
- 元数据和原文在本地 JSON/文件目录，Chroma 使用本地持久化目录；不适合多实例同时写入。
- 当前同步处理 Markdown/TXT，不支持 PDF、DOCX、OCR、表格结构恢复或异步队列。
- 当前只用向量 Top-K 和阈值，没有混合检索、重排序、版本发布切换或评测集。
- P2 再补充真实认证、任务队列、ACL、重排序、离线评测、成本统计和生产级观测。

## 14. 从 P0 到 P1 的新增边界

P0 的 `POST /api/chat` 只处理消息和工具调用；P1 会新增文档处理链路、向量存储和引用结构。不要把文档全文直接拼进 P0 Prompt，也不要在浏览器端保存 API Key、Embedding 向量或未过滤的私有文档。
