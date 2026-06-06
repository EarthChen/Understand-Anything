# Subagent Dispatch Protocol

This document describes how to dispatch sub-agents across all supported platforms. Any skill or agent that needs to spawn sub-agents should link to this document instead of duplicating platform-specific dispatch logic.

## How to Use

At each dispatch point in a skill or agent, write:

```markdown
**Dispatch a `<agent-name>` subagent.** See [Dispatch Protocol](../docs/DISPATCH-PROTOCOL.md).

> <prompt template with parameters>
>
> - `$PARAM_1`: `value`
> - `$PARAM_2`: `value`

Wait for completion, then verify `<expected output file>` exists.
```

The prompt template contains the task-specific payload (what the sub-agent should do). This document handles the mechanism (how to call the sub-agent on each platform).

---

## Platform-Specific Instructions

### Claude Code

Use the `Agent` tool:

```
Agent({
  subagent_type: "general-purpose",
  prompt: "<prompt template>"
})
```

### Codex (OpenAI)

Use `spawn_agent`. The prompt **MUST** contain one of these authorization keywords: `sub-agents`, `delegation`, `parallel agent work`. Without these keywords, Codex will refuse to dispatch.

```
spawn_agent(prompt="<prompt template containing 'sub-agents' keyword>")
```

To ensure authorization, include this line in your prompt template:
> You are authorized to dispatch sub-agents as required by the parent task.

### Cursor

Use the built-in agent dispatch mechanism. Cursor supports multi-agent via its MCP agent integration.

### OpenCode

Use the equivalent multi-agent or worker spawn capability provided by the platform.

### Pi

Use the equivalent multi-agent or worker spawn capability provided by the platform.

### Generic / Unknown Platform

If your platform is not listed above, execute the sub-agent's task in an **isolated context** (separate CLI session, new agent invocation, or equivalent). Never inline a sub-agent's full pipeline in your current context window — it will exhaust context and degrade quality.

---

## Dispatch Patterns

### Single Agent Dispatch

Dispatch one sub-agent and wait for completion:

```markdown
**Dispatch a `file-analyzer` subagent.** See [Dispatch Protocol](../docs/DISPATCH-PROTOCOL.md).

> Read the agent definition at `$PLUGIN_ROOT/agents/file-analyzer.md` and follow its instructions.
>
> - `$PROJECT_ROOT`: `/path/to/project`
> - Batch index: `0`
> - Files to analyze: `<file list>`
>
> Write output to: `$PROJECT_ROOT/.understand-anything/tmp/batch-0.json`

Wait for completion, then verify the output file exists.
```

### Parallel Agent Dispatch

Dispatch multiple sub-agents concurrently (up to 5):

```markdown
**Dispatch `file-analyzer` subagents in parallel** (up to 5 concurrently).
See [Dispatch Protocol](../docs/DISPATCH-PROTOCOL.md).

For each batch, use this prompt:

> Read the agent definition at `$PLUGIN_ROOT/agents/file-analyzer.md` ...
>
> - Batch index: `<i>`
> ...

Wait for ALL dispatches to complete, then verify each output file exists.
```

### Skill Dispatch via upstream-updater

When a sub-agent needs to execute an entire skill (e.g., running `/understand` on a service):

```markdown
**Dispatch an `upstream-updater` subagent** to run `/understand` on this service.
See [Dispatch Protocol](../docs/DISPATCH-PROTOCOL.md).

> Read the agent definition at `$PLUGIN_ROOT/agents/upstream-updater.md` and follow its instructions.
>
> - `$SKILL_PATH`: `$PLUGIN_ROOT/skills/understand/SKILL.md`
> - `$SERVICE_ROOT`: `/path/to/service`
> - `$SKILL_ARGS`: `--language zh`
> - `$EXPECTED_OUTPUT`: `/path/to/service/.understand-anything/knowledge-graph.json`

Wait for completion, then verify `$EXPECTED_OUTPUT` exists.
```

---

## Verification Gates

Every dispatch point MUST include a post-dispatch verification step. Never proceed to the next phase without confirming the sub-agent produced its expected output.

**File-based verification:**
```bash
test -f "$EXPECTED_OUTPUT" && echo "OK" || echo "MISSING"
```

**Count-based verification (for batch outputs):**
```bash
ls "$OUTPUT_DIR"/batch-*.json 2>/dev/null | wc -l
```

If verification fails:
- Log the failure with the service/batch name
- In batch mode: continue with remaining items (unless `--continue-on-error=false`)
- In single mode: report error and stop

---

## Key Rules

1. **Never run sub-agent pipelines inline.** Sub-agents have 5-7 phases with their own nested dispatches. Inlining them exhausts your context window.
2. **Use imperative prose, not bash comments.** Dispatch instructions must be readable as task directives, not hidden in code comments.
3. **Always verify output.** Every dispatch must be followed by a check that the expected file exists.
4. **Parallel when possible.** Independent sub-agents (different services, different batches) should run concurrently.
5. **Sequential when dependent.** If sub-agent B needs output from sub-agent A, wait for A before dispatching B.
