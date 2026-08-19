/**
 * HEIRLOOM — actions.
 *
 * This replaces Part E of the prototype wholesale. Every function there was
 * local simulation: it rolled dice, moved coins, and mutated `G` directly. Here
 * each one is a single API call, and the only thing that comes back into `G` is
 * the server's snapshot.
 *
 * The pattern throughout is: call, hydrate, then play the feedback. The
 * celebration follows the server's answer — it never runs ahead of it, because
 * the outcome is not ours to predict.
 */

import { COLORS, PLOT_UNLOCK, SPECIES, SPECIES_ORDER } from '@heirloom/genetics';
import * as api from './api';
import { G, hydrate, plotCapacity } from './store.js';
import { Audio_ } from './audio.js';
import { withAlpha } from './art.js';
import { burst, floatText } from './world.js';

/**
 * Filled in by ui.js at boot, for the same reason `world.hooks` exists: actions
 * must be callable from the renderer without dragging the whole DOM layer into
 * a circular import.
 */
export const ui = {
  toast: () => {},
  updateHUD: () => {},
  renderPanel: () => {},
  updateTutorial: () => {},
  showPlate: () => {},
  closePlate: () => {},
  levelBanner: () => {},
};

/** Serialises requests: the server rejects a double-submit, we avoid sending one. */
let inFlight = null;

function refresh(snapshot) {
  const beforeLevel = G.level;
  hydrate(snapshot);
  ui.updateHUD();
  ui.updateTutorial();
  if (G.panel) ui.renderPanel();
  if (G.level > beforeLevel) onLevelUp(beforeLevel, G.level);
}

/**
 * Wraps every call so a rejection surfaces as a toast rather than a silent
 * no-op. The server's message is shown verbatim — it is written for players.
 */
async function run(fn) {
  if (inFlight) return null;
  G.busy = true;
  inFlight = fn();
  try {
    return await inFlight;
  } catch (err) {
    Audio_.err();
    ui.toast(err?.message ?? 'That did not work.', 'warn');
    // A rejection usually means our snapshot is stale — resync before the next.
    if (err?.status === 409 || err?.status === 400) {
      try {
        refresh(await api.fetchState());
      } catch {
        /* offline; the next successful call will resync */
      }
    }
    return null;
  } finally {
    inFlight = null;
    G.busy = false;
  }
}

/* ---------------- planting and harvest ---------------- */

export async function plantStrain(pl, strain) {
  if (pl.state !== 'empty') return;
  await run(async () => {
    const state = await api.plant(pl.i, strain.id);
    Audio_.plant();
    burst(pl.gx, pl.gy, withAlpha('#7FB069', 0.9), 8);
    refresh(state);
  });
}

export async function harvest(pl) {
  if (pl.state !== 'ripe') return;
  const strain = pl.strain;
  await run(async () => {
    const res = await api.harvest(pl.i);
    const hex = COLORS[res.color]?.hex ?? '#E8DCC0';

    floatText(pl.gx, pl.gy, `+${res.units} ✿`, hex, 17);
    setTimeout(() => floatText(pl.gx, pl.gy, `+${res.copies} seed`, '#E8DCC0', 13), 180);
    burst(pl.gx, pl.gy, hex, 16);
    Audio_.harvest();
    if (res.blighted) {
      ui.toast(`${strain?.name ?? 'That bed'} came up blighted — a reduced crop.`, 'warn');
    }
    G.stats.harvests++;
    refresh(res.state);
  });
}

/**
 * Sequential on purpose. The prototype staggered these for the animation; here
 * they must also not race each other through the rate limiter.
 */
export async function harvestAll() {
  const ripe = G.plots.filter((p) => p.state === 'ripe');
  for (const pl of ripe) {
    await harvest(pl);
    await new Promise((r) => setTimeout(r, 90));
  }
}

/* ---------------- market ---------------- */

export async function sellStack(st) {
  await run(async () => {
    const res = await api.sell(st.species, st.color, st.n);
    Audio_.coin();
    ui.toast(`Sold ${res.qty} × ${SPECIES[st.species].name} for ${res.coins} coins.`, 'good');
    G.stats.sold += res.qty;
    refresh(res.state);
  });
}

