---
name: unslop
description: Eliminate generic AI-slop interfaces and engineer studio-grade frontend systems. Use when creating, refactoring, auditing, or reviewing web UI in React, Vue, Svelte, HTML, or CSS.
---

# unslop

You are not asked to make an interface merely “modern.” You are asked to make every visual decision specific, systematic, accessible, and defensible.

## Activate the design system

1. If the project contains an unslop managed rule block, its preset tokens are the source of truth.
2. If no preset is installed, run `npx github:avivgerz-hue/unslop init` or ask which built-in preset fits the product. Do not improvise a second token system.
3. Inspect existing semantic components, tokens, content hierarchy, and interaction patterns before writing UI.
4. Run `npx github:avivgerz-hue/unslop audit .` before and after frontend work. Turn each reported `file:line` into a concrete refactor; never suppress a rule to improve the score.

## The anti-slop contract

### Composition

- Derive the layout from the content and user task. Do not default to a centered hero followed by three identical feature cards.
- Use an intentional grid with explicit content edges, column spans, gaps, and responsive behavior.
- Group by proximity and alignment. Avoid wrapping every label, metric, and sentence in its own floating card.
- Use asymmetry only when it improves hierarchy. Preserve enough negative space for the composition to breathe.
- Emoji are not a substitute for a coherent icon set, product illustration, or information design.

### Color

- Use semantic `background`, `surface`, `surfaceElevated`, `text`, `textMuted`, `border`, `accent`, and `accentText` tokens.
- Reserve the accent for actions, focus, selection, or meaningful data. Do not wash the entire page in the accent.
- Do not introduce purple/indigo gradient clichés, cyan or magenta glows, arbitrary neon shadows, or decorative rainbow palettes.
- Verify text and control contrast after compositing, especially on translucent surfaces. Never communicate state by color alone.
- Apply WCAG 2.1 relative luminance exactly: linearize sRGB channels, composite alpha, and calculate `(L1 + 0.05) / (L2 + 0.05)`. Normal text needs 4.5:1; large text (24px, or 18.66px at 700+) needs 3:1. Resolve `slop/low-contrast` findings with semantic tokens rather than arbitrary nearby colors.

### Typography

- Use the preset’s type scale without inventing intermediate sizes.
- Display headings require deliberate negative tracking, controlled line-height, balanced wrapping, and a constrained measure.
- Keep body copy readable and normally between 45 and 75 characters per line. Avoid centering paragraphs.
- Use no more than three font weights in one component tree. Build hierarchy through size, spacing, and color first.
- Apply `font-variant-numeric: tabular-nums` to prices, metrics, counters, timestamps, identifiers, and data columns. Right-align comparable values.
- Do not use uppercase, letter spacing, or weight to disguise weak information hierarchy.

### Geometry

- Keep spacing on the preset’s base grid. A one-off arbitrary value needs a documented optical or platform reason.
- Never emit conflicting spacing or corner-radius utilities on the same element and responsive variant.
- Use a small semantic radius hierarchy. Derive nested radii from the outer radius and intervening padding.
- Reserve pill radii for pills, tags, and avatars. Do not round every container by default.
- Account for icon view-box padding, glyph overhang, borders, and shadow offsets when optically aligning elements.

### Elevation and material

- Use the preset’s elevation tokens. Do not emit raw `shadow-xl` or `shadow-2xl` as a substitute for hierarchy.
- Anchor elevated surfaces with a subtle 1px border where the preset calls for one. Prefer layered, restrained shadows over a single dark blur.
- Separate ordinary regions with whitespace and hairlines before adding cards or shadows.
- Use translucency only when content behind the material is meaningful. Provide an opaque fallback and verify contrast.

### Motion and interaction

- Motion must explain causality or provide direct-manipulation feedback. No decorative floating, pulsing, parallax, or perpetual glow.
- Prefer transform and opacity; avoid layout-thrashing animation.
- Implement default, hover, focus-visible, active, disabled, loading, empty, error, and success states wherever applicable.
- Preserve keyboard operation and visible focus. Use native semantic elements before ARIA.
- Respect `prefers-reduced-motion`; remove spatial and ambient movement without hiding state changes.

## Execution loop

1. **Read:** inspect product content, existing primitives, tokens, routes, and constraints.
2. **Compose:** define the information hierarchy and responsive grid before choosing effects.
3. **Tokenize:** map every color, font, size, radius, shadow, and spacing decision to the selected preset.
4. **Implement:** build semantic, responsive, keyboard-accessible components with complete states.
5. **Audit:** run `npx github:avivgerz-hue/unslop audit .` and resolve all findings at their exact locations.
6. **Verify:** inspect the rendered result at narrow and wide viewports; test long content, large numbers, zoom, contrast, focus, and reduced motion.

## Native MCP and token workflows

When the unslop MCP server is connected, prefer its deterministic tools over reimplementing analysis:

- `unslop_audit`: pass an optional `path` and `ignore`; use the returned score, exact violations, and refactoring prompt.
- `unslop_extract_dna`: pass a CSS `source` path or HTTP(S) URL and optional preset `name`; apply the returned compiled design system.
- `unslop_apply_preset`: pass one of `linear-dark`, `swiss-grid`, `stripe-minimal`, `apple-glass`, or `neo-brutalist`, plus an optional `projectDir`. The tool updates agent rules and merges `.mcp.json` without replacing other servers.

For component implementation, generate a framework-compatible token contract instead of inventing values:

```bash
npx github:avivgerz-hue/unslop export-tokens --preset linear-dark --out tokens.css
npx github:avivgerz-hue/unslop export-tokens --source ./tokens.css --name extracted --out tokens.css
```

The output includes Tailwind v4 `@theme`, standard `:root` variables, and `.dark` overrides. Map Tailwind utilities to the generated `@theme` tokens. In other frameworks, consume semantic variables such as `--surface-0`, `--text-primary`, `--border-subtle`, `--font-display`, and `--shadow-md` directly. Preserve the generated token names rather than creating a competing scale.

## Audit interpretation

The Design Integrity Score starts at 100. Each error deducts 12 points, each warning deducts 7, and each informational finding deducts 3, clamped to 0–100. WCAG contrast failures are errors. A high score means the source avoids known anti-patterns; it does not prove visual quality or accessibility. Static analysis skips indeterminate colors instead of guessing, so rendered contrast verification remains mandatory.

Use the generated refactoring brief as an engineering checklist. Preserve behavior and content. Never replace flagged arbitrary values with a new set of arbitrary values, and never claim visual excellence from static analysis alone.

## Useful commands

```bash
npx github:avivgerz-hue/unslop init --preset linear-dark
npx github:avivgerz-hue/unslop mcp
npx github:avivgerz-hue/unslop audit .
npx github:avivgerz-hue/unslop audit src --json
npx github:avivgerz-hue/unslop extract https://example.com --name example -o .claude/skills/unslop/SKILL.md
npx github:avivgerz-hue/unslop export-tokens --preset linear-dark --out tokens.css
npx github:avivgerz-hue/unslop presets
```
