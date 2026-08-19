/**
 * HEIRLOOM — interface.
 *
 * The markup and CSS are the prototype's, kept as-is. What changed is the data
 * source: every panel now reads the snapshot the server sent, and every button
 * that used to mutate local state calls through `actions`, which is the API.
 *
 * Nothing here computes a score, a value, or an outcome. Where the prototype
 * called `strainScore(s)` this reads `s.score`, because the server already
 * decided it.
 */

import {
  COLORS,
  COLOR_KEYS,
  LOCI,
  PLOT_UNLOCK,
  SPECIES,
  SPECIES_ORDER,
  SPECIES_TRAITS,
  TIERS,
  TRAITS,
  MARKET_FEE_RATE,
  colorPunnett,
  dayPhase,
  dayPhaseName,
  expressColor,
  isNight,
  expressLocus,
  matches,
  repSlots,
} from '@heirloom/genetics';
import {
  C,
  G,
  clamp,
  fmtNum,
  fmtTime,
  plotUnlocked,
  serverNow,
  setTutorialDone,
} from './store.js';
import { drawPlant, iso } from './art.js';
import { Audio_ } from './audio.js';
import { viewport } from './world.js';
import { actions } from './actions.js';
import { markSeen, primerFor, resetPrimers } from './primers.js';

/** Tier and trait definitions, matched to the keys the server sent. */
const tierOf = (s) => TIERS.find((t) => t.key === s.tier) ?? TIERS[0];
const traitsOf = (s) => TRAITS.filter((t) => s.traits.includes(t.k));

/** Parent names, resolved against what the player currently holds. */
function parentNames(strain) {
  if (!strain.parentAId || !strain.parentBId) return null;
  const all = G.vault.concat(G.herbarium);
  const find = (id) => all.find((s) => s.id === id)?.name ?? 'a lost line';
  return [find(strain.parentAId), find(strain.parentBId)];
}

const $ = s => document.querySelector(s);
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- toasts ---------------- */
function toast(msg, kind = 'info') {
  const t = el('div', 'toast toast--' + kind, msg);
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  const pct = clamp(G.xpInLevel / Math.max(1, G.xpForLevel), 0, 1) * 100;
  $('#hudCoins').textContent = fmtNum(G.coins);
  $('#hudSeed').textContent = G.seedToken.toFixed(2);
  $('#hudLevel').textContent = G.level;
  $('#xpFill').style.width = pct + '%';
  $('#xpText').textContent = fmtNum(G.xpInLevel) + ' / ' + fmtNum(G.xpForLevel);
  const d = G.dayT;
  const phase = d < 0.08 ? 'Dawn' : d < 0.42 ? 'Morning' : d < 0.55 ? 'Golden hour' : d < 0.66 ? 'Dusk' : 'Night';
  $('#hudPhase').textContent = phase;
  $('#dockCommission').dataset.badge = G.commissions.filter(c => canFulfill(c)).length || '';
  const ripe = G.plots.filter(p => p.state === 'ripe').length;
  $('#harvestAll').style.display = ripe ? 'flex' : 'none';
  $('#harvestAllN').textContent = ripe;

  /* Only offer to sow when there is both a bed to fill and seed to fill it. */
  const fallow = G.plots.filter(p => plotUnlocked(p.i) && p.state === 'empty').length;
  const haveSeed = G.vault.some(s => s.qty >= 1);
  $('#plantAll').style.display = fallow && haveSeed ? 'flex' : 'none';
  $('#plantAllN').textContent = fallow;
}

/* ---------------- gene widgets ---------------- */
function alleleChip(v) { return `<i class="al al--${v}">${v}</i>`; }
function geneBlock(strain, compact) {
  const p = strain.phenotype;
  let h = '<div class="genes' + (compact ? ' genes--compact' : '') + '">';
  for (const l of LOCI) {
    const pair = strain.genes[l.k];
    const val = p[l.k];
    h += `<div class="gene" title="${l.name}: ${l.desc}">
      <span class="gene__k">${l.k}</span>
      <span class="gene__bar"><i style="width:${(val / 6) * 100}%"></i></span>
      <span class="gene__v">${val}</span>
      <span class="gene__pair">${alleleChip(pair[0])}${alleleChip(pair[1])}</span>
    </div>`;
  }
  const c0 = COLORS[strain.color[0]], c1 = COLORS[strain.color[1]], ce = COLORS[p.color];
  h += `<div class="gene gene--color" title="Colour: the lower-ranked allele is dominant, so rare morphs must be paired to appear.">
    <span class="gene__k">C</span>
    <span class="gene__color" style="background:${ce.hex}"></span>
    <span class="gene__v gene__v--wide">${ce.name}</span>
    <span class="gene__pair"><i class="al al--c" style="background:${c0.hex}"></i><i class="al al--c" style="background:${c1.hex}"></i></span>
  </div>`;
  h += '</div>';
  return h;
}

function strainCard(s, opts = {}) {
  const t = tierOf(s), sp = SPECIES[s.species];
  const tr = traitsOf(s);
  const card = el('div', 'card card--strain');
  card.style.setProperty('--tier', t.hex);
  card.innerHTML = `
    <div class="card__top">
      <div class="card__id">
        <span class="tierdot" style="background:${t.hex}"></span>
        <div>
          <div class="card__name">${esc(s.name)}${s.qty > 1 ? `<em class="qty">×${s.qty}</em>` : ''}</div>
          <div class="card__sub">${sp.name} · <span class="tier">${t.name}</span> · Gen ${s.generation}</div>
        </div>
      </div>
      <div class="card__score" title="Breeding score">${s.score}</div>
    </div>
    ${geneBlock(s, true)}
    <div class="card__stats">
      <span title="Fruit per harvest">✿ ${s.yieldCount}</span>
      <span title="Time to ripen">◷ ${fmtTime(s.growSeconds)}</span>
      <span title="Coins per fruit">◆ ${s.unitValue}</span>
      ${tr.length ? `<span class="traits">${tr.map(x => `<i title="${x.desc}">${x.name}</i>`).join('')}</span>` : ''}
    </div>`;
  if (opts.actions) {
    const row = el('div', 'card__actions');
    for (const a of opts.actions) {
      const b = el('button', 'btn ' + (a.style || 'btn--ghost'), a.label);
      if (a.disabled) b.disabled = true;
      b.onclick = ev => { ev.stopPropagation(); a.fn(); };
      row.appendChild(b);
    }
    card.appendChild(row);
  }
  if (opts.onClick) card.onclick = () => opts.onClick(s);
  if (opts.selected) card.classList.add('is-selected');
  return card;
}

/* ---------------- panel shell ---------------- */
const PANEL_TITLES = {
  vault: ['Seed vault', 'Every strain you hold. Plant them, cross them, or send them to a collector.'],
  bench: ['Breeding bench', 'Cross two parents of the same species. Each parent passes one allele per gene.'],
  codex: ['Herbarium', 'Specimens you have named and pressed. This is the record that outlives the farm.'],
  market: ['Market cart', 'Sell the harvest, restock nursery seed, buy mutagen.'],
  commission: ['Commission board', 'Collectors want specific genetics. Meet the brief, earn $SEED.'],
  exchange: ['Exchange', 'Buy and sell specimens with other gardeners. Coins only — $SEED never trades.'],
  estate: ['The estate', 'Permanent improvements, and the long record of what you have bred.'],
  help: ['How breeding works', 'Four quantitative genes, one colour gene, and a mutation rate you can raise.'],
};

