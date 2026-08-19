/**
 * HEIRLOOM — procedural art engine.
 *
 * Ported from the prototype almost verbatim: this is the game's visual
 * identity, and it draws every plant from its genes with no image assets at
 * all. Do not introduce sprites here.
 *
 * The one change from the prototype is where the genetics come from. The
 * prototype computed `phenotype()` and `yieldCount()` locally; here they are
 * read off the strain view the server sent, so the browser never derives a
 * number that decides what a plant is.
 */

import { COLORS, SPECIES } from '@heirloom/genetics';
import { C, G, TAU, chance, clamp, fontBody, hashStr, lerp, mulberry, pick, rnd } from './store.js';

/** Server-sent, never recomputed. */
const phenotype = (strain) => strain.phenotype;
const yieldCount = (strain) => strain.yieldCount;


const TW = 104, TH = 52;            // iso tile footprint
const iso = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });

function diamond(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x, y + h / 2);
  ctx.lineTo(x - w / 2, y);
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = clamp(Math.round(r + amt * 255), 0, 255);
  g = clamp(Math.round(g + amt * 255), 0, 255);
  b = clamp(Math.round(b + amt * 255), 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- ground ---------------- */
function drawGrassTile(ctx, gx, gy, seedBase, dark = 0) {
  const p = iso(gx, gy);
  const r = mulberry(hashStr(gx + ':' + gy + ':' + seedBase));
  const tone = 0.5 + r() * 0.5;
  const d = dark * 0.26;
  const g1 = shade('#4E7C46', -0.018 + tone * 0.030 - d);
  const g2 = shade('#3D6539', -0.012 + tone * 0.020 - d);
  const grd = ctx.createLinearGradient(p.x, p.y - TH / 2, p.x, p.y + TH / 2);
  grd.addColorStop(0, g1); grd.addColorStop(1, g2);
  diamond(ctx, p.x, p.y, TW, TH);
  ctx.fillStyle = grd; ctx.fill();
  // sparse blade tufts
  const tufts = dark > 0.35 ? 0 : 2 + ((r() * 3) | 0);
  ctx.strokeStyle = withAlpha('#8FC17A', 0.32 * (1 - dark)); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  for (let i = 0; i < tufts; i++) {
    const a = r() * TAU, d = r() * 0.36;
    const bx = p.x + Math.cos(a) * TW * d, by = p.y + Math.sin(a) * TH * d;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + (r() - 0.5) * 5, by - 5, bx + (r() - 0.5) * 8, by - 9);
    ctx.stroke();
  }
}

function drawPathTile(ctx, gx, gy, seedBase, dark = 0) {
  const p = iso(gx, gy);
  const r = mulberry(hashStr('path' + gx + ':' + gy + ':' + seedBase));
  diamond(ctx, p.x, p.y, TW, TH);
  ctx.fillStyle = shade('#9C8B6F', (r() - 0.5) * 0.06 - dark * 0.16);
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU, d = r() * 0.4;
    ctx.beginPath();
    ctx.ellipse(p.x + Math.cos(a) * TW * d, p.y + Math.sin(a) * TH * d, 1.4 + r() * 2.2, 1 + r() * 1.4, 0, 0, TAU);
    ctx.fillStyle = withAlpha(r() > 0.5 ? '#C4B392' : '#7C6C52', 0.5);
    ctx.fill();
  }
}

function drawBed(ctx, gx, gy, wet, hover, locked) {
  const p = iso(gx, gy);
  // recessed shadow
  diamond(ctx, p.x, p.y + 3, TW * 0.9, TH * 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  diamond(ctx, p.x, p.y, TW * 0.84, TH * 0.84);
  const grd = ctx.createLinearGradient(p.x, p.y - TH / 2, p.x, p.y + TH / 2);
  if (locked) { grd.addColorStop(0, '#4A4136'); grd.addColorStop(1, '#332C24'); }
  else if (wet) { grd.addColorStop(0, '#4A331F'); grd.addColorStop(1, '#301F11'); }
  else { grd.addColorStop(0, '#5B4229'); grd.addColorStop(1, '#3A2917'); }
  ctx.fillStyle = grd; ctx.fill();
  // furrows
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 2.2;
  for (let i = -2; i <= 2; i++) {
    const o = i * 11;
    ctx.beginPath();
    ctx.moveTo(p.x - TW / 2 + o, p.y + TH / 2 * (o > 0 ? 0 : 0));
    ctx.lineTo(p.x + o, p.y + TH / 2);
    ctx.moveTo(p.x - TW / 2 + o, p.y);
    ctx.lineTo(p.x + o, p.y - TH / 2 + 2);
    ctx.stroke();
  }
  ctx.restore();
  // inner rim catches light so an empty bed reads as tilled soil, not a pit
  diamond(ctx, p.x, p.y - 1.5, TW * 0.74, TH * 0.74);
  ctx.strokeStyle = 'rgba(255,228,180,0.10)'; ctx.lineWidth = 2; ctx.stroke();
  // brass edging
  diamond(ctx, p.x, p.y, TW * 0.84, TH * 0.84);
  ctx.strokeStyle = locked ? 'rgba(140,130,110,0.45)' : (hover ? withAlpha(C.brassLite, 0.95) : withAlpha(C.brass, 0.42));
  ctx.lineWidth = hover ? 2.4 : 1.4;
  ctx.stroke();
  if (locked) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#A79A82'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(p.x, p.y - 8, 5, Math.PI, 0); ctx.stroke();
    roundRect(ctx, p.x - 7, p.y - 8, 14, 11, 2.5);
    ctx.fillStyle = '#C6B79A'; ctx.fill();
    ctx.restore();
  }
}

