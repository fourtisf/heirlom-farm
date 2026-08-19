/**
 * HEIRLOOM — world layout, camera, renderer, input.
 *
 * Ported from the prototype with its structure intact; only the state reads
 * changed. The prototype's `G` was written by a local simulation, so this file
 * kept its own plot bookkeeping and drove a `tickWorld`. Here `G` is a render
 * cache filled by `/api/state`, plot geometry lives in the store, and the
 * things a click used to do directly are dispatched through `hooks` — which
 * the UI layer fills in — so this module never imports the API and never
 * decides an outcome.
 */

import {
  C,
  G,
  TAU,
  clamp,
  fontBody,
  fontMono,
  initPlots,
  lerp,
  mulberry,
  plotProgress,
  plotUnlocked,
  rnd,
  tickPlots,
} from './store.js';
import {
  TH,
  TW,
  dayTint,
  diamond,
  drawAmbience,
  drawBed,
  drawBench,
  drawCommissionPost,
  drawConservatory,
  drawGrassTile,
  drawHedge,
  drawMarketCart,
  drawPathTile,
  drawPlant,
  drawSprout,
  drawTree,
  initAmbience,
  iso,
  withAlpha,
} from './art.js';
import { Audio_ } from './audio.js';

/**
 * Filled in by the UI layer at boot. Keeping them indirect is what lets the
 * renderer stay ignorant of the API: it reports that a bed was clicked, it does
 * not decide what planting means.
 */
export const hooks = {
  onPlotClick: () => {},
  onStructureClick: () => {},
  /** Dismisses the topmost open overlay, whatever that currently is. */
  dismiss: () => {},
  harvestAll: () => {},
};

let cv, ctx, DPR = 1, VW = 0, VH = 0;

const WORLD_SEED = 20260818;

/* plot grid: three beds deep, five across */
const PLOT_POS = [];
for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) PLOT_POS.push({ gx: 3.15 + col * 1.24, gy: 4.35 + row * 1.24 });

const STRUCT = {
  conservatory: { gx: 2.5, gy: 2.6 },
  bench:        { gx: 8.5, gy: 3.4 },
  cart:         { gx: 2.2, gy: 7.6 },
  post:         { gx: 8.4, gy: 7.9 },
};

/* The estate is a walled garden: a hedge ring closes the composition, and a
   dense treeline beyond it means the ground never reads as a floating island. */
const EST = { x0: 1.0, x1: 9.9, y0: 1.5, y1: 9.4 };
const DECOR = [];
(function buildDecor() {
  const R = mulberry(WORLD_SEED);
  const gate = (gx, gy) =>
    (Math.abs(gx - 2.2) < 0.8 && (gy < EST.y0 + 0.4 || gy > EST.y1 - 0.4)) ||
    (Math.abs(gy - 3.4) < 0.8 && (gx < EST.x0 + 0.4 || gx > EST.x1 - 0.4));
  for (let g = EST.x0; g <= EST.x1 + 0.01; g += 0.82) {
    for (const [gx, gy] of [[g, EST.y0], [g, EST.y1], [EST.x0, g], [EST.x1, g]]) {
      if (gate(gx, gy)) continue;
      DECOR.push({ type: 'hedge', gx, gy, seed: (R() * 1e6) | 0 });
    }
  }
  /* A single loose ring of trees frames the garden. Everything further out is
     handled by darkening the ground, which is cheaper and reads as canopy. */
  const pad = 3.4;
  for (let g = EST.x0 - pad; g <= EST.x1 + pad + 0.01; g += 3.4) {
    for (const [gx, gy] of [[g, EST.y0 - pad], [g, EST.y1 + pad], [EST.x0 - pad, g], [EST.x1 + pad, g]]) {
      DECOR.push({ type: 'tree', gx: gx + (R() - 0.5) * 1.1, gy: gy + (R() - 0.5) * 1.1, seed: (R() * 1e6) | 0 });
    }
  }
  for (let i = 0; i < 9; i++) {
    const side = (R() * 4) | 0;
    const along = R() * (EST.x1 - EST.x0 + 9) + EST.x0 - 4.5;
    const out = pad + 2.2 + R() * 5.5;
    const spot = [[along, EST.y0 - out], [along, EST.y1 + out], [EST.x0 - out, along], [EST.x1 + out, along]][side];
    DECOR.push({ type: 'tree', gx: spot[0], gy: spot[1], seed: (R() * 1e6) | 0 });
  }
})();