function openPanel(kind) {
  Audio_.ui();
  G.panel = kind;
  const p = $('#panel');
  p.classList.add('is-open');
  $('#panelTitle').textContent = PANEL_TITLES[kind][0];
  $('#panelSub').textContent = PANEL_TITLES[kind][1];
  renderPanel();
  /* These three read data that does not ride along with the state snapshot. */
  if (kind === 'exchange') {
    if ((G.market.tab || 'browse') === 'browse') actions.loadMarket(true);
    else actions.loadMyListings();
  }
  if (kind === 'estate') {
    if ((G.estateTab || 'upgrades') === 'upgrades') actions.loadUpgrades();
    else actions.loadMilestones();
  }
  document.querySelectorAll('.dock__btn').forEach(b => b.classList.toggle('is-active', b.dataset.panel === kind));
}
function closePanel() {
  G.panel = null;
  $('#panel').classList.remove('is-open');
  document.querySelectorAll('.dock__btn').forEach(b => b.classList.remove('is-active'));
}
/**
 * A one-off explainer, shown at the top of the panel it belongs to.
 *
 * Dismissing it is permanent — a player who understands a feature should not
 * have to close the same card every time they open the panel.
 */
function primerCard(primer) {
  const card = el('div', 'primer');
  card.innerHTML = `
    <div class="primer__t">${esc(primer.title)}</div>
    <div class="primer__b">${primer.body}</div>`;
  const ok = el('button', 'btn btn--sm primer__ok', 'Got it');
  ok.onclick = () => {
    markSeen(primer.id);
    renderPanel();
  };
  card.appendChild(ok);
  return card;
}

function renderPanel() {
  if (!G.panel) return;
  const body = $('#panelBody');
  body.innerHTML = '';

  const primer = primerFor(G.panel);
  if (primer) body.appendChild(primerCard(primer));
  ({
    vault: panelVault,
    bench: panelBench,
    codex: panelCodex,
    market: panelMarket,
    commission: panelCommission,
    exchange: panelExchange,
    estate: panelEstate,
    help: panelHelp,
  }[G.panel])(body);
}

/* ---------------- vault ---------------- */
function sortedVault() {
  return [...G.vault].sort((a, b) => b.score - a.score);
}
function panelVault(body) {
  /* Running out of seed with beds standing open is the one state a new player
     can reach and not understand. A playtest sat in it for a full minute. */
  const freeBeds = G.plots.filter((p) => plotUnlocked(p.i) && p.state === 'empty').length;
  if (freeBeds > 0 && G.vault.length) {
    const note = el('div', 'note');
    note.innerHTML = `<b>${freeBeds} bed${freeBeds > 1 ? 's' : ''} standing empty.</b> ` +
      'Every bed left fallow is a harvest you are not getting.';
    body.appendChild(note);
  }
  if (!G.vault.length) {
    body.appendChild(el('div', 'empty',
      '<b>No seed left.</b><span>Every seed you held is in the ground. A harvest returns at ' +
      'least one seed of the line it came from, so the beds will restock you — or buy fresh ' +
      'nursery stock at the cart if you would rather not wait.</span>'));
    const b = el('button', 'btn btn--brass', 'Open the market');
    b.onclick = () => openPanel('market');
    body.appendChild(b);
    return;
  }
  const grid = el('div', 'grid');
  for (const s of sortedVault()) {
    grid.appendChild(strainCard(s, {
      actions: [
        { label: 'Plant', style: 'btn--brass', fn: () => beginPlantFlow(s) },
        { label: 'Cross', fn: () => { toggleSelect(s); openPanel('bench'); } },
        { label: 'Press', fn: () => showPlate(s, { mode: 'record' }) },
      ],
    }));
  }
  body.appendChild(grid);
}

/* ---------------- bench ---------------- */
function toggleSelect(s) {
  if (!G.selection) G.selection = [];
  const i = G.selection.findIndex(x => x.id === s.id);
  if (i >= 0) G.selection.splice(i, 1);
  else {
    if (G.selection.length >= 2) G.selection.shift();
    G.selection.push(s);
  }
  if (G.panel) renderPanel();
}
function panelBench(body) {
  const sel = G.selection || [];
  const slot = (s, idx) => {
    const d = el('div', 'slot' + (s ? ' slot--filled' : ''));
    if (s) {
      const t = tierOf(s);
      d.style.setProperty('--tier', t.hex);
      d.innerHTML = `<div class="slot__label">Parent ${idx + 1}</div>
        <div class="slot__name">${esc(s.name)}</div>
        <div class="slot__sub">${SPECIES[s.species].name} · ${t.name}</div>
        ${geneBlock(s, true)}`;
      const x = el('button', 'slot__clear', '✕');
      x.onclick = () => toggleSelect(s);
      d.appendChild(x);
    } else {
      d.innerHTML = `<div class="slot__label">Parent ${idx + 1}</div><div class="slot__hint">Pick a seed below</div>`;
    }
    return d;
  };
  const pair = el('div', 'bench__pair');
  pair.appendChild(slot(sel[0], 0));
  const cross = el('div', 'bench__x', '×');
  pair.appendChild(cross);
  pair.appendChild(slot(sel[1], 1));
  body.appendChild(pair);

  const ok = sel.length === 2 && sel[0].species === sel[1].species && sel[0].id !== sel[1].id;
  const mism = sel.length === 2 && sel[0].species !== sel[1].species;

  if (sel.length === 2 && ok) {
    const rangeBox = el('div', 'forecast');
    let rows = '';
    for (const l of LOCI) {
      const opts = [];
      for (const a of sel[0].genes[l.k]) for (const b of sel[1].genes[l.k]) opts.push(expressLocus([a, b]));
      const lo = Math.min(...opts), hi = Math.max(...opts);
      rows += `<div class="fc"><span>${l.k}</span><b>${lo === hi ? lo : lo + '–' + hi}</b></div>`;
    }
    const cols = [...new Set([...sel[0].color, ...sel[1].color].map(c => COLORS[c].name))].join(' / ');
    rangeBox.innerHTML = `<div class="forecast__t">Possible offspring, before mutation</div>
      <div class="forecast__row">${rows}</div>
      <div class="forecast__c">Colour alleles in play: ${cols}</div>`;
    body.appendChild(rangeBox);
    body.appendChild(punnettBox(sel[0], sel[1]));
  }

  const mutRow = el('div', 'mutagen');
  mutRow.innerHTML = `<div>
      <b>Mutagen</b>
      <span>Raises the mutation rate from 9% to 26% per allele, and triples the odds of a colour shift.</span>
    </div>
    <div class="mutagen__n">${G.mutagen} held</div>`;
  const useMut = el('label', 'switch');
  useMut.innerHTML = `<input type="checkbox" id="useMutagen" ${G.mutagen > 0 ? '' : 'disabled'}><span></span>`;
  mutRow.appendChild(useMut);
  body.appendChild(mutRow);

  const distinct = new Set(G.vault.map((v) => v.id)).size;
  const label = ok
    ? 'Cross these parents'
    : mism
      ? 'Parents must be the same species'
      : distinct < 2
        ? 'A cross needs two different lines'
        : 'Select two parents';
  const go = el('button', 'btn btn--brass btn--wide', label);
  go.disabled = !ok;
  go.onclick = () => actions.doBreed();
  body.appendChild(go);

  const h = el('div', 'sectionhead', 'Vault');
  body.appendChild(h);
  const grid = el('div', 'grid grid--tight');
  for (const s of sortedVault()) {
    grid.appendChild(strainCard(s, {
      onClick: toggleSelect,
      selected: sel.some(x => x.id === s.id),
    }));
  }
  body.appendChild(grid);
}


