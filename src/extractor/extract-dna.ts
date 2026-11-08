import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePreset, type DesignPreset } from "../presets/index.js";

export interface TokenFrequency {
  value: string;
  count: number;
}

export interface DesignDNA {
  source: string;
  colors: {
    surface: TokenFrequency[];
    text: TokenFrequency[];
    mutedText: TokenFrequency[];
    border: TokenFrequency[];
    accent: TokenFrequency[];
    accentText: TokenFrequency[];
  };
  typography: {
    fontStacks: TokenFrequency[];
    fontSizes: TokenFrequency[];
    lineHeights: TokenFrequency[];
    fontWeights: TokenFrequency[];
    letterSpacings: TokenFrequency[];
  };
  radii: TokenFrequency[];
  /** Individual shadow layers, useful for inspecting elevation construction. */
  shadows: TokenFrequency[];
  /** Complete box-shadow declarations retained as reusable elevation tokens. */
  shadowCompositions?: TokenFrequency[];
  spacing: TokenFrequency[];
  motion: {
    durations: TokenFrequency[];
    easings: TokenFrequency[];
  };
  cssVariables: Record<string, string>;
  warnings: string[];
}

export interface ExtractOptions {
  /** Injectable for tests or applications with a custom network stack. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Maximum linked/imported stylesheets fetched from a document. */
  maxStylesheets?: number;
  /** Maximum response size in bytes. Defaults to 2 MiB. */
  maxBytes?: number;
}

type FrequencyMap = Map<string, number>;
type ColorRole = keyof DesignDNA["colors"];

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const COLOR_PATTERN = /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|\b(?:white|black|red|blue|green|yellow|orange|purple|indigo|violet|fuchsia|magenta|cyan|gray|grey|transparent|rebeccapurple)\b/gi;

function cleanValue(value: string): string {
  return value.replace(/!important/gi, "").trim().replace(/\s+/g, " ");
}

function splitOutsideParentheses(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function splitWhitespaceOutsideParentheses(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = -1;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index] ?? " ";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (start >= 0) {
        parts.push(value.slice(start, index));
        start = -1;
      }
    } else if (start < 0) {
      start = index;
    }
  }
  return parts.filter(Boolean);
}

function declarations(body: string): Array<{ property: string; value: string }> {
  const result: Array<{ property: string; value: string }> = [];
  for (const rawDeclaration of splitOutsideParentheses(body, ";")) {
    let depth = 0;
    let colon = -1;
    for (let index = 0; index < rawDeclaration.length; index += 1) {
      const character = rawDeclaration[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === ":" && depth === 0) {
        colon = index;
        break;
      }
    }
    if (colon < 0) continue;
    const property = rawDeclaration.slice(0, colon).trim().toLowerCase();
    const value = cleanValue(rawDeclaration.slice(colon + 1));
    if (property && value) result.push({ property, value });
  }
  return result;
}

function addFrequency(map: FrequencyMap, rawValue: string): void {
  const value = cleanValue(rawValue);
  if (!value || value === "none" || value === "normal" || value === "inherit" || value === "initial") {
    return;
  }
  map.set(value, (map.get(value) ?? 0) + 1);
}

function normalizeColor(value: string): string {
  const clean = cleanValue(value).toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(clean)) {
    const hex = clean.slice(1);
    return `#${[...hex].map((character) => character + character).join("")}`;
  }
  return clean
    .replace(/\s*([,(/])\s*/g, "$1")
    .replace(/,/g, ", ")
    .replace(/\s+\)/g, ")");
}

function cssPixels(value: string): number | undefined {
  const clean = value.trim().toLowerCase();
  if (clean === "0") return 0;
  const match = clean.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/);
  if (!match) return undefined;
  const numeric = Number.parseFloat(match[1] ?? "0");
  return match[2] === "px" ? numeric : numeric * 16;
}

