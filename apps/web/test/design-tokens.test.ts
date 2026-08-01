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

describe('the seat ring is responsive and token driven', () => {
  const table = read(path.join(stylesDir, 'table.css'));
  const responsive = read(path.join(stylesDir, 'responsive.css'));

  it('lays out each table size with its own grid template', () => {
    expect(table).toContain('grid-template-areas');
    // Two player tables have nobody left or right.
    expect(table).toContain('.table-center.seats-2');
  });

  it('reserves space for played cards so the ring never jumps', () => {
    const slot = table.slice(table.indexOf('.table-seat__played'));
    expect(slot).toMatch(/min-height:/);
    expect(slot).toMatch(/min-width:/);
  });

  it('reserves space for the event line so the centre never jumps', () => {
    expect(table.slice(table.indexOf('.table-event'))).toMatch(/min-height:/);
  });

  it('adapts the tight side columns on very narrow phones', () => {
    expect(table).toContain('@media (max-width: 380px)');
  });

  it('gives the ring more room on wider screens', () => {
    expect(responsive).toContain('.table-center');
  });

  it('names team sides relative to the viewer, not by absolute index', () => {
    // `team-0`/`team-1` would colour your own side differently depending on
    // which seat you drew, which is exactly the bug this guards.
    expect(table).toContain('.table-seat.team-theirs');
    expect(table).not.toMatch(/\.table-seat\.team-[01]\b/);
  });
});

describe('card face and animation', () => {
  const table = read(path.join(stylesDir, 'table.css'));

  it('pins the index into the top corner, as real cards do', () => {
    // The standard layout puts the rank-and-suit index tight in the corner, not
    // centred: that corner is the only part visible in a fanned hand.
    const rule = table.slice(table.indexOf('.card__index {'), table.indexOf('.card__index--flipped'));
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*\d/);
    expect(rule).toMatch(/left:\s*\d/);
  });

  it('repeats the index rotated in the opposite corner', () => {
    const rule = table.slice(table.indexOf('.card__index--flipped'));
    expect(rule).toMatch(/rotate\(180deg\)/);
    expect(rule).toMatch(/bottom:\s*\d/);
    expect(rule).toMatch(/right:\s*\d/);
    // The inherited top/left must be released or the corner offsets fight.
    expect(rule).toMatch(/top:\s*auto/);
    expect(rule).toMatch(/left:\s*auto/);
  });

  it('centres the large pip independently of the corner indices', () => {
    const rule = table.slice(table.indexOf('.card__pip {'));
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/translate\(-50%,\s*-50%\)/);
  });

  it('animates the won trick highlight in CSS', () => {
    // Seat highlighting is a plain state change, so CSS is the right tool.
    // Card entrances are not: they live in `useCardEntrance` and are covered by
    // card-animation.test.tsx, which asserts the animation actually starts.
    expect(table).toContain('@keyframes seat-won');
  });

  it('leaves card entrance animation to the Web Animations API', () => {
    // A CSS mount animation silently does nothing when React reuses the node,
    // which is how "cards just appear" shipped three times.
    expect(table).not.toContain('@keyframes card-deal');
    expect(table).not.toContain('@keyframes card-land');
  });

  it('only lifts cards on devices that truly hover', () => {
    // A hover transform on touch sticks after the tap ends.
    expect(table).toContain('@media (hover: hover)');
  });

  it('marks illegal cards without hiding them', () => {
    const blocked = table.slice(table.indexOf('.card.is-blocked'));
    expect(blocked).toMatch(/grayscale/);
  });
});