/**
 * The colour Punnett square.
 *
 * This is the one piece of teaching the prototype was missing. The whole
 * strategy of HEIRLOOM is that the beautiful morphs are recessive — so the
 * plainest plant in your vault may be the most valuable thing you own — and
 * nothing in the game ever said so. A player had to infer it from twenty
 * disappointing crosses, and most would quit first.
 *
 * Everything shown is derived from two parent cards the player already holds,
 * so it reveals nothing they could not work out with a pencil. Mutation is
 * deliberately excluded: the ladder can still surprise you upward, and that
 * surprise should stay a surprise.
 */
function punnettBox(a, b) {
  const p = colorPunnett(a, b);
  const box = el('div', 'punnett');

  const cells = p.cells.map((c) => {
    const shown = COLORS[c.shows];
    const hidden = COLORS[c.from[0]].rank > COLORS[c.from[1]].rank ? c.from[0] : c.from[1];
    return `<div class="pn__cell${c.carries ? ' pn__cell--carrier' : ''}"
        title="${COLORS[c.from[0]].name} + ${COLORS[c.from[1]].name}${c.carries ? ` — shows ${shown.name}, hides ${COLORS[hidden].name}` : ''}">
      <i style="background:${shown.hex}"></i>
      <b>${shown.name}</b>
      ${c.carries ? `<em>carries ${COLORS[hidden].name}</em>` : '<em>true</em>'}
    </div>`;
  }).join('');

  const odds = p.outcomes
    .map((o) => `<div class="pn__odd">
        <i style="background:${COLORS[o.color].hex}"></i>
        <b>${Math.round(o.chance * 100)}%</b>
        <span>${COLORS[o.color].name}</span>
      </div>`)
    .join('');

  const carrierPct = Math.round(p.carrierChance * 100);
  const best = COLORS[p.bestHidden];
  const showsBest = p.outcomes.some((o) => o.color === p.bestHidden);

  /* The sentence that matters. A cross with a 0% chance of showing the rare
     morph can still be the most valuable cross available, and this is where we
     say so out loud. */
  const bestOdds = p.outcomes.find((o) => o.color === p.bestHidden);
  const bestPct = Math.round((bestOdds?.chance ?? 0) * 100);

  let lesson;
  if (p.bestHidden === 'crimson') {
    lesson = 'Neither parent carries anything rarer than Crimson. Nothing hidden here to find.';
  } else if (showsBest && carrierPct > 0) {
    /* The payoff cross. Both parents carry the same recessive, so it can finally
       express — and this is the moment the whole game is built around, so say
       the number plainly rather than burying it in the odds row. */
    lesson = `<em>${bestPct}% of offspring will show ${best.name} outright.</em> ` +
      `Another ${carrierPct}% will look plainer but still carry something rarer — keep those too, ` +
      'they are how the next one appears.';
  } else if (!showsBest && carrierPct > 0) {
    lesson = `No offspring will <em>show</em> ${best.name} — but ${carrierPct}% will carry it hidden. ` +
      'Keep those and cross them together: two carriers are how a recessive morph finally appears.';
  } else if (showsBest) {
    lesson = `Every offspring shows ${best.name}. This line is fixed.`;
  } else {
    lesson = 'Every offspring shows exactly what it carries. Nothing is hidden in this cross.';
  }

  box.innerHTML = `
    <div class="punnett__t">Colour inheritance</div>
    <div class="pn__grid">${cells}</div>
    <div class="pn__odds">${odds}</div>
    <div class="pn__lesson">${lesson}</div>`;
  return box;
}

/* ---------------- herbarium ---------------- */
function panelCodex(body) {
  const counts = TIERS.map(t => ({ t, n: G.herbarium.filter(c => c.tier === t.key).length }));
  const bar = el('div', 'codexbar');
  bar.innerHTML = counts.map(c => `<div class="cb"><i style="background:${c.t.hex}"></i><b>${c.n}</b><span>${c.t.name}</span></div>`).join('');
  body.appendChild(bar);
  if (!G.herbarium.length) {
    body.appendChild(el('div', 'empty', '<b>No specimens pressed yet.</b><span>Name a strain you are proud of and it is recorded here permanently, with its accession number and parentage.</span>'));
    return;
  }
  const grid = el('div', 'grid');
  for (const s of [...G.herbarium].sort((a, b) => b.score - a.score)) {
    grid.appendChild(strainCard(s, { actions: [{ label: 'View plate', fn: () => showPlate(s, { mode: 'view' }) }] }));
  }
  body.appendChild(grid);
}

/* ---------------- market ---------------- */
function panelMarket(body) {
  const stacks = Object.values(G.produce).filter(x => x.n > 0);
  body.appendChild(el('div', 'sectionhead', 'Sell harvest'));
  if (!stacks.length) {
    body.appendChild(el('div', 'empty empty--sm', '<b>Nothing to sell.</b><span>Harvest a ripe bed first.</span>'));
  } else {
    const total = stacks.reduce((a, x) => a + x.n * x.value, 0);
    const list = el('div', 'stacks');
    for (const st of stacks) {
      const col = COLORS[st.color];
      const row = el('div', 'stack');
      row.innerHTML = `<span class="stack__dot" style="background:${col.hex}"></span>
        <div class="stack__t"><b>${SPECIES[st.species].name}</b><span>${col.name} · ${st.value} coins each</span></div>
        <div class="stack__n">×${st.n}</div>`;
      const b = el('button', 'btn btn--sm', 'Sell');
      b.onclick = () => actions.sellStack(st);
      row.appendChild(b);
      list.appendChild(row);
    }
    body.appendChild(list);
    const all = el('button', 'btn btn--brass btn--wide', `Sell everything · ${fmtNum(total)} coins`);
    all.onclick = () => actions.sellAll(stacks.slice());
    body.appendChild(all);
  }

  /* Moonflower is the one species whose grow time depends on when you plant it,
     so the market is where that becomes actionable. */
  if (G.level >= SPECIES.moonflower.lvl) {
    const phase = dayPhase(serverNow());
    const night = isNight(phase);
    const clock = el('div', 'note');
    clock.innerHTML = night
      ? `<b>It is ${dayPhaseName(phase)}.</b> Moonflower planted now comes on fast.`
      : `<b>It is ${dayPhaseName(phase)}.</b> Moonflower planted now will sulk — it wants to go in after dusk.`;
    body.appendChild(clock);
  }

  body.appendChild(el('div', 'sectionhead', 'Nursery seed'));
  const shop = el('div', 'stacks');
  for (const key of SPECIES_ORDER) {
    const sp = SPECIES[key];
    const locked = G.level < sp.lvl;
    const row = el('div', 'stack' + (locked ? ' is-locked' : ''));
    const tr = SPECIES_TRAITS[key];
    row.innerHTML = `<span class="stack__dot" style="background:${locked ? '#5A5348' : C.leaf}"></span>
      <div class="stack__t">
        <b>${sp.name}</b>
        <span><i class="latin">${sp.latin}</i> · ${sp.note}</span>
        <em class="stack__trait">${esc(tr.trait)}</em>
      </div>
      <div class="stack__n">${locked ? 'Level ' + sp.lvl : fmtNum(sp.seedCost)}</div>`;
    const b = el('button', 'btn btn--sm', locked ? 'Locked' : 'Buy');
    b.disabled = locked || G.coins < sp.seedCost;
    b.onclick = () => actions.buySeed(key);
    row.appendChild(b);
    shop.appendChild(row);
  }
  body.appendChild(shop);

  body.appendChild(el('div', 'sectionhead', 'Supplies'));
  const sup = el('div', 'stacks');
  const mrow = el('div', 'stack');
  mrow.innerHTML = `<span class="stack__dot" style="background:${C.wine}"></span>
    <div class="stack__t"><b>Mutagen</b><span>One vial per cross. Higher mutation rate, both directions.</span></div>
    <div class="stack__n">450</div>`;
  const mb = el('button', 'btn btn--sm', 'Buy');
  mb.disabled = G.coins < 450;
  mb.onclick = () => actions.buyMutagen();
  mrow.appendChild(mb);
  sup.appendChild(mrow);
  body.appendChild(sup);
}

