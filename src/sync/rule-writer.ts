import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { loadPreset, type DesignPreset } from "../presets/index.js";
import { UNSLOP_VERSION } from "../version.js";

export const MANAGED_START = "<!-- unslop:start -->";
export const MANAGED_END = "<!-- unslop:end -->";

export interface RuleSyncOptions {
  cwd?: string;
  preset: DesignPreset | string;
  /** Replace whole files instead of preserving content outside managed blocks. */
  force?: boolean;
}

export type RuleFileStatus = "created" | "updated" | "unchanged";

export interface SyncedRuleFile {
  path: string;
  status: RuleFileStatus;
}

export interface RuleSyncResult {
  preset: string;
  files: SyncedRuleFile[];
}

interface RuleTarget {
  path: string;
  claudeSkill?: boolean;
}

const RULE_TARGETS: RuleTarget[] = [
  { path: ".claude/skills/unslop/SKILL.md", claudeSkill: true },
  { path: "CLAUDE.md" },
  { path: "AGENTS.md" },
  { path: ".cursorrules" },
  { path: ".windsurfrules" },
  { path: ".clinerules" },
];

function kebabCase(value: string): string {
  return value.replace(/([a-z\d])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** Render a drop-in CSS token contract for the selected design system. */
export function renderTokenCSS(preset: DesignPreset): string {
  const { tokens } = preset;
  const lines = [
    ":root {",
    `  color-scheme: ${tokens.colorScheme};`,
    ...Object.entries(tokens.colors).map(
      ([name, value]) => `  --unslop-color-${kebabCase(name)}: ${value};`,
    ),
    `  --unslop-font-sans: ${tokens.typography.fontFamily};`,
    `  --unslop-font-mono: ${tokens.typography.monospaceFamily};`,
    ...Object.entries(tokens.typography.scale).map(
      ([name, value]) => `  --unslop-text-${kebabCase(name)}: ${value};`,
    ),
    `  --unslop-tracking-display: ${tokens.typography.displayTracking};`,
    `  --unslop-tracking-body: ${tokens.typography.bodyTracking};`,
    ...Object.entries(tokens.radii).map(
      ([name, value]) => `  --unslop-radius-${kebabCase(name)}: ${value};`,
    ),
    ...Object.entries(tokens.shadows).map(
      ([name, value]) => `  --unslop-shadow-${kebabCase(name)}: ${value};`,
    ),
    ...tokens.spacing.scale.map(
      (value) => `  --unslop-space-${String(value).replace(/\./g, "_")}: ${value}px;`,
    ),
    `  --unslop-duration: ${tokens.motion.duration};`,
    `  --unslop-easing: ${tokens.motion.easing};`,
    `  --unslop-content-max: ${tokens.layout.maxWidth};`,
    `  --unslop-border-width: ${tokens.layout.borderWidth};`,
    `  --unslop-grid-gap: ${tokens.layout.gridGap};`,
    `  --unslop-content-inset: ${tokens.layout.contentInset};`,
  ];
  if (tokens.effects?.backdropBlur) {
    lines.push(`  --unslop-backdrop-blur: ${tokens.effects.backdropBlur};`);
  }
  if (tokens.effects?.backdropSaturation) {
    lines.push(`  --unslop-backdrop-saturation: ${tokens.effects.backdropSaturation};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/** Compile a preset into framework-agnostic instructions for any coding agent. */
export function renderRuleDocument(preset: DesignPreset): string {
  const { tokens } = preset;
  const typeRows = Object.entries(tokens.typography.scale).map(([name, size]) => [
    name,
    `\`${size}\``,
  ]);
  const colorRows = Object.entries(tokens.colors).map(([name, value]) => [
    kebabCase(name),
    `\`${value}\``,
  ]);
  const radiusRows = Object.entries(tokens.radii).map(([name, value]) => [
    name,
    `\`${value}\``,
  ]);
  const shadowRows = Object.entries(tokens.shadows).map(([name, value]) => [
    name,
    `\`${value}\``,
  ]);
  const spring = tokens.motion.spring;
  const sections = [
    `# unslop · ${preset.title}`,
    "",
    preset.description,
    "",
    "These rules are mandatory whenever you create, refactor, or review frontend code. Preserve product behavior and content while enforcing this visual system. Do not substitute a generic component-library theme for these tokens.",
    "",
    "## 1. Design physics",
    "",
    "1. **Hierarchy before decoration.** Establish meaning through composition, type, spacing, and contrast before color, shadows, or animation.",
    "2. **One grid.** Align every edge and baseline to the spacing contract. Arbitrary values require a documented semantic reason.",
    "3. **One accent.** Use the accent for action, focus, selection, or a deliberate data encoding—not ambient decoration.",
    "4. **Optical alignment.** Account for glyph overhang, icon bounds, border thickness, and shadow offset; mathematical sameness is not always visual alignment.",
    "5. **Accessible by construction.** Maintain WCAG AA contrast, visible keyboard focus, 44px touch targets where space allows, semantic HTML, and reduced-motion behavior.",
    "6. **Content-specific composition.** Never default to a centered hero, purple gradient, three emoji cards, and a final call-to-action. Derive layout from the information architecture.",
    "",
    "## 2. Color contract",
    "",
    markdownTable(["Semantic token", "Value"], colorRows),
    "",
    `- Page color scheme: **${tokens.colorScheme}**.`,
    "- Never invent raw hex, RGB, HSL, or opacity values when a semantic token exists.",
    "- Use text-muted only for secondary copy that still meets contrast requirements.",
    "- Verify WCAG 2.1 contrast with real sRGB luminance after alpha compositing: normal text requires 4.5:1; large text (24px, or 18.66px at 700+) requires 3:1. Resolve every slop/low-contrast finding.",
    "- No purple/indigo gradient clichés, neon cyber-glows, rainbow accent palettes, or color-only status communication.",
    "",
    "## 3. Typography contract",
    "",
    `Sans stack: \`${tokens.typography.fontFamily}\`  `,
    `Monospace stack: \`${tokens.typography.monospaceFamily}\`  `,
    `Display tracking: \`${tokens.typography.displayTracking}\`; body tracking: \`${tokens.typography.bodyTracking}\`.`,
    "",
    markdownTable(["Scale step", "Size"], typeRows),
    "",
    `Available weights: ${Object.entries(tokens.typography.weights)
      .map(([name, weight]) => `${name} ${weight}`)
      .join(", ")}.`,
    "- Display headings require tight tracking, deliberate line-height, balanced wrapping, and a constrained measure.",
    "- Body copy normally stays between 45 and 75 characters per line. Do not center long-form copy.",
    "- Use `font-variant-numeric: tabular-nums` for prices, metrics, counters, clocks, identifiers, and data columns.",
    "- Use at most three font weights in a component tree. Prefer size, spacing, and color over additional weights.",
    "",
    "## 4. Geometry and spacing",
    "",
    `- Base spacing grid: **${tokens.spacing.base}px**.`,
    `- Allowed spacing stops: **${tokens.spacing.scale.join(", ")}px**.`,
    `- Content maximum: **${tokens.layout.maxWidth}**; grid: **${tokens.layout.columns} columns**; gap: **${tokens.layout.gridGap}**; inline inset: **${tokens.layout.contentInset}**.`,
    `- Default border width: **${tokens.layout.borderWidth}**.`,
    "- No same-element spacing or radius utility conflicts. Responsive changes must use explicit responsive variants.",
    "- Group related controls with smaller gaps and separate regions with larger gaps; do not distribute everything evenly by default.",
    "- Nested corner radii must account for the padding between outer and inner surfaces.",
    "",
    markdownTable(["Radius token", "Value"], radiusRows),
    "",
    "## 5. Elevation and material",
    "",
    markdownTable(["Elevation token", "Value"], shadowRows),
    "",
    "- Anchor elevated surfaces with the border token. Never add raw `shadow-xl`/`shadow-2xl` without an intentional border and layered elevation decision.",
    "- Do not stack multiple elevated cards inside one another. Prefer whitespace and hairline separators for ordinary grouping.",
  ];
  if (tokens.effects?.backdropBlur) {
    sections.push(
      `- Glass surfaces use backdrop blur \`${tokens.effects.backdropBlur}\`${tokens.effects.backdropSaturation ? ` and saturation \`${tokens.effects.backdropSaturation}\`` : ""}; provide an opaque fallback and verify composited contrast.`,
    );
  }
  sections.push(
    "",
    "## 6. Motion contract",
    "",
    `- Duration: \`${tokens.motion.duration}\`; easing: \`${tokens.motion.easing}\`.`,
  );
  if (spring) {
    sections.push(`- Spring: mass ${spring.mass}, stiffness ${spring.stiffness}, damping ${spring.damping}.`);
  }
  sections.push(
    "- Animate only properties that communicate causality. Prefer transform and opacity; avoid layout thrashing.",
    "- Under `prefers-reduced-motion: reduce`, remove spatial and ambient motion and preserve immediate state feedback.",
    "",
    "## 7. Preset-specific laws",
    "",
    ...preset.rules.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "## 8. CSS token source of truth",
    "",
    `Use these variables directly or map them once into Tailwind, CSS Modules, styled-components, or the host design system. Do not create a second competing token scale. For Tailwind v4 @theme plus :root and .dark variables, run \`npx github:avivgerz-hue/unslop export-tokens --preset ${preset.name} --out tokens.css\`.`,
    "",
    "```css",
    renderTokenCSS(preset),
    "```",
    "",
    "## 9. Agent execution loop",
    "",
    "1. Inspect existing components and reuse their semantic primitives before creating new ones.",
    "2. Write the information hierarchy and responsive grid first; implement typography and spacing before visual effects.",
    "3. Implement all interaction states: default, hover, focus-visible, active, disabled, loading, empty, error, and success where applicable.",
    "4. Run `npx github:avivgerz-hue/unslop audit .` and resolve every reported location without suppressing rules.",
    "5. Manually verify narrow and wide viewports, keyboard navigation, contrast, reduced motion, numeric alignment, and content overflow.",
    "",
    "A passing audit is necessary but not sufficient: never claim visual excellence without checking the rendered result.",
  );
  return sections.join("\n");
}

export function managedBlock(content: string): string {
  return `${MANAGED_START}\n${content.trim()}\n${MANAGED_END}`;
}

function skillFrontmatter(preset: DesignPreset): string {
  return [
    "---",
    "name: unslop",
    `description: ${JSON.stringify(`Enforce the ${preset.title} design system and eliminate generic AI UI slop. Use when building, refactoring, or reviewing frontend interfaces.`)}`,
    "---",
  ].join("\n");
}

/** Render a standalone Claude-compatible SKILL.md document. */
export function renderAgentSkill(preset: DesignPreset): string {
  return `${skillFrontmatter(preset)}\n\n${managedBlock(renderRuleDocument(preset))}\n`;
}

function replaceManagedBlock(existing: string, content: string): string | undefined {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start < 0 && end < 0) return undefined;
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      `Invalid unslop managed block: both ${MANAGED_START} and ${MANAGED_END} are required. Re-run with --force to rebuild the file.`,
    );
  }
  const afterEnd = end + MANAGED_END.length;
  if (
    existing.indexOf(MANAGED_START, start + MANAGED_START.length) >= 0 ||
    existing.indexOf(MANAGED_END, afterEnd) >= 0
  ) {
    throw new Error("Invalid unslop managed block: duplicate markers found. Re-run with --force to rebuild the file.");
  }
  return `${existing.slice(0, start)}${managedBlock(content)}${existing.slice(afterEnd)}`;
}

