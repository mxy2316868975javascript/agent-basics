# AI 基础实验室

一个用于理解 AI 应用基本组成的最小 Next.js Demo：

- `LLM`：服务端调用 OpenAI-compatible Chat Completions。
- `Token`：页面展示输入文本的近似 Token 数，只用于理解计量概念。
- `Embedding`：页面解释语义向量；本版本不接真实 Embedding API 或向量数据库。
- `SSE`：模型最终回答通过服务端事件逐段返回浏览器。
- `Function Calling`：询问当前时间时，模型请求 `get_current_time`，Node 执行后把结果交回模型。

## 分阶段学习文档

- [P0：基础对话与核心能力](docs/P0-foundation.md) —— 当前代码已经实现的能力和边界。
- [P1：RAG 知识库](docs/P1-rag.md) —— 文档上传、分片、Embedding 和向量检索。
- [P2：Agent 与工作流](docs/P2-agent.md) —— 工具编排、状态、权限、评测和观测。

## 运行

```bash
npm install
cp .env.example .env.local
```

填写 `.env.local` 的 `LLM_API_KEY`，然后：

```bash
npm run dev
```

打开 <http://localhost:3000>。

## 检查

```bash
npm run typecheck
npm run build
```

## 一次请求的真实路径

```text
React 页面
  -> POST /api/chat
  -> Node 首轮请求模型，判断是否需要工具
  -> Node 执行 get_current_time（如果被请求）
  -> Node 第二轮请求模型，并以 SSE 转发 token
  -> React 逐段追加 AI 消息
```

模型 Key 只放在 Node 服务端环境变量中，不会发送到浏览器。