/* ---------------- commissions ---------------- */
/**
 * UX only. The server re-derives the phenotype from stored genes and re-runs
 * this same check on fulfilment, so a client that lies about a match simply
 * gets a 400.
 */
const matchesCommission = (strain, c) => matches(strain, c.reqs, c.species);
const canFulfill = (c) => G.vault.some((s) => matchesCommission(s, c));

function panelCommission(body) {
  const slots = repSlots();
  const info = el('div', 'repbar');
  info.innerHTML = `<div><b>Standing</b><span>${G.rep} with the collectors' guild</span></div>
    <div class="repbar__slots">${[0, 1, 2].map(i => `<i class="${i < slots ? 'on' : ''}"></i>`).join('')}</div>
    <div class="repbar__note">${slots < 3 ? `Next slot at ${slots === 1 ? 12 : 30} standing` : 'All slots open'}</div>`;
  body.appendChild(info);
  if (!G.commissions.length) {
    body.appendChild(el('div', 'empty', '<b>The board is bare.</b><span>New briefs get pinned every minute or so.</span>'));
    return;
  }
  for (const c of G.commissions) {
    const wrap = el('div', 'card card--comm');
    const match = G.vault.filter(s => matchesCommission(s, c)).sort((a, b) => a.score - b.score)[0];
    wrap.innerHTML = `
      <div class="comm__head">
        <div>
          <div class="comm__who">${esc(c.collector)}</div>
          <div class="comm__want">wants <b>${SPECIES[c.species].name}</b></div>
        </div>
        <div class="comm__pay">
          <span>${fmtNum(c.coins)} <i>coins</i></span>
          <span>${c.xp} <i>xp</i></span>
          ${Number(c.seedReward) ? `<span class="pay--seed">${Number(c.seedReward).toFixed(2)} <i>$SEED</i></span>` : ''}
        </div>
      </div>
      <div class="comm__spec">${esc(c.spec)}</div>
      <div class="comm__note">“${esc(c.note)}”</div>`;
    const row = el('div', 'card__actions');
    const b = el('button', 'btn ' + (match ? 'btn--brass' : ''), match ? `Send ${esc(match.name)}` : 'No match in vault');
    b.disabled = !match;
    b.onclick = () => actions.fulfilCommission(c, match);
    const d = el('button', 'btn btn--ghost', 'Decline');
    d.onclick = () => { G.commissions = G.commissions.filter(x => x !== c); renderPanel(); updateHUD(); };
    row.appendChild(b); row.appendChild(d);
    wrap.appendChild(row);
    body.appendChild(wrap);
  }
}


/* ---------------- exchange ---------------- */

/**
 * The board where specimens actually change hands.
 *
 * Coins only, and the panel says so: $SEED emission is throttled by reputation
 * on purpose, and letting it trade here would route around that gate.
 */
function panelExchange(body) {
  const tabs = el('div', 'tabs');
  const showing = G.market.tab || 'browse';
  for (const [key, label] of [['browse', 'Browse'], ['selling', 'Your listings']]) {
    const b = el('button', 'tab' + (showing === key ? ' is-on' : ''), label);
    b.onclick = () => {
      G.market.tab = key;
      renderPanel();
      if (key === 'browse') actions.loadMarket(true);
      else actions.loadMyListings();
    };
    tabs.appendChild(b);
  }
  body.appendChild(tabs);

  if (showing === 'selling') return exchangeSelling(body);
  return exchangeBrowse(body);
}

function exchangeBrowse(body) {
  const bar = el('div', 'filters');
  const f = G.market.filters;
  bar.innerHTML = `
    <select id="mkSpecies">
      <option value="">All species</option>
      ${SPECIES_ORDER.map(k => `<option value="${k}"${f.species === k ? ' selected' : ''}>${SPECIES[k].name}</option>`).join('')}
    </select>
    <select id="mkSort">
      <option value="new"${f.sort === 'new' ? ' selected' : ''}>Newest</option>
      <option value="price"${f.sort === 'price' ? ' selected' : ''}>Cheapest</option>
      <option value="score"${f.sort === 'score' ? ' selected' : ''}>Best</option>
    </select>`;
  body.appendChild(bar);
  bar.querySelector('#mkSpecies').onchange = e => { f.species = e.target.value || undefined; actions.loadMarket(true); };
  bar.querySelector('#mkSort').onchange = e => { f.sort = e.target.value; actions.loadMarket(true); };

  if (G.market.loading && !G.market.listings.length) {
    body.appendChild(el('div', 'empty', '<b>Reading the board…</b>'));
    return;
  }
  if (!G.market.listings.length) {
    body.appendChild(el('div', 'empty', '<b>Nothing on the board.</b><span>No gardener is selling a specimen matching that. Try a wider filter, or list something yourself.</span>'));
    return;
  }

  const grid = el('div', 'grid');
  for (const l of G.market.listings) {
    grid.appendChild(listingCard(l));
  }
  body.appendChild(grid);

  if (G.market.cursor) {
    const more = el('button', 'btn btn--ghost btn--wide', 'Show more');
    more.onclick = () => actions.loadMarket(false);
    body.appendChild(more);
  }
}

