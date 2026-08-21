# What HEIRLOM is missing

A review of the built game against one goal: **fun, and easy to pick up.**

The engineering here is not the problem. The server owns every roll, the ledger is complete, the
module graph enforces the client/server boundary, and the balance guard holds the rarity curve. That
is a better foundation than most shipped games have.

What is missing is almost entirely on the other side: the game is *correct* before it is *enjoyable*.
Below, in the order I would build them.

---

## The one-line diagnosis

**HEIRLOM makes the player do the work of a breeder without giving them the feelings of one.**

The crossing is the game. It is also, right now, a button that returns a card. There is no
anticipation before the roll, no read on whether a failed cross got you closer, and no reason to
prefer one cross over another beyond raw score. A hundred crosses to Ivory is not a long chase; it is
a hundred identical button presses with a card at the end of each.

Everything in Tier 1 is about fixing that, and none of it touches the genetics engine.

---

## Tier 1 — the fun. Build these first.

### 1.1 The cross needs a reveal, not a return value

`doBreed` in `apps/web/src/game/actions.js` awaits the API and calls `ui.showPlate(child)`. The
single most valuable moment in the game resolves in under 200ms with no build-up.

The result is already committed on the server before the animation starts, so none of this is a
fairness question — it is pure theatre, and it is free:

- The plate opens empty, on parchment, with the accession code typing in.
- The four quantitative loci resolve **one at a time**, ~180ms apart, each with its allele chips
  landing before the bar fills.
- The colour locus resolves **last**, and holds a beat before it does.
- A tier at Prized or above lands with the existing `Audio_.rare()` and a slower fill.

Cost: perhaps 80 lines in `ui.js`, no server change, no balance change. Nothing else in this document
will move "is it fun" as far per line of code.

### 1.2 Show the near miss

The colour ladder steps at 3% base. A player will cross twenty to thirty times before anything moves,
and every one of those crosses currently reports the same thing: nothing happened.

But something *did* happen, and the data is already there:

- `BreedResult.mutations` records every allele shift, including colour ladder steps. It is stored on
  the row and serialised to the client. **Nothing in the UI reads it.** Surface it on the plate:
  *"Vigor 3 → 4"*, *"Colour: Amber → Jade"*. A cross that moved something should say so.
- A child's hidden colour allele is in `strain.color[1]` and already reaches the client. `geneBlock`
  draws it as an unlabelled swatch. Label it: **"Carries Violet"** as a badge on the card. A plain
  crimson plant that carries Violet is the most valuable thing in a player's vault and the interface
  currently whispers it.
- Track and display *closest approach* — the best colour allele the player has ever held. "Nearest to
  Ivory: Violet carrier, 12 crosses ago" turns a flat grind into a visible climb.

Near-miss feedback is what makes a low-probability chase tolerable. This game has the rarest possible
reward structure and none of the feedback that structure requires.

### 1.3 Crossing is free and rate-limited, which makes spamming it optimal

Commit `e20200d` stopped charging for crosses. That fixed a real blocker, but it removed the last
decision from the bench: there is now no reason not to cross your two best specimens every two
seconds until the daily cap. The rate limiter is the only thing shaping play, and a rate limiter is
not a game mechanic — it is a wall.

Give the bench a **germination timer** instead of a price:

- A cross occupies the bench for 25–45s and resolves into a plate the player comes back to.
- One bench slot at first; the seed library upgrade adds a second, the glasshouse a third.
- Mutagen keeps its current job, and additionally cuts the germination time.

This costs one nullable column and turns the strongest button in the game into a resource the player
schedules around. It also gives the idle loop a second clock that is not beds, which is what makes
the "check back in" habit form.

### 1.4 Make the first colour step happen in session one

Median 101 crosses to first Ivory (`docs/DECISIONS.md` §3) is a fine *end* of the chase. The problem
is the *start*: a new player can plausibly do their first thirty crosses and never see the colour
locus move at all, which reads as "colour is not part of this game."

Add a one-time, server-side floor: **a player's first colour ladder step is guaranteed within their
first N crosses** (N ≈ 12). Once only, recorded on the player row, invisible in the copy. It does not
touch the curve — the balance guard's band is far wider than one forced step — and it converts the
opening from "nothing is happening" into "I saw it move, I want it to move again."

---

## Tier 2 — "gampang dimainkan". The ease-of-play work.

### 2.1 Nothing ever answers "what do I do now"

Past the thirteen-step tutorial, the game never states a current objective. The dock offers seven
destinations and no priority among them.

Add one **objective chip** in the HUD, server-computed, one line, always present: *"Sell 12 fruit"* →
*"Cross two tomatoes"* → *"Reach level 3 for the chili line"*. A single `nextGoal` field on the state
snapshot. This is the highest-leverage ease-of-play change in the codebase and it is perhaps 60 lines
end to end.