function nextContent(existing: string | undefined, preset: DesignPreset, target: RuleTarget, force: boolean): string {
  const document = renderRuleDocument(preset);
  const fresh = target.claudeSkill
    ? renderAgentSkill(preset)
    : `${managedBlock(document)}\n`;
  if (force || existing === undefined || existing.trim().length === 0) return fresh;

  const replaced = replaceManagedBlock(existing, document);
  if (replaced !== undefined) {
    // Rebuild a missing frontmatter only for a newly managed skill; existing
    // frontmatter and user content are deliberately left byte-for-byte intact.
    return replaced.endsWith("\n") ? replaced : `${replaced}\n`;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${managedBlock(document)}\n`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.unslop.tmp`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Write Claude Code, Codex, Cursor, and Windsurf rules. Existing user content is
 * preserved and repeated runs replace only the unslop managed block.
 */
export async function syncRuleFiles(options: RuleSyncOptions): Promise<RuleSyncResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const preset = typeof options.preset === "string" ? loadPreset(options.preset) : options.preset;
  const files: SyncedRuleFile[] = [];
  for (const target of RULE_TARGETS) {
    const absolutePath = join(cwd, target.path);
    let existing: string | undefined;
    try {
      existing = await readFile(absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const content = nextContent(existing, preset, target, options.force ?? false);
    if (existing === content) {
      files.push({ path: target.path, status: "unchanged" });
      continue;
    }
    await atomicWrite(absolutePath, content);
    files.push({
      path: target.path,
      status: existing === undefined ? "created" : "updated",
    });
  }
  return { preset: preset.name, files };
}

export const writeAgentRules = syncRuleFiles;

export interface MCPSyncOptions {
  cwd?: string;
  /** Package specifier used by npx. Defaults to the current release. */
  packageSpec?: string;
}

function isJSONObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge unslop into a project's .mcp.json without disturbing other servers. */
export async function syncMcpConfig(options: MCPSyncOptions = {}): Promise<SyncedRuleFile> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const path = join(cwd, ".mcp.json");
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let config: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (error) {
      throw new Error(
        `Cannot update .mcp.json because it is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isJSONObject(parsed)) throw new Error("Cannot update .mcp.json: its root must be a JSON object.");
    config = parsed;
  }
  if (config.mcpServers !== undefined && !isJSONObject(config.mcpServers)) {
    throw new Error("Cannot update .mcp.json: mcpServers must be a JSON object.");
  }
  const servers = isJSONObject(config.mcpServers) ? config.mcpServers : {};
  const currentUnslop = isJSONObject(servers.unslop) ? servers.unslop : {};
  const packageSpec = options.packageSpec?.trim() || `github:avivgerz-hue/unslop`;
  const content = `${JSON.stringify(
    {
      ...config,
      mcpServers: {
        ...servers,
        unslop: {
          ...currentUnslop,
          command: "npx",
          args: ["-y", packageSpec, "mcp"],
        },
      },
    },
    null,
    2,
  )}\n`;
  if (existing === content) return { path: ".mcp.json", status: "unchanged" };
  await atomicWrite(path, content);
  return { path: ".mcp.json", status: existing === undefined ? "created" : "updated" };
}

/** Install agent rules and the native MCP configuration as one CLI operation. */
export async function installUnslop(options: RuleSyncOptions & MCPSyncOptions): Promise<RuleSyncResult> {
  const result = await syncRuleFiles(options);
  const mcp = await syncMcpConfig(options);
  return { ...result, files: [...result.files, mcp] };
}

export function portableRulePath(path: string): string {
  return path.split(sep).join("/");
}

export function relativeRulePath(cwd: string, path: string): string {
  return portableRulePath(relative(cwd, path));
}