describe('top bar leave control', () => {
  const shell = read(path.join(stylesDir, 'shell.css'));

  it('expands the icon hit area to a full tap target', () => {
    const rule = shell.slice(shell.indexOf('.icon-button::after'));
    expect(rule).toContain('var(--tap-target)');
    // A centred overlay needs a positioned ancestor, otherwise it anchors to
    // the page and the enlarged hit area lands somewhere else entirely.
    expect(shell.slice(shell.indexOf('.icon-button {'))).toMatch(/position:\s*relative/);
  });

  it('opens the popover from the inline end so RTL does not push it off screen', () => {
    const rule = shell.slice(shell.indexOf('.leave-popover {'));
    expect(rule).toContain('inset-inline-end');
    expect(rule).not.toMatch(/inset-inline-start:\s*0/);
  });

  it('never lets the popover grow wider than the screen', () => {
    expect(shell.slice(shell.indexOf('.leave-popover {'))).toMatch(/max-width:\s*min\(/);
  });
});

describe('cards size themselves in any layout context', () => {
  const table = read(path.join(stylesDir, 'table.css'));
  const responsive = read(path.join(stylesDir, 'responsive.css'));

  /** Grabs a rule body by exact selector, ignoring media-query wrappers. */
  function rule(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} should exist`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  }

  it('gives the card an explicit width, not just a flex basis', () => {
    // The card lives in two very different parents: `.hand` is a flex row and
    // `.table-seat__played` is a grid cell. `flex-basis` only sizes flex items,
    // so relying on it made every card on the table collapse to zero width.
    const base = rule(table, '.card');
    expect(base).toMatch(/width:\s*\d+px/);
    expect(base).toMatch(/height:\s*\d+px/);
  });

  it('sizes the compact variant explicitly too', () => {
    const compact = rule(table, '.card.compact');
    expect(compact).toMatch(/width:\s*\d+px/);
    expect(compact).toMatch(/height:\s*\d+px/);
  });

  it('never sizes a card with flex-basis anywhere', () => {
    for (const file of styleFiles) {
      const css = read(path.join(stylesDir, file));
      const cardRules = css.match(/\.card[^{]*\{[^}]*\}/g) ?? [];
      for (const body of cardRules) {
        expect(body, `${file}: cards must not depend on flex-basis`).not.toMatch(/flex-basis/);
      }
    }
  });

  it('keeps the wide-screen override on width as well', () => {
    expect(rule(responsive, '.card')).toMatch(/width:\s*\d+px/);
  });

  it('reserves a seat slot at least as large as the card it holds', () => {
    // Otherwise a landing card would resize the ring on every trick.
    const slot = rule(table, '.table-seat__played');
    const slotWidth = Number(slot.match(/width:\s*(\d+)px/)?.[1]);
    const cardWidth = Number(rule(table, '.card.compact').match(/width:\s*(\d+)px/)?.[1]);
    expect(slotWidth).toBeGreaterThanOrEqual(cardWidth);
  });
});

describe('cards never disturb the rest of the table', () => {
  const table = read(path.join(stylesDir, 'table.css'));
  const responsive = read(path.join(stylesDir, 'responsive.css'));

  function rule(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} should exist`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  }

  it('gives the card stage a fixed size, not a minimum', () => {
    // With only a min-size, a landing or stacked card can grow the seat, and
    // because every seat shares one grid the whole ring shifts.
    const stage = rule(table, '.table-seat__played');
    expect(stage).toMatch(/width:\s*\d+px/);
    expect(stage).toMatch(/height:\s*\d+px/);
    expect(stage).toMatch(/position:\s*relative/);
  });

  it('paints cards in a layer that is out of normal flow', () => {
    const layer = rule(table, '.table-seat__played > *');
    expect(layer).toMatch(/position:\s*absolute/);
  });

  it('keeps a stack of draw cards from growing the seat', () => {
    const stack = rule(table, '.draw-stack');
    expect(stack).toMatch(/width:\s*\d+px/);
    expect(stack).toMatch(/height:\s*\d+px/);
    expect(rule(table, '.draw-stack__card')).toMatch(/position:\s*absolute/);
  });

  it('fixes the seat badge height so appearing tags do not resize it', () => {
    // The "نوبت" tag comes and goes on every turn change.
    expect(rule(table, '.table-seat__badge')).toMatch(/height:\s*\d+px/);
  });

  it('never lets seat tags wrap onto a second line', () => {
    expect(rule(table, '.table-seat__tags')).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('reserves room for the turn message, whatever its length', () => {
    const badge = rule(table, '.turn-badge');
    expect(badge).toMatch(/min-height:\s*\d+px/);
    expect(badge).toMatch(/min-width:/);
  });

  it('reserves the height of the hand so dealing does not push the table up', () => {
    expect(rule(table, '.hand')).toMatch(/min-height:/);
    // The wide breakpoint uses taller cards and must reserve more.
    expect(rule(responsive, '.hand')).toMatch(/min-height:/);
  });

  it('reserves the centre of the table', () => {
    expect(rule(table, '.table-center__core')).toMatch(/min-height:\s*\d+px/);
  });
});

describe('cards sit where the table says they should', () => {
  const table = read(path.join(stylesDir, 'table.css'));

  function rule(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} should exist`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  }

  it('never centres a card with a transform', () => {
    // The entrance animation writes `transform` on this very element, so a
    // translate(-50%,-50%) used for centring is wiped out mid-flight and the
    // card settles half its own size away from its slot.
    const layer = rule(table, '.table-seat__played > *');
    expect(layer).not.toMatch(/transform:/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(layer).toMatch(/place-items:\s*center/);
  });

  it('centres stacked draw cards the same way', () => {
    const stackCard = rule(table, '.draw-stack__card');
    expect(stackCard).toMatch(/inset:\s*0/);
  });

  it('sweeps a finished trick towards each possible winner', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(table).toContain(`.table-seat__played.is-sweeping.sweep-${side}`);
    }
  });

  it('fades the swept cards out as they travel', () => {
    expect(rule(table, '.table-seat__played.is-sweeping > *')).toMatch(/opacity:\s*0/);
  });
});
