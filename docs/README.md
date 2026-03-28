# Flywheel Documentation

[← Back to main README](../README.md)

- [Getting Started](#getting-started)
- [Document Guide](#document-guide)
- [Demo Vaults](#demo-vaults)
- [Contributing](#contributing)
- [FAQ](#faq)

---

## Getting Started

- **Install** — see [Try It](../README.md#try-it) in the main README
- **First query** — see [See It Work](../README.md#see-it-work) for a walkthrough
- **Demo vaults** — jump to [Demo Vaults](#demo-vaults) below

---

## Document Guide

| Document | Description | Key Question |
|----------|-------------|--------------|
| [SETUP.md](SETUP.md) | Set up your own vault — prerequisites, config, first commands | "How do I get started with my own vault?" |
| [OPENCLAW.md](OPENCLAW.md) | Wire Flywheel into OpenClaw with MCP, agent bindings, and tool presets | "How should I set up Flywheel behind an OpenClaw bot?" |
| [TOOLS.md](TOOLS.md) | Full tool reference — 75 tools across 12 categories | "What tools are available and what do they do?" |
| [COOKBOOK.md](COOKBOOK.md) | Example prompts organized by use case | "What can I ask Claude to do with my vault?" |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Index strategy, FTS5 search, graph model, auto-wikilinks | "How does Flywheel work under the hood?" |
| [CONFIGURATION.md](CONFIGURATION.md) | Environment variables, tool presets, platform setup | "How do I customize my setup?" |
| [TESTING.md](TESTING.md) | Test philosophy, performance benchmarks, security testing | "How is this tested and can I trust it?" |
| [SECURITY.md](SECURITY.md) | HTTP reverse proxy recipes — nginx, Caddy, TLS, auth | "How do I safely expose Flywheel over the network?" |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error recovery, diagnostics, common issues | "Something went wrong — how do I fix it?" |
| [VISION.md](VISION.md) | The flywheel effect, design principles, ecosystem | "Where is this project going?" |
| [ALGORITHM.md](ALGORITHM.md) | The 13-layer scoring system — how every suggestion is computed | "How does auto-wikilinks decide what to link?" |
| [PROVE-IT.md](PROVE-IT.md) | Clone it, run it, see it in 5 minutes | "Can I try this right now?" |
| [SHARING.md](SHARING.md) | What's tracked, privacy guarantees, calibration data | "What does Flywheel record and is it safe to share?" |
| [BENCHMARKS.md](BENCHMARKS.md) | Performance characteristics at various vault sizes | "How fast is it and how does it scale?" |
| [POLICY_EXAMPLES.md](POLICY_EXAMPLES.md) | Ready-to-run policy YAML examples | "What can policies do?" |
| [QUALITY_REPORT.md](QUALITY_REPORT.md) | Graph quality metrics and regression tracking | "How accurate are the suggestions?" |

---

## Demo Vaults

7 production-ready vaults representing real knowledge work. Each demo is a self-contained Obsidian vault with an `.mcp.json` already configured.

| Demo | Persona | Try This |
|------|---------|----------|
| [carter-strategy](../demos/carter-strategy/) | Solo consultant tracking clients and invoices | "How much have I billed Acme Corp?" |
| [artemis-rocket](../demos/artemis-rocket/) | Rocket engineer managing milestones | "What's blocking the propulsion milestone?" |
| [startup-ops](../demos/startup-ops/) | SaaS co-founder running operations | "What's our MRR?" |
| [nexus-lab](../demos/nexus-lab/) | PhD researcher navigating literature | "How does AlphaFold connect to my experiment?" |
| [solo-operator](../demos/solo-operator/) | Content creator managing revenue | "How's revenue this month?" |
| [support-desk](../demos/support-desk/) | Support agent resolving tickets | "What's Sarah Chen's situation?" |
| [zettelkasten](../demos/zettelkasten/) | Zettelkasten student studying learning science | "How does spaced repetition connect to active recall?" |

Every demo is a real test fixture. If it works in the README, it passes in CI.

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory/demos/carter-strategy && claude
```

---

## Contributing

```bash
npm run build    # Build both packages
npm test         # Run full test suite
npm run dev      # Watch mode
npm run lint     # Type check
```

For architecture details and code organization, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## FAQ

**Is my data sent anywhere?**
No. Flywheel runs entirely on your machine. No cloud services, no API keys (beyond Claude itself), no data leaves your disk. The SQLite indexes live inside your vault directory.

**How many notes can it handle?**
CI benchmarks test 100,000-line file mutations and 2,500-entity indexes. The bench package can generate very large synthetic vaults. See [BENCHMARKS.md](BENCHMARKS.md) and [TESTING.md](TESTING.md) for the scoped measurements that are actually checked in.

**Will it corrupt my vault?**
The repo currently defines 2,760 tests across 142 test files. The suite includes 100 parallel write operations with zero corruption in the stress tests, property-based fuzzing, and dedicated security tests for injection attacks and path traversal. See [TESTING.md](TESTING.md).

**How much does it cost in tokens?**
It depends on the dataset, model, and task. The checked-in benchmark artifacts currently show about **$0.074/question** for the latest HotpotQA 500-question run and **$0.122/question** for the latest 695-question LoCoMo E2E run. See [TESTING.md](TESTING.md) for the exact scope and dates.

**Does it work with Claude Desktop?**
Yes. See [CONFIGURATION.md](CONFIGURATION.md) for Claude Desktop setup instructions.

**What about other AI clients?**
Flywheel implements the Model Context Protocol (MCP). Any MCP-compatible client can use it.
