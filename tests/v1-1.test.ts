import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeSource,
  contrastRatio,
  parseColor,
  relativeLuminance,
  requiredContrastRatio,
} from "../src/analyzer/slop-detector.js";
import { createPresetFromDNA, extractTokensFromCSS } from "../src/extractor/extract-dna.js";
import {
  MCP_TOOL_DEFINITIONS,
  startMcpServer,
  UnslopMCPServer,
} from "../src/mcp/server.js";
import { listPresets } from "../src/presets/index.js";
import { installUnslop, syncMcpConfig } from "../src/sync/rule-writer.js";
import { renderTokenStylesheet } from "../src/sync/token-exporter.js";
import { UNSLOP_VERSION } from "../src/version.js";
import { runCli } from "../bin/unslop.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "unslop-v1-1-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

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

function lowContrast(source: string) {
  return analyzeSource(source, "contrast-fixture.tsx").filter(
    (violation) => violation.ruleId === "slop/low-contrast",
  );
}

describe("WCAG 2.1 mathematics and integration", () => {
  it("calculates exact relative luminance and symmetric contrast ratios", () => {
    expect(relativeLuminance("#000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(relativeLuminance("hsl(0 0% 100%)")).toBe(1);
    expect(relativeLuminance("rgb(100% 100% 100%)")).toBe(1);
    expect(contrastRatio("#000", "#fff")).toBe(21);
    expect(contrastRatio("#fff", "#000")).toBe(21);
    expect(contrastRatio("#777", "#fff")).toBeCloseTo(4.478089453577214, 12);
    expect(contrastRatio("red", "white")).toBeCloseTo(3.9984767707539985, 12);
    expect(requiredContrastRatio(16)).toBe(4.5);
    expect(requiredContrastRatio(24)).toBe(3);
    expect(requiredContrastRatio(19, 700)).toBe(3);
    expect(requiredContrastRatio(19, 600)).toBe(4.5);
    expect(() => relativeLuminance("var(--unknown)")).toThrow("Unsupported CSS color");
    expect(() => requiredContrastRatio(0)).toThrow("positive finite");
    expect(parseColor("#0000")?.a).toBe(0);
  });

  it("composites alpha before calculating contrast", () => {
    const expected = 3.976653024912438;
    expect(contrastRatio("rgba(0, 0, 0, 0.5)", "#fff")).toBeCloseTo(expected, 12);
    expect(contrastRatio("#00000080", "rgb(255 255 255)")).toBeCloseTo(4.0041069566148515, 12);
    expect(contrastRatio("hsl(0 0% 0% / 50%)", "white")).toBeCloseTo(expected, 12);
  });

  it("flags normal text below 4.5:1 and applies the 3:1 large-text threshold", () => {
    const violations = lowContrast(
      ".copy { color: #777; background: #fff; font-size: 16px; }",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      severity: "error",
      line: 1,
      category: "color",
    });
    expect(violations[0]?.message).toContain("4.48:1");
    expect(violations[0]?.recommendation).toContain("4.5:1");
    expect(lowContrast(".display { color: #777; background: #fff; font-size: 24px; }")).toEqual([]);
    expect(lowContrast(".display { color: #777; background: #fff; font-size: 19px; font-weight: 700; }")).toEqual([]);
    expect(lowContrast(".display { color: #777; background: #fff; font-size: 19px; font-weight: bold; }")).toEqual([]);
    expect(lowContrast(".copy { color: #595959; background: #fff; font-size: 16px; }")).toEqual([]);
  });

  it("resolves variables and inherited canvases in CSS and JSX", () => {
    const css = `:root { --canvas: #ffffff; --copy: #777777; }
      body { background: var(--canvas); }
      .muted { color: var(--copy); font-size: 1rem; }`;
    expect(lowContrast(css)).toHaveLength(1);
    expect(lowContrast(`<p className="text-gray-400 bg-white text-base">Muted</p>`)).toHaveLength(1);
    expect(lowContrast(`<p className="text-[#777777] bg-[#ffffff] text-2xl">Large</p>`)).toEqual([]);
    expect(lowContrast(`<p style="color: rgba(0,0,0,.5); background: #fff">Small</p>`)).toHaveLength(1);
    expect(lowContrast(`<p className="text-gray-700 bg-white text-base">Readable</p>`)).toEqual([]);
  });
});

describe("Tailwind v4 and semantic token exporter", () => {
  it("exports complete deterministic @theme, :root, and .dark blocks for every preset", () => {
    for (const preset of listPresets()) {
      const css = renderTokenStylesheet(preset);
      expect(css).toContain("@theme {");
      expect(css).toContain(":root {");
      expect(css).toContain(".dark {");
      expect(css).toContain(`--color-accent: ${preset.tokens.colors.accent};`);
      expect(css).toContain(`--surface-0: ${preset.tokens.colors.background};`);
      expect(css).toContain(`--border-subtle: ${preset.tokens.colors.border};`);
      expect(css).toContain(`--font-display: ${preset.tokens.typography.fontFamily};`);
      expect(css).toContain(`--spacing: ${preset.tokens.spacing.base}px;`);
      expect(css).toContain(`--container-content: ${preset.tokens.layout.maxWidth};`);
      expect(css).not.toMatch(/undefined|NaN/);
      expect(renderTokenStylesheet(preset)).toBe(css);
    }
    expect(renderTokenStylesheet(listPresets()[0]!)).toContain("--spring-stiffness: 320;");
  });

  it("exports extracted DNA and derives a usable dark companion for light sources", () => {
    const dna = extractTokensFromCSS(`:root {
      --color-bg: #f8f8f6; --color-surface: #ffffff; --color-text: #171717;
      --color-muted: #525252; --color-border: #dedede; --color-accent: #005fbf;
      --font-sans: Inter, sans-serif;
    } body { background: var(--color-bg); color: var(--color-text); font-family: var(--font-sans); font-size: 16px; }`);
    const preset = createPresetFromDNA(dna, "Exported DNA");
    const css = renderTokenStylesheet(preset);
    expect(css).toContain("unslop · Exported DNA");
    expect(css).toContain("--surface-0: #f8f8f6;");
    expect(css).toContain("--color-text-primary: #171717;");
    expect(css).toContain("color-mix(in srgb, #171717 94%, #f8f8f6)");
    expect(css).toContain(".dark {\n  color-scheme: dark;");
  });

  it("prints and writes token stylesheets through the CLI", async () => {
    const directory = await temporaryDirectory();
    const printed = await invoke(["export-tokens", "--preset", "neo-brutalist"], directory);
    expect(printed.code).toBe(0);
    expect(printed.stdout).toContain("--color-accent: #ff5c35;");
    const written = await invoke([
      "export-tokens", "--preset", "swiss-grid", "--out", "styles/tokens.css",
    ], directory);
    expect(written.code).toBe(0);
    expect(await readFile(join(directory, "styles/tokens.css"), "utf8")).toContain("--font-display: Helvetica Neue");

    await writeFile(join(directory, "source.css"), ":root { --color-bg: #fff; --color-text: #111; } body { background: var(--color-bg); color: var(--color-text); }");
    const extracted = await invoke([
      "export-tokens", "--source", "source.css", "--name", "CLI DNA",
    ], directory);
    expect(extracted.code).toBe(0);
    expect(extracted.stdout).toContain("unslop · CLI DNA");
    expect((await invoke(["export-tokens", "--preset", "linear-dark", "--source", "source.css"], directory)).code).toBe(2);
  });
});

describe("merge-safe MCP project configuration", () => {
  it("preserves unrelated servers, top-level settings, and unslop custom fields", async () => {
    const directory = await temporaryDirectory();
    const existing = {
      inputs: [{ id: "token", type: "promptString" }],
      mcpServers: {
        other: { command: "node", args: ["other-server.js"] },
        unslop: { command: "old", args: [], env: { KEEP: "yes" } },
      },
    };
    await writeFile(join(directory, ".mcp.json"), JSON.stringify(existing, null, 2));
    const result = await installUnslop({ cwd: directory, preset: "linear-dark" });
    expect(result.files).toHaveLength(7);
    const config = JSON.parse(await readFile(join(directory, ".mcp.json"), "utf8"));
    expect(config.inputs).toEqual(existing.inputs);
    expect(config.mcpServers.other).toEqual(existing.mcpServers.other);
    expect(config.mcpServers.unslop).toEqual({
      command: "npx",
      args: ["-y", `github:avivgerz-hue/unslop`, "mcp"],
      env: { KEEP: "yes" },
    });
    const second = await installUnslop({ cwd: directory, preset: "linear-dark" });
    expect(second.files.every((file) => file.status === "unchanged")).toBe(true);
  });

  it("rejects malformed MCP JSON without overwriting it", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, ".mcp.json"), "{ not-json", "utf8");
    await expect(syncMcpConfig({ cwd: directory })).rejects.toThrow("not valid JSON");
    expect(await readFile(join(directory, ".mcp.json"), "utf8")).toBe("{ not-json");
  });
});

