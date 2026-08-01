import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design system guarantees.
 *
 * These are the rules that keep the styling honest as it grows:
 * every colour comes from a token, every text colour is readable, the font is
 * bundled rather than fetched, and notched phones are accounted for.
 */

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const stylesDir = path.join(srcDir, 'styles');
const read = (p: string) => readFileSync(p, 'utf8');

const tokens = read(path.join(stylesDir, 'tokens.css'));
const entry = read(path.join(srcDir, 'styles.css'));
const styleFiles = readdirSync(stylesDir).filter((f) => f.endsWith('.css'));

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Reads a token's literal value out of tokens.css. */
function token(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `token --${name} should exist`).toBeTruthy();
  return match![1]!.trim();
}

describe('font is self-hosted', () => {
  it('bundles Vazirmatn instead of fetching it from a CDN', () => {
    expect(entry).toContain('@fontsource-variable/vazirmatn');
  });

  it('never imports from a remote host in any stylesheet', () => {
    // A blocked CDN must not be able to break typography, the way
    // fonts.googleapis.com previously did on censored networks.
    for (const file of styleFiles) {
      const css = read(path.join(stylesDir, file));
      expect(css, `${file} should not reach out to the network`).not.toMatch(
        /@import\s+url\(\s*['"]?https?:/i,
      );
      expect(css, `${file} should not reference a remote font`).not.toContain('fonts.googleapis.com');
      expect(css).not.toContain('fonts.gstatic.com');
    }
  });

  it('keeps a Persian-capable fallback chain for when the font fails', () => {
    const stack = token('font-fa');
    expect(stack).toContain('Vazirmatn Variable');
    expect(stack).toMatch(/Tahoma|Noto Naskh Arabic|IRANSans/);
    expect(stack).toMatch(/system-ui|sans-serif/);
  });
});

describe('colour tokens meet WCAG AA', () => {
  const bgBase = token('bg-base');
  const bgRaised = token('bg-raised');

  const textTokens = ['text-primary', 'text-secondary', 'text-muted'] as const;

  it.each(textTokens)('%s is readable on the page background', (name) => {
    expect(contrast(token(name), bgBase)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(textTokens)('%s is readable on raised surfaces', (name) => {
    expect(contrast(token(name), bgRaised)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['mint-200', 'accent text'],
    ['violet-100', 'brand text'],
    ['rose-300', 'danger text'],
    ['amber-300', 'warning text'],
    ['violet-050', 'bam badge text'],
  ])('%s (%s) is readable on the page background', (name) => {
    expect(contrast(token(name), bgBase)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps both suit colours readable on a card face', () => {
    const face = token('card-face');
    expect(contrast(token('card-red'), face)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('card-black'), face)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accent buttons readable', () => {
    expect(contrast(token('text-on-accent'), token('mint-500'))).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches AAA for body and primary text', () => {
    expect(contrast(token('text-primary'), bgBase)).toBeGreaterThanOrEqual(7);
    expect(contrast(token('text-secondary'), bgBase)).toBeGreaterThanOrEqual(7);
  });
});

describe('stylesheets use tokens, not raw values', () => {
  const consumers = styleFiles.filter((f) => f !== 'tokens.css');

  it.each(consumers)('%s declares no raw hex colour', (file) => {
    const css = read(path.join(stylesDir, file));
    // Strip comments so an explanatory hex in prose does not trip the rule.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes).toEqual([]);
  });

  it('defines the palette only once, in tokens.css', () => {
    expect(tokens).toMatch(/--violet-500:/);
    expect(tokens).toMatch(/--mint-500:/);
  });
});

describe('layout tokens', () => {
  it('exposes safe-area insets for notched phones', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(tokens).toContain(`--safe-${side}: env(safe-area-inset-${side}`);
    }
  });

  it('actually applies the safe area to the app shell and landing screen', () => {
    const shell = read(path.join(stylesDir, 'shell.css'));
    const landing = read(path.join(stylesDir, 'landing.css'));
    expect(shell).toContain('--safe-top');
    expect(shell).toContain('--safe-bottom');
    expect(landing).toContain('--safe-bottom');
  });

  it('keeps the sticky hand and toast clear of the home indicator', () => {
    const table = read(path.join(stylesDir, 'table.css'));
    expect(table).toContain('--safe-bottom');
  });

  it('declares a comfortable minimum tap target', () => {
    expect(parseInt(token('tap-target'), 10)).toBeGreaterThanOrEqual(44);
  });
});

describe('theme is locked to dark', () => {
  it('declares a dark colour-scheme so native controls follow', () => {
    expect(tokens).toContain('color-scheme: dark');
  });

  it('never introduces a light-theme media query', () => {
    for (const file of styleFiles) {
      const css = read(path.join(stylesDir, file));
      expect(css, `${file} must not switch to a light theme`).not.toContain(
        'prefers-color-scheme: light',
      );
    }
  });
});

describe('viewport and document head', () => {
  const rawHtml = readFileSync(path.resolve(srcDir, '../index.html'), 'utf8');
  // Comments explain *why* these attributes exist and mention them by name, so
  // assertions must run against the real markup or they pass on the prose.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  const viewport = html.match(/<meta\s+name="viewport"[\s\S]*?>/)?.[0] ?? '';

  it('opts into the full screen so safe-area insets report real values', () => {
    // Without `viewport-fit=cover` every env(safe-area-inset-*) resolves to 0
    // and all the notch padding in the stylesheets does nothing.
    expect(viewport).not.toBe('');
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('does not block pinch zoom', () => {
    // `maximum-scale=1` / `user-scalable=no` fail WCAG 1.4.4.
    expect(viewport).not.toMatch(/maximum-scale\s*=/);
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
  });

  it('declares a dark theme to the browser chrome', () => {
    expect(html).toContain('name="color-scheme" content="dark"');
    expect(html).toMatch(/name="theme-color"/);
  });

  it('leaves a slot for the build-time font preload', () => {
    expect(rawHtml).toContain('persian-font-preload');
  });

  it('never hard-codes a node_modules path that would 404 in production', () => {
    expect(rawHtml).not.toContain('node_modules');
  });
});

describe('viewport height units', () => {
  it('pairs every 100vh with a dvh fallback so mobile browser chrome is handled', () => {
    // On mobile, `vh` includes the collapsing URL bar, which pushes the sticky
    // hand of cards below the fold. `dvh` tracks the visible viewport.
    for (const file of styleFiles) {
      const css = read(path.join(stylesDir, file));
      const vhCount = (css.match(/\d+vh\b/g) ?? []).length;
      const dvhCount = (css.match(/\d+dvh\b/g) ?? []).length;
      expect(dvhCount, `${file} should back each vh rule with a dvh rule`).toBe(vhCount);
    }
  });
});
