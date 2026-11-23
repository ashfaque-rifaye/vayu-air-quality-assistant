import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** Pull the `--name: #hex;` declarations out of the first matching :root-like block. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

const lightBlock = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
const darkBlock = /prefers-color-scheme:\s*dark[\s\S]*?:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
const light = tokensIn(lightBlock);
const dark = { ...light, ...tokensIn(darkBlock) };

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA = 4.5;

function checkPairs(theme: Record<string, string>, pairs: readonly [string, string][]) {
  for (const [fg, bg] of pairs) {
    const ratio = contrast(theme[fg] ?? fg, theme[bg] ?? bg);
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
  }
}

const TOKEN_PAIRS: readonly [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-soft"],
  ["text", "surface-ai"],
  ["muted", "surface"],
  ["brand-contrast", "brand"],
  ["accent-text", "surface"],
  ["accent-text", "surface-soft"],
  ["danger", "danger-surface"],
  ["ok", "ok-surface"],
  ["warn", "warn-surface"],
];

describe("design tokens meet WCAG AA", () => {
  it("parsed both themes", () => {
    expect(Object.keys(light).length).toBeGreaterThan(10);
    expect(darkBlock.length).toBeGreaterThan(10);
  });

  it("light theme token pairs", () => checkPairs(light, TOKEN_PAIRS));
  it("dark theme token pairs", () => checkPairs(dark, TOKEN_PAIRS));

  it("white text on every hero gradient end", () => {
    const ends = ["#15655a", "#1a6b61", "#6a5212", "#8f3327", "#6e2860", "#6a1d1d", "#156b5f"];
    for (const end of ends) expect(contrast("#ffffff", end), end).toBeGreaterThanOrEqual(AA);
  });

  it("the mint accent (eyebrow, italic, icons) is legible on every hero end", () => {
    const ends = ["#15655a", "#1a6b61", "#6a5212", "#8f3327", "#6e2860", "#6a1d1d", "#156b5f"];
    for (const end of ends) expect(contrast("#8ff0de", end), end).toBeGreaterThanOrEqual(AA);
  });

  it("AQI pills are legible in light theme", () => {
    checkPairs({}, [
      ["#0e5a39", "#d6f1e3"],
      ["#5f4e00", "#f7eecb"],
      ["#8a4a00", "#ffe3c9"],
      ["#9d2029", "#fbdcdc"],
      ["#6a2a86", "#ecdcf3"],
      ["#7a1f1f", "#f1d7d7"],
    ]);
  });

  it("AQI pills are legible in dark theme", () => {
    checkPairs({}, [
      ["#86e3b0", "#123524"],
      ["#f0d579", "#342c0c"],
      ["#f3b071", "#3a2410"],
      ["#ff9aa4", "#3a1a1e"],
      ["#d6a7e8", "#2d1836"],
      ["#f0a0a0", "#371717"],
    ]);
  });
});
