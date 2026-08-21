/**
 * HEIRLOM — actions.
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

import { COLORS, MILESTONES, PLOT_UNLOCK, SPECIES, SPECIES_ORDER } from '@heirlom/genetics';
import * as api from './api';
import { G, hydrate, plotCapacity } from './store.js';
import { hasSeen, markSeen, primerById, unlocksFor } from './primers.js';
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

function announceMilestones(keys) {
  if (!keys?.length) return;
  for (const key of keys) {
    const def = MILESTONES.find((m) => m.key === key);
    if (def) ui.toast(`Recorded: ${def.name}. ${def.blurb}`, 'good');
  }
  Audio_.rare();
}

function refresh(snapshot) {
  const beforeLevel = G.level;
  hydrate(snapshot);
  // Covers a returning player who levelled past an unlock in a previous session.
  if (beforeLevel === 1 && G.level > 1) announceUnlocks(G.level);
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
    if (res.severe) {
      ui.toast(
        `${res.strainName ?? 'That planting'} was lost to blight. No crop, and no seed returned.`,
        'warn',
      );
      Audio_.err();
      /* The first time this happens, say what could have prevented it. */
      if (!hasSeen('blight')) {
        markSeen('blight');
        const primer = primerById('blight');
        setTimeout(() => ui.toast(primer.body.replace(/<[^>]+>/g, ''), 'warn'), 2800);
      }
    } else if (res.blighted) {
      ui.toast(`${strain?.name ?? 'That bed'} came up blighted — a reduced crop.`, 'warn');
    }
    announceMilestones(res.earned);
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

/**
 * Sows every empty bed with the best seed on hand.
 *
 * A two-minute playtest logged thirty-six separate plant actions, nearly all of
 * them the same decision — "put my best seed in the next hole". This does that
 * in one press. Planting a *particular* strain in a *particular* bed is still
 * there for when it matters; this is for when it does not.
 *
 * Sequential rather than parallel: the beds share one seed supply, and firing
 * them at once would race each other through it.
 */
export async function plantAll() {
  const open = G.plots.filter((p) => p.i < G.plotCapacity && p.state === 'empty');
  if (!open.length) return;

  let sown = 0;
  for (const bed of open) {
    const seed = G.vault.filter((s) => s.qty >= 1).sort((a, b) => b.score - a.score)[0];
    if (!seed) {
      if (sown === 0) {
        Audio_.err();
        ui.toast('No seed left. A harvest returns seed, or buy nursery stock at the cart.', 'warn');
      }
      break;
    }
    try {
      const state = await api.plant(bed.i, seed.id);
      Audio_.plant();
      burst(bed.gx, bed.gy, withAlpha('#7FB069', 0.9), 6);
      hydrate(state);
      sown++;
    } catch (err) {
      ui.toast(err?.message ?? 'That bed refused the seed.', 'warn');
      break;
    }
  }

  if (sown) {
    ui.toast(`Sowed ${sown} bed${sown > 1 ? 's' : ''}.`, 'good');
    ui.updateHUD();
    ui.updateTutorial();
    if (G.panel) ui.renderPanel();
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
    announceMilestones(res.earned);
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
    announceMilestones(res.earned);
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
    announceMilestones(res.earned);
  });
}

export async function declineCommission(c) {
  await run(async () => {
    const state = await api.declineCommission(c.id);
    Audio_.ui();
    refresh(state);
  });
}

/* ---------------- the exchange ---------------- */

/**
 * The board is other players' data, so it is fetched on demand rather than
 * riding along with every state snapshot.
 */
export async function loadMarket(reset = true) {
  G.market.loading = true;
  if (reset) {
    G.market.listings = [];
    G.market.cursor = null;
  }
  ui.renderPanel();
  try {
    const res = await api.browseMarket({
      ...G.market.filters,
      ...(reset ? {} : { cursor: G.market.cursor ?? undefined }),
    });
    G.market.listings = reset ? res.listings : G.market.listings.concat(res.listings);
    G.market.cursor = res.nextCursor;
  } catch (err) {
    ui.toast(err?.message ?? 'Could not read the board.', 'warn');
  } finally {
    G.market.loading = false;
    ui.renderPanel();
  }
}

export async function loadMyListings() {
  try {
    G.myListings = (await api.myListings()).listings;
    ui.renderPanel();
  } catch {
    /* the panel will show what it has */
  }
}

