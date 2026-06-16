# Backend Flow Extraction Strategy

Extract business flows from server-side codebases (Spring Boot, Express, FastAPI, Go HTTP services, etc.) by tracing call chains from entry points downward through the knowledge graph.

## Entry Points

Identify flow triggers from KG nodes with type `endpoint` or `service`:

| Trigger | KG signals | Example |
|---------|------------|---------|
| HTTP endpoints | GET/POST/PUT/DELETE route handlers | `POST /api/orders` |
| RPC providers | `@DubboService`, gRPC service implementations | `OrderServiceImpl.createOrder()` |
| Event subscribers | `@KafkaListener`, `@RabbitListener`, message consumers | `onOrderCreated()` |
| Cron / Scheduled handlers | `@Scheduled`, cron job entry functions | `nightlyReconciliation()` |
| CLI / manual | Command-line entry points, admin scripts | `main()` in CLI tool |

Each flow starts at one entry point. `domainMeta.entryPoint` is a human label (e.g., `POST /api/orders`); actual edge tracing uses KG node IDs from the edges list.

## Edge Tracing Strategy

1. **Identify the entry KG node** — type `endpoint`, `service`, or the function implementing `domainMeta.entryPoint`.
2. **Trace `calls` edges downward** — find all edges where `source` matches the entry node's KG ID and `type == "calls"`. Each called function is a candidate step.
3. **Follow depth 2–3** — for each called function, check outbound `calls` edges again to find sub-calls. If the entry point has fewer than 4 outbound `calls` edges, recurse to depth 2–3 until you have at least 4 distinct steps.
4. **Typical chain pattern** — endpoint → service → repository → database / external client.

### Minimum Steps

Every flow MUST have at least 4 distinct steps derived from actual method calls in the KG edges.

## entryType Values

Use these values in `domainMeta.entryType`:

| Value | When to use |
|-------|-------------|
| `http` | HTTP REST/GraphQL endpoint handlers |
| `cli` | Command-line or script entry points |
| `event` | Message queue listeners, event subscribers |
| `cron` | Scheduled tasks, cron jobs |
| `manual` | Admin tools, one-off scripts, manually triggered jobs |

## Domain Splitting Heuristic

Group backend domains by **API endpoint groups** — endpoints that operate on the same entity noun belong to the same domain:

- `POST /api/orders`, `GET /api/orders/{id}`, `PUT /api/orders/{id}/cancel` → **Order Management**
- `POST /api/users`, `GET /api/users/{id}/profile` → **User Management**

Shared infrastructure (`utils/`, `config/`, generic middleware) is cross-cutting — do NOT create separate domains for it.

## Step Naming

Use the actual method's business purpose derived from its name and summary — NOT generic placeholders.

### BANNED Step Names

Generating these means the output failed quality gates:

- "Validate Input" / "校验输入" (generic)
- "Execute Business Logic" / "执行业务逻辑" (generic)
- "Build Response" / "构建响应" (generic)
- Any single-word generic name like "Process", "Handle", "Execute"

Instead, derive names from the method: "检查亲密度阈值", "创建绑定记录", "发布关系变更事件", "查询用户配置".

### Additional Rules

- **ACCURATE lineRange**: Each step's `lineRange` MUST come from the target KG node's `lineRange` field. Using `[1, 100]`, `[0, 0]`, or any fabricated range is FORBIDDEN. If a node has no lineRange, omit the field.
- **PREFER DISTINCT filePath**: Steps should reference different files when the call chain crosses class boundaries. Same-file multi-step is allowed if each step maps to a different KG node (method). If ALL steps point to the same file with the same lineRange, calls edges are not being traced properly.
- **sourceNode field**: Add `"sourceNode": "<KG node ID>"` to each step, linking it to the actual KG node this step is derived from.

## Worked Example

Given these edges in the KG subset:

```
source: "function:...WebServiceImpl.java:bindClosedFriend" → target: "function:...ServiceImpl.java:checkIntimacy"  type: "calls"
source: "function:...WebServiceImpl.java:bindClosedFriend" → target: "function:...ServiceImpl.java:createRecord"  type: "calls"
source: "function:...ServiceImpl.java:createRecord" → target: "function:...KafkaProducer.java:publishEvent"     type: "calls"
source: "function:...WebServiceImpl.java:bindClosedFriend" → target: "function:...NotifyService.java:sendNotify" type: "calls"
```

Correct steps output:

```json
[
  {"id": "step:bind:check-intimacy", "name": "校验亲密度阈值", "summary": "检查双方亲密度是否达到绑定要求", "sourceNode": "function:...ServiceImpl.java:checkIntimacy", "filePath": "...ServiceImpl.java", "lineRange": [45, 67]},
  {"id": "step:bind:create-record", "name": "创建挚友绑定记录", "summary": "在数据库中创建双向绑定关系记录", "sourceNode": "function:...ServiceImpl.java:createRecord", "filePath": "...ServiceImpl.java", "lineRange": [110, 145]},
  {"id": "step:bind:publish-event", "name": "发布关系变更事件", "summary": "通过Kafka发布绑定事件通知下游系统", "sourceNode": "function:...KafkaProducer.java:publishEvent", "filePath": "...KafkaProducer.java", "lineRange": [23, 35]},
  {"id": "step:bind:send-notify", "name": "发送用户通知", "summary": "通知双方用户挚友关系已建立", "sourceNode": "function:...NotifyService.java:sendNotify", "filePath": "...NotifyService.java", "lineRange": [88, 102]}
]
```

## Language Requirements

> If the dispatch contains a language directive (e.g., `--language en`), follow that directive instead. The defaults below apply to Chinese-language projects.

- `flow.name`: English Title Case (e.g., "Create Family", "Bind Closed Friend")
- `flow.summary`: Chinese, one sentence describing business purpose (MUST contain ≥2 CJK characters)
- `step.name`: Chinese, specific business action derived from method name/summary
- `step.summary`: Chinese, describing what this step accomplishes in business terms
