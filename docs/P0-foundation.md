# P0：基础对话与核心能力

状态：**已实现**

P0 的目标不是做一个完整的 AI 产品，而是把一次 AI 请求最小、真实地跑通，让前端工程师看清楚 LLM、Token、Embedding、SSE 和 Function Calling 的职责边界。

## 1. 能力清单

| 能力 | 当前状态 | 本 Demo 中的实现 |
| --- | --- | --- |
| LLM | 已实现 | Node 服务端调用 OpenAI-compatible `/chat/completions` |
| Token | 教学估算 | 页面显示近似输入 Token，不冒充模型 tokenizer 的精确结果 |
| Embedding | 概念展示 | 只解释语义向量和搜索用途，不调用 Embedding API |
| SSE | 已实现 | Node 将模型输出转换成 SSE，React 逐段追加答案 |
| Function Calling | 已实现 | 模型请求 `get_current_time`，Node 执行后把结果交回模型 |

因此，P0 已经具备真正的 LLM、SSE 和 Function Calling 链路；Embedding 仍然是下一阶段 RAG 的入口概念。

## 2. 系统结构

```text
浏览器 React
  │
  │ POST /api/chat
  ▼
Next.js Node API
  ├─ 校验消息和环境变量
  ├─ 首轮请求模型：判断是否需要工具
  ├─ 执行本地工具：get_current_time
  ├─ 第二轮请求模型：流式生成最终答案
  └─ 通过 SSE 转发 meta/tool/token/done/error
  │
  ▼
浏览器读取 ReadableStream 并更新页面
```

这里有两次模型请求是刻意设计的：第一轮负责判断行动，第二轮负责生成最终答案并流式返回。这样可以把 Function Calling 和 SSE 分开观察。

## 3. 一次普通问题的执行顺序

用户输入“Token 是什么？”后：

1. React 将当前消息列表发送到 `POST /api/chat`。
2. Node 只接受 `user` 和 `assistant` 消息，并截取最近 20 条。
3. Node 计算一个教学用的近似 Token 数，并发送 `meta` 事件。
4. Node 首轮调用模型，声明当前可用的工具。
5. 模型没有请求工具，Node 保留原消息上下文。
6. Node 第二轮调用模型，并读取上游 SSE。
7. Node 将每个文本片段转成 `token` 事件。
8. React 收到片段后，追加到当前 AI 消息中。
9. 输出完成后发送 `done`。

## 4. Function Calling 的执行顺序

用户输入“现在几点？”后：

```text
模型：请调用 get_current_time，参数 timezone=Asia/Shanghai
  ↓
Node：解析并校验工具名、参数
  ↓
Node：执行 Intl.DateTimeFormat 得到真实时间
  ↓
Node：将 tool_call 和 tool_result 加入上下文
  ↓
模型：根据工具结果生成自然语言回答
  ↓
Node：以 SSE 发送最终文本
```

重要边界：模型只是在输出结构化的“行动请求”，不会直接执行 JavaScript。真正拥有执行权限的是 Node。

当前工具是无副作用的时间查询，因此不需要人工确认、数据库事务或幂等键。真实业务中的退款、发货、删除等工具必须增加权限检查和确认步骤。

## 5. 五个核心概念在 P0 中分别做什么

### 5.1 LLM

LLM 接收消息上下文并生成文本。它适合做理解、总结、改写、分类和自然语言生成，但不应该被当成实时数据库或业务执行器。

```json
[
  { "role": "system", "content": "你是 AI 入门教练" },
  { "role": "user", "content": "Token 是什么？" }
]
```

`system` 是应用规则，`user` 是用户输入，`assistant` 是历史回答。系统规则不能代替权限校验，权限必须在后端代码中执行。

### 5.2 Token

Token 是模型处理文本、计算上下文和计费时使用的单位。一次请求的上下文大致包括：

```text
系统 Prompt Token
+ 历史消息 Token
+ 当前问题 Token
+ 模型输出 Token
```

当前页面使用 `lib/tokens.ts` 做近似估算，只用于帮助理解长度、成本和上下文限制。生产环境需要使用目标模型对应的 tokenizer 或供应商 usage 字段。

### 5.3 Embedding

Embedding 将文本转换为向量，用于比较语义相似度：

```text
“如何修改登录密码”
  → [0.12, -0.34, ...]

“账号密码忘记了怎么重置”
  → [0.10, -0.30, ...]
```

它不负责生成答案，而是负责从资料中找出相关内容。P0 只在左侧概念面板解释它，真实的文档入库和检索属于 P1。

### 5.4 SSE

SSE 是服务端持续向浏览器发送事件的 HTTP 传输方式。它不会提升模型能力，只改善等待体验。

本 Demo 使用的事件：

| 事件 | 作用 |
| --- | --- |
| `meta` | 告知模型名和近似 Token 数 |
| `tool_call` | 展示模型请求了什么工具 |
| `tool_result` | 展示 Node 执行工具的结果 |
| `token` | 追加一段模型文本 |
| `done` | 标记本次回答结束 |
| `error` | 传递可展示的错误 |

### 5.5 Function Calling

