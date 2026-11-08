import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeSource,
  auditTarget,
  calculateDesignIntegrityScore,
  formatAuditReport,
  generateRefactoringPrompt,
} from "../src/analyzer/slop-detector.js";
import {
  createPresetFromDNA,
  extractDesignDNA,
  extractTokensFromCSS,
} from "../src/extractor/extract-dna.js";
import {
  listPresets,
  listPresetSummaries,
  loadPreset,
  PRESET_NAMES,
  validatePreset,
} from "../src/presets/index.js";
import {
  MANAGED_END,
  MANAGED_START,
  renderAgentSkill,
  renderTokenCSS,
  syncRuleFiles,
} from "../src/sync/rule-writer.js";
import { CLI_VERSION, runCli } from "../bin/unslop.js";
import { UNSLOP_VERSION } from "../src/version.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "unslop-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function ruleIDs(source: string, file = "fixture.tsx"): string[] {
  return analyzeSource(source, file).map((violation) => violation.ruleId);
}

describe("slop detector", () => {
  it("flags Tailwind and CSS cliché gradients with exact source locations", () => {
    const source = [
      "<section className=\"bg-gradient-to-r from-purple-500 via-indigo-500\">",
      "  <style>{`.hero { background: linear-gradient(90deg, #8b5cf6, #111111); }`}</style>",
      "</section>",
    ].join("\n");
    const violations = analyzeSource(source, "src/Hero.tsx").filter(
      (violation) => violation.ruleId === "slop/cliche-gradient",
    );
    expect(violations).toHaveLength(3);
    expect(violations[0]).toMatchObject({ file: "src/Hero.tsx", line: 1, column: 38 });
    expect(violations.map((violation) => violation.line)).toEqual([1, 1, 2]);
    expect(violations[0]?.recommendation).toContain("semantic");
  });

  it("requires multiple signals before flagging an emoji feature grid", () => {
    const slop = `<section className="grid md:grid-cols-3 text-center gap-8">
      <article><div>🚀</div><h3>Fast</h3></article>
      <article><div>✨</div><h3>Beautiful</h3></article>
      <article><div>🔒</div><h3>Secure</h3></article>
    </section>`;
    const intentional = `<section className="grid md:grid-cols-3 gap-8">
      <article><h3>Fast</h3><p>Measured in milliseconds.</p></article>
    </section>`;
    expect(ruleIDs(slop)).toContain("slop/emoji-feature-grid");
    expect(ruleIDs(intentional)).not.toContain("slop/emoji-feature-grid");
  });

  it("flags neon glows independently from ordinary elevation", () => {
    const violations = analyzeSource(
      `.terminal { box-shadow: 0 0 32px #00ffff; }`,
      "terminal.css",
    );
    expect(violations.map((violation) => violation.ruleId)).toContain("slop/neon-glow");
    expect(ruleIDs(`.status { text-shadow: 0 0 12px rgba(255, 0, 255, .8); }`, "status.css")).toContain("slop/neon-glow");
    expect(ruleIDs(`.icon { filter: drop-shadow(0 0 8px #0ff); }`, "icon.css")).toContain("slop/neon-glow");
    expect(ruleIDs(`<div className="shadow-[0_0_24px_#39ff14]"/>`, "glow.tsx")).toContain("slop/neon-glow");
    expect(ruleIDs(`.icon { filter: drop-shadow(0 2px 4px rgba(0,0,0,.2)); }`, "icon.css")).not.toContain("slop/neon-glow");
  });

  it("accepts bordered or layered elevation and rejects raw heavy shadows", () => {
    expect(ruleIDs(`<div className="shadow-2xl rounded-xl p-6">Card</div>`)).toContain("slop/raw-elevation");
    expect(ruleIDs(`<div className="shadow-2xl border border-white/10 rounded-xl p-6">Card</div>`)).not.toContain("slop/raw-elevation");
    expect(ruleIDs(`.card { box-shadow: 0 20px 40px rgba(0,0,0,.3); }`, "card.css")).toContain("slop/raw-elevation");
    expect(ruleIDs(`.card { box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 20px 40px rgba(0,0,0,.2); }`, "card.css")).not.toContain("slop/raw-elevation");
  });

  it("requires a real 1px border instead of a color-only utility or radius", () => {
    expect(ruleIDs(`<div className="shadow-xl border-white/10">Card</div>`)).toContain("slop/raw-elevation");
    expect(ruleIDs(`.card { border-radius: 1px; box-shadow: 0 20px 40px rgba(0,0,0,.3); }`, "card.css")).toContain("slop/raw-elevation");
    expect(ruleIDs(`.card { border-width: 1px; border-color: rgba(0,0,0,.12); box-shadow: 0 20px 40px rgba(0,0,0,.3); }`, "card.css")).not.toContain("slop/raw-elevation");
    expect(ruleIDs(`.card { border: 1px solid transparent; box-shadow: 0 20px 40px rgba(0,0,0,.3); }`, "card.css")).toContain("slop/raw-elevation");
  });

  it("enforces display tracking for JSX and CSS headings only when needed", () => {
    expect(ruleIDs(`<h1 className="text-6xl font-semibold">Precision</h1>`)).toContain("slop/display-tracking");
    expect(ruleIDs(`<h1 className="text-6xl tracking-tighter font-semibold">Precision</h1>`)).not.toContain("slop/display-tracking");
    expect(ruleIDs(`h1 { font-size: 3rem; }`, "type.css")).toContain("slop/display-tracking");
    expect(ruleIDs(`h1 { font-size: 3rem; letter-spacing: -0.04em; }`, "type.css")).not.toContain("slop/display-tracking");
    expect(ruleIDs(`<p className="text-base">Readable copy</p>`)).not.toContain("slop/display-tracking");
  });

  it("detects static and explicitly marked dynamic numeric UI", () => {
    expect(ruleIDs(`<span className="text-2xl">1,234.50</span>`)).toContain("slop/numeric-alignment");
    expect(ruleIDs(`<span className="metric">{downloads.toLocaleString()}</span>`)).toContain("slop/numeric-alignment");
    expect(ruleIDs(`<span className="text-2xl tabular-nums">1,234.50</span>`)).not.toContain("slop/numeric-alignment");
    expect(ruleIDs(`<p>Version 2 introduces stable tokens.</p>`)).not.toContain("slop/numeric-alignment");
  });

  it("limits font-weight mixing without banning responsive or normal hierarchy", () => {
    const source = `<div><span className="font-light">A</span><span className="font-normal">B</span><span className="font-medium">C</span><span className="font-bold">D</span></div>`;
    expect(ruleIDs(source)).toContain("slop/font-weight-mixing");
    expect(ruleIDs(`<div><span className="font-normal">A</span><strong className="font-semibold">B</strong></div>`)).not.toContain("slop/font-weight-mixing");
  });

  it("distinguishes spacing conflicts from intentional responsive changes", () => {
    expect(ruleIDs(`<div className="p-4 p-6">Conflict</div>`)).toContain("slop/conflicting-spacing");
    expect(ruleIDs(`<div className="p-4 md:p-6">Responsive</div>`)).not.toContain("slop/conflicting-spacing");
    expect(ruleIDs(`<div className="p-[13px]">Off grid</div>`)).toContain("slop/off-grid-spacing");
    expect(ruleIDs(`<div className="mt-[1px] p-[12px]">Optical</div>`)).not.toContain("slop/off-grid-spacing");
  });

  it("detects competing radii and excessive radius-scale mixing", () => {
    expect(ruleIDs(`<div className="rounded-lg rounded-xl">Conflict</div>`)).toContain("slop/conflicting-radius");
    const mixed = `<div className="rounded-sm"><div className="rounded-md"/><div className="rounded-xl"/><div className="rounded-3xl"/></div>`;
    expect(ruleIDs(mixed)).toContain("slop/radius-scale");
    expect(ruleIDs(`<div className="rounded-lg md:rounded-xl">Responsive</div>`)).not.toContain("slop/conflicting-radius");
  });

  it("returns a perfect score and useful prompt for clean source", () => {
    const source = `<main className="mx-auto max-w-6xl p-6">
      <h1 className="text-6xl tracking-tight font-semibold">Design with intent</h1>
      <div className="rounded-lg border border-white/10 shadow-md p-6">
        <span className="tabular-nums">42,001</span>
      </div>
    </main>`;
    const violations = analyzeSource(source, "clean.tsx");
    expect(violations).toEqual([]);
    expect(calculateDesignIntegrityScore(violations)).toBe(100);
    expect(generateRefactoringPrompt(violations)).toContain("No slop violations");
  });

  it("clamps the score and creates a structured location-aware refactoring brief", () => {
    const source = Array.from({ length: 20 }, () => `<div className="shadow-xl p-4 p-8">Raw</div>`).join("\n");
    const violations = analyzeSource(source, "src/Bad.tsx");
    const prompt = generateRefactoringPrompt(violations);
    expect(calculateDesignIntegrityScore(violations)).toBe(0);
    expect(prompt).toContain("# unslop refactoring brief");
    expect(prompt).toContain("src/Bad.tsx:1:1");
    expect(prompt).toContain("## Acceptance criteria");
  });

  it("audits supported files recursively in deterministic order and ignores build output", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "components"));
    await mkdir(join(directory, "node_modules", "package"), { recursive: true });
    await writeFile(join(directory, "components", "b.tsx"), `<div className="shadow-xl"/>`, "utf8");
    await writeFile(join(directory, "a.vue"), `<template><h1 class="text-5xl">Hello</h1></template>`, "utf8");
    await writeFile(join(directory, "node_modules", "package", "ignored.tsx"), `<div className="from-purple-500"/>`, "utf8");
    await writeFile(join(directory, "notes.txt"), "from-purple-500", "utf8");

    const report = await auditTarget(directory, { cwd: directory });
    expect(report.files).toEqual(["a.vue", "components/b.tsx"]);
    expect(report.filesScanned).toBe(2);
    expect(report.summary.warnings).toBe(2);
    expect(report.violations.map((violation) => violation.file)).toEqual(["a.vue", "components/b.tsx"]);
    expect(formatAuditReport(report)).toContain(`Design Integrity Score: ${report.score}/100`);
  });

  it("rejects a missing audit target", async () => {
    await expect(auditTarget("/definitely/not/a/real/unslop-target")).rejects.toThrow("does not exist");
  });
});