function byFrequency(map: FrequencyMap): TokenFrequency[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function byNumericScale(map: FrequencyMap): TokenFrequency[] {
  return byFrequency(map).sort((left, right) => {
    const leftPixels = cssPixels(left.value);
    const rightPixels = cssPixels(right.value);
    if (leftPixels === undefined && rightPixels === undefined) return left.value.localeCompare(right.value);
    if (leftPixels === undefined) return 1;
    if (rightPixels === undefined) return -1;
    return leftPixels - rightPixels || left.value.localeCompare(right.value);
  });
}

function byShadowScale(map: FrequencyMap): TokenFrequency[] {
  const elevation = (shadow: string): number => {
    if (/^\s*none\s*$/i.test(shadow)) return -1;
    let maximum = 0;
    for (const layer of splitOutsideParentheses(shadow, ",")) {
      const lengths = layer.match(/-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)?/g) ?? [];
      const raw = lengths[2];
      if (!raw) continue;
      const value = Number.parseFloat(raw);
      const pixels = raw.endsWith("rem") || raw.endsWith("em") ? value * 16 : value;
      maximum = Math.max(maximum, pixels);
    }
    return maximum;
  };
  return byFrequency(map).sort(
    (left, right) =>
      elevation(left.value) - elevation(right.value) ||
      right.count - left.count ||
      left.value.localeCompare(right.value),
  );
}

function variableValue(
  value: string,
  variables: Readonly<Record<string, string>>,
  seen = new Set<string>(),
): string {
  const match = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]+)?\)$/);
  if (!match) return value;
  const name = match[1] ?? "";
  if (seen.has(name)) return value;
  const replacement = variables[name];
  if (!replacement) return value;
  seen.add(name);
  return variableValue(replacement, variables, seen);
}

function variableColorRole(name: string): ColorRole | undefined {
  if (/(?:on-accent|accent-foreground|accent-text|button-text|on-primary)/.test(name)) return "accentText";
  if (/(?:muted|subtle|secondary-text|text-secondary|text-muted)/.test(name)) return "mutedText";
  if (/(?:accent|primary|brand|link|action)/.test(name)) return "accent";
  if (/(?:border|outline|divider|stroke|line-color)/.test(name)) return "border";
  if (/(?:foreground|text|font-color|heading|body-color)/.test(name)) return "text";
  if (/(?:background|surface|bg|canvas|elevated)/.test(name)) return "surface";
  return undefined;
}

function colorsIn(value: string): string[] {
  return [...value.matchAll(COLOR_PATTERN)].map((match) => normalizeColor(match[0]));
}

function addColors(map: FrequencyMap, value: string): void {
  for (const color of new Set(colorsIn(value))) addFrequency(map, color);
}

function normalizeFontStack(value: string): string {
  return splitOutsideParentheses(cleanValue(value), ",")
    .map((font) => font.trim())
    .filter(Boolean)
    .join(", ");
}

function extractVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) variables[name] = cleanValue(value);
  }
  return Object.fromEntries(Object.entries(variables).sort(([left], [right]) => left.localeCompare(right)));
}