/* ---------------- gene-driven plants ----------------
   Every visual property is downstream of a gene:
     Y -> how many fruit, and past the drawable cap, how large
     V -> sway speed and stem slenderness
     H -> stem thickness, leaf count, leaf depth
     E -> shimmer motes and colour saturation
   Pale morphs get a dark rim so Ivory still reads against a bright bed.
------------------------------------------------------ */

const FORM_CAP = { bush: 8, pod: 9, stalk: 4, gourd: 3, bulb: 4 };

/* one leaf, mirrored properly via transform rather than signed lengths */
function drawLeaf(ctx, px, py, len, wid, ang, side, fill, droop = 0.5) {
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(side, 1);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.32, -wid, len * 0.72, -wid * 0.72, len, wid * droop * 0.5);
  ctx.bezierCurveTo(len * 0.70, wid * 0.55, len * 0.34, wid * 0.85, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(24,46,26,0.42)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.55, -wid * 0.12, len * 0.94, wid * droop * 0.35);
  ctx.strokeStyle = 'rgba(36,77,42,0.5)';
  ctx.lineWidth = 0.85;
  ctx.stroke();
  ctx.restore();
}

/* a round fruit with rim, shading and specular so pale colours still read */
function drawBerry(ctx, x, y, rad, col, squash = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.ellipse(0, 0, rad, rad * squash, 0, 0, TAU);
  const g = ctx.createRadialGradient(-rad * 0.38, -rad * 0.44, rad * 0.1, 0, 0, rad * 1.06);
  g.addColorStop(0, shade(col.hex, 0.24));
  g.addColorStop(0.62, col.hex);
  g.addColorStop(1, col.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = withAlpha(col.deep, 0.92);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-rad * 0.34, -rad * 0.42, rad * 0.28, rad * 0.18, -0.5, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.restore();
}

function drawPlant(ctx, x, y, strain, growth, t, opts = {}) {
  const p = phenotype(strain);
  const col = COLORS[p.color];
  const sp = SPECIES[strain.species];
  const R = mulberry(hashStr(strain.id));
  const sA = R(), sB = R(), sC = R();
  const ripe = growth >= 1;
  const g = clamp(growth, 0, 1);
  const ease = 1 - Math.pow(1 - g, 2.2);
  const scale = (0.44 + ease * 0.56) * (opts.scale || 1);

  const stemW = 1.9 + p.H * 0.58;
  const dark = shade('#2C5531', -0.02 + p.H * 0.010);
  const mid = shade('#477C40', -0.01 + p.H * 0.009);
  const lite = shade('#79AA63', 0.015 + p.H * 0.006);
  const sway = Math.sin(t * (0.62 + p.V * 0.12) + sA * 9) * (0.035 + p.V * 0.007);

  const total = ripe ? yieldCount(strain) : 0;
  const cap = FORM_CAP[sp.form];
  const visN = Math.min(total, cap);
  const boost = 1 + Math.max(0, total - cap) * 0.055;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway * 0.28);
  ctx.scale(scale, scale);

  ctx.beginPath();
  ctx.ellipse(0, 1, 19 + p.Y * 1.5, 7 + p.Y * 0.45, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fill();

  /* ---------- bush / pod: layered tiers around a short stem ---------- */
  if (sp.form === 'bush' || sp.form === 'pod') {
    const H = sp.form === 'pod' ? 34 : 42;
    const tiers = 3 + Math.round(p.H * 0.34);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sway * 14, -H * 0.55, sway * 24, -H);
    ctx.strokeStyle = shade('#4B6F35', 0);
    ctx.lineWidth = stemW;
    ctx.lineCap = 'round';
    ctx.stroke();

    for (let i = 0; i < tiers; i++) {
      const f = i / Math.max(tiers - 1, 1);
      const ly = -6 - f * (H - 6);
      const len = (17 + p.H * 2.3) * (1 - f * 0.30);
      const wid = 6.5 + p.H * 0.62;
      const fill = i % 3 === 0 ? lite : i % 3 === 1 ? mid : dark;
      drawLeaf(ctx, sway * 24 * f, ly, len, wid, 0.30 + f * 0.22, -1, fill);
      drawLeaf(ctx, sway * 24 * f, ly, len, wid, 0.30 + f * 0.22, 1, i % 2 ? mid : dark);
    }

    /* fruit hang in small clusters off the upper stem, not in a ring */
    for (let i = 0; i < visN; i++) {
      const clusterI = Math.floor(i / 2);
      const side = clusterI % 2 ? 1 : -1;
      const cy = -16 - clusterI * 9 - (i % 2) * 5;
      const cx = side * (8 + (i % 2) * 7 + clusterI * 1.6) + sway * 18;
      ctx.beginPath();
      ctx.moveTo(sway * 20, cy + 4);
      ctx.quadraticCurveTo(cx * 0.6, cy - 2, cx, cy - 3);
      ctx.strokeStyle = '#4E7A38';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (sp.form === 'pod') {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(side * 0.28 + 0.12);
        ctx.beginPath();
        ctx.moveTo(0, -1);
        ctx.bezierCurveTo(4.4 * boost, 4, 3.2 * boost, 11 * boost, 0.6, 16 * boost);
        ctx.bezierCurveTo(-1.6, 10 * boost, -3.6 * boost, 4, -2.6, -1);
        ctx.closePath();
        const pg = ctx.createLinearGradient(-4, 0, 5, 12);
        pg.addColorStop(0, shade(col.hex, 0.2));
        pg.addColorStop(1, col.deep);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = withAlpha(col.deep, 0.9);
        ctx.lineWidth = 0.95;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-1.4, 0);
        ctx.quadraticCurveTo(0.4, 6, 0.2, 13);
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy - 1, 2.4, Math.PI, 0);
        ctx.strokeStyle = '#3E6B44';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        const rad = (4.6 + p.Y * 0.42) * boost;
        drawBerry(ctx, cx, cy + rad * 0.6, rad, col, 0.94);
        ctx.strokeStyle = '#3E6B44';
        ctx.lineWidth = 1.2;
        for (let k = 0; k < 3; k++) {
          const ka = -1.9 + k * 0.62;
          ctx.beginPath();
          ctx.moveTo(cx, cy + rad * 0.6 - rad * 0.82);
          ctx.lineTo(cx + Math.cos(ka) * rad * 0.72, cy + rad * 0.6 - rad * 0.82 + Math.sin(ka) * rad * 0.5 + rad * 0.4);
          ctx.stroke();
        }
      }
    }
  }

  /* ---------- stalk: one tall cane, arching blades, husked cobs ---------- */
  if (sp.form === 'stalk') {
    const H = 64;
    const nodes = 4 + Math.round(p.H * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sway * 12, -H * 0.55, sway * 30, -H);
    ctx.strokeStyle = '#5E7C36';
    ctx.lineWidth = stemW + 1.1;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-stemW * 0.3, 0);
    ctx.quadraticCurveTo(sway * 12, -H * 0.55, sway * 30 - stemW * 0.3, -H);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    for (let i = 0; i < nodes; i++) {
      const f = i / Math.max(nodes - 1, 1);
      const ly = -8 - f * (H - 8);
      const side = i % 2 ? 1 : -1;
      const len = (30 + p.H * 3.4) * (1 - f * 0.22);
      ctx.save();
      ctx.translate(sway * 30 * f, ly);
      ctx.scale(side, 1);
      ctx.beginPath();
      ctx.moveTo(0, 1.5);
      ctx.bezierCurveTo(len * 0.42, -8 - f * 5, len * 0.8, -4 - f * 4, len, 12 - f * 9);
      ctx.bezierCurveTo(len * 0.72, -0.5 - f * 3, len * 0.4, -1 - f * 2, 0, -1.5);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? mid : dark;
      ctx.fill();
      ctx.strokeStyle = 'rgba(24,46,26,0.36)';
      ctx.lineWidth = 0.85;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.42, -4 - f * 4, len * 0.78, -2 - f * 3, len * 0.96, 10 - f * 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < visN; i++) {
      const side = i % 2 ? 1 : -1;
      const cy = -20 - i * 13;
      const cx = side * 5 + sway * 18;
      const cw = 5.2 * boost, ch = 13 * boost;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(side * 0.30);
      ctx.beginPath();
      ctx.ellipse(0, 0, cw, ch, 0, 0, TAU);
      const cg = ctx.createLinearGradient(-cw, 0, cw, 0);
      cg.addColorStop(0, col.deep);
      cg.addColorStop(0.45, shade(col.hex, 0.16));
      cg.addColorStop(1, col.deep);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = withAlpha(col.deep, 0.9);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, cw, ch, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (let r = -4; r <= 4; r++) {
        for (let k = -3; k <= 3; k++) {
          ctx.beginPath();
          ctx.arc(k * 1.9 + (r % 2) * 0.9, r * 2.9, 0.85, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      // husk
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(d * cw * 0.75, -ch * 0.92);
        ctx.quadraticCurveTo(d * cw * 1.9, 0, d * cw * 0.55, ch * 0.98);
        ctx.quadraticCurveTo(d * cw * 0.9, 0, d * cw * 0.72, -ch * 0.9);
        ctx.closePath();
        ctx.fillStyle = d < 0 ? mid : dark;
        ctx.fill();
      }
      // silk
      ctx.strokeStyle = withAlpha('#D8C071', 0.85);
      ctx.lineWidth = 0.9;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 1.2, -ch * 0.95);
        ctx.quadraticCurveTo(k * 2.4, -ch * 1.3, k * 3.4, -ch * 1.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------- gourd: ground vine, lobed leaves, ribbed fruit ---------- */
  if (sp.form === 'gourd') {
    const runners = 4 + Math.round(p.H * 0.7);
    for (let i = 0; i < runners; i++) {
      const a = (i / runners) * TAU + sA * 5;
      const len = 19 + p.H * 3.1;
      const ex = Math.cos(a) * len, ey = Math.sin(a) * len * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(ex * 0.55, ey * 0.5 - 7, ex, ey);
      ctx.strokeStyle = '#4E7A38';
      ctx.lineWidth = 2.1;
      ctx.stroke();
      // lobed leaf: three overlapping blades
      ctx.save();
      ctx.translate(ex, ey);
      const lf = i % 2 ? mid : dark;
      for (const o of [-0.55, 0, 0.55]) {
        drawLeaf(ctx, 0, 0, 12 + p.H * 1.5, 7.5, a + o, 1, o === 0 ? lf : shade(lf, -0.03), 0.8);
      }
      ctx.restore();
      // tendril
      ctx.beginPath();
      ctx.moveTo(ex * 0.7, ey * 0.7 - 4);
      ctx.quadraticCurveTo(ex * 0.85, ey * 0.7 - 12, ex * 0.98, ey * 0.7 - 7);
      ctx.strokeStyle = withAlpha('#6E9247', 0.8);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    for (let i = 0; i < visN; i++) {
      const a = (i / Math.max(visN, 1)) * TAU + sB * 4 + 0.6;
      const gx2 = Math.cos(a) * 15, gy2 = Math.sin(a) * 8 - 5;
      const rad = (8.5 + p.Y * 1.25) * boost;
      ctx.save();
      ctx.translate(gx2, gy2);
      ctx.beginPath();
      ctx.ellipse(0, rad * 0.72, rad * 1.02, rad * 0.3, 0, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, rad, rad * 0.84, 0, 0, TAU);
      const gg = ctx.createRadialGradient(-rad * 0.32, -rad * 0.4, rad * 0.14, 0, 0, rad * 1.1);
      gg.addColorStop(0, shade(col.hex, 0.22));
      gg.addColorStop(0.6, col.hex);
      gg.addColorStop(1, col.deep);
      ctx.fillStyle = gg;
      ctx.fill();
      // ribs as soft shadow bands rather than outlines
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, rad, rad * 0.84, 0, 0, TAU);
      ctx.clip();
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(k * rad * 0.36, -rad);
        ctx.quadraticCurveTo(k * rad * 0.5, 0, k * rad * 0.36, rad);
        ctx.strokeStyle = withAlpha(col.deep, 0.42);
        ctx.lineWidth = rad * 0.13;
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(0, 0, rad, rad * 0.84, 0, 0, TAU);
      ctx.strokeStyle = withAlpha(col.deep, 0.95);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-rad * 0.36, -rad * 0.4, rad * 0.26, rad * 0.15, -0.5, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -rad * 0.82);
      ctx.lineTo(1.5, -rad * 1.28);
      ctx.strokeStyle = '#6B5A2E';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- bulb: nodding bells, glow kept in check ---------- */
  if (sp.form === 'bulb') {
    const H = 44;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sway * 18, -H * 0.6, sway * 26, -H);
    ctx.strokeStyle = '#3E6B54';
    ctx.lineWidth = stemW;
    ctx.lineCap = 'round';
    ctx.stroke();
    const nl = 3 + Math.round(p.H * 0.5);
    for (let i = 0; i < nl; i++) {
      const f = i / Math.max(nl - 1, 1);
      const side = i % 2 ? 1 : -1;
      drawLeaf(ctx, sway * 18 * f, -8 - f * 28, 12 + p.H * 1.4, 5.5, 0.42, side, i % 2 ? mid : dark, 0.7);
    }
    const nightF = typeof nightAmount === 'function' ? nightAmount() : 0;
    const glowA = (0.06 + p.E * 0.032) * (1 + nightF * 2.4);
    for (let i = 0; i < Math.max(1, visN); i++) {
      const a = (i / Math.max(visN, 1)) * TAU + sC * 6;
      const bx = Math.cos(a) * (i ? 12 : 0) + sway * 22;
      const by = -H + Math.sin(a) * 6 - (i ? 4 : 0);
      const rad = (7 + p.Y * 0.55) * boost;
      ctx.save();
      ctx.translate(bx, by);
      const gr = rad * (1.7 + nightF * 1.1);
      const gl = ctx.createRadialGradient(0, 0, rad * 0.4, 0, 0, gr);
      gl.addColorStop(0, withAlpha(col.hex, glowA));
      gl.addColorStop(1, withAlpha(col.hex, 0));
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -rad * 0.9);
      ctx.lineTo(0, -rad * 1.7);
      ctx.strokeStyle = '#3E6B54';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // five nodding petals, dark-edged so ivory keeps its shape
      for (let k = 0; k < 5; k++) {
        ctx.save();
        ctx.rotate((k / 5) * TAU + 0.3);
        ctx.scale(1, 0.78 + nightF * 0.34);
        ctx.beginPath();
        ctx.moveTo(0, -rad * 0.16);
        ctx.bezierCurveTo(rad * 0.62, -rad * 0.5, rad * 0.42, -rad * 1.16, 0, -rad * 1.3);
        ctx.bezierCurveTo(-rad * 0.42, -rad * 1.16, -rad * 0.62, -rad * 0.5, 0, -rad * 0.16);
        ctx.closePath();
        const pg = ctx.createLinearGradient(0, -rad * 0.2, 0, -rad * 1.3);
        pg.addColorStop(0, col.deep);
        pg.addColorStop(1, shade(col.hex, 0.26));
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = withAlpha(col.deep, 0.9);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.3, 0, TAU);
      ctx.fillStyle = withAlpha('#FFF4D2', 0.95);
      ctx.fill();
      ctx.strokeStyle = withAlpha(col.deep, 0.7);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* essence shimmer: the gene you can see from across the garden */
  if (p.E >= 4) {
    const motes = (p.E - 3) * 3;
    for (let i = 0; i < motes; i++) {
      const ph = t * (0.45 + i * 0.11) + i * 2.1 + sC * 8;
      const mx = Math.cos(ph) * (14 + (i % 3) * 7);
      const my = -14 - ((ph * 8) % 42);
      const al = (0.5 + 0.5 * Math.sin(ph * 2)) * 0.5;
      ctx.beginPath();
      ctx.arc(mx, my, 1.4, 0, TAU);
      ctx.fillStyle = withAlpha(p.color === 'ivory' ? '#FFF6DC' : C.brassLite, al);
      ctx.fill();
    }
  }
  ctx.restore();

  if (ripe && !opts.noBadge) {
    const bob = Math.sin(t * 2.2 + sA * 6) * 2.5;
    const lift = (sp.form === 'stalk' ? 82 : sp.form === 'gourd' ? 36 : sp.form === 'bulb' ? 62 : 58) * scale;
    ctx.save();
    ctx.translate(x, y - lift + bob);
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-5, 2);
    ctx.lineTo(5, 2);
    ctx.closePath();
    ctx.fillStyle = C.brassLite;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -6, 9, 0, TAU);
    ctx.fillStyle = C.brassLite;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,10,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#3A2A0C';
    ctx.font = `700 11px ${fontBody()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✿', 0, -6);
    ctx.restore();
  }
}

function drawSprout(ctx, x, y, t, seed) {
  const R = mulberry(hashStr('sp' + seed));
  const s = R();
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 3.5, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
  const sw = Math.sin(t * 1.6 + s * 8) * 0.1;
  ctx.rotate(sw);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10);
  ctx.strokeStyle = '#5F8C46'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
  for (const d of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, -9);
    ctx.quadraticCurveTo(d * 6, -14, d * 9, -8);
    ctx.quadraticCurveTo(d * 5, -8, 0, -9);
    ctx.fillStyle = d < 0 ? '#7FB069' : '#5E9450'; ctx.fill();
  }
  ctx.restore();
}

/* ---------------- structures ---------------- */
function drawConservatory(ctx, gx, gy, t) {
  const p = iso(gx, gy);
  const W = 168, H = 96, ROOF = 62;
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.ellipse(0, 8, W * 0.62, 30, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
  // stone base
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H + 30); ctx.lineTo(0, -H + 4); ctx.lineTo(W / 2, -H + 30);
  ctx.lineTo(W / 2, 6); ctx.lineTo(0, 32); ctx.lineTo(-W / 2, 6); ctx.closePath();
  ctx.fillStyle = '#6C6152'; ctx.fill();
  // glass walls
  const left = ctx.createLinearGradient(-W / 2, -H, 0, 20);
  left.addColorStop(0, withAlpha('#BFE0D2', 0.55)); left.addColorStop(1, withAlpha('#4E7166', 0.75));
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H + 30); ctx.lineTo(0, -H + 4); ctx.lineTo(0, 20); ctx.lineTo(-W / 2, -6); ctx.closePath();
  ctx.fillStyle = left; ctx.fill();
  const right = ctx.createLinearGradient(0, -H, W / 2, 20);
  right.addColorStop(0, withAlpha('#9FCBBC', 0.5)); right.addColorStop(1, withAlpha('#3E5C53', 0.8));
  ctx.beginPath();
  ctx.moveTo(W / 2, -H + 30); ctx.lineTo(0, -H + 4); ctx.lineTo(0, 20); ctx.lineTo(W / 2, -6); ctx.closePath();
  ctx.fillStyle = right; ctx.fill();
  // brass mullions
  ctx.strokeStyle = withAlpha(C.brass, 0.85); ctx.lineWidth = 2;
  for (let i = 1; i < 5; i++) {
    const f = i / 5;
    ctx.beginPath();
    ctx.moveTo(-W / 2 * (1 - f), lerp(-H + 30, -H + 4, f)); ctx.lineTo(-W / 2 * (1 - f), lerp(-6, 20, f)); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2 * (1 - f), lerp(-H + 30, -H + 4, f)); ctx.lineTo(W / 2 * (1 - f), lerp(-6, 20, f)); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H + 30); ctx.lineTo(0, -H + 4); ctx.lineTo(W / 2, -H + 30);
  ctx.lineTo(W / 2, -6); ctx.lineTo(0, 20); ctx.lineTo(-W / 2, -6); ctx.closePath();
  ctx.strokeStyle = withAlpha(C.brass, 0.95); ctx.lineWidth = 2.6; ctx.stroke();
  // domed roof
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H + 30);
  ctx.quadraticCurveTo(0, -H - ROOF, W / 2, -H + 30);
  ctx.lineTo(0, -H + 4); ctx.closePath();
  const rg = ctx.createLinearGradient(0, -H - ROOF, 0, -H + 30);
  rg.addColorStop(0, withAlpha('#DFF1E8', 0.72)); rg.addColorStop(1, withAlpha('#6E8B7B', 0.68));
  ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = withAlpha(C.brass, 0.9); ctx.lineWidth = 2; ctx.stroke();
  for (let i = 1; i < 6; i++) {
    const f = i / 6, sx = lerp(-W / 2, W / 2, f);
    ctx.beginPath(); ctx.moveTo(sx, -H + 30 - Math.sin(f * Math.PI) * 6);
    ctx.quadraticCurveTo(sx * 0.5, -H - ROOF * 0.7, 0, -H + 4);
    ctx.strokeStyle = withAlpha(C.brass, 0.4); ctx.lineWidth = 1.2; ctx.stroke();
  }
  // finial
  ctx.beginPath(); ctx.arc(0, -H - ROOF + 8, 5, 0, TAU);
  ctx.fillStyle = C.brassLite; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -H - ROOF + 4); ctx.lineTo(0, -H - ROOF - 12);
  ctx.strokeStyle = C.brassLite; ctx.lineWidth = 2.4; ctx.stroke();
  // warm interior glow at night
  const night = 0.12 + nightAmount() * 0.85;
  ctx.beginPath();
  ctx.moveTo(-W / 2, -H + 30); ctx.lineTo(0, -H + 4); ctx.lineTo(W / 2, -H + 30);
  ctx.lineTo(W / 2, -6); ctx.lineTo(0, 20); ctx.lineTo(-W / 2, -6); ctx.closePath();
  ctx.fillStyle = withAlpha('#FFD98A', 0.08 + night * 0.34 + Math.sin(t * 0.8) * 0.012);
  ctx.fill();
  if (night > 0.2) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spill = ctx.createRadialGradient(0, 10, 10, 0, 10, 210);
    spill.addColorStop(0, withAlpha('#FFC86A', 0.30 * night));
    spill.addColorStop(1, withAlpha('#FFC86A', 0));
    ctx.fillStyle = spill;
    ctx.beginPath();
    ctx.ellipse(0, 16, 210, 92, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBench(ctx, gx, gy, t, active) {
  const p = iso(gx, gy);
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.ellipse(0, 6, 52, 20, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  // table
  ctx.beginPath();
  ctx.moveTo(-52, -14); ctx.lineTo(0, -34); ctx.lineTo(52, -14); ctx.lineTo(0, 6); ctx.closePath();
  ctx.fillStyle = '#7A5B38'; ctx.fill();
  ctx.strokeStyle = '#4E3822'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-52, -14); ctx.lineTo(-52, -6); ctx.lineTo(0, 14); ctx.lineTo(0, 6); ctx.closePath();
  ctx.fillStyle = '#5C4128'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(52, -14); ctx.lineTo(52, -6); ctx.lineTo(0, 14); ctx.lineTo(0, 6); ctx.closePath();
  ctx.fillStyle = '#4A3320'; ctx.fill();
  // legs
  ctx.strokeStyle = '#3E2C1B'; ctx.lineWidth = 4;
  for (const d of [[-40, -4], [40, -4], [0, 16]]) {
    ctx.beginPath(); ctx.moveTo(d[0], d[1]); ctx.lineTo(d[0], d[1] + 16); ctx.stroke();
  }
  // brass crossing apparatus
  ctx.save(); ctx.translate(0, -26);
  ctx.strokeStyle = C.brass; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-16, 4); ctx.lineTo(-16, -16); ctx.lineTo(16, -16); ctx.lineTo(16, 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, -26); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -30, 4.5, 0, TAU); ctx.fillStyle = C.brassLite; ctx.fill();
  for (const d of [-16, 16]) {
    ctx.beginPath(); ctx.ellipse(d, 4, 7, 4, 0, 0, TAU);
    ctx.fillStyle = active ? withAlpha(C.brassLite, 0.9) : '#8E7A4A'; ctx.fill();
  }
  if (active) {
    const a = 0.4 + 0.4 * Math.sin(t * 3);
    ctx.beginPath(); ctx.arc(0, -22, 12, 0, TAU);
    ctx.fillStyle = withAlpha(C.brassLite, a * 0.28); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawMarketCart(ctx, gx, gy, t) {
  const p = iso(gx, gy);
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.ellipse(0, 6, 48, 18, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  // body
  ctx.beginPath();
  ctx.moveTo(-44, -18); ctx.lineTo(0, -36); ctx.lineTo(44, -18); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = '#8A6A42'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-44, -18); ctx.lineTo(-44, -4); ctx.lineTo(0, 14); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = '#6B5033'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(44, -18); ctx.lineTo(44, -4); ctx.lineTo(0, 14); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = '#57402A'; ctx.fill();
  // striped awning
  ctx.save(); ctx.translate(0, -56);
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const x0 = -50 + i * 14.3;
    ctx.moveTo(x0, 0); ctx.lineTo(x0 + 14.3, 0);
    ctx.lineTo(x0 + 14.3, 10 + Math.sin(i * 1.4 + t) * 1.5); ctx.lineTo(x0, 10 + Math.sin(i * 1.4 + t + 0.4) * 1.5);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? '#E8DCC0' : '#7A2E3B'; ctx.fill();
  }
  ctx.strokeStyle = withAlpha('#3A2A18', 0.5); ctx.lineWidth = 1;
  ctx.strokeRect(-50, 0, 100, 10);
  ctx.restore();
  ctx.strokeStyle = '#5C4128'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-44, -56); ctx.lineTo(-44, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(44, -56); ctx.lineTo(44, -18); ctx.stroke();
  // crates of produce
  for (let i = 0; i < 3; i++) {
    const cx = -22 + i * 22, cy = -26 - (i % 2) * 4;
    roundRect(ctx, cx - 9, cy - 8, 18, 12, 2);
    ctx.fillStyle = '#9A7A4E'; ctx.fill();
    ctx.strokeStyle = '#5C4128'; ctx.lineWidth = 1; ctx.stroke();
    for (let k = 0; k < 3; k++) {
      ctx.beginPath(); ctx.arc(cx - 5 + k * 5, cy - 9, 3, 0, TAU);
      ctx.fillStyle = [C.wine, '#D99A2B', '#4E9E7A'][(i + k) % 3]; ctx.fill();
    }
  }
  // wheel
  ctx.beginPath(); ctx.arc(-30, 6, 11, 0, TAU);
  ctx.strokeStyle = '#4E3822'; ctx.lineWidth = 3.4; ctx.stroke();
  ctx.beginPath(); ctx.arc(-30, 6, 2.5, 0, TAU); ctx.fillStyle = '#4E3822'; ctx.fill();
  ctx.restore();
}

function drawCommissionPost(ctx, gx, gy, t, pending) {
  const p = iso(gx, gy);
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.ellipse(0, 4, 30, 12, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  ctx.strokeStyle = '#5C4128'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-16, 2); ctx.lineTo(-16, -34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(16, -34); ctx.stroke();
  roundRect(ctx, -30, -66, 60, 36, 3);
  ctx.fillStyle = '#6B5033'; ctx.fill();
  ctx.strokeStyle = '#3E2C1B'; ctx.lineWidth = 2; ctx.stroke();
  // pinned notes
  for (let i = 0; i < Math.min(pending, 3); i++) {
    ctx.save();
    ctx.translate(-18 + i * 18, -50 + (i % 2) * 4);
    ctx.rotate((i - 1) * 0.09 + Math.sin(t * 0.6 + i) * 0.02);
    roundRect(ctx, -8, -11, 16, 21, 1.5);
    ctx.fillStyle = C.parchment; ctx.fill();
    ctx.strokeStyle = 'rgba(70,55,30,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.strokeStyle = 'rgba(70,55,30,0.35)'; ctx.lineWidth = 0.9;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-5, -6 + k * 4); ctx.lineTo(5, -6 + k * 4); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0, -12, 2, 0, TAU); ctx.fillStyle = C.wine; ctx.fill();
    ctx.restore();
  }
  // small roof
  ctx.beginPath(); ctx.moveTo(-36, -66); ctx.lineTo(0, -78); ctx.lineTo(36, -66); ctx.closePath();
  ctx.fillStyle = '#4E3822'; ctx.fill();
  if (pending > 0) {
    const a = 0.55 + 0.45 * Math.sin(t * 2.6);
    ctx.beginPath(); ctx.arc(30, -70, 7, 0, TAU);
    ctx.fillStyle = withAlpha(C.wine, a); ctx.fill();
    ctx.fillStyle = '#F4EAD6'; ctx.font = `700 10px ${fontBody()}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(pending), 30, -70);
  }
  ctx.restore();
}

