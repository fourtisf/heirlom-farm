# Decisions taken during the build

Everything here is a call made while porting `HEIRLOOM.html` to the production stack. The handoff's
§10 listed five questions marked "do not guess"; four were answered by Michael before the build, and
the fifth is still open. The rest are divergences from the prototype, each with the reasoning, so
they can be reversed knowingly rather than rediscovered.

---

## 1. Answered before the build

| Question (handoff §10) | Answer | Consequence |
|---|---|---|
| Timers — prototype speed or real idle? | **Keep prototype speed** (16–58s) | No scheduler needed. `GROW_TIME_SCALE` in `constants.ts` is the single knob that moves the whole economy onto idle timers without touching a formula. |
| Chain for $SEED | **Ledger only, no chain** | `seedBalance` is an off-chain `Decimal`. Withdrawal is a request queue. No contract code exists. |
| Do commissions expire? | **No** | They sit until filled or declined, as in the prototype. `status` already carries an `expired` value if that changes. |
| Herbarium visibility | **Private**, later reversed — see §5.5 | Pressed specimens now have a public page; unpressed ones stay private. |

**Still open — needs ALFA:** which chain, when the ledger is ready to settle. Nothing in the build
depends on the answer, which was the point of building the ledger first.

---

## 2. Divergences from the prototype

### 2.1 Produce stacks merge at a quantity-weighted average

The prototype averaged the old and new unit value unweighted:

```js
value = Math.round((existing.value + incoming) / 2)
```

That is exploitable. Harvest a hundred cheap units at value 10, then harvest one expensive unit at
value 30, and the whole stack becomes worth 20 — roughly 990 coins conjured from a single fruit.

The production version weights by quantity, which conserves the stack's total value exactly. This is
what handoff rule §6.4 ("`unitValue` is frozen at harvest") is actually protecting; the unweighted
mean let a later harvest retroactively reprice an earlier one, which is the same failure in a
different disguise.

`apps/server/src/routes/farm.ts` → `addProduce`.

### 2.2 Blight is rolled at plant time, not harvest time

Handoff §5 describes harvest as "roll blight if not yet rolled". Rolling at harvest means the player
chooses when the die is thrown, and anything a player can time is a thing a player can farm.

Blight is now rolled once when the bed is planted and stored. It is **withheld from the client** until
the bed reaches 55% growth, which preserves the prototype's reveal timing exactly — `bedView` returns
`blighted: null` before that threshold rather than the real value. The harvest path still rolls if
`blightRolled` is somehow false, so the handoff's described behaviour remains as the fallback.

`apps/server/src/lib/serialize.ts` → `bedView`, and `routes/farm.ts` → `plant`.

### 2.3 Naming presses a specimen without removing it from circulation

An early reading of "press into the herbarium" made named strains unplantable. That is wrong, and
wrong in a way that would quietly kill the feature — nobody names their best line if naming destroys
it. The prototype adds the strain to a codex list and leaves it in the vault.

`pressed` now means "has a herbarium record". A strain can be in the vault and the herbarium at once.
Commission fulfilment also sets `pressed`, so a specimen you gave away is still on record — matching
the prototype's `codexAdd` on fulfil.

### 2.4 Escape closes the topmost overlay

In the prototype Escape only called `closePanel()`, so the specimen plate and the seed picker could
not be dismissed with the keyboard and would sit on top of whatever opened next. Escape now walks
plate → picker → panel.

### 2.5 The debug bridge is read-only

The prototype's `window.HEIRLOOM` exposed `makeStrain`, `breed`, and `vaultAdd` — the handoff opens
by pointing out that this lets anyone mint 99 legendaries from the console. The bridge survives in
development because it is genuinely useful, but it now exposes only state, the API client, and panel
controls. There is no longer any browser code path that can create a strain, so there is nothing to
strip beyond the bridge itself.

---

## 3. On the "~200 crosses to Ivory" figure

The title screen quotes ~200 crosses to first Ivory without mutagen, ~100 with. The balance guard
holds Ivory reachable and the formulas are ported exactly, but the absolute number is a property of
the **player model**, not of the engine.

Measured over 60 seeded runs with the simulated breeder in `test/genetics.test.ts` — which keeps a
five-parent pool and always crosses its two best carriers:

| | median | min | max | never reached |
|---|---|---|---|---|
| no mutagen | 101 | 27 | 199 | 0/60 |
| mutagen | 47 | 15 | 129 | 0/60 |

The **ratio** is 2.15×, against the handoff's quoted 2× — which is the number that actually tests
whether the formulas were ported faithfully, and it matches. The absolute median is lower than 200
because this simulated player is more aggressive than the one used in the original balance pass: it
ranks parents by hidden carrier value, so it hoards Ivory carriers a real player might sell.

**No constant was changed.** The guard asserts a band (60–420) wide enough that ordinary seed noise
cannot fail CI but a real balance shift will. Before quoting a new figure publicly, agree the player
model with ALFA — the copy is only meaningful relative to an assumed strategy.

---

## 4. Things worth knowing that are not decisions