const GROUND = [];
(function buildGround() {
  for (let gx = -12; gx <= 22; gx++) {
    for (let gy = -12; gy <= 22; gy++) {
      const onPath =
        (Math.abs(gy - 3.4) < 0.55 && gx >= 0 && gx <= 11) ||
        (Math.abs(gx - 2.2) < 0.55 && gy >= 0 && gy <= 11) ||
        (Math.abs(gy - 8.1) < 0.55 && gx >= 2 && gx <= 9) ||
        (Math.abs(gx - 8.4) < 0.55 && gy >= 3 && gy <= 9);
      const outX = Math.max(0, EST.x0 - gx, gx - EST.x1);
      const outY = Math.max(0, EST.y0 - gy, gy - EST.y1);
      const out = Math.hypot(outX, outY);
      GROUND.push({ gx, gy, path: onPath && out < 0.9, dark: clamp(out / 3.2, 0, 1) });
    }
  }
})();

/* ---------------- camera ---------------- */
function screenToWorld(sx, sy) {
  const c = G.camera;
  return { x: (sx - VW / 2) / c.z + c.x, y: (sy - VH / 2) / c.z + c.y };
}
function centerOn(gx, gy, z) {
  const p = iso(gx, gy);
  G.camera.tx = p.x; G.camera.ty = p.y;
  if (z) G.camera.tz = z;
}

function pickPlot(sx, sy) {
  const w = screenToWorld(sx, sy);
  let best = null, bestD = 1e9;
  for (const pl of G.plots) {
    const p = iso(pl.gx, pl.gy);
    const dx = (w.x - p.x) / (TW * 0.46), dy = (w.y - p.y) / (TH * 0.46);
    const d = dx * dx + dy * dy;
    if (d < 1 && d < bestD) { bestD = d; best = pl; }
  }
  return best;
}
function pickStructure(sx, sy) {
  const w = screenToWorld(sx, sy);
  const hits = [
    { k: 'bench', p: iso(STRUCT.bench.gx, STRUCT.bench.gy), rx: 60, ry: 46, oy: -20 },
    { k: 'cart', p: iso(STRUCT.cart.gx, STRUCT.cart.gy), rx: 56, ry: 50, oy: -26 },
    { k: 'post', p: iso(STRUCT.post.gx, STRUCT.post.gy), rx: 42, ry: 46, oy: -34 },
    { k: 'conservatory', p: iso(STRUCT.conservatory.gx, STRUCT.conservatory.gy), rx: 92, ry: 80, oy: -50 },
  ];
  for (const h of hits) {
    const dx = (w.x - h.p.x) / h.rx, dy = (w.y - h.p.y - h.oy) / h.ry;
    if (dx * dx + dy * dy < 1) return h.k;
  }
  return null;
}