/** Extract a deterministic token inventory from any CSS text. */
export function extractTokensFromCSS(css: string, source = "inline-css"): DesignDNA {
  const colorMaps: Record<ColorRole, FrequencyMap> = {
    surface: new Map(),
    text: new Map(),
    mutedText: new Map(),
    border: new Map(),
    accent: new Map(),
    accentText: new Map(),
  };
  const fontStacks: FrequencyMap = new Map();
  const fontSizes: FrequencyMap = new Map();
  const lineHeights: FrequencyMap = new Map();
  const fontWeights: FrequencyMap = new Map();
  const letterSpacings: FrequencyMap = new Map();
  const radii: FrequencyMap = new Map();
  const shadows: FrequencyMap = new Map();
  const shadowCompositions: FrequencyMap = new Map();
  const spacing: FrequencyMap = new Map();
  const durations: FrequencyMap = new Map();
  const easings: FrequencyMap = new Map();

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const cssVariables = extractVariables(withoutComments);

  for (const [name, rawValue] of Object.entries(cssVariables)) {
    const role = variableColorRole(name.toLowerCase());
    if (role) addColors(colorMaps[role], variableValue(rawValue, cssVariables));
    if (/(?:font-family|font-stack|font-sans|font-serif|font-mono)/.test(name)) {
      addFrequency(fontStacks, normalizeFontStack(rawValue));
    } else if (/(?:font-size|text-size|type-scale)/.test(name)) {
      addFrequency(fontSizes, rawValue);
    } else if (/(?:radius|radii|rounded)/.test(name)) {
      for (const value of splitWhitespaceOutsideParentheses(rawValue)) addFrequency(radii, value);
    } else if (/(?:shadow|elevation)/.test(name)) {
      addFrequency(shadowCompositions, rawValue);
      for (const value of splitOutsideParentheses(rawValue, ",")) addFrequency(shadows, value);
    } else if (/(?:spacing|space-|gap|inset)/.test(name)) {
      for (const value of splitWhitespaceOutsideParentheses(rawValue)) addFrequency(spacing, value);
    } else if (/(?:duration|speed)/.test(name)) {
      addFrequency(durations, rawValue);
    } else if (/(?:easing|ease-|timing)/.test(name)) {
      addFrequency(easings, rawValue);
    }
  }

  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const block of withoutComments.matchAll(blockPattern)) {
    const selector = (block[1] ?? "").trim();
    for (const declaration of declarations(block[2] ?? "")) {
      const property = declaration.property;
      const resolved = variableValue(declaration.value, cssVariables);
      const value = cleanValue(resolved);
      if (property.startsWith("--")) continue;

      if (property === "background" || property === "background-color") {
        const role = /(?:button|btn|primary|accent|brand|badge|link)/i.test(selector)
          ? "accent"
          : "surface";
        addColors(colorMaps[role], value);
      } else if (property === "color") {
        const isControl = /(?:button|btn|primary|accent|brand)/i.test(selector);
        const isLink = /(?:^|[,.\s#:-])(?:a|link)(?:$|[,.\s#:[\]-])/i.test(selector);
        const isMuted = /(?:muted|subtle|secondary|caption|metadata)/i.test(selector);
        const role: ColorRole = isControl
          ? "accentText"
          : isLink
            ? "accent"
            : isMuted
              ? "mutedText"
              : "text";
        addColors(colorMaps[role], value);
      } else if (/^border(?:-[^:]+)?$/.test(property) || property === "outline-color") {
        addColors(colorMaps.border, value);
      } else if (property === "fill" || property === "stroke") {
        if (/(?:icon|accent|primary|brand)/i.test(selector)) addColors(colorMaps.accent, value);
      }

      if (property === "font-family") {
        addFrequency(fontStacks, normalizeFontStack(value));
      } else if (property === "font") {
        const family = value.match(/(?:^|\s)((?:"[^"]+"|'[^']+'|[\w-]+)(?:\s*,\s*(?:"[^"]+"|'[^']+'|[\w-]+))+)$/);
        if (family?.[1]) addFrequency(fontStacks, normalizeFontStack(family[1]));
      } else if (property === "font-size") {
        addFrequency(fontSizes, value);
      } else if (property === "line-height") {
        addFrequency(lineHeights, value);
      } else if (property === "font-weight") {
        addFrequency(fontWeights, value);
      } else if (property === "letter-spacing") {
        addFrequency(letterSpacings, value);
      }

      if (/^border-(?:top-left|top-right|bottom-left|bottom-right)-radius$/.test(property)) {
        addFrequency(radii, value);
      } else if (property === "border-radius") {
        for (const radius of splitWhitespaceOutsideParentheses(value.replace(/\s*\/\s*/g, " "))) {
          addFrequency(radii, radius);
        }
      }

      if (property === "box-shadow") {
        addFrequency(shadowCompositions, value);
        for (const shadowLayer of splitOutsideParentheses(value, ",")) {
          addFrequency(shadows, shadowLayer);
        }
      }

      if (
        /^(?:margin|padding)(?:-(?:top|right|bottom|left|inline|block))?$/.test(property) ||
        /^(?:gap|row-gap|column-gap|inset|top|right|bottom|left)$/.test(property)
      ) {
        for (const stop of splitWhitespaceOutsideParentheses(value)) {
          if (!/\bauto\b/i.test(stop)) addFrequency(spacing, stop);
        }
      }

      if (property === "transition-duration" || property === "animation-duration") {
        for (const duration of splitOutsideParentheses(value, ",")) addFrequency(durations, duration);
      } else if (property === "transition" || property === "animation") {
        for (const duration of value.match(/(?:\d+\.?\d*|\.\d+)(?:ms|s)\b/g) ?? []) {
          addFrequency(durations, duration);
        }
        for (const easing of value.match(/(?:steps|cubic-bezier|linear|ease-in-out|ease-out|ease-in|ease)\([^)]*\)|\b(?:linear|ease-in-out|ease-out|ease-in|ease)\b/g) ?? []) {
          addFrequency(easings, easing);
        }
      } else if (property === "transition-timing-function" || property === "animation-timing-function") {
        addFrequency(easings, value);
      }
    }
  }

  return {
    source,
    colors: {
      surface: byFrequency(colorMaps.surface),
      text: byFrequency(colorMaps.text),
      mutedText: byFrequency(colorMaps.mutedText),
      border: byFrequency(colorMaps.border),
      accent: byFrequency(colorMaps.accent),
      accentText: byFrequency(colorMaps.accentText),
    },
    typography: {
      fontStacks: byFrequency(fontStacks),
      fontSizes: byNumericScale(fontSizes),
      lineHeights: byNumericScale(lineHeights),
      fontWeights: byNumericScale(fontWeights),
      letterSpacings: byNumericScale(letterSpacings),
    },
    radii: byNumericScale(radii),
    shadows: byFrequency(shadows),
    shadowCompositions: byShadowScale(shadowCompositions),
    spacing: byNumericScale(spacing),
    motion: {
      durations: byNumericScale(durations),
      easings: byFrequency(easings),
    },
    cssVariables,
    warnings: [],
  };
}

export const extractDesignTokens = extractTokensFromCSS;

function attribute(tag: string, name: string): string | undefined {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(expression);
  return match?.[1] ?? match?.[2];
}

function stylesheetURLs(cssOrHTML: string, baseURL: string): string[] {
  const urls = new Set<string>();
  for (const match of cssOrHTML.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
    try {
      const url = new URL(match[1] ?? "", baseURL);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.href);
    } catch {
      // A malformed import is ignored; valid local declarations remain usable.
    }
  }
  return [...urls].sort();
}

function linkedStylesheets(html: string, baseURL: string): string[] {
  const urls = new Set<string>(stylesheetURLs(html, baseURL));
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, "rel")?.toLowerCase() ?? "";
    const href = attribute(tag, "href");
    if (!href || (!rel.split(/\s+/).includes("stylesheet") && !/\.css(?:$|[?#])/i.test(href))) continue;
    try {
      const url = new URL(href, baseURL);
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.href);
    } catch {
      // Ignore malformed links without discarding inline DOM tokens.
    }
  }
  return [...urls].sort();
}

function inlineCSS(html: string): string {
  const blocks: string[] = [];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (match[1]) blocks.push(match[1]);
  }
  for (const match of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const style = match[1] ?? match[2];
    if (style) blocks.push(`:root { ${style} }`);
  }
  return blocks.join("\n");
}

interface FetchedText {
  text: string;
  contentType: string;
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchText(url: string, options: ExtractOptions): Promise<FetchedText> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime does not provide fetch. Use Node.js 20.10 or newer.");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number.");
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "unslop/1.0 (+https://github.com/avivgerz-hue/unslop)",
        accept: "text/css,text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
    const text = await boundedResponseText(response, maxBytes);
    return { text, contentType: response.headers.get("content-type")?.toLowerCase() ?? "" };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isHTTPURL(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extract design DNA from a live URL, an HTML document URL, or a local CSS file. */
export async function extractDesignDNA(input: string, options: ExtractOptions = {}): Promise<DesignDNA> {
  if (!input.trim()) throw new Error("Provide a URL or CSS file path.");
  const maxStylesheets = options.maxStylesheets ?? 12;
  if (!Number.isInteger(maxStylesheets) || maxStylesheets < 0) {
    throw new Error("maxStylesheets must be a non-negative integer.");
  }

  if (!isHTTPURL(input)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)) {
      throw new Error("Only http:// and https:// URLs are supported.");
    }
    const path = resolve(input);
    let css: string;
    try {
      css = await readFile(path, "utf8");
    } catch {
      throw new Error(`Cannot read CSS file: ${input}`);
    }
    return extractTokensFromCSS(css, input);
  }

  const initial = await fetchText(input, options).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to fetch ${input}: ${message}`);
  });
  const looksLikeCSS = initial.contentType.includes("text/css") || /\.css(?:$|[?#])/i.test(input);
  const initialCSS = looksLikeCSS ? initial.text : inlineCSS(initial.text);
  const cssBlocks = [initialCSS];
  const queue = linkedStylesheets(looksLikeCSS ? initial.text : initial.text, input);
  const visited = new Set<string>();
  const warnings: string[] = [];

  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    if (visited.size >= maxStylesheets) {
      warnings.push(`Stylesheet limit (${maxStylesheets}) reached; remaining external stylesheets were not fetched.`);
      break;
    }
    visited.add(url);
    try {
      const fetched = await fetchText(url, options);
      cssBlocks.push(fetched.text);
      for (const imported of stylesheetURLs(fetched.text, url)) {
        if (!visited.has(imported)) queue.push(imported);
      }
    } catch (error) {
      warnings.push(`Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const dna = extractTokensFromCSS(cssBlocks.join("\n"), input);
  dna.warnings = warnings;
  return dna;
}