/** A listing renders as a strain card would, plus a price and the genotype. */
function listingCard(l) {
  const t = TIERS.find(x => x.key === l.tier) ?? TIERS[0];
  const shown = COLORS[expressColor(l.color)];
  const card = el('div', 'card card--strain card--listing');
  card.style.setProperty('--tier', t.hex);

  const affordable = G.coins >= l.price;
  card.innerHTML = `
    <div class="card__top">
      <div class="card__id">
        <span class="tierdot" style="background:${t.hex}"></span>
        <div>
          <div class="card__name">${esc(l.name)}</div>
          <div class="card__sub">${SPECIES[l.species].name} · <span class="tier">${t.name}</span> · Gen ${l.generation} · ${esc(l.accession)}</div>
        </div>
      </div>
      <div class="card__score" title="Breeding score">${l.score}</div>
    </div>
    <div class="genes genes--compact">
      ${LOCI.map(loc => `<div class="gene">
        <span class="gene__k">${loc.k}</span>
        <span class="gene__pair">${alleleChip(l.genes[loc.k][0])}${alleleChip(l.genes[loc.k][1])}</span>
      </div>`).join('')}
      <div class="gene gene--color">
        <span class="gene__k">C</span>
        <span class="gene__color" style="background:${shown.hex}"></span>
        <span class="gene__v gene__v--wide">${shown.name}</span>
        <span class="gene__pair"><i class="al al--c" style="background:${COLORS[l.color[0]].hex}"></i><i class="al al--c" style="background:${COLORS[l.color[1]].hex}"></i></span>
      </div>
    </div>
    <div class="listing__foot">
      <div class="listing__price">◆ ${fmtNum(l.price)}</div>
    </div>`;

  const foot = card.querySelector('.listing__foot');
  if (l.mine) {
    foot.appendChild(el('span', 'listing__mine', 'Yours'));
  } else {
    const b = el('button', 'btn btn--brass', affordable ? 'Buy' : 'Not enough coins');
    b.disabled = !affordable;
    b.onclick = () => actions.buyListing(l);
    foot.appendChild(b);
  }
  return card;
}

function exchangeSelling(body) {
  const note = el('div', 'note');
  note.innerHTML = `Listing puts the seed in escrow — it leaves your vault immediately and cannot be planted or crossed until the listing is cancelled or sold. A <b>${Math.round(MARKET_FEE_RATE * 100)}%</b> fee is taken from the sale and destroyed.`;
  body.appendChild(note);

  const head = el('div', 'sectionhead', 'List a specimen');
  body.appendChild(head);

  if (!G.vault.length) {
    body.appendChild(el('div', 'empty', '<b>Nothing to sell.</b>'));
  } else {
    const grid = el('div', 'grid grid--tight');
    for (const strain of sortedVault()) {
      grid.appendChild(strainCard(strain, {
        actions: [{ label: 'List for sale', style: 'btn--brass', fn: () => actions.openListDialog(strain) }],
      }));
    }
    body.appendChild(grid);
  }

  body.appendChild(el('div', 'sectionhead', 'On the board'));
  if (!G.myListings.length) {
    body.appendChild(el('div', 'empty', '<b>You are not selling anything.</b>'));
    return;
  }
  const rows = el('div', 'rows');
  for (const l of G.myListings) {
    const row = el('div', 'row');
    row.innerHTML = `
      <div>
        <b>${esc(l.name)}</b>
        <span>${SPECIES[l.species].name} · score ${l.score} · ${esc(l.accession)}</span>
      </div>
      <div class="row__right">
        <b>◆ ${fmtNum(l.price)}</b>
        <span>${l.status === 'open' ? `you receive ${fmtNum(l.net)}` : l.status}</span>
      </div>`;
    if (l.status === 'open') {
      const b = el('button', 'btn btn--ghost', 'Cancel');
      b.onclick = () => actions.cancelListing(l);
      row.appendChild(b);
    }
    rows.appendChild(row);
  }
  body.appendChild(rows);
}

/* ---------------- estate: upgrades and milestones ---------------- */

function panelEstate(body) {
  const tabs = el('div', 'tabs');
  const showing = G.estateTab || 'upgrades';
  for (const [key, label] of [['upgrades', 'Improvements'], ['milestones', 'Record']]) {
    const b = el('button', 'tab' + (showing === key ? ' is-on' : ''), label);
    b.onclick = () => {
      G.estateTab = key;
      renderPanel();
      if (key === 'upgrades') actions.loadUpgrades();
      else actions.loadMilestones();
    };
    tabs.appendChild(b);
  }
  body.appendChild(tabs);

  if (showing === 'milestones') return estateMilestones(body);
  return estateUpgrades(body);
}

function estateUpgrades(body) {
  if (!G.upgradeDefs.length) {
    body.appendChild(el('div', 'empty', '<b>Reading the ledger…</b>'));
    return;
  }
  const rows = el('div', 'rows');
  for (const u of G.upgradeDefs) {
    const row = el('div', 'row row--upgrade' + (u.locked ? ' is-locked' : ''));
    const pips = Array.from({ length: u.maxLevel }, (_, i) =>
      `<i class="pip${i < u.owned ? ' pip--on' : ''}"></i>`).join('');
    row.innerHTML = `
      <div>
        <b>${u.name} ${pips}</b>
        <span>${u.blurb}</span>
        <em class="upgrade__effect">${u.effect}</em>
      </div>`;
    const right = el('div', 'row__right');
    if (u.locked) {
      right.innerHTML = `<span>Level ${u.unlockLevel}</span>`;
    } else if (u.maxed) {
      right.innerHTML = '<span>Complete</span>';
    } else {
      const b = el('button', 'btn btn--brass', `◆ ${fmtNum(u.nextCost)}`);
      b.disabled = G.coins < u.nextCost;
      b.onclick = () => actions.buyUpgrade(u);
      right.appendChild(b);
    }
    row.appendChild(right);
    rows.appendChild(row);
  }
  body.appendChild(rows);
}

function estateMilestones(body) {
  if (!G.milestoneDefs.length) {
    body.appendChild(el('div', 'empty', '<b>Reading the record…</b>'));
    return;
  }
  const done = G.milestoneDefs.filter(m => m.achieved).length;
  const head = el('div', 'mstat');
  head.innerHTML = `<b>${done}</b><span>of ${G.milestoneDefs.length} recorded</span>`;
  body.appendChild(head);

  const rows = el('div', 'rows');
  for (const m of G.milestoneDefs) {
    const row = el('div', 'row row--milestone' + (m.achieved ? ' is-done' : ''));
    row.innerHTML = `
      <div>
        <b>${m.achieved ? '✓ ' : ''}${esc(m.name)}</b>
        <span>${esc(m.blurb)}</span>
      </div>`;
    rows.appendChild(row);
  }
  body.appendChild(rows);
}

