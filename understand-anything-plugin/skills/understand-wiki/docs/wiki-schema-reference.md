## Reference: Wiki File Schema Summary

### Service-Level Files

| File | Required Fields |
|---|---|
| `meta.json` | `gitCommitHash`, `generatedAt`, `version`, `outputLanguage` |
| `index.json` | `entries[]` each with `id`, `name`, `type`, `summary` |
| `service.json` | `name`, `description`, `techStack[]`, `modules[]`, `entryPoints[]` |
| `domains/<slug>.json` | `id`, `name`, `summary`, `entities[]`, `flows[]` |

### Flow Structure

```json
{
  "id": "flow:<slug>",
  "name": "<display name>",
  "summary": "<2-3 sentences>",
  "steps": [
    {
      "order": 1,
      "name": "<step name>",
      "description": "<detailed description with business rules>",
      "sourceRef": { "file": "<relative path>", "lineRange": [start, end] }
    }
  ]
}
```

### wikiRef Format

See [wikiRef Specification](./wikiref-spec.md) for the canonical format.

### Parent-Level Files

| File | Purpose |
|---|---|
| `overview.json` | System-wide summary, service list with descriptions |
| `architecture.json` | Cross-service call relationships, shared resources, event flows |
| `domains/<cross-domain>.json` | End-to-end business flow pages spanning multiple services |
| `index.json` | Parent-level navigation index |
| `meta.json` | Parent-level metadata with serviceCount |

---

### Content Depth Quality: Good vs Shallow Examples

The quality gate (`wiki_structure_validator.py --depth`) scores domain pages on a 0-100 scale based on summary depth, sourceRef coverage, and business rule/exception/side effect indicators.

#### Shallow Domain Page (score ~20)

```json
{
  "id": "domain:order-management",
  "name": "Order Management",
  "summary": "Handles orders.",
  "entities": ["Order"],
  "flows": [
    {
      "id": "flow:create-order",
      "name": "Create Order",
      "summary": "Creates an order.",
      "steps": [
        { "order": 1, "name": "Receive request", "description": "Gets the request." },
        { "order": 2, "name": "Save order", "description": "Saves to database." }
      ]
    }
  ]
}
```

Problems: summary is 1 sentence (16 chars); no entities with descriptions; step descriptions are vague one-liners; no sourceRef; no mention of business rules, validation, exceptions, or side effects.

#### Good Domain Page (score ~85)

```json
{
  "id": "domain:order-management",
  "name": "Order Management",
  "summary": "Manages the complete lifecycle of customer orders from creation through fulfillment. Enforces amount validation (minimum ¥1, maximum ¥500,000), idempotency via unique order number generation, and status-based state machine transitions (DRAFT → SUBMITTED → PAID → SHIPPED → COMPLETED). Key invariant: once an order reaches PAID status, it cannot be modified — only cancelled with mandatory refund initiation.",
  "entities": [
    { "name": "Order", "description": "Core aggregate root representing a customer purchase. Fields: orderId, userId, totalAmount (BigDecimal), status (enum), items[], shippingAddress, createdAt, updatedAt. Status transitions are validated by OrderStateMachine — invalid transitions throw IllegalStateTransitionException." },
    { "name": "OrderItem", "description": "Line item within an order. References productId and snapshotted price at time of order creation to prevent price drift affecting settled orders." }
  ],
  "flows": [
    {
      "id": "flow:create-order",
      "name": "Create Order",
      "summary": "Processes a new order submission from the web/mobile frontend. Validates cart contents against current inventory, calculates pricing with applicable promotions, and persists the order in DRAFT status before triggering payment initiation via MOA RPC to payment-service.",
      "steps": [
        {
          "order": 1,
          "name": "Validate cart contents",
          "description": "OrderService.createOrder() receives CreateOrderRequest from OrderController. Validates: all items exist in product catalog (calls ProductQueryService.batchQuery()), quantities > 0 and <= 99 per item, total item count <= 200. Throws InvalidCartException with specific field errors on validation failure.",
          "sourceRef": { "file": "src/main/java/com/example/order/service/OrderService.java", "lineRange": [45, 82] }
        },
        {
          "order": 2,
          "name": "Calculate pricing and apply promotions",
          "description": "PricingEngine.calculate() resolves unit prices from product snapshots, applies matching promotion rules (first-match strategy from PromotionRuleRepository), calculates shipping fee based on region. Side effect: inserts PriceCalculationLog for audit trail. Business rule: if promotion discount exceeds 50% of original price, requires manager approval flag.",
          "sourceRef": { "file": "src/main/java/com/example/order/service/PricingEngine.java", "lineRange": [30, 95] }
        },
        {
          "order": 3,
          "name": "Persist order and initiate payment",
          "description": "OrderRepository.save() persists Order aggregate with status=DRAFT in t_order table, then publishes OrderCreatedEvent via Kafka topic 'order.created'. OrderPaymentInitiator calls PaymentFacade.createPayment() via MOA RPC to payment-service with orderId and totalAmount. On RPC timeout, order remains in DRAFT and a retry task is scheduled (max 3 attempts, 30s interval).",
          "sourceRef": { "file": "src/main/java/com/example/order/service/OrderService.java", "lineRange": [84, 130] }
        }
      ]
    }
  ]
}
```

Qualities: summary is a full paragraph (340+ chars) with invariants and constraints; entities have rich descriptions with field details and behaviors; step descriptions include business rules, validation logic, exception types, side effects, and cross-service interactions; every step has sourceRef.