export const extractDNA = extractDesignDNA;

function first(tokens: TokenFrequency[], fallback: string): string {
  return tokens[0]?.value ?? fallback;
}

function assignScaleValue(scale: Record<string, string>, name: string, value: string): void {
  let candidate = name;
  let suffix = 2;
  while (scale[candidate] !== undefined) {
    candidate = `${name}-${suffix}`;
    suffix += 1;
  }
  scale[candidate] = value;
}

function compileTypeScale(tokens: TokenFrequency[]): Record<string, string> {
  const numeric = tokens
    .map((token) => ({ token, pixels: cssPixels(token.value) }))
    .filter((entry): entry is { token: TokenFrequency; pixels: number } =>
      entry.pixels !== undefined && entry.pixels > 0,
    );
  const scale: Record<string, string> = {};
  if (numeric.length === 0) {
    if (tokens.length === 0) return { base: "1rem" };
    for (const [index, token] of tokens.entries()) {
      assignScaleValue(scale, index === 0 ? "fluid" : `fluid-${index + 1}`, token.value);
    }
    return scale;
  }

  let baseEntry: { token: TokenFrequency; pixels: number } | undefined;
  let baseDistance = Number.POSITIVE_INFINITY;
  for (const entry of numeric) {
    const distance = Math.abs(entry.pixels - 16);
    if (entry.pixels >= 10 && entry.pixels <= 22 && distance < baseDistance) {
      baseEntry = entry;
      baseDistance = distance;
    }
  }
  const basePixels = baseEntry?.pixels ?? 16;
  const belowNames = ["sm", "xs", "2xs", "3xs", "4xs", "5xs"];
  const below = numeric
    .filter((entry) => entry !== baseEntry && entry.pixels < basePixels)
    .sort((left, right) => right.pixels - left.pixels);
  const belowRoles = new Map<TokenFrequency, string>();
  below.forEach((entry, index) => {
    const role = below.length === 1 && entry.pixels <= 12
      ? "xs"
      : belowNames[index] ?? `${index + 1}xs`;
    belowRoles.set(entry.token, role);
  });

  if (!baseEntry) scale.base = "1rem";
  for (const entry of numeric) {
    if (entry === baseEntry) {
      assignScaleValue(scale, "base", entry.token.value);
      continue;
    }
    const belowRole = belowRoles.get(entry.token);
    if (belowRole) {
      assignScaleValue(scale, belowRole, entry.token.value);
      continue;
    }
    const ratio = entry.pixels / basePixels;
    const role = ratio <= 1.1875
      ? "lg"
      : ratio <= 1.375
        ? "xl"
        : ratio <= 1.875
          ? "2xl"
          : ratio <= 3
            ? "3xl"
            : ratio <= 4
              ? "4xl"
              : `${Math.ceil(ratio)}xl`;
    assignScaleValue(scale, role, entry.token.value);
  }
  for (const token of tokens) {
    if (cssPixels(token.value) === undefined) assignScaleValue(scale, "fluid", token.value);
  }
  return scale;
}