function drawHedge(ctx, gx, gy, seed) {
  const p = iso(gx, gy);
  const R = mulberry(hashStr('h' + gx + gy + seed));
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.beginPath(); ctx.ellipse(0, 4, 44, 16, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
  // sides
  ctx.beginPath();
  ctx.moveTo(-52, -4); ctx.lineTo(0, 22); ctx.lineTo(0, 8); ctx.lineTo(-52, -18); ctx.closePath();
  ctx.fillStyle = '#27502D'; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(52, -4); ctx.lineTo(0, 22); ctx.lineTo(0, 8); ctx.lineTo(52, -18); ctx.closePath();
  ctx.fillStyle = '#1F4526'; ctx.fill();
  // clipped top face, catching the light
  ctx.beginPath();
  ctx.moveTo(-52, -18); ctx.lineTo(0, -44); ctx.lineTo(52, -18); ctx.lineTo(0, 8); ctx.closePath();
  ctx.fillStyle = '#456F41'; ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = R() * TAU, d = R();
    const bx = Math.cos(a) * 42 * d, by = Math.sin(a) * 19 * d - 17;
    ctx.beginPath(); ctx.ellipse(bx, by, 7 + R() * 6, 5 + R() * 4, R() * 1.2, 0, TAU);
    ctx.fillStyle = ['#4E7C46', '#568349', '#3E6B44'][(R() * 3) | 0]; ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-52, -18); ctx.lineTo(0, -44); ctx.lineTo(52, -18); ctx.lineTo(0, 8); ctx.closePath();
  ctx.strokeStyle = 'rgba(20,40,22,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

function drawTree(ctx, gx, gy, t, seed) {
  const p = iso(gx, gy);
  const R = mulberry(hashStr('t' + seed + gx + gy));
  const s = 0.56 + R() * 0.46;
  const sway = Math.sin(t * 0.55 + R() * 8) * 0.022;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
  ctx.beginPath(); ctx.ellipse(0, 4, 30, 12, 0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-5, 2);
  ctx.quadraticCurveTo(-3, -26, -9, -46); ctx.lineTo(9, -46);
  ctx.quadraticCurveTo(3, -26, 5, 2); ctx.closePath();
  ctx.fillStyle = '#5A4429'; ctx.fill();
  ctx.strokeStyle = '#3E2E1A'; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.translate(0, -46); ctx.rotate(sway);
  const nb = 4 + ((R() * 3) | 0);
  const tall = 0.75 + R() * 0.7;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + R() * 1.4;
    const rr = 15 + R() * 17;
    const bx = Math.cos(a) * (9 + R() * 15);
    const by = -18 * tall + Math.sin(a) * (10 + R() * 12) * tall;
    ctx.beginPath(); ctx.ellipse(bx, by, rr, rr * (0.72 + R() * 0.24), R() * 0.6, 0, TAU);
    ctx.fillStyle = ['#27502D', '#2F5B34', '#3E6B44', '#37613C', '#456F41'][i % 5]; ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(-9, -30 * tall, 13 + R() * 6, 9 + R() * 5, -0.3, 0, TAU);
  ctx.fillStyle = withAlpha('#7FB069', 0.28); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/* ---------------- ambience ---------------- */
const AMB = { flutter: [], motes: [] };
function initAmbience() {
  AMB.flutter.length = 0; AMB.motes.length = 0;
  for (let i = 0; i < 9; i++) AMB.flutter.push({ x: rnd(-400, 500), y: rnd(-120, 340), a: rnd(TAU), sp: rnd(14, 30), ph: rnd(TAU), kind: chance(0.5) ? 'bee' : 'fly', hue: pick(['#E8DCC0', '#D99A2B', '#7D5BA6', '#F0E6CE']) });
  for (let i = 0; i < 34; i++) AMB.motes.push({ x: rnd(-620, 720), y: rnd(-260, 420), s: rnd(0.6, 2.1), sp: rnd(3, 11), ph: rnd(TAU) });
}
function drawAmbience(ctx, t, dt) {
  for (const m of AMB.motes) {
    m.y -= m.sp * dt; m.x += Math.sin(t * 0.5 + m.ph) * 6 * dt;
    if (m.y < -300) { m.y = 440; m.x = rnd(-620, 720); }
    ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, TAU);
    ctx.fillStyle = withAlpha('#F4E9C8', 0.14 + 0.14 * Math.sin(t + m.ph));
    ctx.fill();
  }
  for (const f of AMB.flutter) {
    f.a += Math.sin(t * 1.4 + f.ph) * 0.9 * dt;
    f.x += Math.cos(f.a) * f.sp * dt; f.y += Math.sin(f.a) * f.sp * 0.5 * dt;
    if (f.x < -560 || f.x > 660) f.a = Math.PI - f.a;
    if (f.y < -240 || f.y > 400) f.a = -f.a;
    const w = Math.abs(Math.sin(t * 16 + f.ph));
    ctx.save(); ctx.translate(f.x, f.y);
    if (f.kind === 'bee') {
      ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 2.2, f.a, 0, TAU);
      ctx.fillStyle = '#D9A62B'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(-1, 0, 1.2, 2.2, f.a, 0, TAU);
      ctx.fillStyle = '#2A2118'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -2, 3.4 * w + 1, 1.4, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
    } else {
      ctx.rotate(f.a * 0.2);
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(d * (2 + w * 2.4), -1, 3.6, 2.4 * (0.35 + w * 0.65), d * 0.5, 0, TAU);
        ctx.fillStyle = withAlpha(f.hue, 0.9); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(0, 0, 1, 3, 0, 0, TAU);
      ctx.fillStyle = '#3A2C1A'; ctx.fill();
    }
    ctx.restore();
  }
}