/* ---------------- canvas ---------------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  VW = r.width; VH = r.height;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------------- render ---------------- */
function render(t, dt) {
  const c = G.camera;
  c.x = lerp(c.x, c.tx, 1 - Math.pow(0.001, dt));
  c.y = lerp(c.y, c.ty, 1 - Math.pow(0.001, dt));
  c.z = lerp(c.z, c.tz, 1 - Math.pow(0.002, dt));

  // deep-woodland backdrop; the estate is always inland, never on an island edge
  const tint = dayTint(G.dayT);
  const nightF = clamp((G.dayT - 0.55) / 0.2, 0, 1);
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, nightF > 0.4 ? '#101A16' : '#1E3220');
  bg.addColorStop(0.55, nightF > 0.4 ? '#14201A' : '#26402A');
  bg.addColorStop(1, nightF > 0.4 ? '#0C1410' : '#1B2C1D');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, VW, VH);

  ctx.save();
  ctx.translate(VW / 2, VH / 2);
  ctx.scale(c.z, c.z);
  ctx.translate(-c.x, -c.y);

  // ground
  for (const g of GROUND) {
    const p = iso(g.gx, g.gy);
    const sx = (p.x - c.x) * c.z + VW / 2, sy = (p.y - c.y) * c.z + VH / 2;
    if (sx < -TW * c.z || sx > VW + TW * c.z || sy < -TH * 3 * c.z || sy > VH + TH * 4 * c.z) continue;
    if (g.path) drawPathTile(ctx, g.gx, g.gy, WORLD_SEED);
    else drawGrassTile(ctx, g.gx, g.gy, WORLD_SEED, g.dark);
  }

  // beds sit flat, drawn before anything standing
  for (const pl of G.plots) {
    const unlocked = plotUnlocked(pl.i);
    drawBed(ctx, pl.gx, pl.gy, pl.state !== 'empty', G.hoverPlot === pl.i && unlocked, !unlocked);
  }

  // y-sorted standing entities
  const ents = [];
  ents.push({ d: STRUCT.conservatory.gx + STRUCT.conservatory.gy, fn: () => drawConservatory(ctx, STRUCT.conservatory.gx, STRUCT.conservatory.gy, t) });
  ents.push({ d: STRUCT.bench.gx + STRUCT.bench.gy, fn: () => drawBench(ctx, STRUCT.bench.gx, STRUCT.bench.gy, t, G.selection && G.selection.length === 2) });
  ents.push({ d: STRUCT.cart.gx + STRUCT.cart.gy, fn: () => drawMarketCart(ctx, STRUCT.cart.gx, STRUCT.cart.gy, t) });
  ents.push({ d: STRUCT.post.gx + STRUCT.post.gy, fn: () => drawCommissionPost(ctx, STRUCT.post.gx, STRUCT.post.gy, t, G.commissions.length) });
  for (const d of DECOR) {
    ents.push({
      d: d.gx + d.gy,
      fn: d.type === 'tree'
        ? () => drawTree(ctx, d.gx, d.gy, t, d.seed)
        : () => drawHedge(ctx, d.gx, d.gy, d.seed),
    });
  }
  for (const pl of G.plots) {
    if (pl.state === 'empty' || !plotUnlocked(pl.i)) continue;
    const prog = plotProgress(pl);
    const p = iso(pl.gx, pl.gy);
    ents.push({
      d: pl.gx + pl.gy + 0.01,
      fn: () => {
        if (prog < 0.16) drawSprout(ctx, p.x, p.y, t, pl.strain.id);
        else drawPlant(ctx, p.x, p.y, pl.strain, prog < 1 ? 0.2 + prog * 0.8 : 1, t);
        if (pl.blighted) {
          ctx.save(); ctx.translate(p.x, p.y - 34);
          ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU);
          ctx.fillStyle = withAlpha('#6B4B2A', 0.9); ctx.fill();
          ctx.fillStyle = '#E8DCC0'; ctx.font = `700 11px ${fontBody()}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', 0, 0); ctx.restore();
        }
      },
    });
  }
  ents.sort((a, b) => a.d - b.d);
  for (const e of ents) e.fn();

  // growth rings on beds still ripening
  for (const pl of G.plots) {
    if (pl.state !== 'growing') continue;
    const prog = plotProgress(pl);
    const p = iso(pl.gx, pl.gy);
    ctx.save();
    ctx.translate(p.x, p.y + 18);
    ctx.beginPath(); ctx.roundRect(-24, -4, 48, 7, 3.5);
    ctx.fillStyle = 'rgba(10,8,4,0.55)'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(-23, -3, 46 * prog, 5, 2.5);
    ctx.fillStyle = withAlpha(C.brassLite, 0.92); ctx.fill();
    ctx.restore();
  }

  // tutorial pointer, drawn in world space so it tracks the bed under the camera
  if (G.coachTarget) {
    const p = iso(G.coachTarget.gx, G.coachTarget.gy);
    const ph = (t * 0.8) % 1;
    ctx.save();
    diamond(ctx, p.x, p.y, TW * 0.9, TH * 0.9);
    ctx.fillStyle = withAlpha(C.brassLite, 0.13 + 0.06 * Math.sin(t * 3));
    ctx.fill();
    for (let k = 0; k < 2; k++) {
      const f = (ph + k * 0.5) % 1;
      diamond(ctx, p.x, p.y, TW * (0.86 + f * 0.5), TH * (0.86 + f * 0.5));
      ctx.strokeStyle = withAlpha(C.brassLite, (1 - f) * 0.9);
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }
    const bob = Math.sin(t * 3) * 5;
    ctx.translate(p.x, p.y - 74 + bob);
    const glow = ctx.createRadialGradient(0, 6, 2, 0, 6, 30);
    glow.addColorStop(0, withAlpha(C.brassLite, 0.45));
    glow.addColorStop(1, withAlpha(C.brassLite, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 6, 30, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 22); ctx.lineTo(-13, 0); ctx.lineTo(-5.5, 0);
    ctx.lineTo(-5.5, -16); ctx.lineTo(5.5, -16); ctx.lineTo(5.5, 0);
    ctx.lineTo(13, 0); ctx.closePath();
    ctx.fillStyle = C.brassLite; ctx.fill();
    ctx.strokeStyle = 'rgba(58,38,8,.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }

  drawAmbience(ctx, t, dt);

  // world-space fx
  for (const f of G.fx) {
    if (f.space !== 'world') continue;
    ctx.save(); ctx.globalAlpha = f.a;
    if (f.kind === 'float') {
      ctx.fillStyle = f.color; ctx.font = `700 ${f.size}px ${fontMono()}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x, f.y);
    } else if (f.kind === 'spark') {
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size, 0, TAU);
      ctx.fillStyle = f.color; ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();

  // atmosphere
  ctx.fillStyle = tint.c; ctx.fillRect(0, 0, VW, VH);
  const vg = ctx.createRadialGradient(VW / 2, VH * 0.44, Math.min(VW, VH) * 0.32, VW / 2, VH * 0.5, Math.max(VW, VH) * 0.82);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(8,10,6,${0.34 + tint.v * 0.5})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);

}