describe("preset registry", () => {
  it("loads all five complete and distinct design systems", () => {
    expect(PRESET_NAMES).toEqual([
      "linear-dark",
      "swiss-grid",
      "stripe-minimal",
      "apple-glass",
      "neo-brutalist",
    ]);
    const presets = listPresets();
    expect(presets).toHaveLength(5);
    expect(new Set(presets.map((preset) => preset.tokens.colors.accent)).size).toBe(5);
    for (const preset of presets) {
      expect(validatePreset(preset)).toEqual(preset);
      expect(preset.rules.length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(preset.tokens.typography.scale)).toHaveLength(8);
    }
    expect(listPresetSummaries()[0]).toMatchObject({ name: "linear-dark", colorScheme: "dark" });
  });

  it("returns defensive copies and normalizes preset names", () => {
    const first = loadPreset(" Linear-Dark.json ");
    first.tokens.colors.accent = "#000000";
    first.rules.pop();
    expect(loadPreset("linear-dark").tokens.colors.accent).toBe("#5e6ad2");
    expect(loadPreset("linear-dark").rules).toHaveLength(10);
  });

  it("rejects unknown and malformed presets", () => {
    expect(() => loadPreset("generic-ai")).toThrow("Available presets");
    expect(() => validatePreset({ schemaVersion: 1 })).toThrow("non-empty string");
    const malformed = structuredClone(loadPreset("swiss-grid")) as unknown as { tokens: { spacing: { base: number } } };
    malformed.tokens.spacing.base = 0;
    expect(() => validatePreset(malformed)).toThrow("must be positive");
  });
});

