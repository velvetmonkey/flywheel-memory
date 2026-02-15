# Flywheel Documentation

[← Back to main README](../README.md)

---

## Getting Started

- **Install** — see [Quick Start](../README.md#quick-start) in the main README
- **First query** — see [Live Example](../README.md#live-example-the-flywheel-in-action) for a walkthrough
- **Demo vaults** — jump to [Demo Vaults](#demo-vaults) below

---

## Document Guide

| Document | Description | Key Question |
|----------|-------------|--------------|
| [SETUP.md](SETUP.md) | Set up your own vault — prerequisites, config, first commands | "How do I get started with my own vault?" |
| [TOOLS.md](TOOLS.md) | Full tool reference — 36 tools across 15 categories | "What tools are available and what do they do?" |
| [COOKBOOK.md](COOKBOOK.md) | Example prompts organized by use case | "What can I ask Claude to do with my vault?" |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Index strategy, FTS5 search, graph model, auto-wikilinks | "How does Flywheel work under the hood?" |
| [CONFIGURATION.md](CONFIGURATION.md) | Environment variables, tool presets, platform setup | "How do I customize my setup?" |
| [TESTING.md](TESTING.md) | Test philosophy, performance benchmarks, security testing | "How is this tested and can I trust it?" |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error recovery, diagnostics, common issues | "Something went wrong — how do I fix it?" |
| [VISION.md](VISION.md) | The flywheel effect, design principles, ecosystem | "Where is this project going?" |
| [ALGORITHM.md](ALGORITHM.md) | The 10-layer scoring system — how every suggestion is computed | "How does auto-wikilinks decide what to link?" |
| [PROVE-IT.md](PROVE-IT.md) | Clone it, run it, see it in 5 minutes | "Can I try this right now?" |

---

## Demo Vaults

6 production-ready vaults representing real knowledge work. Each demo is a self-contained Obsidian vault with an `.mcp.json` already configured.

| Demo | Persona | Try This | Notes |
|------|---------|----------|-------|
| [carter-strategy](../demos/carter-strategy/) | Solo consultant tracking clients and invoices | "How much have I billed Acme Corp?" | 32 |
| [artemis-rocket](../demos/artemis-rocket/) | Rocket engineer managing milestones | "What's blocking the propulsion milestone?" | 63 |
| [startup-ops](../demos/startup-ops/) | SaaS co-founder running operations | "What's our MRR?" | 31 |
| [nexus-lab](../demos/nexus-lab/) | PhD researcher navigating literature | "How does AlphaFold connect to my experiment?" | 32 |
| [solo-operator](../demos/solo-operator/) | Content creator managing revenue | "How's revenue this month?" | 16 |
| [support-desk](../demos/support-desk/) | Support agent resolving tickets | "What's Sarah Chen's situation?" | 12 |
| [zettelkasten](../demos/zettelkasten/) | Zettelkasten student studying learning science | "How does spaced repetition connect to active recall?" | 47 |

Every demo is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Contributing

```bash
npm run build    # Build both packages
npm test         # Run full test suite (1,812 tests)
npm run dev      # Watch mode
npm run lint     # Type check
```

For architecture details and code organization, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## FAQ

**Is my data sent anywhere?**
No. Flywheel runs entirely on your machine. No cloud services, no API keys (beyond Claude itself), no data leaves your disk. The SQLite indexes live inside your vault directory.

**How many notes can it handle?**
Tested to 100,000 notes. The in-memory index builds at startup (a few seconds cold, ~100ms cached) and queries return in under 10ms.

**Will it corrupt my vault?**
1,812 tests say no. The test suite includes 100 parallel write operations with zero corruption, property-based fuzzing with 50+ randomized scenarios per property, and dedicated security tests for injection attacks and path traversal. See [TESTING.md](TESTING.md).

**How much does it cost in tokens?**
A typical query uses 50-200 tokens of context. Compare that to reading files directly, which can consume 2,000-250,000 tokens for the same answer.

**Does it work with Claude Desktop?**
Yes. See [CONFIGURATION.md](CONFIGURATION.md) for Claude Desktop setup instructions.

**What about other AI clients?**
Flywheel implements the Model Context Protocol (MCP). Any MCP-compatible client can use it.