/* day-night tint over the whole world */
function dayTint(dayT) {
  const d = dayT % 1;
  if (d < 0.08) return { c: 'rgba(255,170,104,0.28)', v: 0.34 };   // dawn
  if (d < 0.42) return { c: 'rgba(255,240,196,0.05)', v: 0.05 };   // day
  if (d < 0.55) return { c: 'rgba(255,142,66,0.26)', v: 0.20 };    // golden
  if (d < 0.66) return { c: 'rgba(96,74,156,0.38)', v: 0.42 };     // dusk
  return { c: 'rgba(26,44,108,0.52)', v: 0.60 };                    // night
}
/* 0 at midday, 1 deep in the night — used for lamps, glow and bloom */
function nightAmount() {
  const d = G.dayT % 1;
  if (d < 0.08) return 1 - d / 0.08 * 0.65;
  if (d < 0.45) return 0;
  if (d < 0.58) return (d - 0.45) / 0.13 * 0.5;
  if (d < 0.70) return 0.5 + (d - 0.58) / 0.12 * 0.5;
  return 1;
}

export {
  TW,
  TH,
  iso,
  diamond,
  roundRect,
  shade,
  withAlpha,
  drawGrassTile,
  drawPathTile,
  drawBed,
  drawLeaf,
  drawBerry,
  drawPlant,
  drawSprout,
  drawConservatory,
  drawBench,
  drawMarketCart,
  drawCommissionPost,
  drawHedge,
  drawTree,
  initAmbience,
  drawAmbience,
  dayTint,
  nightAmount,
  FORM_CAP,
};
