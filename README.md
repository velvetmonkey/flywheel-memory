<div align="center">
  <h1>Flywheel Memory</h1>
  <p><strong>Local-first memory for AI agents. No cloud. No black box. Everything connects.</strong></p>
</div>

[![npm version](https://img.shields.io/npm/v/@velvetmonkey/flywheel-memory.svg)](https://www.npmjs.com/package/@velvetmonkey/flywheel-memory)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blueviolet.svg)](https://modelcontextprotocol.io/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

---

## Quickstart (4 Steps)

```bash
# 1. Configure your MCP client
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": { "VAULT_PATH": "~/my-vault" }
    }
  }
}

# 2. Create a vault folder (or use existing markdown folder)
mkdir ~/my-vault

# 3. Add your first memory
memory_add({
  content: "Sarah prefers async communication and is frustrated about billing",
  path: "users/sarah.md"
})

# 4. It's connected! ✨
# → Creates [[Sarah]] with sentiment tracking
# → Future mentions of "Sarah" auto-link
# → Backlinks show everywhere Sarah is mentioned
```

**That's it.** Every memory builds the graph. The graph improves context. Better context = better agents.

---

## Why Flywheel Memory?

| Feature | Flywheel Memory | Mem0 | LangMem |
|---------|-----------------|------|---------|
| **Install** | 1 package | 1 package | 1 package |
| **Latency** | <100ms | Network-dependent | 17-60s |
| **Privacy** | 100% local | Cloud API | Cloud API |
| **Vendor lock-in** | None (markdown) | Proprietary | LangGraph |
| **Debuggable** | `git blame` | Black box | Black box |
| **Deterministic** | Yes | No | No |
| **Cost** | Free | Per-API-call | Per-API-call |

---

## See It Work

A support agent logs a customer call:

```json
{
  "tool": "memory_add",
  "content": "Call with Sarah - refund processed, she's happy now",
  "path": "logs/2026-02-12.md",
  "section": "## Calls"
}
```

**Result:**
```markdown
## Calls
- 14:30 Call with [[Sarah Chen]] - refund processed, she's happy now
  → [[Billing]] [[TKT-2024-003]]
```

- **Auto-wikilinks**: "Sarah" → `[[Sarah Chen]]`
- **Contextual suggestions**: Related ticket and topic added
- **Deterministic**: Same input = same output, always

---

## 73 Tools for Agent Memory

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Memory** | `memory_add`, `memory_search`, `memory_update` | Core memory operations |
| **Read** | 48 tools | Search, backlinks, graph queries |
| **Write** | 22 tools | Mutations, tasks, frontmatter |

### Memory Operations (New!)

```javascript
// Add a memory
memory_add({ content: "User prefers dark mode", user_id: "user123" })

// Search memories (FTS5 keyword search)
memory_search({ query: "user preferences", user_id: "user123" })

// Update memory
memory_update({ id: "mem_abc", content: "User prefers light mode now" })
```

### Read Operations (from Flywheel)

```javascript
// Search notes
search_notes({ query: "billing issues" })

// Get backlinks
get_backlinks({ path: "users/sarah.md" })

// Graph query
get_related_notes({ path: "tickets/TKT-001.md", depth: 2 })
```

### Write Operations (from Flywheel-Crank)

```javascript
// Add to section
vault_add_to_section({ path: "log.md", section: "## Today", content: "..." })

// Toggle task
vault_toggle_task({ path: "tasks.md", task: "Review PR" })

// Update metadata
vault_update_frontmatter({ path: "user.md", updates: { sentiment: "happy" } })
```

---

## The Flywheel Effect

```
Day 1:   Add memories → basic storage
         ↓
Week 1:  Wikilinks connect notes → patterns emerge
         ↓
Month 1: Graph intelligence → agent knows context before you ask
```

Every memory strengthens the graph. The graph improves suggestions. Better suggestions = smarter agents.

---

## LangChain / LangGraph

```python
from langchain_mcp_adapters import MultiServerMCPClient

async with MultiServerMCPClient({
    "memory": {
        "command": "npx",
        "args": ["-y", "@velvetmonkey/flywheel-memory"],
        "env": {"VAULT_PATH": "/path/to/vault"}
    }
}) as client:
    tools = client.get_tools()
    # 73 tools ready for your agent
```

---

## Claude Code

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": { "VAULT_PATH": "/path/to/vault" }
    }
  }
}
```

---

## Search: FTS5 + Optional Semantic

### Built-in: FTS5 Keyword Search (Default)

Fast, local, no external dependencies:

```javascript
memory_search({ query: "billing refund" })
// → Finds notes containing "billing" or "refund"
// → BM25 ranking, stemming, phrase matching
// → <10ms latency
```

### Optional: Semantic Search (Coming Soon)

For meaning-based search, enable with an embedding provider:

```javascript
// Configure in env
EMBEDDING_PROVIDER=openai  // or "local"
OPENAI_API_KEY=sk-...

// Then search by meaning
memory_search({ query: "customer unhappy about money", semantic: true })
// → Finds notes about billing frustration, even without those exact words
```

---

## Migration from Flywheel + Flywheel-Crank

If you're using the separate packages:

```diff
- "flywheel": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-mcp"] }
- "flywheel-crank": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-crank"] }
+ "memory": { "command": "npx", "args": ["-y", "@velvetmonkey/flywheel-memory"] }
```

All 73 tools work exactly the same. Just one server instead of two.

---

## Benchmarks

| Metric | Result |
|--------|--------|
| Memory add | <50ms |
| FTS5 search (10k notes) | <10ms |
| Entity indexing (10k) | <500ms |
| Concurrent mutations | Safe (last-write-wins) |

---

## Documentation

- [Getting Started](docs/getting-started.md) - 5 minutes to first memory
- [Memory Operations](docs/memory.md) - Add, search, update memories
- [Auto-Wikilinks](docs/wikilinks.md) - How linking works
- [Search Guide](docs/search.md) - FTS5 and semantic search
- [Tool Reference](docs/tools/) - All 73 tools
- [Migration Guide](docs/migration.md) - From flywheel + flywheel-crank

---

## License

Apache-2.0

---

<div align="center">
  <p><strong>The only AI memory you can debug with <code>git blame</code>.</strong></p>
</div>
