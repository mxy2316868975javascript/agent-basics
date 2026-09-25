# AI 基础实验室

一个用于理解 AI 应用基本组成的最小 Next.js Demo：

- `LLM`：服务端调用 OpenAI-compatible Chat Completions。
- `Token`：页面展示输入文本的近似 Token 数，只用于理解计量概念。
- `Embedding`：服务端调用 OpenAI-compatible `/embeddings`，为知识库片段生成真实向量。
- `SSE`：模型最终回答通过服务端事件逐段返回浏览器。
- `Function Calling`：询问当前时间时，模型请求 `get_current_time`，Node 执行后把结果交回模型。

## 分阶段学习文档

- [P0：基础对话与核心能力](docs/P0-foundation.md) —— 当前代码已经实现的能力和边界。
- [P1：RAG 知识库](docs/P1-rag.md) —— 文档上传、分片、Embedding 和向量检索。
- [P2：Agent 与工作流](docs/P2-agent.md) —— 工具编排、状态、权限、评测和观测。

## 运行

> P1 使用 `chromadb@3.5.0`，请使用 Node.js 20+；P0 的基础聊天在 Node.js 18.18+ 可运行。

```bash
npm install
cp .env.example .env.local
```

填写 `.env.local` 的 `LLM_API_KEY`，然后：

```bash
npm run dev
```

P1 知识库还需要先启动本地 Chroma：

```bash
docker compose up -d
```

然后打开：

```text
http://localhost:3000
```

上传 `.md` 或 `.txt` 文件，等待状态变为 `ready`，打开“使用知识库”后提问即可看到检索来源。

### 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `LLM_API_KEY` | 服务端调用 Chat Completions 和 Embedding | 无，必须填写 |
| `LLM_BASE_URL` | OpenAI-compatible 服务地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 对话模型 | `gpt-4o-mini` |
| `EMBEDDING_MODEL` | 向量模型 | `text-embedding-3-small` |
| `CHROMA_URL` | 本地 Chroma 地址 | `http://localhost:8000` |
| `CHROMA_COLLECTION` | Chroma collection 名称 | `ai_basics_demo_chunks` |

## 检查

```bash
npm run typecheck
npm run build
```

## 一次请求的真实路径

```text
React 页面
  -> POST /api/chat（可先检索 Chroma）
  -> POST /api/knowledge/documents（上传时解析、Embedding、写入 Chroma）
  -> Node 首轮请求模型，判断是否需要工具
  -> Node 执行 get_current_time（如果被请求）
  -> Node 第二轮请求模型，并以 SSE 转发 token
  -> React 逐段追加 AI 消息
```

模型 Key 只放在 Node 服务端环境变量中，不会发送到浏览器。

P1 使用固定的 `demo-user` 演示 owner 过滤，文档元数据保存在 `data/knowledge/`，Chroma 数据保存在 `data/chroma/`，两者都不会提交到 Git。当前索引是同步处理，适合学习和单进程开发，不包含登录、队列、PDF/DOCX 解析或多实例协调。