export async function buyListing(listing) {
  await run(async () => {
    const res = await api.buyListing(listing.id);
    Audio_.coin();
    ui.toast(`${res.bought.name} is yours for ${res.bought.price} coins.`, 'good');
    refresh(res.state);
    await loadMarket(true);
  });
}

export async function cancelListing(listing) {
  await run(async () => {
    const state = await api.cancelListing(listing.id);
    Audio_.ui();
    ui.toast(`${listing.name} withdrawn from the board.`);
    refresh(state);
    await loadMyListings();
  });
}

/**
 * Asks for a price, seeded with the server's advisory quote. The quote is
 * guidance only — nothing enforces it, and a seller is free to ignore it.
 */
export async function openListDialog(strain) {
  let quote;
  try {
    quote = await api.quoteStrain(strain.id);
  } catch (err) {
    ui.toast(err?.message ?? 'Could not price that.', 'warn');
    return;
  }

  const raw = window.prompt(
    `List ${strain.name} (score ${quote.score}) for how many coins?\n\n` +
      `Suggested: ${quote.suggested}. A ${Math.round((quote.fee / quote.suggested) * 100)}% fee is ` +
      `destroyed on sale, so at that price you would receive ${quote.net}.`,
    String(quote.suggested),
  );
  if (raw === null) return;

  const price = Math.floor(Number(raw));
  if (!Number.isFinite(price) || price <= 0) {
    ui.toast('That is not a price.', 'warn');
    return;
  }

  await run(async () => {
    const state = await api.listStrain(strain.id, price);
    Audio_.coin();
    ui.toast(`${strain.name} listed for ${price} coins. The seed is held in escrow.`, 'good');
    refresh(state);
    await loadMyListings();
  });
}

/* ---------------- estate ---------------- */

export async function loadUpgrades() {
  try {
    G.upgradeDefs = (await api.fetchUpgrades()).upgrades;
    ui.renderPanel();
  } catch {
    /* panel shows a loading state */
  }
}

export async function loadMilestones() {
  try {
    G.milestoneDefs = (await api.fetchMilestones()).milestones;
    ui.renderPanel();
  } catch {
    /* panel shows a loading state */
  }
}

export async function buyUpgrade(upgrade) {
  await run(async () => {
    const state = await api.buyUpgrade(upgrade.key);
    Audio_.coin();
    ui.toast(`${upgrade.name} built.`, 'good');
    refresh(state);
    await loadUpgrades();
  });
}

/* ---------------- daily tasks ---------------- */

export async function loadDaily() {
  try {
    G.daily = await api.fetchDaily();
    ui.updateHUD();
    if (G.panel === 'daily') ui.renderPanel();
  } catch {
    /* the panel shows what it has; the next open tries again */
  }
}

export async function claimDaily(task) {
  await run(async () => {
    const res = await api.claimDaily(task.key);
    Audio_.rare();
    G.daily = res.daily;
    ui.toast(`${task.name} — ${res.coins} coins and ${res.xp} XP.`, 'good');
    refresh(res.state);
  });
}

/* ---------------- sharing ---------------- */

/**
 * A pressed specimen has a public page. Copying the link is the whole feature —
 * the plate was always built to be screenshotted, it just had nowhere to point.
 */
export async function shareSpecimen(strain) {
  const url = `${window.location.origin}/herbarium/${encodeURIComponent(strain.accession)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: `${strain.name} — HEIRLOM`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    ui.toast('Link copied.', 'good');
  } catch {
    // Clipboard can be refused; showing the URL still lets them copy it.
    ui.toast(url);
  }
}

/* ---------------- progression feedback ---------------- */

/**
 * Tells the player when something new has opened up.
 *
 * Without this a feature simply appears in the dock one day and the player is
 * left to work out what it is for. Each announcement fires once.
 */
function announceUnlocks(level) {
  for (const unlock of unlocksFor(level)) {
    markSeen(unlock.id);
    ui.toast(unlock.message, 'good');
  }
}

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
  announceUnlocks(to);
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
  plantAll,
  loadDaily,
  claimDaily,
  loadMarket,
  loadMyListings,
  buyListing,
  cancelListing,
  openListDialog,
  loadUpgrades,
  loadMilestones,
  buyUpgrade,
  shareSpecimen,
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
