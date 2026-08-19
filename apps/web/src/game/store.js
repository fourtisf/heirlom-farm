/**
 * HEIRLOOM — client state.
 *
 * This is the seam. The prototype kept a global `G` that the simulation wrote
 * to and the renderer read from; the renderer and art engine are ported almost
 * verbatim, so `G` keeps exactly the same shape — but nothing writes to it any
 * more except `hydrate()`, which copies in the server's snapshot.
 *
 * Read it as: the server owns the truth, `G` is a render cache.
 */

/** Mirrors the design tokens in globals.css. */
export const C = {
  soil: '#241B12',
  soilDeep: '#150E08',
  loam: '#3B2A1B',
  parchment: '#E8DCC0',
  ink: '#2B2116',
  verdant: '#3E6B44',
  leaf: '#7FB069',
  leafLight: '#A9D18A',
  brass: '#C9A227',
  brassLite: '#EBC85C',
  glass: '#6E8B7B',
  wine: '#7A2E3B',
  sky: '#8FB6A8',
};

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const now = () => Date.now();

/* Presentation-only randomness. Every roll that matters happens on the server;
   these drive leaf jitter and dust motes. */
export const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const rint = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

export const fmtNum = (n) => {
  n = Math.floor(n);
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  return n.toLocaleString('en-US');
};

export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  if (s >= 60) return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  return s + 's';
};

/**
 * Canvas cannot read a CSS custom property, and next/font emits a hashed family
 * name, so a literal 'Karla' in a font string would silently fall back. These
 * read the resolved stack once and cache it.
 */
let _fontBody = null;
let _fontMono = null;

const readFont = (variable, fallback) => {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${fallback}` : fallback;
};

export const fontBody = () => (_fontBody ??= readFont('--font-body', 'system-ui, sans-serif'));
export const fontMono = () => (_fontMono ??= readFont('--font-mono', 'ui-monospace, monospace'));

/** Deterministic per-plant art variance, keyed off the accession code. */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const G = {
  /* animation clock — the only numbers the client is allowed to own */
  t: 0,
  last: 0,
  dt: 0,
  dayT: 0.28,
  paused: false,

  /* mirrored from the server snapshot */
  playerId: null,
  coins: 0,
  seedToken: 0,
  xp: 0,
  xpInLevel: 0,
  xpForLevel: 1,
  level: 1,
  rep: 0,
  mutagen: 0,
  plotCapacity: 4,
  gardener: 'A. Vale',

  plots: [],
  vault: [],
  herbarium: [],
  produce: {},
  commissions: [],

  /* purely local view state */
  camera: { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 },
  selection: null,
  panel: null,
  hoverPlot: null,
  toasts: [],
  fx: [],
  plate: null,
  discovered: {},
  stats: { harvests: 0, bred: 0, sold: 0, commissions: 0 },
  tutorial: { step: 0, done: false },
  coachTarget: null,
  seenSpecies: { tomato: true },

  /* clock skew between this browser and the server, in ms */
  clockSkew: 0,
  busy: false,
  error: null,
};

/** Fifteen fixed bed slots; the server decides which are unlocked. */
export function initPlots(positions) {
  G.plots = positions.map((p, i) => ({
    i,
    gx: p.gx,
    gy: p.gy,
    strain: null,
    plantedAt: 0,
    ripeAt: 0,
    growSec: 0,
    state: 'empty',
    blighted: false,
  }));
}

export const plotCapacity = () => G.plotCapacity;
export const plotUnlocked = (i) => i < G.plotCapacity;

/** Server time, as best this browser can estimate it. */
export const serverNow = () => Date.now() + G.clockSkew;

/**
 * Copies a `/api/state` snapshot into `G`. Everything derived — score, tier,
 * traits, unit value, grow time — arrives precomputed from the server; the
 * client never recalculates a number that decides what something is worth.
 */
export function hydrate(snapshot) {
  const p = snapshot.player;
  G.playerId = p.id;
  G.coins = p.coins;
  G.seedToken = Number(p.seedBalance);
  G.xp = p.xp;
  G.level = p.level;
  G.xpInLevel = p.xpInLevel;
  G.xpForLevel = p.xpForLevel;
  G.rep = p.rep;
  G.repSlots = p.repSlots;
  G.mutagen = p.mutagen;
  G.plotCapacity = p.plotCapacity;

  G.clockSkew = new Date(snapshot.serverTime).getTime() - Date.now();

  G.vault = snapshot.vault;
  G.herbarium = snapshot.herbarium;
  G.commissions = snapshot.commissions;

  G.produce = {};
  for (const stack of snapshot.produce) {
    G.produce[`${stack.species}:${stack.color}`] = {
      species: stack.species,
      color: stack.color,
      n: stack.qty,
      value: stack.unitValue,
    };
  }

  const byId = new Map(snapshot.vault.concat(snapshot.herbarium).map((s) => [s.id, s]));
  for (const bed of snapshot.beds) {
    const plot = G.plots[bed.index];
    if (!plot) continue;
    const strain = bed.strainId ? byId.get(bed.strainId) ?? null : null;
    plot.strain = strain;
    plot.plantedAt = bed.plantedAt ? new Date(bed.plantedAt).getTime() : 0;
    plot.ripeAt = bed.ripeAt ? new Date(bed.ripeAt).getTime() : 0;
    plot.growSec = plot.ripeAt && plot.plantedAt ? (plot.ripeAt - plot.plantedAt) / 1000 : 0;
    // `blighted` is null until the bed is far enough along to show symptoms.
    plot.blighted = bed.blighted === true;
    plot.state = !bed.strainId ? 'empty' : bed.ripe ? 'ripe' : 'growing';
  }

  // Anything the player has ever held counts as seen, for the market blurbs.
  for (const s of snapshot.vault) G.seenSpecies[s.species] = true;

  G.discovered = {};
  for (const s of snapshot.vault.concat(snapshot.herbarium)) {
    G.discovered[s.tier] = (G.discovered[s.tier] || 0) + 1;
  }
}

/**
 * Growth 0..1 off the server's clock, not the browser's. The bar advancing is
 * cosmetic; whether a bed is actually ripe is the server's call, which is why
 * `/api/harvest` re-checks rather than trusting this.
 */
export function plotProgress(pl) {
  if (pl.state === 'empty' || !pl.ripeAt || !pl.plantedAt) return 0;
  const span = pl.ripeAt - pl.plantedAt;
  if (span <= 0) return 1;
  return clamp((serverNow() - pl.plantedAt) / span, 0, 1);
}

/** Advances ripeness locally between polls, so the UI does not feel dead. */
export function tickPlots() {
  for (const pl of G.plots) {
    if (pl.state === 'growing' && pl.ripeAt && serverNow() >= pl.ripeAt) pl.state = 'ripe';
  }
}