- **`JWT_SECRET` is required and must be ≥32 characters.** The server refuses to boot without it
  rather than starting with a weak default.
- **`/health` is exempt from the rate limiter** and reports `db` and `redis` status separately. It
  was originally covered by the Redis-backed limiter, which meant a Redis outage returned 500 — every
  load-balancer probe would fail at the moment the service most needs to stay routable.
- **Server tests need a real Postgres and Redis.** They test transactional races; a fake would pass
  while proving nothing.
- **`next dev` and `next build` write to separate directories** (`.next-dev` and `.next`). They
  shared one by default, and running a build beside a live dev server left it serving production
  chunks — the debug bridge would vanish, then it would fail outright with a confusing
  `Cannot find module './522.js'`. It caught me twice before I stopped documenting it and fixed it.


---

## 5. The second pass — what the game was missing

Asked to assess the finished build, I said the game had four holes. All four are
now filled. One rule held throughout, and there is a test asserting it:
**`breed()` and every constant the rarity curve depends on are untouched.**
Everything below changes throughput, stakes or goals — never how many crosses it
takes to reach Ivory.

### 5.1 The exchange

The pitch is that genetics are the product, but a product needs a market. Before
this, a Legendary Ivory could only fill your own commissions; nobody else could
want it, so "the only thing of value" was never tested by anyone.

Design calls made here:

- **Coins, never $SEED.** $SEED emission is throttled by reputation on purpose.
  Letting it trade would route around that gate and turn every commission into a
  tradeable faucet.
- **Escrow on listing.** The seed leaves the seller's stack immediately, so it
  cannot be planted, bred, or sold while it sits on the board. Cancelling
  returns it; there is a test that three concurrent cancels return exactly one.
- **The 6% fee is burned, not paid.** This is what makes trading a coin sink
  rather than a coin shuffle, and it is the anti-wash-trading measure that
  actually works: a pair churning a specimen between them is strictly poorer
  after every round trip, and a test measures exactly that. Self-trades are
  blocked outright and selling is gated at level 3, so a throwaway alt cannot be
  spun up to funnel coins.
- **The buyer receives a copy, not the row.** The seller's herbarium record and
  the specimen's parentage links stay intact; the accession is preserved with a
  suffix so a traded plant keeps the identity printed on its plate.

### 5.2 Stakes

Breeding had no downside — a bad cross cost sixteen seconds — and blight cost
45% of one harvest, which is a rounding error once a few beds are running.
Hardiness therefore did almost nothing, and nothing in the game could take a
line away from you.

A share of blighted plantings are now **lost outright**: no produce, no seed
copy. The odds are gated by Hardiness (43% of blight cases at H1, 8% at H6), so
a tough plant does not merely catch blight less often, it survives the blight it
catches. The roll happens at harvest as a consequence of the blight, not as a
second independent fate.

This is the only mechanic in the game that can permanently destroy a line, and
it is deliberately reachable: plant your last seed of a fragile strain and you
can lose it.

### 5.3 Coin sinks

Coins bought seed and mutagen and nothing else, so the mid-game economy went
flat. Four permanent estate upgrades now give it somewhere to go — cold frame,
irrigation, seed library, glasshouse — each capped at two or three levels and
priced quadratically.

They move grow time, blight odds, seed-copy chance and sale price. They are
applied server-side from the stored rows, so a client claiming a glasshouse gets
nothing. **This is a new balance surface** and worth a look before launch: it
changes crosses-per-hour, though not crosses-to-Ivory.

### 5.4 Long goals

Seventeen milestones, evaluated server-side against stored genes and awarded
once. They survive selling the specimen that earned them, because the record is
of what you bred rather than what you currently hold.

Carrier genotypes deliberately do not count: expressing Ivory is the
achievement, holding one hidden is not.

### 5.5 Teaching the carrier idea, and going public

Two smaller gaps, both now closed:

- **The bench shows a colour Punnett square.** The strategic core of the game is
  that a plain-looking plant may be the most valuable thing you own, and nothing
  ever said so. It reads out the odds and then says the thing plainly — for two
  carriers crossed, "25% of offspring will show Ivory outright. Another 50% will
  look plainer but still carry something rarer." It excludes mutation on
  purpose: the ladder can still surprise a player upward, and that surprise
  should stay a surprise.
- **Pressed specimens have a public page** at `/herbarium/HB-xxxx`, with a share
  button on the plate. This reverses the earlier "herbarium private" call on
  Michael's instruction. Pressing is the opt-in: only a named specimen is
  published, unpressed ones 404, and the page carries nothing about the owner
  beyond the gardener name they chose. There is a test asserting the wallet and
  player id never appear in the response.

### 5.6 Mobile

The panels already collapsed to a bottom sheet, but the dock now carries seven
destinations and the HUD clipped its XP readout at 390px. The dock scrolls
horizontally rather than crushing its labels, and the HUD drops the day-phase
label — flavour rather than information — to make room.