Function Calling 的完整结构是：

```text
模型决定调用哪个工具
  → Node 校验调用请求
  → Node 执行真实函数
  → 工具结果回到消息上下文
  → 模型生成最终回答
```

工具 Schema 只是模型可见的接口说明，不等于安全授权。真正的授权、参数校验、超时和审计都必须由 Node 负责。

## 6. API 契约

### 请求

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "messages": [
    { "role": "user", "content": "现在几点？" }
  ]
}
```

### 成功响应

响应类型为：

```text
text/event-stream; charset=utf-8
```

每个事件格式为：

```text
data: {"type":"token","content":"你好"}

```

### 错误响应

| 状态码 | 场景 |
| --- | --- |
| `400` | 请求结构、消息角色或用户问题不合法 |
| `503` | 服务端没有配置 `LLM_API_KEY` |
| SSE `error` | 模型请求、工具执行或上游流读取失败 |

## 7. 代码地图

| 文件 | 责任 |
| --- | --- |
| `app/page.tsx` | 输入框、消息列表、SSE 读取和工具轨迹 |
| `app/api/chat/route.ts` | 请求校验、两轮模型调用和 SSE 编排 |
| `lib/llm.ts` | OpenAI-compatible 请求、超时和上游 SSE 解析 |
| `lib/tools.ts` | `get_current_time` 工具定义和执行逻辑 |
| `lib/tokens.ts` | 教学用近似 Token 估算 |

## 8. P0 的明确边界

当前没有：

- 用户登录和权限系统
- 聊天记录持久化
- 真实 Embedding 和向量数据库
- 文件上传和文档解析
- 多工具 Agent 循环
- 生产级限流、成本统计和观测平台

这些能力分别进入 P1 和 P2，不在 P0 中提前堆叠。

## 9. P0 常见业务坑

P0 看起来只是一个聊天框，但一上线就会遇到密钥、成本、错误体验和工具安全问题。下面这些不是“以后再优化”的装饰项，而是基础边界。

| 常见坑 | 解决方案 | 为什么要这么做 |
| --- | --- | --- |
| 把 API Key 放在 React 环境变量或浏览器请求里 | Key 只放 Node 服务端，浏览器只请求自己的 `/api/chat` | 浏览器代码和 Network 请求都可被用户看到，泄露后别人可以直接消耗你的额度 |
| 把模型回答当成业务事实 | 订单、余额、库存、时间等事实必须通过工具或数据库获取 | LLM 的回答是概率生成，不是业务系统的权威数据源 |
| 把用户输入拼进最高优先级规则 | `system` 规则与用户内容分开传递，并把用户内容当不可信数据 | 用户可能通过 Prompt Injection 诱导模型泄露规则或调用不该调用的工具 |
| 只限制问题长度，不限制历史上下文 | 截断历史消息、限制输出 Token，并记录真实 usage | 历史消息会持续增长，最终导致请求变慢、超上下文或成本失控 |
| 页面把近似 Token 当成计费结果 | 教学估算只用于提示；生产以模型返回的 usage 字段计费和告警 | 不同模型的 tokenizer 不同，字符数不能代替真实 Token 数 |
| SSE 只按网络 chunk 直接解析 | 按空行分隔完整 SSE 事件，保留未完成 buffer，并处理 `[DONE]` | 网络分片不等于业务事件，直接解析会丢字、拼 JSON 失败或重复显示 |
| 用户关闭页面后，Node 还在继续调用模型 | 监听请求取消信号，中止上游 fetch，并释放 Reader 和定时器 | 否则用户看不到结果，但模型费用和并发连接仍在消耗 |
| 流式输出到一半失败，页面仍显示“成功” | 用 `done` 标记完整结束；异常显示“回答未完成”，不要伪装成完整答案 | 半截答案可能被业务方误认为完整结论，尤其是金额、规则和操作建议 |
| Function Calling 只校验了工具名，没有校验参数和权限 | 工具白名单、JSON Schema 校验、用户权限校验、超时和调用次数限制 | 模型生成的工具参数仍是不可信输入，工具本身可能产生真实副作用 |
| 给写操作工具自动重试 | 查询可重试；写操作使用幂等键、操作记录和人工确认 | 网络超时不代表执行失败，盲目重试可能重复退款、发货或发消息 |
| 只记录最终答案，不记录模型和工具过程 | 每次请求记录 `request_id`、模型、Token、工具名、耗时和错误类型，敏感内容脱敏 | 出现错误时，必须知道是模型判断错、工具错，还是流式传输错 |
| 以为“OpenAI-compatible”就完全兼容 | 启动时做能力检查，并对工具调用、SSE、错误格式做供应商适配 | 兼容接口通常只兼容路径，不一定兼容参数、事件格式和 Tool Calling 行为 |

## 10. P0 验收标准

- 页面可以正常发送问题并逐段显示模型回答。
- 没有 API Key 时不会把密钥或上游堆栈泄露给浏览器。
- 询问时间时可以看到 `tool_call → tool_result → token → done`。
- 空消息和超长消息会被 Node 拒绝。
- `npm run typecheck` 和 `npm run build` 通过。