/* ---------------- fx helpers ---------------- */
function floatText(gx, gy, text, color, size = 15) {
  const p = iso(gx, gy);
  G.fx.push({ space: 'world', kind: 'float', x: p.x, y: p.y - 40, vy: -34, a: 1, text, color, size, life: 1.5 });
}
function burst(gx, gy, color, n = 14) {
  const p = iso(gx, gy);
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU), s = rnd(24, 90);
    G.fx.push({
      space: 'world', kind: 'spark', x: p.x, y: p.y - 18,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - 40,
      a: 1, size: rnd(1.4, 3.4), color, life: rnd(0.5, 1.1), grav: 120,
    });
  }
}
function stepFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i];
    f.life -= dt;
    if (f.life <= 0) { G.fx.splice(i, 1); continue; }
    f.a = clamp(f.life * 1.4, 0, 1);
    if (f.kind === 'float') { f.y += f.vy * dt; f.vy *= 0.94; }
    else { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.grav || 0) * dt; }
  }
}

/* ---------------- input ---------------- */
function bindInput() {
  let dragging = false, moved = false, lx = 0, ly = 0, pinch = 0, pinchZ = 1;
  const pts = new Map();

  const down = e => {
    Audio_.init();
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y); pinchZ = G.camera.tz;
    }
  };
  const move = e => {
    const r = cv.getBoundingClientRect();
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) G.camera.tz = clamp(pinchZ * (d / pinch), 0.48, 1.9);
      moved = true; return;
    }
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      G.camera.tx -= dx / G.camera.z; G.camera.ty -= dy / G.camera.z;
      G.camera.x -= dx / G.camera.z; G.camera.y -= dy / G.camera.z;
      lx = e.clientX; ly = e.clientY;
    }
    const pl = pickPlot(e.clientX - r.left, e.clientY - r.top);
    G.hoverPlot = pl ? pl.i : null;
    cv.style.cursor = pl || pickStructure(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : 'grab';
  };
  const up = e => {
    const r = cv.getBoundingClientRect();
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (dragging && !moved) {
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const st = pickStructure(sx, sy);
      const pl = pickPlot(sx, sy);
      if (pl) hooks.onPlotClick(pl);
      else if (st) hooks.onStructureClick(st);
    }
    if (pts.size === 0) dragging = false;
  };
  const wheel = e => {
    e.preventDefault();
    G.camera.tz = clamp(G.camera.tz * (e.deltaY > 0 ? 0.9 : 1.11), 0.48, 1.9);
  };
  const key = e => {
    if (e.key === 'Escape') hooks.dismiss();
    if (e.key === 'h' || e.key === 'H') hooks.harvestAll();
  };

  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', key);
  window.addEventListener('resize', resize);

  /* Returned rather than left dangling: React mounts a component twice in
     development, and a second set of pointer listeners would double every
     drag and every click. */
  return () => {
    cv.removeEventListener('pointerdown', down);
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', up);
    cv.removeEventListener('pointercancel', up);
    cv.removeEventListener('wheel', wheel);
    window.removeEventListener('keydown', key);
    window.removeEventListener('resize', resize);
  };
}

/* ---------------- loop ---------------- */
let running = false;

function loop(ts) {
  if (!running) return;
  const dt = Math.min(0.05, (ts - G.last) / 1000 || 0);
  G.last = ts; G.t += dt;
  if (!G.paused) {
    /* A 240-second cosmetic cycle. It has no gameplay effect beyond Moonflower
       bloom intensity, so the client is allowed to own it. */
    G.dayT = (G.dayT + dt / 240) % 1;
    tickPlots();
  }
  stepFx(dt);
  render(G.t, dt);
  requestAnimationFrame(loop);
}

/** Current canvas size in CSS pixels. The tutorial places its spotlight with it. */
export const viewport = () => ({ w: VW, h: VH });

/** Boots the renderer against a mounted canvas. Returns a teardown function. */
export function mountRenderer(canvas) {
  cv = canvas;
  ctx = cv.getContext('2d');
  initPlots(PLOT_POS);
  initAmbience();
  resize();
  centerOn(5.6, 6.2, 0.86);
  G.camera.x = G.camera.tx;
  G.camera.y = G.camera.ty;
  G.camera.z = G.camera.tz;
  const teardown = bindInput();
  running = true;
  const raf = requestAnimationFrame(loop);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    teardown();
  };
}

export {
  PLOT_POS,
  STRUCT,
  WORLD_SEED,
  centerOn,
  floatText,
  burst,
  iso as isoProject,
  pickPlot,
  pickStructure,
  resize,
  screenToWorld,
};
