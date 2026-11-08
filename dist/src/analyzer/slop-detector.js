import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { contrastRatio, parseColor, requiredContrastRatio, } from "./wcag.js";
export { contrastRatio, parseColor, relativeLuminance, requiredContrastRatio } from "./wcag.js";
export const SUPPORTED_EXTENSIONS = [
    ".tsx",
    ".jsx",
    ".vue",
    ".svelte",
    ".html",
    ".css",
];
const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
]);
const FONT_WEIGHTS = {
    thin: "100",
    extralight: "200",
    light: "300",
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    extrabold: "800",
    black: "900",
};
const RADIUS_VALUES = new Set([
    "none",
    "sm",
    "DEFAULT",
    "md",
    "lg",
    "xl",
    "2xl",
    "3xl",
]);
function portablePath(path) {
    return path.split(sep).join("/");
}
function compactEvidence(value) {
    const compact = value.trim().replace(/\s+/g, " ");
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}
class SourceIndex {
    source;
    lineStarts = [0];
    constructor(source) {
        this.source = source;
        for (let index = 0; index < source.length; index += 1) {
            if (source[index] === "\n") {
                this.lineStarts.push(index + 1);
            }
        }
    }
    location(offset) {
        const safeOffset = Math.max(0, Math.min(offset, this.source.length));
        let low = 0;
        let high = this.lineStarts.length - 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if ((this.lineStarts[middle] ?? 0) <= safeOffset) {
                low = middle + 1;
            }
            else {
                high = middle - 1;
            }
        }
        const lineIndex = Math.max(0, high);
        return {
            line: lineIndex + 1,
            column: safeOffset - (this.lineStarts[lineIndex] ?? 0) + 1,
        };
    }
}
function classAttribute(attributes) {
    const plain = attributes.match(/\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    if (plain) {
        return plain[1] ?? plain[2] ?? "";
    }
    const expression = attributes.match(/\b(?:class|className)\s*=\s*\{\s*(["'`])([\s\S]*?)\1\s*\}/);
    return expression?.[2] ?? "";
}
function styleAttribute(attributes) {
    const match = attributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    return match?.[1] ?? match?.[2] ?? "";
}
const TAILWIND_COLORS = {
    "slate-50": "#f8fafc", "slate-100": "#f1f5f9", "slate-200": "#e2e8f0", "slate-300": "#cbd5e1",
    "slate-400": "#94a3b8", "slate-500": "#64748b", "slate-600": "#475569", "slate-700": "#334155",
    "slate-800": "#1e293b", "slate-900": "#0f172a", "slate-950": "#020617",
    "gray-50": "#f9fafb", "gray-100": "#f3f4f6", "gray-200": "#e5e7eb", "gray-300": "#d1d5db",
    "gray-400": "#9ca3af", "gray-500": "#6b7280", "gray-600": "#4b5563", "gray-700": "#374151",
    "gray-800": "#1f2937", "gray-900": "#111827", "gray-950": "#030712",
    "zinc-50": "#fafafa", "zinc-100": "#f4f4f5", "zinc-200": "#e4e4e7", "zinc-300": "#d4d4d8",
    "zinc-400": "#a1a1aa", "zinc-500": "#71717a", "zinc-600": "#52525b", "zinc-700": "#3f3f46",
    "zinc-800": "#27272a", "zinc-900": "#18181b", "zinc-950": "#09090b",
    "neutral-50": "#fafafa", "neutral-100": "#f5f5f5", "neutral-200": "#e5e5e5", "neutral-300": "#d4d4d4",
    "neutral-400": "#a3a3a3", "neutral-500": "#737373", "neutral-600": "#525252", "neutral-700": "#404040",
    "neutral-800": "#262626", "neutral-900": "#171717", "neutral-950": "#0a0a0a",
    "stone-50": "#fafaf9", "stone-100": "#f5f5f4", "stone-200": "#e7e5e4", "stone-300": "#d6d3d1",
    "stone-400": "#a8a29e", "stone-500": "#78716c", "stone-600": "#57534e", "stone-700": "#44403c",
    "stone-800": "#292524", "stone-900": "#1c1917", "stone-950": "#0c0a09",
    "red-400": "#f87171", "red-500": "#ef4444", "red-600": "#dc2626", "red-700": "#b91c1c",
    "orange-400": "#fb923c", "orange-500": "#f97316", "orange-600": "#ea580c",
    "yellow-400": "#facc15", "yellow-500": "#eab308", "yellow-600": "#ca8a04",
    "green-400": "#4ade80", "green-500": "#22c55e", "green-600": "#16a34a", "green-700": "#15803d",
    "cyan-400": "#22d3ee", "cyan-500": "#06b6d4", "cyan-600": "#0891b2",
    "blue-400": "#60a5fa", "blue-500": "#3b82f6", "blue-600": "#2563eb", "blue-700": "#1d4ed8",
    "indigo-400": "#818cf8", "indigo-500": "#6366f1", "indigo-600": "#4f46e5", "indigo-700": "#4338ca",
    "purple-400": "#c084fc", "purple-500": "#a855f7", "purple-600": "#9333ea", "purple-700": "#7e22ce",
    "violet-400": "#a78bfa", "violet-500": "#8b5cf6", "violet-600": "#7c3aed",
    "fuchsia-400": "#e879f9", "fuchsia-500": "#d946ef", "fuchsia-600": "#c026d3",
};
const TEXT_SIZE_PIXELS = {
    xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30,
    "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};
function styleDeclarations(input) {
    const result = new Map();
    for (const declaration of splitOutsideParentheses(input, ";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0)
            continue;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const value = declaration.slice(colon + 1).trim();
        if (property && value)
            result.set(property, value);
    }
    return result;
}
function cssVariables(source) {
    const variables = {};
    for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
        if (match[1] && match[2])
            variables[match[1]] = match[2].trim();
    }
    return variables;
}
function resolveVariable(value, variables, seen = new Set()) {
    const match = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)$/);
    if (!match)
        return value.trim();
    const name = match[1] ?? "";
    if (seen.has(name))
        return match[2]?.trim() ?? value;
    seen.add(name);
    const replacement = variables[name] ?? match[2];
    return replacement ? resolveVariable(replacement, variables, seen) : value;
}
function declarationColor(value, variables) {
    if (!value || /gradient\s*\(/i.test(value))
        return undefined;
    const resolved = resolveVariable(value, variables);
    const direct = parseColor(resolved);
    if (direct)
        return direct;
    const candidate = resolved.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:black|white|red|green|blue|gray|grey|transparent)\b/i)?.[0];
    return candidate ? parseColor(candidate) : undefined;
}
function utilityColor(classes, prefix, variables) {
    for (const utility of classes.split(/\s+/)) {
        if (utility.includes(":") || !utility.startsWith(`${prefix}-`))
            continue;
        const token = utility.slice(prefix.length + 1);
        const arbitrary = token.match(/^\[([^\]]+)\]$/)?.[1];
        if (arbitrary) {
            const color = declarationColor(arbitrary.replace(/^color:/, ""), variables);
            if (color)
                return color;
            continue;
        }
        const [colorName, opacity] = token.split("/");
        const raw = TAILWIND_COLORS[colorName ?? ""] ?? colorName;
        const color = declarationColor(raw, variables);
        if (!color)
            continue;
        if (opacity !== undefined) {
            const alpha = Number.parseFloat(opacity);
            if (Number.isFinite(alpha))
                color.a *= Math.min(1, Math.max(0, alpha / 100));
        }
        return color;
    }
    return undefined;
}
function cssPixels(value) {
    if (!value)
        return undefined;
    const match = value.trim().match(/^(\d+\.?\d*|\.\d+)(px|rem|em)$/i);
    if (!match)
        return undefined;
    const numeric = Number.parseFloat(match[1] ?? "");
    return match[2]?.toLowerCase() === "px" ? numeric : numeric * 16;
}
function typographyContext(classes, declarations) {
    let fontSize = cssPixels(declarations.get("font-size")) ?? 16;
    const declaredWeight = declarations.get("font-weight")?.trim().toLowerCase() ?? "normal";
    let fontWeight = Number.parseInt(declaredWeight, 10) || Number(FONT_WEIGHTS[declaredWeight]) || 400;
    for (const utility of classes.split(/\s+/)) {
        if (utility.includes(":"))
            continue;
        const size = utility.match(/^text-(.+)$/);
        if (size) {
            const arbitrary = size[1]?.match(/^\[([^\]]+)\]$/)?.[1];
            fontSize = TEXT_SIZE_PIXELS[size[1] ?? ""] ?? cssPixels(arbitrary) ?? fontSize;
        }
        const weight = utility.match(/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/);
        if (weight?.[1])
            fontWeight = Number(FONT_WEIGHTS[weight[1]]);
    }
    return { fontSize, fontWeight };
}
function inheritedCanvas(source, variables) {
    for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1] ?? "";
        if (!/(?:^|,)\s*(?::root|html|body)\s*(?:,|$)/i.test(selector.trim()))
            continue;
        const declarations = styleDeclarations(block[2] ?? "");
        const color = declarationColor(declarations.get("background-color") ?? declarations.get("background"), variables);
        if (color)
            return color;
    }
    return undefined;
}
function hasSubtleBorder(classes, inlineStyle = "") {
    const utilities = classes.split(/\s+/).filter(Boolean);
    const hasWidth = utilities.some((utility) => /^(?:[\w-]+:)*border(?:-[xytrblse])?(?:-1|-\[1px\])?$/.test(utility));
    const hasColor = utilities.some((utility) => /^(?:[\w-]+:)*border-(?:(?:white|black)\/(?:5|10|15|20)|(?:slate|gray|neutral|zinc|stone)-(?:100|200|700|800|900)(?:\/(?:5|10|15|20))?|border|line|outline|muted|\[[^\]]*(?:\/|0\.(?:0|1)\d?)[^\]]*\])$/.test(utility));
    // A border color alone renders no border in Tailwind. Requiring an actual
    // 1px width avoids treating `shadow-xl border-white/10` as anchored.
    return (hasWidth && hasColor) || hasSubtleCSSBorder(inlineStyle);
}
function hasSubtleCSSBorder(declarations) {
    let hasWidth = false;
    let hasColor = false;
    for (const declaration of splitOutsideParentheses(declarations, ";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0)
            continue;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const value = declaration.slice(colon + 1).trim();
        const isShorthand = /^border(?:-(?:top|right|bottom|left|inline|block))?$/.test(property);
        const isWidth = /^border(?:-(?:top|right|bottom|left|inline|block))?-width$/.test(property);
        const isColor = /^border(?:-(?:top|right|bottom|left|inline|block))?-color$/.test(property);
        if ((isShorthand || isWidth) && /(?:^|\s)1px(?:\s|$)/i.test(value))
            hasWidth = true;
        if ((isShorthand || isColor) && !/(?:^|\s)(?:none|medium|thin|thick)(?:\s|$)/i.test(value)) {
            // Opaque pure black/white and transparent borders are not subtle
            // hairlines. Semantic variables and low-chroma/low-alpha colors remain
            // valid because their composited appearance cannot be inferred here.
            if (!/(?:#000(?:000)?\b|#fff(?:fff)?\b|\bblack\b|\bwhite\b|\btransparent\b|\bcurrentcolor\b)/i.test(value)) {
                hasColor = true;
            }
        }
    }
    return hasWidth && hasColor;
}
function splitOutsideParentheses(value, delimiter) {
    const parts = [];
    let depth = 0;
    let start = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (quote) {
            if (character === quote && value[index - 1] !== "\\") {
                quote = "";
            }
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
        }
        else if (character === "(") {
            depth += 1;
        }
        else if (character === ")") {
            depth = Math.max(0, depth - 1);
        }
        else if (character === delimiter && depth === 0) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));
    return parts;
}
function shadowBlur(shadow) {
    const lengths = shadow.match(/-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)?/g) ?? [];
    const raw = lengths[2];
    if (!raw) {
        return 0;
    }
    const value = Number.parseFloat(raw);
    return raw.endsWith("rem") || raw.endsWith("em") ? value * 16 : value;
}
function hasNeonColor(value) {
    return /(?:cyan|magenta|fuchsia|#(?:0ff|00ffff|ff00ff|0f0|00ff00|39ff14)\b|rgba?\(\s*0\s*[,\s]\s*255\s*[,\s]\s*(?:255|0)\b|rgba?\(\s*255\s*[,\s]\s*0\s*[,\s]\s*255\b|hsla?\(\s*(?:180|300)(?:deg)?\b)/i.test(value);
}
function arbitrarySpacingPixels(value) {
    const match = value.match(/^\[(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)\]$/);
    if (!match) {
        return undefined;
    }
    const numeric = Number.parseFloat(match[1] ?? "0");
    return match[2] === "px" ? numeric : numeric * 16;
}
function parseSpacingUtility(utility) {
    const clean = utility.replace(/^!/, "");
    const pieces = clean.split(":");
    const base = pieces.pop() ?? "";
    const variant = pieces.join(":");
    const match = base.match(/^(-?)(p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?)-(\[[^\]]+\]|[^\s]+)$/);
    if (!match) {
        return undefined;
    }
    return {
        variant,
        property: `${match[1] ?? ""}${match[2] ?? ""}`,
        value: match[3] ?? "",
    };
}
function parseRadiusUtility(utility) {
    const clean = utility.replace(/^!/, "");
    const pieces = clean.split(":");
    const base = pieces.pop() ?? "";
    const match = base.match(/^rounded(?:-(t|r|b|l|tl|tr|br|bl|ss|se|ee|es))?(?:-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/);
    if (!match) {
        return undefined;
    }
    return {
        variant: pieces.join(":"),
        side: match[1] ?? "all",
        value: match[2] ?? "DEFAULT",
    };
}
function numericText(value) {
    const normalized = value.trim().replace(/\s+/g, " ");
    return /^(?:[$€£¥₹]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|ms|s|min|hr|k|m|b|x))?(?:\s?(?:USD|EUR|GBP))?$/i.test(normalized);
}
/** Analyze one supported source file without touching the filesystem. */
export function analyzeSource(source, filePath = "component.tsx") {
    const index = new SourceIndex(source);
    const pending = [];
    const add = (violation) => {
        pending.push(violation);
    };
    const cssWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const variables = cssVariables(cssWithoutComments);
    const canvas = inheritedCanvas(cssWithoutComments, variables);
    const verifyContrast = (foreground, background, fontSize, fontWeight, offset, evidence) => {
        const ratio = contrastRatio(foreground, background);
        const required = requiredContrastRatio(fontSize, fontWeight);
        if (ratio >= required)
            return;
        add({
            ruleId: "slop/low-contrast",
            category: "color",
            severity: "error",
            offset,
            message: `Text contrast is ${ratio.toFixed(2)}:1; WCAG 2.1 AA requires ${required}:1 for ${required === 3 ? "large" : "normal"} text.`,
            evidence,
            recommendation: `Increase foreground/background contrast to at least ${required}:1 using semantic text and surface tokens; verify the composited colors rather than opacity values in isolation.`,
        });
    };
    const gradientClass = /\b(?:from|via|to)-(?:purple|indigo|violet|fuchsia)-(?:\d{2,3}|\[[^\]]+\])/g;
    for (const match of source.matchAll(gradientClass)) {
        add({
            ruleId: "slop/cliche-gradient",
            category: "color",
            severity: "warning",
            offset: match.index,
            message: "Cliché purple/indigo AI gradient stop detected.",
            evidence: match[0],
            recommendation: "Replace the gradient with a deliberate solid accent or a subtle same-hue surface transition from the semantic design tokens.",
        });
    }
    const cssGradient = /(?:linear|radial|conic)-gradient\s*\([^;}]*(?:purple|indigo|violet|fuchsia|#(?:6366f1|8b5cf6|a855f7|d946ef))[^;}]*\)/gi;
    for (const match of source.matchAll(cssGradient)) {
        add({
            ruleId: "slop/cliche-gradient",
            category: "color",
            severity: "warning",
            offset: match.index,
            message: "Cliché purple/indigo CSS gradient detected.",
            evidence: match[0],
            recommendation: "Use semantic surface tokens and reserve saturated color for a single intentional action or data encoding.",
        });
    }
    const glowUtility = /\b(?:shadow|drop-shadow|text-shadow)-\[([^\]]+)\]/g;
    for (const match of source.matchAll(glowUtility)) {
        const value = (match[1] ?? "").replace(/_/g, " ");
        if (!hasNeonColor(value))
            continue;
        add({
            ruleId: "slop/neon-glow",
            category: "color",
            severity: "warning",
            offset: match.index,
            message: "Neon cyber-glow utility detected.",
            evidence: match[0],
            recommendation: "Replace the glow with semantic focus rings or neutral layered elevation; saturated light is not depth.",
        });
    }
    const tagPattern = /<([A-Za-z][\w:.-]*)(\s[^<>]*?)?>/g;
    const globalRadii = new Map();
    for (const match of source.matchAll(tagPattern)) {
        const tagName = (match[1] ?? "").toLowerCase();
        const attributes = match[2] ?? "";
        const classes = classAttribute(attributes);
        const inlineStyle = styleAttribute(attributes);
        if (!classes && !inlineStyle) {
            continue;
        }
        const inlineDeclarations = styleDeclarations(inlineStyle);
        const foreground = declarationColor(inlineDeclarations.get("color"), variables) ??
            utilityColor(classes, "text", variables);
        const background = declarationColor(inlineDeclarations.get("background-color") ?? inlineDeclarations.get("background"), variables) ??
            utilityColor(classes, "bg", variables) ??
            canvas;
        if (foreground && background) {
            const { fontSize, fontWeight } = typographyContext(classes, inlineDeclarations);
            verifyContrast(foreground, background, fontSize, fontWeight, match.index, compactEvidence(`${inlineStyle || classes} (computed ${fontSize}px/${fontWeight})`));
        }
        if (/(?:^|\s)(?:[\w-]+:)*shadow-(?:xl|2xl)(?:\s|$)/.test(classes)) {
            if (!hasSubtleBorder(classes, inlineStyle)) {
                add({
                    ruleId: "slop/raw-elevation",
                    category: "elevation",
                    severity: "warning",
                    offset: match.index,
                    message: "Heavy elevation is not anchored by a subtle 1px border token.",
                    evidence: classes,
                    recommendation: "Use a layered elevation token and add a 1px low-alpha border; reduce shadow-xl/2xl unless the surface is truly modal.",
                });
            }
        }
        if (/^h[12]$/.test(tagName)) {
            const displaySize = classes.match(/(?:^|\s)(?:[\w-]+:)*text-(?:4xl|5xl|6xl|7xl|8xl|9xl|\[(?:3[2-9]|[4-9]\d|\d{3,})(?:px)\])(?:\s|$)/);
            if (displaySize && !/(?:^|\s)(?:[\w-]+:)*tracking-(?:tight|tighter)(?:\s|$)/.test(classes)) {
                add({
                    ruleId: "slop/display-tracking",
                    category: "typography",
                    severity: "warning",
                    offset: match.index,
                    message: "Display heading lacks tight optical letter spacing.",
                    evidence: classes,
                    recommendation: "Add tracking-tight or tracking-tighter, then tune line-height and measure instead of increasing font weight.",
                });
            }
        }
        const spacingByProperty = new Map();
        const radiiBySide = new Map();
        for (const utility of classes.split(/\s+/).filter(Boolean)) {
            const spacing = parseSpacingUtility(utility);
            if (spacing) {
                const key = `${spacing.variant}:${spacing.property}`;
                const previous = spacingByProperty.get(key);
                if (previous && previous.value !== spacing.value) {
                    add({
                        ruleId: "slop/conflicting-spacing",
                        category: "spacing",
                        severity: "error",
                        offset: match.index,
                        message: `Conflicting ${spacing.property} utilities (${previous.value} and ${spacing.value}) on one element.`,
                        evidence: classes,
                        recommendation: "Keep one utility per spacing property and responsive variant; encode intentional differences with responsive prefixes.",
                    });
                }
                else {
                    spacingByProperty.set(key, { value: spacing.value, offset: match.index });
                }
                const pixels = arbitrarySpacingPixels(spacing.value);
                if (pixels !== undefined &&
                    pixels !== 0 &&
                    pixels !== 1 &&
                    pixels !== 2 &&
                    pixels % 4 !== 0) {
                    add({
                        ruleId: "slop/off-grid-spacing",
                        category: "spacing",
                        severity: "warning",
                        offset: match.index,
                        message: `Arbitrary ${pixels}px spacing breaks the 4px layout grid.`,
                        evidence: utility,
                        recommendation: "Move to the nearest intentional 4px-grid stop or add a documented semantic spacing token.",
                    });
                }
            }
            const radius = parseRadiusUtility(utility);
            if (radius) {
                const key = `${radius.variant}:${radius.side}`;
                const previous = radiiBySide.get(key);
                if (previous && previous.value !== radius.value) {
                    add({
                        ruleId: "slop/conflicting-radius",
                        category: "layout",
                        severity: "error",
                        offset: match.index,
                        message: `Conflicting radius utilities (${previous.value} and ${radius.value}) on one element.`,
                        evidence: classes,
                        recommendation: "Choose one radius for this corner axis and derive nested radii from outer padding.",
                    });
                }
                else {
                    radiiBySide.set(key, { value: radius.value, offset: match.index });
                }
                if (!radius.variant && radius.side === "all" && RADIUS_VALUES.has(radius.value)) {
                    globalRadii.set(radius.value, match.index);
                    if (globalRadii.size === 4) {
                        add({
                            ruleId: "slop/radius-scale",
                            category: "layout",
                            severity: "warning",
                            offset: match.index,
                            message: "Four or more unrelated corner radii are mixed in one component tree.",
                            evidence: [...globalRadii.keys()].join(", "),
                            recommendation: "Reduce the tree to two or three semantic radii; exclude pills and avatars from the surface radius scale.",
                        });
                    }
                }
            }
        }
    }
    const numericElement = /<(span|div|td|th|p|strong|dd|output)\b([^>]*)>([^<>]{1,80})<\/\1>/gi;
    for (const match of source.matchAll(numericElement)) {
        const attributes = match[2] ?? "";
        const classes = classAttribute(attributes);
        const content = match[3] ?? "";
        const dynamicNumeric = /(?:^|\s)(?:metric|price|amount|count|number|stat-value|numeric)(?:\s|$)/i.test(classes) &&
            /\{[^}]+\}/.test(content);
        if ((numericText(content) || dynamicNumeric) &&
            !/(?:^|\s)(?:[\w-]+:)*tabular-nums(?:\s|$)/.test(classes) &&
            !/font-variant-numeric\s*:\s*(?:[^;]*\b)?tabular-nums/i.test(styleAttribute(attributes))) {
            add({
                ruleId: "slop/numeric-alignment",
                category: "typography",
                severity: "warning",
                offset: match.index,
                message: "Numeric UI is missing tabular figures, causing unstable alignment.",
                evidence: compactEvidence(match[0]),
                recommendation: "Add tabular-nums (font-variant-numeric: tabular-nums) and right-align comparable numeric values.",
            });
        }
    }
    const weights = new Map();
    const weightPattern = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b|\bfont-weight\s*:\s*([1-9]00)\b/g;
    for (const match of source.matchAll(weightPattern)) {
        const weight = match[1] ? FONT_WEIGHTS[match[1]] : match[2];
        if (weight && !weights.has(weight)) {
            weights.set(weight, { offset: match.index, label: match[0] });
            if (weights.size === 4) {
                add({
                    ruleId: "slop/font-weight-mixing",
                    category: "typography",
                    severity: "warning",
                    offset: match.index,
                    message: `Four or more font weights are mixed in one component tree: ${[...weights.keys()].join(", ")}.`,
                    evidence: match[0],
                    recommendation: "Collapse typography to two or three purposeful weights and use size, color, and spacing for remaining hierarchy.",
                });
            }
        }
    }
    const gridPattern = /(?:^|["'\s])(?:[\w-]+:)*grid-cols-3(?:["'\s]|$)|repeat\(\s*3\s*,/g;
    for (const match of source.matchAll(gridPattern)) {
        const nearby = source.slice(Math.max(0, match.index - 1800), Math.min(source.length, match.index + match[0].length + 2400));
        if (/(?:text-center|text-align\s*:\s*center)/.test(nearby) &&
            /\p{Extended_Pictographic}/u.test(nearby)) {
            add({
                ruleId: "slop/emoji-feature-grid",
                category: "layout",
                severity: "warning",
                offset: match.index,
                message: "Generic centered three-column emoji feature grid detected.",
                evidence: compactEvidence(nearby.slice(0, 220)),
                recommendation: "Replace the repeated emoji cards with a content-specific composition, real iconography, and an intentional grid rhythm.",
            });
        }
    }
    const cssBlock = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of cssWithoutComments.matchAll(cssBlock)) {
        const selector = (match[1] ?? "").trim();
        const declarations = match[2] ?? "";
        const blockOffset = match.index + match[0].indexOf("{") + 1;
        const declarationMap = styleDeclarations(declarations);
        const foreground = declarationColor(declarationMap.get("color"), variables);
        const background = declarationColor(declarationMap.get("background-color") ?? declarationMap.get("background"), variables) ?? canvas;
        if (foreground && background) {
            const { fontSize, fontWeight } = typographyContext("", declarationMap);
            verifyContrast(foreground, background, fontSize, fontWeight, blockOffset, compactEvidence(`${selector} { color: ${declarationMap.get("color")}; background: ${declarationMap.get("background-color") ?? declarationMap.get("background") ?? "inherited canvas"}; }`));
        }
        const glow = declarations.match(/(?:^|;)\s*(box-shadow|text-shadow|filter)\s*:\s*([^;]+)/i);
        const glowProperty = glow?.[1]?.toLowerCase();
        const glowValue = glow?.[2];
        if (glowValue &&
            hasNeonColor(glowValue) &&
            (glowProperty !== "filter" || /drop-shadow\s*\(/i.test(glowValue))) {
            add({
                ruleId: "slop/neon-glow",
                category: "color",
                severity: "warning",
                offset: blockOffset,
                message: "Neon cyber-glow effect detected.",
                evidence: glowValue,
                recommendation: "Replace the glow with semantic focus rings or neutral layered elevation; saturated light is not depth.",
            });
        }
        const shadowDeclaration = declarations.match(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/i)?.[1];
        if (shadowDeclaration && !/\bnone\b/i.test(shadowDeclaration)) {
            const layers = splitOutsideParentheses(shadowDeclaration, ",")
                .map((layer) => layer.trim())
                .filter(Boolean);
            if (layers.length === 1 &&
                shadowBlur(layers[0] ?? "") >= 24 &&
                !hasSubtleCSSBorder(declarations)) {
                add({
                    ruleId: "slop/raw-elevation",
                    category: "elevation",
                    severity: "warning",
                    offset: blockOffset,
                    message: "A single heavy CSS shadow has no subtle 1px border or supporting layer.",
                    evidence: shadowDeclaration,
                    recommendation: "Use a semantic elevation token with a hairline border and two restrained shadow layers.",
                });
            }
        }
        if (/(?:^|[,\s])(?:h1|h2)(?:$|[,\s.#:[\]])/i.test(selector) || /(?:display|hero-title)/i.test(selector)) {
            const fontSize = declarations.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i)?.[1];
            const letterSpacing = declarations.match(/(?:^|;)\s*letter-spacing\s*:\s*([^;]+)/i)?.[1];
            if (fontSize) {
                const sizes = fontSize.match(/(?:\d+\.?\d*|\.\d+)(?:px|rem|em)/g) ?? [];
                const isDisplay = sizes.some((size) => {
                    const value = Number.parseFloat(size);
                    return size.endsWith("px") ? value >= 32 : value * 16 >= 32;
                });
                if (isDisplay && !(letterSpacing && /^-\s*(?:\d|\.)/.test(letterSpacing.trim()))) {
                    add({
                        ruleId: "slop/display-tracking",
                        category: "typography",
                        severity: "warning",
                        offset: blockOffset,
                        message: "Display typography lacks negative optical letter spacing.",
                        evidence: `${selector} { font-size: ${fontSize.trim()} }`,
                        recommendation: "Set a deliberately small negative letter-spacing token (typically -0.02em to -0.06em) and verify line breaks.",
                    });
                }
            }
        }
    }
    const violations = pending.map((pendingViolation) => {
        const location = index.location(pendingViolation.offset);
        return {
            ruleId: pendingViolation.ruleId,
            category: pendingViolation.category,
            severity: pendingViolation.severity,
            file: portablePath(filePath),
            line: location.line,
            column: location.column,
            message: pendingViolation.message,
            evidence: compactEvidence(pendingViolation.evidence),
            recommendation: pendingViolation.recommendation,
        };
    });
    const unique = new Map();
    for (const violation of violations) {
        const key = [
            violation.ruleId,
            violation.file,
            violation.line,
            violation.column,
            violation.evidence,
        ].join(":");
        if (!unique.has(key)) {
            unique.set(key, violation);
        }
    }
    return [...unique.values()].sort((left, right) => left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.column - right.column ||
        left.ruleId.localeCompare(right.ruleId));
}
export const detectSlop = analyzeSource;
export function calculateDesignIntegrityScore(violations) {
    const penalties = { error: 12, warning: 7, info: 3 };
    const deduction = violations.reduce((total, violation) => total + penalties[violation.severity], 0);
    return Math.max(0, Math.min(100, 100 - deduction));
}
export function designGrade(score) {
    if (score >= 97)
        return "A+";
    if (score >= 90)
        return "A";
    if (score >= 80)
        return "B";
    if (score >= 70)
        return "C";
    if (score >= 60)
        return "D";
    return "F";
}
export function summarizeViolations(violations) {
    const byCategory = {
        color: 0,
        layout: 0,
        elevation: 0,
        typography: 0,
        spacing: 0,
    };
    const byRule = {};
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const violation of violations) {
        byCategory[violation.category] += 1;
        byRule[violation.ruleId] = (byRule[violation.ruleId] ?? 0) + 1;
        if (violation.severity === "error")
            errors += 1;
        if (violation.severity === "warning")
            warnings += 1;
        if (violation.severity === "info")
            infos += 1;
    }
    return { errors, warnings, infos, byRule, byCategory };
}
export function generateRefactoringPrompt(violations, score = calculateDesignIntegrityScore(violations)) {
    if (violations.length === 0) {
        return [
            "# unslop refactoring brief",
            "",
            `Design Integrity Score: ${score}/100. No slop violations were detected by static analysis.`,
            "Preserve the existing token system. Verify visual hierarchy, keyboard states, responsive behavior, and contrast before making unsolicited changes.",
        ].join("\n");
    }
    const lines = [
        "# unslop refactoring brief",
        "",
        `Design Integrity Score: ${score}/100 (${designGrade(score)}).`,
        "",
        "Refactor the violations below without changing product behavior or content. Reuse semantic tokens; do not swap one set of arbitrary values for another.",
        "",
        "## Required changes",
    ];
    for (const violation of violations) {
        lines.push("", `### ${violation.file}:${violation.line}:${violation.column} — ${violation.ruleId}`, `- Problem: ${violation.message}`, `- Evidence: \`${violation.evidence.replace(/`/g, "\\`")}\``, `- Change: ${violation.recommendation}`);
    }
    lines.push("", "## Acceptance criteria", "- Use one coherent type scale and no more than three font weights per component tree.", "- Put display headings on a tight tracking token and all numeric UI on tabular figures.", "- Derive spacing and radii from semantic tokens with no same-element utility conflicts.", "- Replace heavy raw elevation with subtle borders and intentional layered tokens.", "- Run `npx github:avivgerz-hue/unslop audit .` and manually verify contrast, focus, responsive layout, and reduced motion.");
    return lines.join("\n");
}
async function collectFiles(target, ignored) {
    const targetStats = await stat(target);
    if (targetStats.isFile()) {
        return SUPPORTED_EXTENSIONS.includes(extname(target).toLowerCase())
            ? [target]
            : [];
    }
    if (!targetStats.isDirectory()) {
        return [];
    }
    const files = [];
    async function walk(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!ignored.has(entry.name)) {
                    await walk(resolve(directory, entry.name));
                }
            }
            else if (entry.isFile() &&
                SUPPORTED_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
                files.push(resolve(directory, entry.name));
            }
        }
    }
    await walk(target);
    return files;
}
/** Recursively audit a file or directory in stable path order. */
export async function auditTarget(target = ".", options = {}) {
    const absoluteTarget = resolve(options.cwd ?? process.cwd(), target);
    let targetStats;
    try {
        targetStats = await stat(absoluteTarget);
    }
    catch {
        throw new Error(`Audit target does not exist: ${target}`);
    }
    if (!targetStats.isFile() && !targetStats.isDirectory()) {
        throw new Error(`Audit target is not a file or directory: ${target}`);
    }
    const ignored = new Set([...IGNORED_DIRECTORIES, ...(options.ignore ?? [])]);
    const absoluteFiles = await collectFiles(absoluteTarget, ignored);
    const base = options.cwd ?? process.cwd();
    const files = absoluteFiles.map((file) => portablePath(relative(base, file) || file));
    const violations = [];
    for (const [fileIndex, file] of absoluteFiles.entries()) {
        const source = await readFile(file, "utf8");
        violations.push(...analyzeSource(source, files[fileIndex] ?? file));
    }
    violations.sort((left, right) => left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.column - right.column ||
        left.ruleId.localeCompare(right.ruleId));
    const score = calculateDesignIntegrityScore(violations);
    return {
        target: portablePath(target),
        filesScanned: files.length,
        files,
        violations,
        score,
        grade: designGrade(score),
        summary: summarizeViolations(violations),
        refactoringPrompt: generateRefactoringPrompt(violations, score),
    };
}
export const audit = auditTarget;
export function formatAuditReport(report) {
    const lines = [
        `unslop audit · ${report.filesScanned} file${report.filesScanned === 1 ? "" : "s"} scanned`,
        "",
    ];
    if (report.violations.length === 0) {
        lines.push("No AI slop anti-patterns detected.");
    }
    else {
        for (const violation of report.violations) {
            lines.push(`${violation.file}:${violation.line}:${violation.column}  ${violation.severity.toUpperCase()}  ${violation.ruleId}`, `  ${violation.message}`, `  Fix: ${violation.recommendation}`);
        }
    }
    lines.push("", `Design Integrity Score: ${report.score}/100 (${report.grade})`, `${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.infos} info`, "", report.refactoringPrompt);
    return lines.join("\n");
}
//# sourceMappingURL=slop-detector.js.map