/* ---------------- help ---------------- */
function panelHelp(body) {
  const replay = el('button', 'btn btn--brass btn--wide', 'Replay the guided tutorial');
  replay.style.marginTop = '0';
  replay.onclick = () => { closePanel(); setTimeout(() => startCoach(true), 260); };
  body.appendChild(replay);
  const wrap = el('div');
  body.appendChild(wrap);
  wrap.innerHTML = `
  <div class="prose">
    <p>Every plant carries two alleles at each of five loci. When you cross two parents, the offspring takes <b>one allele at random from each parent</b> per locus — so a weak-looking plant can still be worth breeding if it hides a strong recessive.</p>
    <h4>The four quantitative genes</h4>
    <ul>
      ${LOCI.map(l => `<li><b>${l.k} — ${l.name}.</b> ${l.desc}</li>`).join('')}
    </ul>
    <p>Expression leans on the stronger allele: a <code>5/2</code> pair reads as 4, not 3.5. Fixing a pair to <code>6/6</code> is the only way to guarantee the trait passes on.</p>
    <h4>Colour is classically Mendelian</h4>
    <p>Dominance runs Crimson → Amber → Jade → Violet → Ivory, and the <b>lower-ranked allele wins</b>. That makes the beautiful morphs recessive: an Ivory plant only appears when both alleles are Ivory. Carriers show nothing, which is exactly why you keep them.</p>
    <div class="chiprow">${COLOR_KEYS.map(k => `<span class="cchip"><i style="background:${COLORS[k].hex}"></i>${COLORS[k].name}</span>`).join('')}</div>
    <h4>Mutation</h4>
    <p>Each allele has a 9% chance to shift by one step when copied, occasionally two. Mutagen raises that to 26%. Mutation runs both ways — it is how new material enters the pool, and how a good line gets ruined.</p>
    <h4>Blight, and losing a line</h4>
    <p>A blighted bed usually yields poorly. Some plantings are <b>lost outright</b> — no crop, no seed back. <b>Hardiness</b> both prevents blight and decides whether you survive it, which is why H is worth breeding for even though it never shows on the plant. Think before you put the last seed of a line in the ground.</p>
    <h4>Species behave differently</h4>
    <ul>
      ${SPECIES_ORDER.map(k => `<li><b>${SPECIES[k].name}.</b> ${esc(SPECIES_TRAITS[k].trait)}</li>`).join('')}
    </ul>
    <p>Match the ground to the genes you have: a Yield-heavy line belongs in pumpkin, an Essence-heavy one in chili, and a fragile carrier in corn where spare seed comes back readily.</p>
    <h4>The estate</h4>
    <p><b>Improvements</b> are permanent and are what coins are ultimately for — they change how the whole farm runs rather than one plant. <b>Milestones</b> are the long record; they are awarded once and never taken back, even if you sell the specimen that earned one.</p>
    <h4>The exchange</h4>
    <p>Specimens trade between gardeners in <b>coins only</b>. Listing puts that seed in escrow — out of your vault until it sells or you cancel. A fee is destroyed on every sale, so the exchange moves specimens rather than wealth.</p>
    <h4>Where $SEED comes from</h4>
    <p>Only commissions pay $SEED. Selling produce pays coins. Standing with the guild opens more commission slots, so the token supply is gated by reputation rather than by farm size.</p>
  </div>`;

  const again = el('button', 'btn btn--ghost btn--wide', 'Show the feature hints again');
  again.onclick = () => {
    resetPrimers();
    toast('Hints reset. They will appear again as you open each panel.');
  };
  body.appendChild(again);
}

/* ---------------- plant flow ---------------- */
function beginPlantFlow(strain) {
  const free = G.plots.find(p => p.state === 'empty' && plotUnlocked(p.i));
  if (!free) { Audio_.err(); toast('Every bed is occupied.', 'warn'); return; }
  actions.plantStrain(free, strain);
  closePanel();
}
function onPlotClick(pl) {
  if (!plotUnlocked(pl.i)) {
    Audio_.err();
    toast(`Bed opens at level ${Object.keys(PLOT_UNLOCK).find(k => PLOT_UNLOCK[k] > pl.i) || '—'}.`, 'warn');
    return;
  }
  if (pl.state === 'ripe') { actions.harvest(pl); return; }
  if (pl.state === 'growing') { toast(`${pl.strain.name} ripens in ${fmtTime((pl.ripeAt - serverNow()) / 1000)}.`); return; }
  openSeedPicker(pl);
}
function openSeedPicker(pl) {
  const m = $('#picker');
  const list = $('#pickerList');
  list.innerHTML = '';
  if (!G.vault.length) {
    list.appendChild(el('div', 'empty empty--sm', '<b>No seed in the vault.</b><span>Buy nursery stock at the market cart.</span>'));
  } else {
    for (const s of sortedVault()) {
      list.appendChild(strainCard(s, { onClick: x => { actions.plantStrain(pl, x); closePicker(); } }));
    }
  }
  m.classList.add('is-open');
}
function closePicker() { $('#picker').classList.remove('is-open'); }

function onStructureClick(k) {
  if (k === 'bench') openPanel('bench');
  else if (k === 'cart') openPanel('market');
  else if (k === 'post') openPanel('commission');
  else if (k === 'conservatory') openPanel('codex');
}

/* ---------------- specimen plate (signature) ---------------- */
function showPlate(strain, opts = {}) {
  G.plate = { strain, mode: opts.mode || 'view' };
  const m = $('#plate');
  const t = tierOf(strain), sp = SPECIES[strain.species];
  const tr = traitsOf(strain);
  const cc = k => COLORS[k].name.slice(0, 2);
  const notation = LOCI.map(l => `${l.k}${strain.genes[l.k][0]}/${strain.genes[l.k][1]}`).join('  ') +
    `  C${cc(strain.color[0])}/${cc(strain.color[1])}`;
  const d = new Date(strain.createdAt);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  $('#plateRibbon').textContent = t.name;
  $('#plateRibbon').style.background = t.hex;
  $('#plateRibbon').style.color = t.key === 'common' || t.key === 'prized' ? '#231A10' : '#FFF6E6';
  $('#plateSpecies').textContent = sp.name;
  $('#plateLatin').textContent = sp.latin;
  $('#plateName').textContent = strain.name;
  $('#plateAcc').textContent = strain.accession;
  $('#plateNotation').textContent = notation;
  $('#plateDate').textContent = dateStr;
  $('#plateBy').textContent = G.gardener;
  $('#plateGen').textContent = 'Generation ' + strain.generation;
  $('#plateScore').textContent = strain.score;
  const parents = parentNames(strain);
  $('#plateParents').innerHTML = parents
    ? `Crossed from <b>${esc(parents[0])}</b> × <b>${esc(parents[1])}</b>`
    : 'Nursery stock — no recorded parentage';
  $('#plateTraits').innerHTML = tr.length
    ? tr.map(x => `<span class="ptrait" title="${x.desc}">${x.name}</span>`).join('')
    : '<span class="ptrait ptrait--none">No distinguishing traits</span>';
  $('#plateMut').innerHTML = strain.mutations && strain.mutations.length
    ? `<b>Mutations recorded:</b> ` + strain.mutations.map(mu => `${mu.locus} ${mu.from}→${mu.to}`).join(', ')
    : '';

  // name field only for a fresh cross
  const nameWrap = $('#plateNameWrap');
  if (opts.mode === 'new' || (opts.mode === 'record' && !strain.named)) {
    nameWrap.style.display = 'block';
    $('#plateInput').value = strain.name;
    $('#plateInput').oninput = e => { $('#plateName').textContent = e.target.value || strain.name; };
  } else nameWrap.style.display = 'none';

  /* Only a pressed specimen has a public page to point at. */
  const share = $('#plateShare');
  if (share) {
    share.style.display = strain.pressed ? 'inline-flex' : 'none';
    share.onclick = () => actions.shareSpecimen(strain);
  }

  $('#plateSave').textContent = opts.mode === 'new' ? 'Name it and keep' : 'Press into herbarium';
  $('#plateSave').onclick = () => {
    const v = ($('#plateInput').value || '').trim() || strain.name;
    actions.pressSpecimen(strain, v);
  };
  $('#plateClose').textContent = opts.mode === 'new' ? 'Keep in vault' : 'Close';

  m.classList.add('is-open');
  m.querySelector('.plate').classList.remove('is-drawn');
  drawPlateArt(strain);
  requestAnimationFrame(() => {
    drawPlateArt(strain);
    m.querySelector('.plate').classList.add('is-drawn');
  });
}
function closePlate() { $('#plate').classList.remove('is-open'); G.plate = null; }