Also fixed while there: the tutorial replayed on every reload, because
`tutorial.done` was client-only state in a prototype that had no persistence at
all. It is now remembered in localStorage, and the ? menu still replays it.

### 5.7 Still open

- **Chain for $SEED.** Unchanged, and still nothing depends on it.
- **The exchange has no price history.** Sellers get an advisory quote derived
  from score and generation; there is no record of what things actually sold
  for. That is the next thing worth building if trading takes off.
- **The upgrade curve is unsimulated.** The rarity curve is guarded by a test;
  the throughput curve is not. Worth a balance pass before launch.


---

## 6. The playtest, and a bug it found

I played the opening two minutes and measured it rather than guessing. The first
run:

```
session          120s
waiting          114s  (95%)
acting             6s  (5%)
crosses            0        <- the only interesting decision in the game
blocked          ["no seed to plant"]
best score         0 for the first 58 seconds (the vault was empty)
```

Two separate causes, both now fixed.

### 6.1 The opening kit could not reach the game

A new player got **one** strain with two seeds, and four open beds. They plant
two, the vault is empty, and they cannot cross anything either — a cross needs
two *distinct* parents. So the core of the game was unreachable for the opening
minutes, and the tutorial's breeding step had nothing to work with.

New players now get two separate nursery lines of two seeds each: four beds
filled, and the bench works from the first minute. Both are still ordinary
nursery stock, rolled separately so they differ.

### 6.2 Crossing was charging for parents it should not have

**This was my bug, and a consequential one.** `POST /api/breed` decremented `qty`
on both parents, so every cross cost two seeds. The prototype's `doBreed()` never
did that — it spends mutagen and nothing else — and handoff §5 says to validate
`qty >= 1`, which is a requirement to *hold* the seed, not a price. I read it as a
cost.

The effect was severe and invisible:

- With four opening seeds and four beds, a player who planted their beds could
  never breed at all. The greedy strategy starved the bench completely, which is
  exactly what the playtest bot did and why it recorded zero crosses.
- Two crosses would empty a starting vault.
- **It quietly invalidated the balance pass.** The ~200-crosses figure assumes a
  player keeps crossing their best pair from a standing pool. That is impossible
  if each cross consumes both parents, so the shipped game was far harsher than
  anything that was ever simulated — and the balance guard did not catch it,
  because the simulation breeds from a pool without modelling seed supply.

Crossing is now free. It is limited by the rate limiter and by mutagen, as the
prototype intended. There is a test asserting both parents keep their seed, and
another asserting a new player holds two distinct lines.

### 6.3 What the fixes actually changed

Same playtest, same bot, after both:

| | before | after |
|---|---|---|
| crosses in two minutes | 0 | 1 |
| blocked moments | `["no seed to plant"]` | *none* |
| milestones earned | 0 | 1 |

A separate check of the opening minute confirms a new player now holds two
distinct lines, can cross before doing anything else, and keeps both parents'
seed afterwards.

**Waiting is still ~95% of a two-minute session**, and that is honest: it is a
consequence of 16–58 second timers, which is a decision already taken. What
changed is that the wait is now *usable* — the bench works from the first minute
and crossing is free, so there is something to do with the time. If the dead time
is still felt in real play, the lever is `GROW_TIME_SCALE`, not another feature.

**Also still open for the balance pass:** the guard's simulation does not model
seed supply or bed pressure, so it measures the genetics rather than the whole
game. A player who plants every seed still has nothing to cross that turn. That
tension is probably good, but it is untested.

---

## 7. Species identity

The prototype gave every species a note describing how it behaves, then gave all
five identical maths — only `grow` and `price` differed:

| species | note | mechanic before |
|---|---|---|
| tomato | "Reliable." | baseline |
| corn | "Recessive alleles hide well in this line." | **none** |
| chili | "Small yield, high essence." | **none** |
| pumpkin | "Yield gene expresses dramatically." | **none** |
| moonflower | "Blooms after dusk." | cosmetic only |

So "which species do I grow" had one answer: the most expensive one you could
afford, because a bigger base price beat everything else. The notes were promises
the game did not keep.

They are now true:

- **corn** returns spare seed far more often, and is hardier. A line hides an
  allele by surviving long enough to pass it on, so this is what "hides well"
  actually means in play — a corn carrier is hard to lose by accident.
- **chili** weighs Essence nearly double, and yields little.
- **pumpkin** steepens the yield curve in both directions: a Y6 pumpkin is an
  estate, a Y2 pumpkin is barely worth the bed.
- **moonflower** grows fast if planted after dusk and sulks if planted at noon.
  This is the first thing in the game to give the day cycle a gameplay effect.

**Breeding is untouched.** The modifiers reach expression and economy only, and
there is a test that runs the same seeded cross under all five species and
asserts the children come out byte-identical.

Implementing the moonflower rule exposed a bug in the making: the client's day
cycle was a free-running animation counter, which was fine while it was purely
cosmetic but would now disagree with the server about whether it is night. Both
sides derive the phase from the wall clock instead.

**This is a new balance surface** and, like the estate upgrades, it is
unsimulated. Worth a pass before launch.