export async function sellAll(stacks) {
  for (const st of stacks) await sellStack(st);
}

export async function buySeed(key) {
  await run(async () => {
    const res = await api.buySeed(key);
    Audio_.coin();
    ui.toast(`${SPECIES[key].name} seed added to the vault.`, 'good');
    refresh(res.state);
  });
}

export async function buyMutagen() {
  await run(async () => {
    const state = await api.buyMutagen();
    Audio_.coin();
    refresh(state);
    ui.toast(`Mutagen added. You hold ${G.mutagen}.`, 'good');
  });
}

/* ---------------- breeding ---------------- */

/**
 * The one call where the response is the whole point. There is no preview and
 * no re-roll: the child in the response is already committed, and the plate
 * just reveals what the server rolled.
 */
export async function doBreed() {
  const sel = G.selection ?? [];
  if (sel.length !== 2) return;
  const useMutagen = document.querySelector('#useMutagen')?.checked ?? false;

  await run(async () => {
    const res = await api.breed(sel[0].id, sel[1].id, useMutagen);
    G.selection = null;
    G.stats.bred++;
    refresh(res.state);

    const child = res.child;
    Audio_.breed();
    if (child.tier === 'legendary' || child.tier === 'prized') Audio_.rare();
    ui.showPlate(child, { mode: 'new' });
  });
}

/* ---------------- herbarium ---------------- */

export async function pressSpecimen(strain, name) {
  await run(async () => {
    const res = await api.nameStrain(strain.id, name);
    Audio_.coin();
    ui.toast(`${res.strain.name} pressed into the herbarium.`, 'good');
    ui.closePlate();
    refresh(res.state);
  });
}

/* ---------------- commissions ---------------- */

export async function fulfilCommission(c, strain) {
  if (!strain) return;
  await run(async () => {
    const res = await api.fulfilCommission(c.id, strain.id);
    Audio_.rare();
    const seed = Number(res.seed);
    ui.toast(
      `${res.collector} paid ${res.coins} coins${seed ? ` and ${seed.toFixed(2)} $SEED` : ''}.`,
      'good',
    );
    G.stats.commissions++;
    refresh(res.state);
  });
}

export async function declineCommission(c) {
  await run(async () => {
    const state = await api.declineCommission(c.id);
    Audio_.ui();
    refresh(state);
  });
}

/* ---------------- progression feedback ---------------- */

function onLevelUp(from, to) {
  Audio_.rare();
  const before = PLOT_UNLOCK[Math.min(from, 12)] ?? 15;
  const after = plotCapacity();
  const newSpecies = SPECIES_ORDER.filter((k) => SPECIES[k].lvl > from && SPECIES[k].lvl <= to);

  let msg = `Level ${to}.`;
  if (after > before) msg += ` ${after - before} more bed${after - before > 1 ? 's' : ''} cleared.`;
  if (newSpecies.length) {
    msg += ` ${newSpecies.map((k) => SPECIES[k].name).join(' and ')} now sold at the cart.`;
  }
  ui.toast(msg, 'good');
  ui.levelBanner(to);
}

/* ---------------- polling ---------------- */

/**
 * The client cannot know when a bed ripens on the server's clock, and it must
 * not guess. It advances the growth bar locally for feel, and reconciles here.
 * Slow on purpose: the state is not changing under the player except through
 * their own actions.
 */
export function startPolling(intervalMs = 20_000) {
  let stopped = false;
  const tick = async () => {
    if (stopped || document.hidden || inFlight) return;
    try {
      refresh(await api.fetchState());
    } catch {
      /* transient; the next tick tries again */
    }
  };
  const handle = setInterval(tick, intervalMs);
  const onVisible = () => {
    if (!document.hidden) void tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearInterval(handle);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export const actions = {
  plantStrain,
  harvest,
  harvestAll,
  sellStack,
  sellAll,
  buySeed,
  buyMutagen,
  doBreed,
  pressSpecimen,
  fulfilCommission,
  declineCommission,
  startPolling,
  ui,
};
