/**
 * Input sanitisation for values that other players will see.
 *
 * Display names are broadcast to every seat, so one player can otherwise break
 * the lobby for everyone by sending newlines, control characters, or Unicode
 * bidi overrides that scramble the layout of a right-to-left interface.
 */

export const MAX_NAME_LENGTH = 40;
export const FALLBACK_NAME = 'بازیکن';

/**
 * Unicode bidirectional formatting characters. These are invisible but reorder
 * surrounding text, which is especially damaging in a Persian RTL layout.
 */
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** C0/C1 control characters, including newlines and tabs. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Zero-width characters used to pad a name into something unreadable. */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

export function sanitizeDisplayName(raw: unknown, fallback = FALLBACK_NAME): string {
  if (typeof raw !== 'string') return fallback;

  const cleaned = raw
    .replace(CONTROL_CHARS, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(ZERO_WIDTH, '')
    // Collapse any run of whitespace into a single space.
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned === '') return fallback;
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join('');
}