const DESIGN_CSS = `
:root {
  --color-bg: #090a0c;
  --color-surface: #111318;
  --color-text: #f5f7fa;
  --color-border: rgba(255, 255, 255, 0.12);
  --color-accent: #5e6ad2;
  --color-muted: #9aa4b2;
  --color-on-accent: #ffffff;
  --font-sans: "Inter", system-ui, sans-serif;
  --space-4: 16px;
  --radius-card: 12px;
}
body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.5;
  letter-spacing: -0.01em;
  padding: 24px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 16px 32px rgba(0,0,0,.3);
  gap: 8px;
}
.button {
  background: var(--color-accent);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
}
h1 { font-size: 48px; letter-spacing: -0.04em; }
.swatch { color: #abc; }
`;

describe("Design DNA extractor", () => {
  it("extracts semantic colors, typography, radii, shadows, spacing, and motion", () => {
    const dna = extractTokensFromCSS(DESIGN_CSS, "fixture.css");
    expect(dna.colors.surface.map((token) => token.value)).toEqual(expect.arrayContaining(["#090a0c", "#111318"]));
    expect(dna.colors.text.map((token) => token.value)).toEqual(expect.arrayContaining(["#f5f7fa", "#aabbcc"]));
    expect(dna.colors.border[0]?.value).toContain("rgba");
    expect(dna.colors.accent.map((token) => token.value)).toContain("#5e6ad2");
    expect(dna.colors.mutedText.map((token) => token.value)).toContain("#9aa4b2");
    expect(dna.colors.accentText.map((token) => token.value)).toContain("#ffffff");
    expect(dna.typography.fontStacks[0]?.value).toContain('"Inter", system-ui, sans-serif');
    expect(dna.typography.fontSizes.map((token) => token.value)).toEqual(["14px", "16px", "48px"]);
    expect(dna.typography.fontWeights.map((token) => token.value)).toContain("600");
    expect(dna.typography.letterSpacings.map((token) => token.value)).toEqual(expect.arrayContaining(["-0.01em", "-0.04em"]));
    expect(dna.radii.map((token) => token.value)).toEqual(expect.arrayContaining(["8px", "12px"]));
    expect(dna.shadows.map((token) => token.value)).toEqual(expect.arrayContaining(["0 1px 2px rgba(0,0,0,.2)", "0 16px 32px rgba(0,0,0,.3)"]));
    expect(dna.shadowCompositions?.map((token) => token.value)).toContain("0 1px 2px rgba(0,0,0,.2), 0 16px 32px rgba(0,0,0,.3)");
    expect(dna.spacing.map((token) => token.value)).toEqual(expect.arrayContaining(["8px", "16px", "24px"]));
    expect(dna.motion.durations.map((token) => token.value)).toContain("160ms");
    expect(dna.motion.easings.map((token) => token.value)).toContain("cubic-bezier(0.2, 0, 0, 1)");
    expect(dna.cssVariables["--color-bg"]).toBe("#090a0c");
  });

  it("compiles extracted tokens into a valid enforceable preset", () => {
    const dna = extractTokensFromCSS(DESIGN_CSS, "https://studio.example");
    const preset = createPresetFromDNA(dna, "Acme Precision Dark");
    expect(validatePreset(preset)).toEqual(preset);
    expect(preset.name).toBe("acme-precision-dark");
    expect(preset.tokens.colorScheme).toBe("dark");
    expect(preset.tokens.colors.background).toBe("#090a0c");
    expect(preset.tokens.colors.accent).toBe("#5e6ad2");
    expect(preset.tokens.colors.textMuted).toBe("#9aa4b2");
    expect(preset.tokens.colors.accentText).toBe("#ffffff");
    expect(preset.tokens.typography.displayTracking).toBe("-0.04em");
    expect(preset.tokens.typography.bodyTracking).toBe("-0.01em");
    expect(preset.tokens.typography.scale).toEqual({ sm: "14px", base: "16px", "3xl": "48px" });
    expect(preset.tokens.shadows.sm).toBe("0 1px 2px rgba(0,0,0,.2), 0 16px 32px rgba(0,0,0,.3)");
    expect(preset.tokens.shadows.lg).toBe(preset.tokens.shadows.sm);
    expect(preset.tokens.spacing.base).toBe(8);
    expect(preset.rules.join(" ")).toContain("https://studio.example");
  });

  it("provides complete defaults when a stylesheet contains no recognizable tokens", () => {
    const preset = createPresetFromDNA(extractTokensFromCSS(".empty { display: block; }"), "fallback");
    expect(validatePreset(preset)).toEqual(preset);
    expect(preset.tokens.spacing.scale).toContain(0);
    expect(preset.tokens.typography.weights).toEqual({ weight1: 400, weight2: 600 });
    expect(preset.tokens.colors.accentText).toBe("#ffffff");
    const dark = createPresetFromDNA(
      extractTokensFromCSS(":root { --color-bg: #090a0c; --color-accent: #5e6ad2; }"),
      "contrast",
    );
    expect(dark.tokens.colors.accentText).toBe("#ffffff");
    const bright = createPresetFromDNA(
      extractTokensFromCSS(":root { --color-bg: #ffffff; --color-accent: #ff5c35; }"),
      "bright",
    );
    expect(bright.tokens.colors.accentText).toBe("#111111");
  });

  it("reads a local CSS file", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "tokens.css"), DESIGN_CSS, "utf8");
    const dna = await extractDesignDNA(join(directory, "tokens.css"));
    expect(dna.source).toContain("tokens.css");
    expect(dna.typography.fontSizes).toHaveLength(3);
  });

  it("fetches inline DOM styles, linked CSS, and imports with an injectable network stack", async () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/site.css">
      <style>.inline { border-radius: 6px; }</style>
      </head><body><main style="padding: 32px; background: #f8f8f6">Content</main></body></html>`;
    const responses: Record<string, { body: string; type: string }> = {
      "https://studio.test/": { body: html, type: "text/html" },
      "https://studio.test/site.css": { body: `@import url("/reset.css"); body { color: #171717; } .card { border-radius: 10px; }`, type: "text/css" },
      "https://studio.test/reset.css": { body: `h1 { font-size: 40px; letter-spacing: -0.03em; }`, type: "text/css" },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const resource = responses[url];
      if (!resource) return new Response("missing", { status: 404, statusText: "Not Found" });
      return new Response(resource.body, { status: 200, headers: { "content-type": resource.type } });
    });
    const dna = await extractDesignDNA("https://studio.test/", { fetchImpl: fetchMock as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dna.radii.map((token) => token.value)).toEqual(expect.arrayContaining(["6px", "10px"]));
    expect(dna.spacing.map((token) => token.value)).toContain("32px");
    expect(dna.typography.fontSizes.map((token) => token.value)).toContain("40px");
    expect(dna.warnings).toEqual([]);
  });

  it("keeps inline extraction usable when an external stylesheet fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/missing.css")) return new Response("no", { status: 404, statusText: "Not Found" });
      return new Response(`<link rel="stylesheet" href="/missing.css"><style>body { color: #111111; }</style>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const dna = await extractDesignDNA("https://example.test", { fetchImpl: fetchMock as typeof fetch });
    expect(dna.colors.text.map((token) => token.value)).toContain("#111111");
    expect(dna.warnings[0]).toContain("HTTP 404");
  });

  it("enforces the external stylesheet budget without dropping inline tokens", async () => {
    const fetchMock = vi.fn(async () => new Response(
      `<link rel="stylesheet" href="/one.css"><style>body { font-size: 18px; }</style>`,
      { status: 200, headers: { "content-type": "text/html" } },
    ));
    const dna = await extractDesignDNA("https://example.test", {
      fetchImpl: fetchMock as typeof fetch,
      maxStylesheets: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dna.typography.fontSizes[0]?.value).toBe("18px");
    expect(dna.warnings[0]).toContain("Stylesheet limit (0)");
  });

  it("enforces streamed response limits and validates extraction budgets", async () => {
    const fetchMock = vi.fn(async () => new Response("body { color: #111111; }", {
      status: 200,
      headers: { "content-type": "text/css" },
    }));
    await expect(extractDesignDNA("https://example.test/site.css", {
      fetchImpl: fetchMock as typeof fetch,
      maxBytes: 12,
    })).rejects.toThrow("12-byte limit");
    await expect(extractDesignDNA("https://example.test/site.css", {
      fetchImpl: fetchMock as typeof fetch,
      maxBytes: 0,
    })).rejects.toThrow("maxBytes must be a positive integer");
  });

  it("rejects unsupported protocols and HTTP failures clearly", async () => {
    await expect(extractDesignDNA("file:///etc/passwd")).rejects.toThrow("Only http:// and https://");
    const fetchMock = vi.fn(async () => new Response("denied", { status: 403, statusText: "Forbidden" }));
    await expect(extractDesignDNA("https://example.test", { fetchImpl: fetchMock as typeof fetch })).rejects.toThrow("HTTP 403");
  });
});

describe("agent rule writer", () => {
  it("writes all six agent integrations and preserves unmanaged instructions", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "CLAUDE.md"), "My project instructions.\n", "utf8");
    const result = await syncRuleFiles({ cwd: directory, preset: "swiss-grid" });
    expect(result.files).toHaveLength(6);
    expect(result.files.every((file) => file.status === "created" || file.status === "updated")).toBe(true);
    const skill = await readFile(join(directory, ".claude/skills/unslop/SKILL.md"), "utf8");
    const claude = await readFile(join(directory, "CLAUDE.md"), "utf8");
    expect(skill).toMatch(/^---\nname: unslop\ndescription:/);
    expect(skill).toContain("# unslop · Swiss Grid");
    expect(skill).toContain("--unslop-color-accent: #e30613;");
    expect(claude).toContain("My project instructions.");
    expect(claude.match(new RegExp(MANAGED_START, "g"))).toHaveLength(1);
    await expect(readFile(join(directory, "AGENTS.md"), "utf8")).resolves.toContain("12-column");
    await expect(readFile(join(directory, ".cursorrules"), "utf8")).resolves.toContain("tabular-nums");
    await expect(readFile(join(directory, ".windsurfrules"), "utf8")).resolves.toContain("prefers-reduced-motion");
    await expect(readFile(join(directory, ".clinerules"), "utf8")).resolves.toContain("Design physics");
  });

  it("is byte-for-byte idempotent and updates only the managed block", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "AGENTS.md"), "Keep the existing release process.\n", "utf8");
    await syncRuleFiles({ cwd: directory, preset: "linear-dark" });
    const first = await readFile(join(directory, "AGENTS.md"), "utf8");
    const secondResult = await syncRuleFiles({ cwd: directory, preset: "linear-dark" });
    expect(secondResult.files.every((file) => file.status === "unchanged")).toBe(true);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe(first);

    await syncRuleFiles({ cwd: directory, preset: "neo-brutalist" });
    const updated = await readFile(join(directory, "AGENTS.md"), "utf8");
    expect(updated).toContain("Keep the existing release process.");
    expect(updated).toContain("Neo Brutalist");
    expect(updated).not.toContain("# unslop · Linear Dark");
    expect(updated.indexOf(MANAGED_START)).toBe(updated.lastIndexOf(MANAGED_START));
    expect(updated.indexOf(MANAGED_END)).toBe(updated.lastIndexOf(MANAGED_END));
  });

  it("supports explicit force replacement and rejects malformed managed markers", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "AGENTS.md"), `Before\n${MANAGED_START}\nbroken`, "utf8");
    await expect(syncRuleFiles({ cwd: directory, preset: "linear-dark" })).rejects.toThrow("both");
    await syncRuleFiles({ cwd: directory, preset: "linear-dark", force: true });
    const forced = await readFile(join(directory, "AGENTS.md"), "utf8");
    expect(forced).not.toContain("Before");
    expect(forced).toContain("Linear Dark");
  });

  it("renders standalone skills and all optional material and spring tokens", () => {
    const preset = loadPreset("apple-glass");
    const skill = renderAgentSkill(preset);
    const css = renderTokenCSS(preset);
    expect(skill).toContain("mass 1, stiffness 260, damping 26");
    expect(skill).toContain("opaque fallback");
    expect(css).toContain("--unslop-backdrop-blur: 24px;");
    expect(css).toContain("--unslop-backdrop-saturation: 180%;");
  });
});

describe("CLI", () => {
  async function invoke(args: string[], cwd?: string) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(args, {
      cwd,
      stdout: (message) => { stdout += `${message}\n`; },
      stderr: (message) => { stderr += `${message}\n`; },
    });
    return { code, stdout, stderr };
  }

  it("provides help, version, preset inspection, and usage errors", async () => {
    expect((await invoke([])).stdout).toContain("npx github:avivgerz-hue/unslop <command>");
    expect((await invoke(["--version"])).stdout.trim()).toBe(CLI_VERSION);
    const presets = await invoke(["presets", "--json"]);
    expect(presets.code).toBe(0);
    expect(JSON.parse(presets.stdout)).toHaveLength(5);
    expect((await invoke(["presets", "swiss-grid"])).stdout).toContain("Helvetica Neue");
    const unknown = await invoke(["invented-command"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Unknown command");
  });

  it("initializes a target project through the real command handler", async () => {
    const directory = await temporaryDirectory();
    const result = await invoke(["init", "--preset", "neo-brutalist", "--json"], directory);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).files).toHaveLength(7);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toContain("hard offset shadows");
    const mcp = JSON.parse(await readFile(join(directory, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.unslop).toEqual({
      command: "npx",
      args: ["-y", `github:avivgerz-hue/unslop`, "mcp"],
    });
  });

  it("returns useful audit exit codes and valid JSON", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "bad.tsx"), `<div className="from-purple-500"/>`, "utf8");
    const failed = await invoke(["audit", "--json"], directory);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout).violations[0].ruleId).toBe("slop/cliche-gradient");
    expect((await invoke(["audit", "--no-fail"], directory)).code).toBe(0);

    await writeFile(join(directory, "bad.tsx"), `<h1 className="text-5xl tracking-tight">Clean</h1>`, "utf8");
    expect((await invoke(["audit", "--fail-under", "100"], directory)).code).toBe(0);
    expect((await invoke(["audit", "--fail-under", "101"], directory)).code).toBe(2);
  });

  it("prints and writes extracted Agent Skills and JSON", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "tokens.css"), DESIGN_CSS, "utf8");
    const skill = await invoke(["extract", "tokens.css", "--name", "Local DNA"], directory);
    expect(skill.code).toBe(0);
    expect(skill.stdout).toContain("name: unslop");
    expect(skill.stdout).toContain("Local DNA");
    expect(skill.stdout).toContain("#090a0c");

    const json = await invoke(["extract", "tokens.css", "--json", "--output", "out/dna.json"], directory);
    expect(json.code).toBe(0);
    const output = JSON.parse(await readFile(join(directory, "out/dna.json"), "utf8"));
    expect(output.preset.name).toBe("extracted-dna");
    expect(output.dna.typography.fontSizes).toHaveLength(3);
  });

  it("validates extract arguments and conflicting audit output modes", async () => {
    expect((await invoke(["extract"])).code).toBe(2);
    expect((await invoke(["audit", "--json", "--prompt"])).code).toBe(2);
    expect((await invoke(["init", "--preset", "unknown"])).code).toBe(1);
  });
});