function drawPlateArt(strain) {
  const c = $('#plateCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth || 240, h = c.clientHeight || 260;
  c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  // pressed-specimen paper wash
  const g = x.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.5, h * 0.75);
  g.addColorStop(0, 'rgba(255,251,238,0.85)');
  g.addColorStop(1, 'rgba(226,213,183,0.35)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  // faint grid, like a herbarium sheet
  x.strokeStyle = 'rgba(90,72,44,0.09)'; x.lineWidth = 1;
  for (let i = 20; i < w; i += 20) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
  for (let i = 20; i < h; i += 20) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
  const sp = SPECIES[strain.species];
  const scale = sp.form === 'stalk' ? 1.35 : sp.form === 'gourd' ? 1.5 : 1.7;
  x.save();
  x.translate(w / 2, h * (sp.form === 'gourd' ? 0.62 : 0.82));
  drawPlant(x, 0, 0, strain, 1, 0.4, { scale, noBadge: true });
  x.restore();
  // mounting tape
  x.fillStyle = 'rgba(214,196,150,0.75)';
  for (const [tx, ty, rot] of [[w * 0.5, h * 0.34, -0.12], [w * 0.5, h * 0.66, 0.1]]) {
    x.save(); x.translate(tx, ty); x.rotate(rot);
    x.fillRect(-16, -5, 32, 10);
    x.strokeStyle = 'rgba(150,130,90,0.5)'; x.lineWidth = 0.8; x.strokeRect(-16, -5, 32, 10);
    x.restore();
  }
}


/* ============================================================
   HEIRLOOM — guided tutorial
   A spotlight cuts a hole over whatever the player needs to touch, a card
   explains why, and the step clears itself when the player actually does it.
   Nothing is blocked: the overlay never swallows a click.
   ============================================================ */

const Coach = {
  on: false, i: 0, steps: [], rect: null, raf: 0, settle: 0, entered: false,
};

/* --- target helpers, all returning a screen-space rect --- */
function domRect(sel, pad = 10, round = 14) {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2, round };
}
function worldRect(gx, gy, w, h) {
  const p = iso(gx, gy);
  const z = G.camera.z;
  const view = viewport();
  const sx = (p.x - G.camera.x) * z + view.w / 2;
  const sy = (p.y - G.camera.y) * z + view.h / 2;
  return { x: sx - w / 2, y: sy - h / 2, w, h, round: 18, world: { gx, gy } };
}
function plotRect(i) {
  const pl = G.plots[i] || G.plots[0];
  const z = G.camera.z;
  const r = worldRect(pl.gx, pl.gy - 0.35, 130 * z, 130 * z);
  r.world = { gx: pl.gx, gy: pl.gy };   // the screen hole is lifted; the ring is not
  return r;
}
function firstPlantedPlot() {
  return G.plots.find(p => p.state !== 'empty') || G.plots[0];
}

/* --- the script --- */
function buildCoachSteps() {
  return [
    {
      id: 'welcome',
      title: 'Welcome to the Vale estate',
      body: 'You have four cleared beds, two lines of seed, and a reputation to build. The whole game is one question: can you make the plant better than the ones you were given?',
      target: () => { const r = worldRect(5.5, 5.6, 330 * G.camera.z, 220 * G.camera.z); r.world = null; return r; },
      cta: 'Show me',
      manual: true,
    },
    {
      id: 'plant',
      title: 'Plant your first seed',
      body: 'Tap the highlighted bed, then choose <b>Vale Row</b>. It is ordinary nursery stock — that is deliberate. Ordinary is where every line starts.',
      target: () => plotRect(0),
      advance: () => G.plots.some(p => p.state !== 'empty'),
    },
    {
      id: 'read',
      title: 'The drawing is the genotype',
      body: 'This is not decoration. <b>Yield</b> sets how many fruit appear, <b>Hardiness</b> thickens the stem and adds leaves, <b>Vigor</b> speeds the sway, <b>Essence</b> adds the shimmer, and <b>Colour</b> is the colour. You can read a plant from across the garden.',
      target: () => {
        const p = firstPlantedPlot();
        const r = worldRect(p.gx, p.gy - 0.4, 150 * G.camera.z, 150 * G.camera.z);
        r.world = { gx: p.gx, gy: p.gy };
        return r;
      },
      cta: 'Understood',
      manual: true,
    },
    {
      id: 'harvest',
      title: 'Harvest when the marker appears',
      body: 'A brass flower floats over any ripe bed. Harvesting gives you fruit to sell <b>and</b> one or two copies of the same seed — a good line multiplies itself.',
      target: () => {
        const p = firstPlantedPlot();
        const r = worldRect(p.gx, p.gy - 0.4, 150 * G.camera.z, 150 * G.camera.z);
        r.world = { gx: p.gx, gy: p.gy };
        return r;
      },
      advance: () => G.stats.harvests > 0,
      hint: () => {
        const p = G.plots.find(x => x.state === 'growing');
        if (!p) return '';
        return 'Ripens in ' + fmtTime((p.ripeAt - serverNow()) / 1000) + '.';
      },
    },
    {
      id: 'sell',
      title: 'Sell the harvest',
      body: 'Open the market cart. Fruit becomes coins; coins buy seed and mutagen. Coins are the soft currency — they never become $SEED.',
      target: () => (G.panel === 'market'
        ? (domRect('#panelBody .btn--brass', 8, 14) || domRect('#panelBody', 6, 16))
        : domRect('.dock__btn[data-panel="market"]', 6, 16)),
      advance: () => G.stats.sold > 0,
      hint: () => (G.panel === 'market' ? '' : 'Tap Market in the bar below.'),
    },
    {
      /* This step used to say "buy a second line, you cannot cross a plant with
         itself" — a new player was given one strain and had to shop before they
         could reach the game at all. They now start with two, so the step
         teaches what the nursery is *for* instead of clearing an obstacle. */
      id: 'buy',
      title: 'The nursery is a floor, not a ladder',
      body: 'Shop stock is deliberately poor — alleles of 1 to 3, and only Crimson or Amber. You can always buy your way back from a disaster, but you can never buy your way up. Everything above this line has to be bred.',
      target: () => (G.panel === 'market'
        ? domRect('#panelBody', 6, 16)
        : domRect('.dock__btn[data-panel="market"]', 6, 16)),
      cta: 'Understood',
      manual: true,
      hint: () => (G.panel === 'market' ? 'Nursery seed is further down the panel.' : 'Reopen the market cart.'),
    },
    {
      id: 'bench',
      title: 'Open the breeding bench',
      body: 'This is where the game actually happens. Everything before it was just growing food.',
      target: () => domRect('.dock__btn[data-panel="bench"]', 6, 16),
      advance: () => G.panel === 'bench',
      hint: () => 'You can also tap the bench itself, out by the east path.',
    },
    {
      id: 'parents',
      title: 'Choose two parents',
      body: 'You were given two lines — tap both to load them into the slots. Look at the allele pairs on each card: <b>a weak plant can still carry a strong recessive</b>, and that hidden allele is worth more than the plant you can see.',
      target: () => domRect('#panelBody', 6, 16),
      advance: () => (G.selection || []).length === 2,
    },
    {
      id: 'cross',
      title: 'Make the cross',
      body: 'The offspring takes <b>one allele at random from each parent</b> at every locus. A cross costs you nothing — both parents keep their seed — so cross often and keep whatever surprises you.',
      target: () => domRect('#panelBody .btn--brass', 8, 14) || domRect('#panelBody', 6, 16),
      advance: () => G.stats.bred > 0,
    },
    {
      id: 'notation',
      title: 'Read the specimen plate',
      body: 'The line in the middle is the full genotype. <b>Y3/2</b> means this plant carries a 3 and a 2 at the Yield locus, and passes on one of them. <b>CCr/Am</b> means it looks Crimson but carries Amber — and only you know that.',
      target: () => domRect('#plateNotation', 10, 8),
      cta: 'Understood',
      manual: true,
      guard: () => document.getElementById('plate').classList.contains('is-open'),
    },
    {
      id: 'name',
      title: 'Name it and press it',
      body: 'Give the strain a name and it is recorded permanently in the herbarium — accession number, parentage, mutations and all. This is the part that outlives the farm.',
      target: () => domRect('#plateNameWrap', 8, 12) || domRect('#plateSave', 8, 12),
      advance: () => G.herbarium.length > 0,
      guard: () => document.getElementById('plate').classList.contains('is-open'),
      hint: () => (document.getElementById('plate').classList.contains('is-open')
        ? '' : 'Plate closed — open the vault and tap Press on any strain.'),
    },
    {
      id: 'commission',
      title: 'Where $SEED comes from',
      body: 'Collectors post briefs asking for specific genetics. Meeting one is the <b>only</b> way to earn $SEED, and your standing with the guild decides how many briefs you can hold at once.',
      target: () => domRect('.dock__btn[data-panel="commission"]', 6, 16),
      advance: () => G.panel === 'commission',
      hint: () => 'The notice board stands at the south gate.',
    },
    {
      id: 'done',
      title: 'The rest is selection',
      body: 'Fix Essence first — it tilts colour mutations upward. Then chase the ladder: Crimson, Amber, Jade, Violet, Ivory. Roughly two hundred crosses to the end of it. Keep your carriers.',
      target: () => { const r = worldRect(5.5, 5.6, 330 * G.camera.z, 220 * G.camera.z); r.world = null; return r; },
      cta: 'Start breeding',
      manual: true,
    },
  ];
}