describe("native MCP server", () => {
  it("negotiates MCP and lists exactly three fully specified tools", async () => {
    const server = new UnslopMCPServer({ cwd: "/tmp" });
    const initialized = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(initialized?.result).toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: { name: "unslop", version: UNSLOP_VERSION },
      capabilities: { tools: { listChanged: false } },
    });
    expect(await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const listed = await server.handleMessage({ jsonrpc: "2.0", id: "tools", method: "tools/list" });
    const tools = (listed?.result as { tools: typeof MCP_TOOL_DEFINITIONS }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "unslop_audit", "unslop_extract_dna", "unslop_apply_preset",
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
    const missing = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "missing/method" });
    expect(missing?.error).toMatchObject({ code: -32601 });
    const unknown = await server.handleMessage({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "unknown", arguments: {} },
    });
    expect(unknown?.error).toMatchObject({ code: -32602 });
  });

  it("returns audit scores and exact refactoring instructions through unslop_audit", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "bad.tsx"), `<div className="shadow-xl">Raw</div>`);
    const server = new UnslopMCPServer({ cwd: directory });
    const result = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "unslop_audit", arguments: { path: "bad.tsx" } },
    });
    const tool = result?.result as {
      structuredContent: { score: number; violations: Array<{ ruleId: string; line: number }>; refactoringPrompt: string };
    };
    expect(tool.structuredContent.score).toBeLessThan(100);
    expect(tool.structuredContent.violations[0]).toMatchObject({ ruleId: "slop/raw-elevation", line: 1 });
    expect(tool.structuredContent.refactoringPrompt).toContain("bad.tsx:1:1");
  });

  it("compiles CSS through unslop_extract_dna and applies presets with MCP configuration", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "tokens.css"), ":root { --color-bg: #fff; --color-text: #111; --color-accent: #2563eb; } body { background: var(--color-bg); color: var(--color-text); font-size: 16px; }");
    const server = new UnslopMCPServer({ cwd: directory });
    const extracted = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "unslop_extract_dna", arguments: { source: "tokens.css", name: "MCP DNA" } },
    });
    const extraction = extracted?.result as { structuredContent: { preset: { title: string }; skill: string } };
    expect(extraction.structuredContent.preset.title).toBe("MCP DNA");
    expect(extraction.structuredContent.skill).toContain("name: unslop");

    const applied = await server.handleMessage({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "unslop_apply_preset", arguments: { preset: "swiss-grid" } },
    });
    const application = applied?.result as { structuredContent: { files: unknown[] } };
    expect(application.structuredContent.files).toHaveLength(7);
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toContain("Swiss Grid");
    expect(JSON.parse(await readFile(join(directory, ".mcp.json"), "utf8")).mcpServers.unslop.args).toContain("mcp");
  });

  it("handles JSON-RPC errors and newline-delimited stdio framing without stdout noise", async () => {
    const directory = await temporaryDirectory();
    const input = new PassThrough();
    const output = new PassThrough();
    let serialized = "";
    output.on("data", (chunk: Buffer) => { serialized += chunk.toString("utf8"); });
    const running = startMcpServer({ cwd: directory, input, output });
    input.end(`${[
      "not-json",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      "",
    ].join("\n")}`);
    await running;
    const messages = serialized.trim().split("\n").map((line) => JSON.parse(line));
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
    expect(messages[1]).toMatchObject({ id: 1, result: { serverInfo: { name: "unslop" } } });
    expect(messages[2].result.tools).toHaveLength(3);
    expect(serialized).not.toContain(`unslop ${UNSLOP_VERSION}`);
  });

  it("returns operational tool failures as MCP isError results", async () => {
    const server = new UnslopMCPServer({ cwd: "/definitely/not/a/project" });
    const result = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "unslop_audit", arguments: { path: "missing" } },
    });
    expect(result?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(result?.result)).toContain("does not exist");
  });
});
