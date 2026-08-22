/**
 * Checks every post in x-posts.md still fits in one tweet.
 *
 *   node docs/brand/check-x-posts.mjs
 *
 * X weighs a URL as 23 characters regardless of its real length, counts most
 * Latin text as one per character, and does not count the attached image. A
 * blockquote block in x-posts.md is one post; blank quote lines are the line
 * breaks inside it.
 */
import { readFileSync } from 'node:fs';

const LIMIT = 280;
const URL_WEIGHT = 23;

const md = readFileSync(new URL('./x-posts.md', import.meta.url), 'utf8');
const lines = md.split('\n');

const posts = [];
let heading = '(top)';
let buf = null;

for (const line of lines) {
  if (line.startsWith('#')) heading = line.replace(/^#+\s*/, '');
  if (line.startsWith('>')) {
    (buf ??= { heading, text: [] }).text.push(line.replace(/^>\s?/, ''));
  } else if (buf) {
    posts.push({ ...buf, text: buf.text.join('\n').trim() });
    buf = null;
  }
}
if (buf) posts.push({ ...buf, text: buf.text.join('\n').trim() });

/** X's own weighting: a link is 23 no matter what, everything else is 1. */
function weigh(text) {
  const withoutLinks = text.replace(/\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:fun|com|xyz|io)\b\S*/gi, '');
  const links = text.length - withoutLinks.length ? text.match(/\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:fun|com|xyz|io)\b\S*/gi) ?? [] : [];
  return [...withoutLinks].length + links.length * URL_WEIGHT;
}

let bad = 0;
for (const p of posts) {
  const n = weigh(p.text);
  const ok = n <= LIMIT;
  if (!ok) bad++;
  const first = p.text.split('\n')[0].slice(0, 46);
  console.log(`${ok ? ' ok ' : 'OVER'}  ${String(n).padStart(3)}/${LIMIT}  ${p.heading.padEnd(28)}  ${first}`);
}
console.log(`\n${posts.length} posts, ${bad} over the limit`);
process.exit(bad ? 1 : 0);
