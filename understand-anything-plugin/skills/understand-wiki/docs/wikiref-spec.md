## wikiRef Specification

### Canonical Format

```
<service>/domains/<domain-id>[#flow:<flow-id>]
```

- **Bare path** — no `wiki://` prefix, no `.json` extension
- **`<service>`** — service directory name (e.g., `order-service`, `payment-service`)
- **`<domain-id>`** — domain slug matching the filename without `.json` (e.g., `order-management`)
- **Fragment** — optional, prefixed with `#`, syntax: `flow:<flow-id>` or `step:<order>`

### Examples

| Context | wikiRef Value |
|---|---|
| Cross-domain step → service domain | `order-service/domains/order-management#flow:create-order` |
| Cross-domain step → specific step | `payment-service/domains/payment-processing#step:3` |
| Cross-domain step → domain overview | `inventory-service/domains/stock-management` |

### Format Rules

1. **No protocol prefix**: `wikiRef` in JSON data MUST NOT include `wiki://`. The `wiki://` prefix is a rendering concern — the markdown renderer (`wikiToMarkdown.ts`) prepends it when generating clickable links.

2. **No `.json` extension**: Domain references use the slug only (`order-management`), not the filename (`order-management.json`).

3. **Service path**: First segment is always the service name. This maps to the `name` field of a service entry in the dashboard topology.

4. **Stable IDs**: `flow-id` should match the flow's `id` field (e.g., `flow:create-order`). `step` order should match `steps[].order`.

### Resolution Chain

```
JSON data:      "wikiRef": "order-service/domains/order-management#flow:create-order"
                                          │
Markdown render: [View details](wiki://order-service/domains/order-management#flow:create-order)
                                          │
UI parser:       parseWikiLink() extracts { service: "order-service",
                   path: "domains/order-management", fragment: "flow:create-order" }
                                          │
Navigation:      handleWikiNavigate() → loads domain page "order-management"
                   for service "order-service", scrolls to flow anchor
```

### Validation Rules (Quality Gate)

A valid `wikiRef` MUST:
- Match pattern: `^[a-z0-9][a-z0-9._-]*/domains/[a-z0-9][a-z0-9._-]*(#(flow|step):[a-z0-9._-]+)?$`
- NOT contain `.json`
- NOT start with `wiki://` or `source://`
- Reference a service that exists in the project topology

### Where wikiRef Appears

| File Type | Field | Example |
|---|---|---|
| Cross-domain page (`domains/<cross-domain>.json`) | `steps[].wikiRef` | Links step to detailed service domain page |
| Domain page (`domains/<domain>.json`) | `flows[].steps[].wikiRef` | Links step to related domain in another service (rare, for cross-references) |
