#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { auditTarget, formatAuditReport } from "../src/analyzer/slop-detector.js";
import { createPresetFromDNA, extractDesignDNA } from "../src/extractor/extract-dna.js";
import { listPresets, listPresetSummaries, loadPreset } from "../src/presets/index.js";
import { startMcpServer } from "../src/mcp/server.js";
import { installUnslop, renderAgentSkill } from "../src/sync/rule-writer.js";
import { renderTokenStylesheet } from "../src/sync/token-exporter.js";
import { UNSLOP_VERSION } from "../src/version.js";
export const CLI_VERSION = UNSLOP_VERSION;
class UsageError extends Error {
}
const HELP = `unslop ${CLI_VERSION} — studio-grade design constraints for coding agents

USAGE
  npx github:avivgerz-hue/unslop <command> [options]

COMMANDS
  init [--preset <name>]       Install agent rules and .mcp.json in this project
  mcp                          Run the native MCP server over stdio
  audit [dir]                  Detect AI slop and generate a refactoring brief
  extract <url-or-css-path>    Compile design DNA into an Agent Skill
  export-tokens                Export Tailwind v4 @theme and CSS variables
  presets [name]               List presets or inspect one token contract
  help                         Show this reference

INIT OPTIONS
  -p, --preset <name>          linear-dark (default), swiss-grid, stripe-minimal,
                               apple-glass, or neo-brutalist
  -d, --dir <path>             Target project directory (default: .)
      --force                  Replace whole rule files, including user content
      --json                   Print a machine-readable sync result

AUDIT OPTIONS
      --json                   Print the complete report as JSON
      --prompt                 Print only the structured refactoring prompt
      --fail-under <0-100>     Fail when the integrity score is below a threshold
      --ignore <directory>     Ignore an additional directory (repeatable)
      --no-fail                Always exit successfully after completing the audit

EXTRACT OPTIONS
  -o, --output <path>          Write the Skill or JSON instead of printing it
      --name <preset-name>     Name the compiled preset (default: extracted-dna)
      --json                   Emit both raw DNA and the compiled preset as JSON
      --timeout <ms>           Per-request timeout (default: 10000)
      --max-stylesheets <n>    External stylesheet limit (default: 12)

EXPORT-TOKENS OPTIONS
  -p, --preset <name>          Built-in preset (default: linear-dark)
  -o, --out <file>             Write CSS to a file instead of stdout
  -s, --source <url-or-css>    Compile extracted DNA instead of a built-in preset
      --name <preset-name>     Name extracted DNA (default: extracted-dna)
      --timeout <ms>           Per-request timeout for --source URLs
      --max-stylesheets <n>    External stylesheet limit for --source URLs

MCP OPTIONS
  The mcp command uses only stdio for JSON-RPC messages. Run it from the project
  root, or let the generated .mcp.json launch it through npx.

EXIT STATUS
  0  Command succeeded; audit found no violations
  1  Audit found violations, score was below --fail-under, or command failed
  2  Invalid command-line usage

Run "npx github:avivgerz-hue/unslop presets" to compare built-in design systems.`;
function parse(command, args, options) {
    try {
        return parseArgs({ args, options, allowPositionals: true, strict: true });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new UsageError(`${command}: ${message}`);
    }
}
function positiveNumber(value, fallback, label) {
    if (value === undefined)
        return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        throw new UsageError(`${label} must be a positive number.`);
    return parsed;
}
function nonNegativeInteger(value, fallback, label) {
    if (value === undefined)
        return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0)
        throw new UsageError(`${label} must be a non-negative integer.`);
    return parsed;
}
function assertNoPositionals(command, positionals) {
    if (positionals.length > 0)
        throw new UsageError(`${command} does not accept positional arguments: ${positionals.join(" ")}`);
}
function printPreset(name) {
    const preset = loadPreset(name);
    const { tokens } = preset;
    return [
        `${preset.title} (${preset.name})`,
        preset.description,
        "",
        `Scheme:    ${tokens.colorScheme}`,
        `Canvas:    ${tokens.colors.background}`,
        `Surface:   ${tokens.colors.surface}`,
        `Text:      ${tokens.colors.text}`,
        `Border:    ${tokens.colors.border}`,
        `Accent:    ${tokens.colors.accent}`,
        `Type:      ${tokens.typography.fontFamily}`,
        `Scale:     ${Object.values(tokens.typography.scale).join(" · ")}`,
        `Radii:     ${Object.values(tokens.radii).join(" · ")}`,
        `Spacing:   ${tokens.spacing.base}px base; ${tokens.spacing.scale.join(", ")}px`,
        `Motion:    ${tokens.motion.duration} ${tokens.motion.easing}`,
        `Grid:      ${tokens.layout.columns} columns; ${tokens.layout.maxWidth} max; ${tokens.layout.gridGap} gap`,
        "",
        "Design laws:",
        ...preset.rules.map((rule, index) => `  ${index + 1}. ${rule}`),
    ].join("\n");
}
/** Execute the CLI without terminating the host process. */
export async function runCli(argv = process.argv.slice(2), context = {}) {
    const cwd = context.cwd ?? process.cwd();
    const stdout = context.stdout ?? ((message) => process.stdout.write(`${message}\n`));
    const stderr = context.stderr ?? ((message) => process.stderr.write(`${message}\n`));
    const [command, ...args] = argv;
    if (!command || command === "help" || command === "--help" || command === "-h" || argv.includes("--help")) {
        stdout(HELP);
        return 0;
    }
    if (command === "--version" || command === "-v" || command === "version") {
        stdout(CLI_VERSION);
        return 0;
    }
    try {
        if (command === "presets") {
            const { values, positionals } = parse("presets", args, { json: { type: "boolean" } });
            if (positionals.length > 1)
                throw new UsageError("presets accepts at most one preset name.");
            const name = positionals[0];
            if (name) {
                stdout(values.json ? JSON.stringify(loadPreset(name), null, 2) : printPreset(name));
            }
            else if (values.json) {
                stdout(JSON.stringify(listPresetSummaries(), null, 2));
            }
            else {
                const rows = listPresets().map((preset) => [
                    preset.name.padEnd(16),
                    preset.tokens.colorScheme.padEnd(6),
                    preset.description,
                ]);
                stdout([
                    "NAME              MODE    DESCRIPTION",
                    ...rows.map((row) => row.join("  ")),
                    "",
                    "Inspect a token contract: npx github:avivgerz-hue/unslop presets linear-dark",
                ].join("\n"));
            }
            return 0;
        }
        if (command === "init") {
            const { values, positionals } = parse("init", args, {
                preset: { type: "string", short: "p" },
                dir: { type: "string", short: "d" },
                force: { type: "boolean" },
                json: { type: "boolean" },
            });
            assertNoPositionals("init", positionals);
            const result = await installUnslop({
                cwd: resolve(cwd, values.dir ?? "."),
                preset: values.preset ?? "linear-dark",
                force: values.force ?? false,
            });
            if (values.json) {
                stdout(JSON.stringify(result, null, 2));
            }
            else {
                stdout([
                    `Installed the ${result.preset} design system:`,
                    ...result.files.map((file) => `  ${file.status.padEnd(9)} ${file.path}`),
                    "",
                    "Next: run npx github:avivgerz-hue/unslop audit . before your agent writes more UI.",
                ].join("\n"));
            }
            return 0;
        }
        if (command === "mcp") {
            const { positionals } = parse("mcp", args, {});
            assertNoPositionals("mcp", positionals);
            await startMcpServer({ cwd });
            return 0;
        }
        if (command === "export-tokens") {
            const { values, positionals } = parse("export-tokens", args, {
                preset: { type: "string", short: "p" },
                out: { type: "string", short: "o" },
                source: { type: "string", short: "s" },
                name: { type: "string" },
                timeout: { type: "string" },
                "max-stylesheets": { type: "string" },
            });
            assertNoPositionals("export-tokens", positionals);
            if (values.preset && values.source) {
                throw new UsageError("--preset and --source cannot be used together.");
            }
            let preset;
            if (values.source) {
                const input = /^https?:\/\//i.test(values.source)
                    ? values.source
                    : resolve(cwd, values.source);
                const dna = await extractDesignDNA(input, {
                    timeoutMs: positiveNumber(values.timeout, 10_000, "--timeout"),
                    maxStylesheets: nonNegativeInteger(values["max-stylesheets"], 12, "--max-stylesheets"),
                });
                for (const warning of dna.warnings)
                    stderr(`Warning: ${warning}`);
                preset = createPresetFromDNA(dna, values.name ?? "extracted-dna");
            }
            else {
                if (values.name)
                    throw new UsageError("--name requires --source.");
                if (values.timeout || values["max-stylesheets"]) {
                    throw new UsageError("--timeout and --max-stylesheets require --source.");
                }
                preset = loadPreset(values.preset ?? "linear-dark");
            }
            const stylesheet = renderTokenStylesheet(preset);
            if (values.out) {
                const outputPath = resolve(cwd, values.out);
                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, stylesheet, "utf8");
                stdout(`Wrote ${values.out} using ${preset.name} (Tailwind v4 @theme, :root, and .dark).`);
            }
            else {
                stdout(stylesheet.trimEnd());
            }
            return 0;
        }
        if (command === "audit") {
            const { values, positionals } = parse("audit", args, {
                json: { type: "boolean" },
                prompt: { type: "boolean" },
                "fail-under": { type: "string" },
                ignore: { type: "string", multiple: true },
                "no-fail": { type: "boolean" },
            });
            if (positionals.length > 1)
                throw new UsageError("audit accepts at most one directory or file.");
            if (values.json && values.prompt)
                throw new UsageError("--json and --prompt cannot be used together.");
            const threshold = values["fail-under"] === undefined
                ? undefined
                : Number(values["fail-under"]);
            if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)) {
                throw new UsageError("--fail-under must be a number from 0 to 100.");
            }
            const report = await auditTarget(positionals[0] ?? ".", {
                cwd,
                ignore: values.ignore ?? [],
            });
            if (values.json)
                stdout(JSON.stringify(report, null, 2));
            else if (values.prompt)
                stdout(report.refactoringPrompt);
            else
                stdout(formatAuditReport(report));
            if (values["no-fail"])
                return 0;
            return report.violations.length > 0 || (threshold !== undefined && report.score < threshold) ? 1 : 0;
        }
        if (command === "extract") {
            const { values, positionals } = parse("extract", args, {
                output: { type: "string", short: "o" },
                name: { type: "string" },
                json: { type: "boolean" },
                timeout: { type: "string" },
                "max-stylesheets": { type: "string" },
            });
            if (positionals.length !== 1)
                throw new UsageError("extract requires exactly one URL or CSS file path.");
            const input = positionals[0] ?? "";
            const dna = await extractDesignDNA(input.startsWith("http://") || input.startsWith("https://")
                ? input
                : resolve(cwd, input), {
                timeoutMs: positiveNumber(values.timeout, 10_000, "--timeout"),
                maxStylesheets: nonNegativeInteger(values["max-stylesheets"], 12, "--max-stylesheets"),
            });
            const preset = createPresetFromDNA(dna, values.name ?? "extracted-dna");
            const output = values.json
                ? `${JSON.stringify({ dna, preset }, null, 2)}\n`
                : renderAgentSkill(preset);
            for (const warning of dna.warnings)
                stderr(`Warning: ${warning}`);
            if (values.output) {
                const outputPath = resolve(cwd, values.output);
                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, output, "utf8");
                stdout(`Wrote ${values.output} using extracted preset ${preset.name}.`);
            }
            else {
                stdout(output.trimEnd());
            }
            return 0;
        }
        throw new UsageError(`Unknown command "${command}".`);
    }
    catch (error) {
        stderr(`unslop: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof UsageError) {
            stderr("Run npx github:avivgerz-hue/unslop help for usage.");
            return 2;
        }
        return 1;
    }
}
function isMainModule() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    process.exitCode = await runCli();
}
//# sourceMappingURL=unslop.js.map