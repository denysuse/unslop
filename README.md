# unslop

**Your agent can write the code. Stop letting it ship the same AI interface.**

[![CI](https://github.com/avivgerz-hue/unslop/actions/workflows/ci.yml/badge.svg)](https://github.com/avivgerz-hue/unslop/actions/workflows/ci.yml)
[![Node.js 20.19+](https://img.shields.io/badge/node-%3E%3D20.19-3c873a)](https://nodejs.org/)
[![MIT license](https://img.shields.io/badge/license-MIT-111111)](LICENSE)

![Before and after unslop: a generic purple-gradient AI landing page transformed into a precise, token-driven Linear Dark dashboard](https://raw.githubusercontent.com/avivgerz-hue/unslop/main/docs/assets/before-after-unslop.png)

`unslop` is a zero-runtime-dependency CLI, native MCP server, and installable Agent Skill that gives coding agents a real design system, audits frontend source for generic AI patterns and WCAG contrast failures, exports Tailwind v4 tokens, and turns live interfaces into enforceable Design DNA.

Works with **Claude Code, OpenAI Codex, Cursor, Windsurf, Cline**, and any agent that reads project instructions.

> **Install from GitHub, not npm.** The name `unslop` on the npm registry belongs to a different, unrelated project (a Rust code-duplication detector by another author). Running `npx unslop` installs *that* package, not this one. Until this project is published on npm under its own name or scope, run it from GitHub: `npx github:avivgerz-hue/unslop ...`.

```bash
npx github:avivgerz-hue/unslop init
```

That one command installs the `linear-dark` design contract into `.claude/skills/unslop/SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, and `.clinerules`, then merges the native server into `.mcp.json`. Existing instructions and unrelated MCP servers are preserved.

## The difference

```text
BEFORE: probabilistic taste                 AFTER: enforceable design physics
──────────────────────────────────────      ──────────────────────────────────────
“Make it modern and beautiful.”             4px grid · semantic surface hierarchy
        ↓                                              ↓
 centered purple-gradient hero             12-column content-driven composition
        ↓                                              ↓
 three centered emoji cards                tight display type · 45–75ch body measure
        ↓                                              ↓
 shadow-xl + rounded-2xl everywhere        hairline borders · intentional elevation
        ↓                                              ↓
 another interchangeable AI page           auditable tokens + complete UI states
```

`unslop` does not ask a model to be more creative. It constrains the implementation with explicit typography, geometry, color roles, elevation, motion, and verification loops.

## Why teams install it

- **Installable taste, not a prompt snippet.** Five complete, versioned presets compile to CSS variables and strict agent laws.
- **Deterministic anti-slop audit.** Scan TSX, JSX, Vue, Svelte, HTML, and CSS with exact `file:line:column` diagnostics.
- **Mathematical WCAG 2.1 checks.** Real sRGB relative luminance, alpha compositing, and normal/large-text thresholds—not approximate color heuristics.
- **Native MCP tools.** Audit, extract DNA, and apply presets directly from Claude Code, Claude Desktop, Cursor, or Codex over JSON-RPC 2.0 stdio.
- **Tailwind v4 token export.** Generate `@theme`, `:root`, and `.dark` contracts from any built-in preset or extracted Design DNA.
- **A score your agent can act on.** Every audit includes a structured refactoring brief and acceptance criteria.
- **Extract real Design DNA.** Read local CSS or a live URL, including inline styles, linked stylesheets, and `@import` graphs.
- **No runtime dependency footprint.** Node.js built-ins do the analysis, extraction, synchronization, MCP transport, and CLI work.
- **Safe to re-run.** Managed blocks are idempotent; your existing agent instructions and MCP servers remain intact.

## Quickstart

### 1. Choose a design system

```bash
npx github:avivgerz-hue/unslop init --preset linear-dark
```

```text
Installed the linear-dark design system:
  created   .claude/skills/unslop/SKILL.md
  created   CLAUDE.md
  created   AGENTS.md
  created   .cursorrules
  created   .windsurfrules
  created   .clinerules
  created   .mcp.json

Next: run npx github:avivgerz-hue/unslop audit . before your agent writes more UI.
```

Then ask your agent:

> Build the settings page using the unslop contract. Reuse the semantic tokens, implement every interaction state, run the audit, and resolve each finding.

### 2. Audit the interface

```bash
npx github:avivgerz-hue/unslop audit src
```

```text
src/components/Hero.tsx:4:7  WARNING  slop/cliche-gradient
  Cliché purple/indigo AI gradient stop detected.
  Fix: Replace the gradient with a deliberate solid accent ...

src/components/Metric.tsx:8:5  WARNING  slop/numeric-alignment
  Numeric UI is missing tabular figures, causing unstable alignment.

Design Integrity Score: 86/100 (B)
```

The full output also contains a copy-ready refactoring prompt. Machine-readable output is one flag away:

```bash
npx github:avivgerz-hue/unslop audit . --json
npx github:avivgerz-hue/unslop audit . --prompt
npx github:avivgerz-hue/unslop audit . --fail-under 90
npx github:avivgerz-hue/unslop audit . --no-fail
```

By default, an audit exits `1` when it finds violations and `0` when clean. Invalid usage exits `2`. Unsupported or empty directories still produce a valid report with zero scanned files.

### 3. Extract a visual language

From a local stylesheet:

```bash
npx github:avivgerz-hue/unslop extract ./tokens.css --name acme -o .claude/skills/unslop/SKILL.md
```

From a live URL:

```bash
npx github:avivgerz-hue/unslop extract https://example.com --name example --json -o design-dna.json
```

The extractor inventories:

- surface, text, muted-text, border, accent, and on-accent colors;
- CSS custom properties and font stacks;
- font sizes, line heights, weights, and tracking;
- radius and spacing scales;
- complete layered elevation tokens and their individual shadow layers;
- durations and easing functions.

Markdown output is a complete Claude-compatible `SKILL.md`. `--json` emits both the raw token inventory and its validated, compiled preset. Network requests use timeouts, response-size limits, a bounded stylesheet queue, and HTTP(S)-only URLs; page JavaScript is never executed.

### 4. Export Tailwind v4 and framework-agnostic tokens

```bash
npx github:avivgerz-hue/unslop export-tokens --preset linear-dark --out tokens.css
```

The generated stylesheet contains three complementary contracts:

- **Tailwind v4 `@theme`** with literal `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--spacing-*`, motion, and container tokens.
- **`:root` semantic variables** such as `--surface-0`, `--surface-1`, `--text-primary`, `--border-subtle`, and `--font-display` for CSS Modules, vanilla CSS, styled-components, or any other framework.
- **`.dark` overrides** for semantic and Tailwind color variables. Dark presets retain their native palette; light presets receive a deterministic dark companion derived from their source colors.

Use it with Tailwind v4:

```css
@import "tailwindcss";
@import "./tokens.css";
```

Or without Tailwind:

```css
.panel {
  color: var(--text-primary);
  background: var(--surface-1);
  border: var(--border-width) solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}
```

Compile tokens directly from extracted DNA instead of a built-in preset:

```bash
npx github:avivgerz-hue/unslop export-tokens --source https://example.com --name example --out example-tokens.css
npx github:avivgerz-hue/unslop export-tokens --source ./tokens.css --name acme
```

`--preset` and `--source` are mutually exclusive. Without `--out`, CSS is written to stdout.

## Native MCP server

Start the zero-dependency Model Context Protocol server over stdio:

```bash
npx github:avivgerz-hue/unslop mcp
```

`init` creates or updates this project configuration automatically:

```json
{
  "mcpServers": {
    "unslop": {
      "command": "npx",
      "args": ["-y", "github:avivgerz-hue/unslop", "mcp"]
    }
  }
}
```

The merge preserves unrelated entries in `mcpServers`, other top-level settings, and custom fields on the unslop entry. Invalid JSON is rejected rather than overwritten. Claude Code can also register the server explicitly:

```bash
claude mcp add --scope project unslop -- npx -y github:avivgerz-hue/unslop mcp
```

For Claude Desktop, add the same `mcpServers.unslop` entry to the application's MCP configuration. Cursor reads project `.mcp.json`; Codex and other MCP-compatible clients can launch the same stdio command.

| MCP tool | Required input | Result |
| --- | --- | --- |
| `unslop_audit` | None; optional `path` and `ignore` | Full audit, integrity score, exact diagnostics, and refactoring instructions |
| `unslop_extract_dna` | `source` CSS path or HTTP(S) URL | Raw DNA, validated compiled preset, and ready-to-use Agent Skill |
| `unslop_apply_preset` | `preset`; optional `projectDir` | Six synchronized agent-rule files plus merge-safe `.mcp.json` |

The transport supports `initialize`, `ping`, `tools/list`, `tools/call`, JSON-RPC errors, notifications, and newline-delimited stdio framing. Protocol messages are the only stdout output. Tool execution failures return MCP `isError` results without terminating the server.

### Zero-build GitHub execution

Run the committed distribution directly from GitHub without installing TypeScript or any other development dependency:

```bash
npx -y github:avivgerz-hue/unslop --version
npx -y github:avivgerz-hue/unslop init
npx -y github:avivgerz-hue/unslop mcp
```

The repository includes `dist/`. During a GitHub install, `prepare` uses the local TypeScript compiler for development when it is available and otherwise validates and reuses the committed runtime and all five preset JSON files. A cold `npx` invocation still needs to download the package; no local compilation step is required.

### Registry and citation metadata

Machine-readable discovery documents live at the repository root:

- [`server.json`](server.json) follows the official MCP Registry schema, declares the npm stdio package and fixed `mcp` argument, and carries the three tool summaries in the registry-approved publisher metadata extension. `package.json` includes the matching `mcpName` ownership declaration.
- [`smithery.yaml`](smithery.yaml) starts `node dist/bin/unslop.js mcp` over stdio without requiring configuration.
- [`glama.json`](glama.json) uses Glama's schema and mirrors the exact runtime tool names, descriptions, and input schemas.
- [`CITATION.cff`](CITATION.cff) provides CFF 1.2.0 software citation metadata for VibeFoundry and powers GitHub's citation widget.

These files describe the project for registry indexing; their presence does not claim that a registry listing or npm publication has occurred.

## Preset gallery

| Preset | Mode | Visual thesis | Best suited for |
| --- | --- | --- | --- |
| `linear-dark` | Dark | Quiet neutral layers, hairline borders, compact type, restrained indigo | Developer tools, operational dashboards, engineering products |
| `swiss-grid` | Light | Editorial scale, exposed grid, black rules, one signal-red accent | Publications, portfolios, cultural and typographic sites |
| `stripe-minimal` | Light | Cool atmospheric canvas, crisp white surfaces, layered soft elevation | SaaS, financial products, marketing with dense product UI |
| `apple-glass` | Light | Optical hierarchy, sparse translucent materials, continuous corners, springs | Consumer products, media experiences, spatial interfaces |
| `neo-brutalist` | Light | Opaque surfaces, stark ink borders, hard offset shadows, one loud accent | Experiments, communities, campaigns, playful tools |

Inspect every token and law before choosing:

```bash
npx github:avivgerz-hue/unslop presets
npx github:avivgerz-hue/unslop presets swiss-grid
npx github:avivgerz-hue/unslop presets apple-glass --json
```

## What the audit detects

| Rule ID | Detection |
| --- | --- |
| `slop/cliche-gradient` | Purple, indigo, violet, and fuchsia gradient utility stops and matching CSS gradients |
| `slop/low-contrast` | WCAG 2.1 AA failures for detected CSS, inline-style, and Tailwind foreground/background pairs |
| `slop/neon-glow` | Cyan, magenta, and fuchsia cyber-glow box shadows |
| `slop/emoji-feature-grid` | Three-column grids combined with centered content and emoji in the same component region |
| `slop/raw-elevation` | `shadow-xl`/`shadow-2xl` without a subtle border token, or a single heavy CSS shadow without support |
| `slop/display-tracking` | Large `h1`/`h2` typography without tight or negative tracking |
| `slop/numeric-alignment` | Static numeric UI and marked dynamic metrics without `tabular-nums` |
| `slop/font-weight-mixing` | Four or more distinct weights in one component source tree |
| `slop/conflicting-spacing` | Different values for the same spacing property and responsive variant on one element |
| `slop/off-grid-spacing` | Arbitrary pixel/rem spacing outside the 4px grid, excluding deliberate 1px and 2px optical stops |
| `slop/conflicting-radius` | Competing radius utilities for one element and corner axis |
| `slop/radius-scale` | Four or more unrelated non-pill surface radii in a component tree |

**WCAG 2.1 contrast:** colors are converted from hex, RGB(A), HSL(A), named colors, CSS variables, or supported Tailwind utilities into sRGB. Channels are linearized with the official WCAG formula, translucent foregrounds are composited over their backgrounds, and contrast is `(L1 + 0.05) / (L2 + 0.05)`. Normal text requires **4.5:1**; large text (at least 24px, or 18.66px at 700+) requires **3:1**. Unsupported or indeterminate color functions are skipped rather than guessed.

**Design Integrity Score:** start at 100; subtract 12 per error, 7 per warning, and 3 per informational finding, clamped to `0–100`. Low-contrast findings are errors. The score is comparable and deterministic, not a claim that static analysis can replace rendered design review.

## CLI reference

```text
unslop init [--preset <name>] [--dir <path>] [--force] [--json]
unslop mcp
unslop audit [dir] [--json | --prompt] [--fail-under <0-100>]
                 [--ignore <directory>] [--no-fail]
unslop extract <url-or-css-path> [--name <preset-name>] [--json]
                 [--output <path>] [--timeout <ms>] [--max-stylesheets <n>]
unslop export-tokens [--preset <name> | --source <url-or-css-path>]
                     [--name <preset-name>] [--out <file>]
unslop presets [name] [--json]
unslop help
unslop --version
```

### Safe rule synchronization

Each generated agent-rule file contains an `unslop` managed block. Running `init` again updates only that block. Existing rule content is preserved byte-for-byte. `.mcp.json` is merged structurally and never replaces unrelated MCP servers. `--force` intentionally replaces whole agent-rule files, including unmanaged content—use it only when that is what you want; it does not erase other MCP servers.

## Agent Skill usage

### Claude Code

`init` writes `.claude/skills/unslop/SKILL.md` with valid frontmatter and the selected design contract. `CLAUDE.md` points to the same managed rules so the constraints remain visible in project context.

### OpenAI Codex

Codex reads `AGENTS.md`. Keep the generated file at the repository root and ask Codex to run `npx github:avivgerz-hue/unslop audit .` after implementing UI.

### Cursor, Windsurf, and Cline

The same contract is compiled into `.cursorrules`, `.windsurfrules`, and `.clinerules`. No plugin, MCP server, or additional runtime is required.

### Manual installation

Copy this repository’s root `SKILL.md` into `.claude/skills/unslop/SKILL.md` for the preset-agnostic anti-slop contract, or run `init` to include a complete preset. The compiled rules are plain Markdown and can be adapted to other agents without changing the CLI.

## Programmatic API

```ts
import { auditTarget, contrastRatio } from "unslop/analyzer";
import { extractDesignDNA, createPresetFromDNA } from "unslop/extractor";
import { startMcpServer } from "unslop/mcp";
import { loadPreset } from "unslop/presets";
import { installUnslop, renderAgentSkill } from "unslop/sync";
import { renderTokenStylesheet } from "unslop/tokens";

const report = await auditTarget("./src");
const dna = await extractDesignDNA("./tokens.css");
const extractedPreset = createPresetFromDNA(dna, "acme");
const skill = renderAgentSkill(extractedPreset);
const stylesheet = renderTokenStylesheet(extractedPreset);

await installUnslop({ cwd: process.cwd(), preset: loadPreset("linear-dark") });
console.log(report.score, contrastRatio("#111111", "#ffffff"), skill, stylesheet);

// Blocks until the MCP client's stdio stream closes:
await startMcpServer({ cwd: process.cwd() });
```

The analyzer also exposes `analyzeSource` for in-memory fixtures and editor integrations.

## Development

```bash
git clone https://github.com/avivgerz-hue/unslop.git
cd unslop
npm ci
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for analyzer-rule design, extraction safety, preset requirements, and pull-request guidelines.

## License

MIT © 2026 VibeFoundry. See [LICENSE](LICENSE).

## Part of the VibeFoundry Agent Suite

| Tool | Purpose |
| --- | --- |
| 🎨 [unslop](https://github.com/avivgerz-hue/unslop) | Studio-grade UI design systems & Anti-Slop engine for coding agents. |
| 🛡️ [vibe-shield](https://github.com/avivgerz-hue/vibe-shield) | Automated security scanner & MCP guard for AI-generated codebases. |
| 👻 [ghost-qa](https://github.com/avivgerz-hue/ghost-qa) | Autonomous headless browser QA & self-healing verification loop. |
