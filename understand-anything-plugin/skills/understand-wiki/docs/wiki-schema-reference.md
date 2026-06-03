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

### Parent-Level Files

| File | Purpose |
|---|---|
| `overview.json` | System-wide summary, service list with descriptions |
| `architecture.json` | Cross-service call relationships, shared resources, event flows |
| `domains/<cross-domain>.json` | End-to-end business flow pages spanning multiple services |
| `index.json` | Parent-level navigation index |
| `meta.json` | Parent-level metadata with serviceCount |