function startCoach(fromScratch = true) {
  Coach.steps = buildCoachSteps();
  if (fromScratch) Coach.i = 0;
  Coach.on = true;
  setTutorialDone(false);
  document.getElementById('coach').classList.add('is-on');
  enterCoachStep();
  if (!Coach.raf) Coach.raf = requestAnimationFrame(coachTick);
}

function endCoach(completed) {
  Coach.on = false;
  setTutorialDone(true);
  G.coachTarget = null;
  document.getElementById('coach').classList.remove('is-on');
  if (Coach.raf) { cancelAnimationFrame(Coach.raf); Coach.raf = 0; }
  if (completed) toast('The estate is yours. Chase the Ivory.', 'good');
}

function enterCoachStep() {
  const s = Coach.steps[Coach.i];
  if (!s) { endCoach(true); return; }
  Coach.entered = true;
  Coach.settle = 0;
  const card = document.getElementById('coachCard');
  card.classList.remove('is-in');
  document.getElementById('coachStep').textContent = `Step ${Coach.i + 1} of ${Coach.steps.length}`;
  document.getElementById('coachTitle').textContent = s.title;
  document.getElementById('coachBody').innerHTML = s.body;
  const next = document.getElementById('coachNext');
  next.style.display = s.manual ? 'block' : 'none';
  next.textContent = s.cta || 'Got it';
  document.getElementById('coachHint').textContent = '';
  document.getElementById('coachDots').innerHTML =
    Coach.steps.map((_, i) => `<i class="${i < Coach.i ? 'done' : i === Coach.i ? 'now' : ''}"></i>`).join('');
  requestAnimationFrame(() => card.classList.add('is-in'));
}

function nextCoachStep() {
  const card = document.getElementById('coachCard');
  card.classList.remove('is-in');
  Coach.i++;
  setTimeout(() => { if (Coach.on) enterCoachStep(); }, 180);
}

function placeCoachCard(rect) {
  const card = document.getElementById('coachCard');
  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 170;
  const M = 14;
  let x = rect ? rect.x + rect.w / 2 - cw / 2 : window.innerWidth / 2 - cw / 2;
  let y;
  const below = rect ? rect.y + rect.h + 16 : 0;
  const above = rect ? rect.y - ch - 16 : 0;
  let caret = 'up';
  if (!rect) { y = window.innerHeight - ch - 120; caret = 'none'; }
  else if (below + ch < window.innerHeight - 96) { y = below; caret = 'up'; }
  else if (above > 78) { y = above; caret = 'down'; }
  else { y = window.innerHeight - ch - 110; caret = 'none'; }
  x = clamp(x, M, window.innerWidth - cw - M);
  y = clamp(y, 66, window.innerHeight - ch - M);
  card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  card.dataset.caret = caret;
  const cx = rect ? clamp(rect.x + rect.w / 2 - x, 22, cw - 22) : cw / 2;
  card.style.setProperty('--caret-x', cx + 'px');
}

function coachTick() {
  Coach.raf = requestAnimationFrame(coachTick);
  if (!Coach.on) return;
  const s = Coach.steps[Coach.i];
  if (!s) return;

  if (s.guard && !s.guard()) {
    // the thing this step points at is gone; wait rather than point at nothing
    document.getElementById('coachHole').style.opacity = '0';
  } else {
    document.getElementById('coachHole').style.opacity = '1';
  }

  const rect = s.target ? s.target() : null;
  Coach.rect = rect;
  const hole = document.getElementById('coachHole');
  if (rect) {
    hole.style.left = Math.round(rect.x) + 'px';
    hole.style.top = Math.round(rect.y) + 'px';
    hole.style.width = Math.round(rect.w) + 'px';
    hole.style.height = Math.round(rect.h) + 'px';
    hole.style.borderRadius = (rect.round || 14) + 'px';
    G.coachTarget = rect.world || null;
  } else {
    G.coachTarget = null;
  }
  placeCoachCard(rect);

  if (s.hint) {
    const h = s.hint();
    const el = document.getElementById('coachHint');
    if (el.textContent !== h) el.textContent = h;
  }

  if (!s.manual && s.advance) {
    if (s.advance()) {
      Coach.settle += 1;
      if (Coach.settle > 12) { Audio_.ui(); nextCoachStep(); }
    } else Coach.settle = 0;
  }
}

/* legacy hook kept so gameplay code can nudge the tutorial without knowing about it */
function updateTutorial() {
  if (!Coach.on) return;
  const s = Coach.steps[Coach.i];
  if (s && !s.manual && s.advance && s.advance()) Coach.settle = 12;
}

export {
  $,
  el,
  esc,
  toast,
  updateHUD,
  geneBlock,
  strainCard,
  openPanel,
  closePanel,
  renderPanel,
  sortedVault,
  canFulfill,
  matchesCommission,
  showPlate,
  closePlate,
  onPlotClick,
  onStructureClick,
  openSeedPicker,
  closePicker,
  beginPlantFlow,
  startCoach,
  updateTutorial,
  buildCoachSteps,
  coachTick,
};