### 2.2 Seven dock destinations is two too many

By level 9 the dock carries vault, bench, herbarium, market, commissions, exchange, estate, help.
Market and exchange are both "trade" to a new player, and the distinction that matters (NPC prices vs
other players) is better taught as two tabs inside one destination than as two icons. The herbarium is
a record, not an activity — it belongs inside the estate, next to the milestones it sits beside
conceptually.

Five destinations: **Seeds · Bench · Trade · Orders · Estate.**

### 2.3 The vocabulary is a first-session tax

Accession, herbarium, commission, phenotype, locus, mutagen, press. The register is genuinely lovely
and it is a real part of what the game is — but it is currently doing double duty as the *interface*
language, and a player cannot learn a game and a glossary at once.

Keep every word of it on the specimen plate, the herbarium page, and the collectors' notes, where the
flavour earns its keep. Use plain words on the buttons and the dock. "Cross these two", not "commit
to the bench". The plate can say *accession HB-4417*; the button that gets you there says *Name it*.

### 2.4 Scores have no reference point

A card shows `score 17` against a 4–31 range the player has to reverse-engineer. Show the comparison
instead: **"+3 vs your best tomato"**. The player never needs to learn the scale to make the decision
the number exists to support.

### 2.5 `window.prompt` for listing a price

`openListDialog` in `actions.js` collects the sale price with `window.prompt`. Beyond looking like
2005, it is suppressed or awkward in several in-app browsers — including the one inside X, which is
exactly where a game built to be shared from X will be opened. This needs to be a real dialog, with
the advisory quote and the 6% burn shown as numbers rather than crammed into a prompt string.

### 2.6 The wallet gate is in front of the first plant

`SignIn.tsx` requires an EIP-1193 wallet and a signature before the player has seen anything. For a
game whose pitch is "fun and easy", this is the largest single funnel loss in the product, and it is
paid before any of the work above can do its job.

Let people play. A guest session — a player row keyed to a device token, no wallet — that binds to a
wallet later, at the point where it first means something (withdrawal, the exchange, anything
touching $SEED). Nothing in the anti-cheat model depends on the wallet existing at signup; it depends
on the server owning the rolls, which it will either way.

---

## Tier 3 — retention. There is currently none.

The game has no reason to be opened tomorrow that it did not have today.

- **No return hook.** Beds ripen on the server clock while the player is away and they come back to a
  silent screen. A "while you were away: 4 beds ripened, 2 commissions expiring" summary on load is
  cheap and is the single most reliable return mechanic there is.
- **No daily anything.** No streak, no daily commission, no daily seed. `startPolling` at 20s
  intervals is the only heartbeat in the client.
- **Nothing drives traffic to the herbarium.** `/herbarium/HB-xxxx` is built, public, and share-ready,
  and the only way anyone reaches one is if a player sends the link themselves. Add a **recently
  pressed** wall and a **specimen of the week**. That is free social proof, it gives the exchange
  price discovery a face, and it is the thing that actually feeds an X account.
- **No leaderboard, and no way to see another player at all** except as an anonymous listing on the
  exchange board.

## Tier 4 — economy risks worth a pass before launch

- **The 16–58s grow times are the worst of both worlds.** `GROW_TIME_SCALE = 1` keeps prototype
  speed: too slow to be an active arcade loop, far too fast to be an idle game with notifications.
  Pick one. My recommendation for "fun and easy": go *faster* for levels 1–5 (tomato at ~6s) so the
  opening loop snaps, then let the later species stretch. The scale knob already exists; what is
  missing is a per-species curve rather than a single multiplier.
- **Coins have nowhere to go after the estate.** Four one-time upgrades, then the currency piles up.
  Add a repeatable sink — re-roll a commission, rent a bench slot, buy a targeted nursery line.
- **The exchange is blind.** Already noted in `DECISIONS.md` §5.7, and it matters more than it reads:
  with no price history and a 6% burn, every seller is guessing and every buyer suspects they
  overpaid. A rolling median per species/tier is a market-health fix, not a nicety.
- **The upgrade curve is unsimulated** (their note, §5.7). The rarity curve has a guard in CI; the
  throughput curve has nothing. Same treatment before launch.

## Tier 5 — noted, not urgent

- No sound toggle in the interface. `Audio_.on` exists and nothing sets it.
- `ui.js` is 1300 lines of `innerHTML` assembly. It is coherent and it works, but the plate and the
  panels are where every change above lands, so it is the file that will hurt first.

---

## If only three things get built

1. **The reveal animation** (1.1) — the largest fun-per-line change available.
2. **The objective chip** (2.1) — the largest ease-of-play change available.
3. **Guest play** (2.6) — without it, nobody reaches either of the other two.
