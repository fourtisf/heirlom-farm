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
| Herbarium visibility | **Private** | `GET /api/strain/:id` is owner-only. No public accession page. |

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
- **`next build` and `next dev` share `.next`.** Running one after the other without cleaning
  produces `Cannot find module './522.js'`.