function bodyTracking(tokens: TokenFrequency[]): string {
  const candidates = tokens
    .map((token) => ({ token, numeric: Number.parseFloat(token.value) }))
    .filter((entry) => Number.isFinite(entry.numeric))
    .sort((left, right) => Math.abs(left.numeric) - Math.abs(right.numeric));
  return candidates[0]?.token.value ?? "-0.01em";
}

function uniquePixels(tokens: TokenFrequency[]): number[] {
  const values = new Set<number>();
  for (const token of tokens) {
    const pixels = cssPixels(token.value);
    if (pixels !== undefined && Number.isFinite(pixels) && pixels >= 0) values.add(pixels);
  }
  return [...values].sort((left, right) => left - right);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

function spacingBase(scale: number[]): number {
  const integers = scale.filter((value) => value > 0).map((value) => Math.round(value * 100));
  if (integers.length === 0) return 4;
  const divisor = integers.reduce((result, value) => greatestCommonDivisor(result, value));
  return divisor > 0 ? divisor / 100 : 4;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "extracted-dna";
}

function titleFromSlug(value: string): string {
  const acronyms: Record<string, string> = { api: "API", css: "CSS", dna: "DNA", ui: "UI" };
  return value
    .split("-")
    .map((word) => acronyms[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function titleFromRequest(requestedName: string, slug: string): string {
  const clean = requestedName.trim().replace(/\s+/g, " ");
  // Preserve intentional casing such as "Local DNA" and "Acme OS". Lowercase
  // slugs still receive a readable title instead of leaking into the Skill H1.
  return /[A-Z]/.test(clean) ? clean : titleFromSlug(slug);
}

function luminance(value: string): number | undefined {
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  const normalized = named[value] ?? value;
  const hex = normalized.match(/^#([\da-f]{6})(?:[\da-f]{2})?$/i)?.[1];
  const rgb = normalized.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  const channels = hex
    ? [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    : rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : undefined;
  if (!channels || channels.some((channel) => !Number.isFinite(channel))) return undefined;
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function readableAccentText(accent: string, colorScheme: "light" | "dark"): string {
  const accentLuminance = luminance(accent);
  if (accentLuminance === undefined) return colorScheme === "dark" ? "#111111" : "#ffffff";
  const darkTextLuminance = luminance("#111111") ?? 0;
  const darkContrast = (accentLuminance + 0.05) / (darkTextLuminance + 0.05);
  const lightContrast = 1.05 / (accentLuminance + 0.05);
  return darkContrast >= lightContrast ? "#111111" : "#ffffff";
}

/** Compile extracted DNA into the same complete schema used by built-in presets. */
export function createPresetFromDNA(dna: DesignDNA, requestedName = "extracted-dna"): DesignPreset {
  const name = slugify(requestedName);
  const background = first(dna.colors.surface, "#ffffff");
  const isDark = (luminance(background) ?? 1) < 0.179;
  const accent = first(dna.colors.accent, "#2563eb");
  const scale = compileTypeScale(dna.typography.fontSizes);
  const radiusValues = dna.radii.map((token) => token.value);
  const radiusAt = (index: number, fallback: string): string =>
    radiusValues[Math.min(index, Math.max(0, radiusValues.length - 1))] ?? fallback;
  const spacingScale = uniquePixels(dna.spacing);
  if (spacingScale.length === 0) spacingScale.push(0, 4, 8, 12, 16, 24, 32, 48);
  if (!spacingScale.includes(0)) spacingScale.unshift(0);
  const elevationTokens = dna.shadowCompositions?.length
    ? dna.shadowCompositions
    : dna.shadows;
  const elevationAt = (position: number): string | undefined =>
    elevationTokens[Math.round(Math.max(0, elevationTokens.length - 1) * position)]?.value;
  const smallShadow = elevationAt(0) ?? "none";
  const mediumShadow = elevationAt(0.5) ?? smallShadow;
  const largeShadow = elevationAt(1) ?? mediumShadow;

  const preset: DesignPreset = {
    schemaVersion: 1,
    name,
    title: titleFromRequest(requestedName, name),
    description: `Design DNA extracted from ${dna.source}; compiled into enforceable agent rules and semantic tokens.`,
    tokens: {
      colorScheme: isDark ? "dark" : "light",
      colors: {
        background,
        surface: dna.colors.surface[1]?.value ?? background,
        surfaceElevated: dna.colors.surface[2]?.value ?? dna.colors.surface[1]?.value ?? background,
        text: first(dna.colors.text, isDark ? "#f5f5f5" : "#111111"),
        textMuted:
          first(dna.colors.mutedText, dna.colors.text[1]?.value ?? (isDark ? "#a3a3a3" : "#555555")),
        border: first(dna.colors.border, isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"),
        accent,
        accentText: first(dna.colors.accentText, readableAccentText(accent, isDark ? "dark" : "light")),
      },
      typography: {
        fontFamily: first(
          dna.typography.fontStacks,
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        ),
        monospaceFamily:
          dna.typography.fontStacks.find((token) => /mono|courier|consolas/i.test(token.value))?.value ??
          "SFMono-Regular, Consolas, Liberation Mono, monospace",
        scale,
        displayTracking:
          dna.typography.letterSpacings.find((token) => token.value.trim().startsWith("-"))?.value ??
          "-0.035em",
        bodyTracking: bodyTracking(dna.typography.letterSpacings),
        numericVariant: "tabular-nums",
        weights: Object.fromEntries(
          (dna.typography.fontWeights.length > 0
            ? dna.typography.fontWeights.slice(0, 4)
            : [{ value: "400", count: 1 }, { value: "600", count: 1 }]
          ).map((token, index) => [`weight${index + 1}`, Number.parseInt(token.value, 10) || 400]),
        ),
      },
      radii: {
        sm: radiusAt(0, "4px"),
        md: radiusAt(1, "6px"),
        lg: radiusAt(2, "8px"),
        xl: radiusAt(3, "12px"),
        full: "9999px",
      },
      shadows: {
        sm: smallShadow,
        md: mediumShadow,
        lg: largeShadow,
      },
      spacing: {
        base: spacingBase(spacingScale),
        scale: spacingScale,
      },
      motion: {
        duration: first(dna.motion.durations, "160ms"),
        easing: first(dna.motion.easings, "cubic-bezier(0.2, 0, 0, 1)"),
      },
      layout: {
        maxWidth: "1200px",
        columns: 12,
        borderWidth: "1px",
        gridGap: `${spacingScale.find((value) => value >= 16) ?? 16}px`,
        contentInset: `${spacingScale.find((value) => value >= 24) ?? 24}px`,
      },
    },
    rules: [
      `Use ${background} as the page canvas and preserve the extracted surface hierarchy.`,
      `Use ${accent} only for intentional actions, links, selection, or focus.`,
      `Keep the extracted font stack unchanged: ${first(dna.typography.fontStacks, "the compiled sans-serif stack")}.`,
      "Use only the compiled type scale; add no arbitrary intermediate font sizes.",
      "Apply negative tracking to display headings and tabular figures to every changing number.",
      "Use the extracted radius hierarchy consistently and derive nested radii from padding.",
      "Reuse the compiled shadow tokens instead of introducing raw one-off box shadows.",
      `Keep all layout spacing on the compiled ${spacingBase(spacingScale)}px base grid.`,
      "Do not add purple gradients, neon glows, generic emoji card grids, or decorative animation.",
      `Run npx github:avivgerz-hue/unslop audit after implementation and compare new tokens against ${dna.source}.`,
    ],
  };
  return validatePreset(preset);
}
