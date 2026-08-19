/**
 * HEIRLOOM — primers.
 *
 * The guided tutorial is a thirteen-step script that teaches the opening loop
 * and then stops. Everything added since — the exchange, estate improvements,
 * milestones, the Punnett square, blight that can kill a line, and the fact
 * that species behave differently — had no explanation anywhere, so a player
 * reaching them for the first time was on their own.
 *
 * Extending the script to twenty-three steps would have been worse. Nobody
 * reads a twenty-three step tutorial, and most of those steps would fire long
 * before the feature was reachable.
 *
 * So instead: each feature carries a short primer that appears the first time
 * it is genuinely relevant, once, at the top of the panel it belongs to. A
 * player who already understands it dismisses it and never sees it again; a
 * player who does not gets the explanation exactly where they need it.
 */

import { MARKET_MIN_LEVEL, SPECIES, UPGRADES } from '@heirloom/genetics';
import { G } from './store.js';

const SEEN_KEY = 'heirloom.primers.seen';

function seenSet() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export const hasSeen = (id) => seenSet().has(id);

export function markSeen(id) {
  try {
    const seen = seenSet();
    seen.add(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* private browsing; the primer will simply show again */
  }
}

/** Clears every primer, so the help panel can offer to replay them. */
export function resetPrimers() {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Each primer names the panel it belongs to and a condition for being worth
 * showing. `unlock` is the toast shown the moment the feature opens up, so a
 * player learns a new thing exists rather than having to go looking.
 */
export const PRIMERS = [
  {
    id: 'bench-punnett',
    panel: 'bench',
    when: () => (G.selection || []).length === 2,
    title: 'Read the colour square',
    body:
      'The grid below is every way these two parents can pair their colour alleles. ' +
      'The <b>lower-ranked colour always wins</b>, so a plant showing Crimson may be hiding ' +
      'Ivory — and the line underneath tells you the odds of exactly that. ' +
      '<b>A plain-looking offspring from the right cross is worth more than a pretty one ' +
      'from the wrong one.</b>',
  },
  {
    id: 'exchange',
    panel: 'exchange',
    when: () => true,
    title: 'What the exchange is for',
    body:
      'Other gardeners sell specimens here, and you can sell yours. Everything trades in <b>coins</b> — ' +
      '$SEED never does. Listing a strain puts that seed in <b>escrow</b>: it leaves your vault at once ' +
      'and cannot be planted or crossed until the listing sells or you cancel it. ' +
      'A small fee is destroyed on every sale, so trading moves specimens, not wealth.',
  },
  {
    id: 'estate-upgrades',
    panel: 'estate',
    when: () => (G.estateTab || 'upgrades') === 'upgrades',
    title: 'Where your coins should go',
    body:
      'Coins buy seed and mutagen, and then pile up with nothing to do. These improvements are ' +
      'the answer: permanent, and they change how the whole farm runs rather than one plant. ' +
      `<b>${UPGRADES.coldframe.name}</b> is the first one worth having — blight is the only thing ` +
      'in the game that can take a line away from you.',
  },
  {
    id: 'estate-milestones',
    panel: 'estate',
    when: () => G.estateTab === 'milestones',
    title: 'The long record',
    body:
      'These are the goals worth years rather than minutes. They are awarded once and ' +
      '<b>kept forever</b> — selling the specimen that earned one does not take it back. ' +
      'Note that carrying a rare allele is not the same as showing it: Ivory is recorded when ' +
      'you finally <b>express</b> it, not when you first hold one hidden.',
  },
  {
    id: 'species',
    panel: 'market',
    when: () => G.level >= SPECIES.corn.lvl,
    title: 'Species are not interchangeable',
    body:
      'Each line in the nursery behaves differently, and the green note under each one says how. ' +
      '<b>Corn</b> returns spare seed readily, so a fragile carrier line survives there. ' +
      '<b>Chili</b> pays for Essence. <b>Pumpkin</b> rewards Yield and punishes its absence. ' +
      '<b>Moonflower</b> grows fast only if you plant it after dusk. ' +
      'Match the ground to the genes you actually have.',
  },
  {
    id: 'blight',
    panel: null,
    when: () => false, // fired by event, not by opening a panel
    title: 'Blight can take a line',
    body:
      'A blighted bed usually just yields poorly — but some plantings are <b>lost outright</b>, ' +
      'with no crop and no seed returned. <b>Hardiness</b> is what protects you: a tough plant does ' +
      'not merely catch blight less often, it survives the blight it catches. ' +
      'Think twice before putting the last seed of a line into the ground.',
  },
  {
    id: 'commission-seed',
    panel: 'commission',
    when: () => true,
    title: 'How collectors work',
    body:
      'Each collector wants a specimen meeting <b>every</b> requirement listed. A colour requirement ' +
      'is met by that morph <b>or anything rarer</b>. Filling one pays coins, reputation, and $SEED — ' +
      'and reputation is what opens more commission slots, so it compounds.',
  },
];

/** The first unseen primer that applies to the panel now open, if any. */
export function primerFor(panel) {
  const seen = seenSet();
  return PRIMERS.find((p) => p.panel === panel && !seen.has(p.id) && p.when());
}

export const primerById = (id) => PRIMERS.find((p) => p.id === id);

/**
 * Announcements for things that open up as a player levels. Without these, a
 * feature simply appears in the dock one day with no explanation of why.
 */
export const UNLOCKS = [
  {
    id: 'unlock-exchange',
    level: MARKET_MIN_LEVEL,
    message: 'The exchange is open to you. You can buy and sell specimens with other gardeners now.',
  },
  {
    id: 'unlock-coldframe',
    level: UPGRADES.coldframe.lvl,
    message: 'The estate will take improvements now. A cold frame is the first thing worth building.',
  },
  {
    id: 'unlock-moonflower',
    level: SPECIES.moonflower.lvl,
    message: 'Moonflower seed is stocked. Plant it after dusk — it sulks in daylight.',
  },
];

/** Returns unlock announcements newly earned by crossing into `level`. */
export function unlocksFor(level) {
  const seen = seenSet();
  return UNLOCKS.filter((u) => level >= u.level && !seen.has(u.id));
}
