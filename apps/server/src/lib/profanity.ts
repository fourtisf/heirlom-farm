/**
 * Strain names are public — they appear on the specimen plate, which is built to
 * be screenshotted. This is a deliberately small list plus a shape check; it is
 * a speed bump, not a moderation system. Anything that gets through is handled
 * by report-and-rename, which is why `named` is a one-way flag support can reset.
 */

const BLOCKED = [
  'anal', 'anus', 'arse', 'bastard', 'bitch', 'cock', 'cunt', 'dick', 'dyke', 'fag',
  'faggot', 'fuck', 'nigger', 'nigga', 'paki', 'penis', 'piss', 'porn', 'pussy', 'rape',
  'retard', 'shit', 'slut', 'spastic', 'tranny', 'twat', 'wank', 'whore',
];

/** Collapses leetspeak and separators so `f-u-c-k` and `fvck` do not sail past. */
function canonical(input: string): string {
  return input
    .toLowerCase()
    .replace(/[13]/g, 'e')
    .replace(/[04]/g, 'o')
    .replace(/[!|]/g, 'i')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/[^a-z]/g, '');
}

export function isClean(name: string): boolean {
  const flat = canonical(name);
  return !BLOCKED.some((word) => flat.includes(word));
}

/** Zero-width and bidi control characters: they render as nothing but persist. */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

/** Printable, single-line, no invisible tricks, no runs of whitespace. */
export function isWellFormedName(name: string): boolean {
  if (name !== name.trim()) return false;
  if (/\s{2,}/.test(name)) return false;
  if (INVISIBLE.test(name)) return false;
  return /^[\p{L}\p{N} '’\-.&]+$/u.test(name);
}
