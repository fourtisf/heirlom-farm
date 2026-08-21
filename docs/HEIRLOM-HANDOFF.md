# HEIRLOM — Build Handoff

**For:** Michael (via Claude Code)
**From:** ALFA
**Prototype:** `HEIRLOM.html` — single file, open it in a browser before reading further. Ten minutes of play will explain this document faster than the document will.

---

## 0. Read this first

HEIRLOM is a browser farm game where **the crop is not the product — the genetics are**. Players cross plants, inherit alleles, chase recessive colour morphs, and fill collector commissions that specify exact gene thresholds. A rare strain is the only thing of value in the game.

That single sentence dictates the entire architecture:

> **Every genetic operation happens on the server. The client never rolls a die that matters.**

The prototype does the opposite — it runs `breed()` in the browser with `Math.random()`. That is correct for a prototype and catastrophic in production. As shipped, anyone can open devtools and type:

```js
HEIRLOM.vaultAdd(HEIRLOM.makeStrain('moonflower',
  {Y:[6,6],V:[6,6],H:[6,6],E:[6,6]}, ['ivory','ivory']), 99)
```

…and mint 99 legendaries. Since strains are the economy, that is the whole economy. **Do not port the client logic. Port the formulas to the server and leave the client with rendering only.**

---

## 1. What to take from the prototype, and what to bin

| Prototype file region | Verdict |
|---|---|
| `part_b.js` — procedural art engine (`drawPlant`, terrain, buildings, ambience) | **Keep almost verbatim.** This is the visual identity. It draws every plant from its genes with no image assets. |
| `part_c.js` — iso projection, camera, renderer, input, day/night | **Keep.** Sound structure. Replace only the state reads. |
| `part_d.js` — UI panels, specimen plate, guided tutorial | **Keep the markup and CSS. Rewire the data source** from local state to API responses. |
| `part_a.js` — genetics engine, formulas, tiers, traits | **Port the formulas to the server. Delete from the client.** The client may keep *read-only* helpers (`phenotype`, `tierOf`, `strainScore`) purely for display of data the server already sent. |
| `part_e.js` — plant/harvest/breed/sell/commission logic | **Bin entirely.** Every one of these becomes an API call. |
| `window.HEIRLOM` debug bridge | **Strip in production builds.** Keep behind `NODE_ENV !== 'production'`. |

The prototype has **no persistence at all** (no localStorage by design). State is in-memory and dies on refresh. Persistence is your job from day one.

---

## 2. Stack

Same as our other builds — do not introduce anything new:

- **Frontend:** Next.js 14 (App Router), TypeScript, the existing canvas renderer mounted in a client component
- **Backend:** Fastify, TypeScript
- **DB:** PostgreSQL via Prisma
- **Cache / locks / rate limits:** Redis
- **Process:** PM2 on the Hostinger VPS
- **Auth:** wallet signature (SIWE-style nonce → sign → session JWT), same pattern as Robinfun

---

## 3. The genetics spec — port these exactly

These constants and formulas are balanced and simulation-tested. Changing any number changes the rarity curve. If you want to change one, tell ALFA first.

### 3.1 Loci

Four quantitative loci, plus one colour locus. Every plant is **diploid** — two alleles per locus.

| Key | Name | Alleles | Governs |
|---|---|---|---|
| `Y` | Yield | integer 1–6 | fruit per harvest |
| `V` | Vigor | integer 1–6 | time to ripen |
| `H` | Hardiness | integer 1–6 | blight resistance |
| `E` | Essence | integer 1–6 | unit value, and colour-mutation odds |
| `C` | Colour | enum | the visible morph |

### 3.2 Expression

Quantitative loci are **dominance-leaning, not averaged**:

```ts
expressLocus([a, b]) = clamp(round(max(a,b) * 0.68 + min(a,b) * 0.32), 1, 6)
// a 5/2 pair reads as 4, not 3.5
```

Colour is **classically Mendelian with the lower rank dominant**:

```ts
COLOR_RANK = { crimson: 1, amber: 2, jade: 3, violet: 4, ivory: 5 }
COLOR_BONUS = { crimson: 0, amber: 1, jade: 2, violet: 4, ivory: 7 }

expressColor([a, b]) = rank(a) <= rank(b) ? a : b
```

This is the heart of the game: **the beautiful morphs are recessive.** An Ivory plant only appears when both alleles are Ivory. Carriers show nothing, which is exactly why players hoard them. Do not "simplify" this.

### 3.3 Derived stats

```ts
score        = Y + V + H + E + COLOR_BONUS[color]        // range 4..31
growSeconds  = round(species.grow * (1.34 - V * 0.115))
yieldCount   = max(1, round(0.6 + Y * Y * 0.3))          // quadratic: 1..11
unitValue    = round(species.price * (0.68 + E * 0.22) * (1 + COLOR_BONUS * 0.09))
blightChance = clamp(0.16 - H * 0.026, 0.006, 0.16)
```

Tiers by score: `<10 Common · 10–14 Heirlom · 15–19 Rare · 20–24 Prized · ≥25 Legendary`

Traits (computed, not stored): `Abundant Y≥5 · Swift V≥5 · Ironleaf H≥5 · Gilded E≥5 · Balanced all≥4 · True-bred every locus homozygous`

### 3.4 Breeding — the one function that must be server-side

```ts
function breed(pa, pb, mutagen: boolean) {
  if (pa.species !== pb.species) throw BadRequest

  const mutRate = mutagen ? 0.26 : 0.09
  for (const locus of ['Y','V','H','E']) {
    let a = pickOne(pa.genes[locus])      // one allele from each parent
    let b = pickOne(pb.genes[locus])
    if (roll(mutRate))       a = clamp(a + (roll(0.62) ? 1 : -1) * (roll(0.16) ? 2 : 1), 1, 6)
    if (roll(mutRate * 0.7)) b = clamp(b + (roll(0.62) ? 1 : -1), 1, 6)
    child.genes[locus] = [a, b]
  }

  // colour walks the dominance ladder; Essence tilts it upward
  const ess = (phenotype(pa).E + phenotype(pb).E) / 2
  const colRate = (mutagen ? 0.085 : 0.030) * (0.8 + ess * 0.075)
  const stepColor = (allele, rate) => {
    if (!roll(rate)) return allele
    const rank = COLOR_RANK[allele]
    const up = roll(clamp(0.66 - rank * 0.035 + (ess - 3) * 0.04, 0.52, 0.8))
    return COLOR_KEYS[clamp(rank - 1 + (up ? 1 : -1), 0, 4)]
  }
  child.color = [ stepColor(pickOne(pa.color), colRate),
                  stepColor(pickOne(pb.color), colRate * 0.7) ]

  child.gen = max(pa.gen, pb.gen) + 1
}
```

Note the upward probability is **always above 0.5**. That is deliberate — an earlier balance pass had it dipping below, which made the ladder mathematically unclimbable and Ivory literally unreachable. Do not "fix" it downward.

**Verified rarity curve** (simulated, genotype-aware player, 5-parent pool): median **~200 crosses** to first Ivory without mutagen, **~100** with. That number is quoted on the title screen — if you change breeding constants, re-run the simulation and update the copy.

### 3.5 Species

| key | level | grow (s) | price | seed cost | form |
|---|---|---|---|---|---|
| tomato | 1 | 16 | 11 | 40 | bush |
| corn | 2 | 26 | 21 | 120 | stalk |
| chili | 4 | 22 | 33 | 340 | pod |
| pumpkin | 6 | 40 | 58 | 900 | gourd |
| moonflower | 9 | 58 | 130 | 2600 | bulb |

Grow times are **prototype-accelerated**. Decide with ALFA whether production uses these or real idle-game timers before you build the tick loop — it changes whether you need a scheduler.

### 3.6 Progression

```ts
LEVELS      = [0,60,170,360,640,1050,1650,2500,3700,5300,7500,10400,14200,19000,25000]
PLOT_UNLOCK = { 1:4, 2:5, 3:6, 4:7, 5:8, 6:9, 7:10, 8:11, 9:12, 10:13, 11:14, 12:15 }
repSlots    = rep >= 30 ? 3 : rep >= 12 ? 2 : 1
```

XP awards: harvest `6 + round(score * 1.1)` · sell `round(units * 1.5)` · breed `14 + gen * 3` · commission `round(18 + difficulty * 5)`

Harvest also returns seed copies: `1 + (roll(0.32 + E * 0.03) ? 1 : 0)`. Blighted beds return exactly 1 and yield `max(1, round(yield * 0.55))`.

---

## 4. Data model

```prisma
model Player {
  id            String   @id @default(cuid())
  wallet        String   @unique
  displayName   String?
  coins         BigInt   @default(260)
  seedBalance   Decimal  @default(0) @db.Decimal(18, 6)   // off-chain $SEED ledger
  xp            Int      @default(0)
  rep           Int      @default(0)
  mutagen       Int      @default(1)
  createdAt     DateTime @default(now())
  strains       Strain[]
  beds          Bed[]
  commissions   Commission[]
  produce       Produce[]
  ledger        LedgerEntry[]
  @@index([seedBalance])
}

model Strain {
  id          String   @id @default(cuid())
  accession   String   @unique                 // HB-xxxx, generated server-side
  playerId    String
  species     String
  genes       Json                             // { Y:[a,b], V:[a,b], H:[a,b], E:[a,b] }
  color       String[]                         // ["crimson","amber"]
  name        String
  named       Boolean  @default(false)
  generation  Int      @default(0)
  qty         Int      @default(1)
  parentAId   String?
  parentBId   String?
  mutations   Json?                            // audit trail of what shifted
  pressed     Boolean  @default(false)         // filed in the herbarium
  createdAt   DateTime @default(now())
  player      Player   @relation(fields: [playerId], references: [id])
  @@index([playerId])
  @@index([playerId, species])
}

model Bed {
  id          String    @id @default(cuid())
  playerId    String
  index       Int                              // 0..14
  strainId    String?
  plantedAt   DateTime?
  ripeAt      DateTime?                        // computed at plant time, server clock
  blighted    Boolean   @default(false)
  blightRolled Boolean  @default(false)
  player      Player    @relation(fields: [playerId], references: [id])
  @@unique([playerId, index])
}

model Produce {
  id        String @id @default(cuid())
  playerId  String
  species   String
  color     String
  qty       Int
  unitValue Int                                // frozen at harvest, not recomputed on sale
  player    Player @relation(fields: [playerId], references: [id])
  @@unique([playerId, species, color])
}

model Commission {
  id         String   @id @default(cuid())
  playerId   String
  collector  String
  note       String
  species    String
  reqs       Json                              // [{k:"E",min:4},{k:"C",color:"jade"}]
  coins      Int
  xp         Int
  seedReward Decimal  @db.Decimal(18, 6)
  status     String   @default("open")         // open | filled | declined | expired
  filledWith String?
  createdAt  DateTime @default(now())
  player     Player   @relation(fields: [playerId], references: [id])
  @@index([playerId, status])
}

model LedgerEntry {
  id        String   @id @default(cuid())
  playerId  String
  kind      String    // harvest | sale | purchase | breed | commission | withdrawal
  coins     BigInt   @default(0)
  seed      Decimal  @default(0) @db.Decimal(18, 6)
  meta      Json?
  createdAt DateTime @default(now())
  player    Player   @relation(fields: [playerId], references: [id])
  @@index([playerId, createdAt])
}
```

**Every** coin and $SEED movement writes a `LedgerEntry`. No exceptions. When someone claims they were robbed, the ledger is the answer.

---

## 5. API surface

All routes require a session JWT. All mutations are `POST`.

| Route | Does | Must validate |
|---|---|---|
| `GET /api/state` | full player snapshot: beds, vault, produce, commissions, balances | — |
| `POST /api/plant` `{bedIndex, strainId}` | plant a seed, decrement qty, set `ripeAt` | bed belongs to player, bed empty, bed index `< plotCapacity(level)`, strain owned and `qty >= 1` |
| `POST /api/harvest` `{bedIndex}` | roll blight if not yet rolled, award produce + seed copies + XP | `now() >= ripeAt`, bed occupied |
| `POST /api/sell` `{species, color, qty?}` | convert produce to coins at the **stored** `unitValue` | player owns that produce stack, `qty <= held` |
| `POST /api/buy-seed` `{species}` | mint nursery stock (alleles 1–3, colour crimson/amber) | `level >= species.lvl`, coins sufficient |
| `POST /api/buy-mutagen` | +1 mutagen, −450 coins | coins sufficient |
| `POST /api/breed` `{parentAId, parentBId, useMutagen}` | **the money endpoint** — see below | both owned, `qty >= 1` each, distinct ids, same species, mutagen held if requested |
| `POST /api/strain/name` `{strainId, name}` | rename + press into herbarium | owned, name 1–26 chars, profanity filter, `named === false` |
| `POST /api/commission/fulfil` `{commissionId, strainId}` | consume the strain, pay coins + $SEED + rep | commission open and owned, strain owned, **server re-checks `matches()`** |
| `POST /api/commission/decline` `{commissionId}` | drop it | owned, open |

### The breed endpoint, specifically

```
1. Redis lock on player:{id}:breed  (prevents double-submit racing)
2. Rate limit: max 1 breed / 2s, 400 / day per player
3. Load both parents FOR UPDATE inside a transaction
4. Validate ownership, species match, distinct rows, qty >= 1
5. If useMutagen: decrement mutagen atomically, fail if 0
6. Generate child with crypto-grade RNG (crypto.randomInt, not Math.random)
7. Persist child + LedgerEntry + XP in the same transaction
8. Return the child
```

The client renders the specimen plate from the response. It never computes the outcome and it never gets a second roll — **no retry, no re-roll, no "preview then confirm"**. The forecast panel in the prototype shows only the deterministic allele range, which is safe to compute client-side because it reveals nothing the player cannot derive from the two parent cards they already own.

---

## 6. Anti-cheat rules

1. **Time is the server's.** `ripeAt` is computed and stored at plant time. Never trust a client-supplied timestamp, elapsed duration, or "I finished early".
2. **RNG is `crypto.randomInt`.** `Math.random()` is seedable-adjacent and has no place in an economy.
3. **`matches()` runs server-side on fulfilment.** The client greys out non-matching strains for UX only; the server re-derives the phenotype from stored genes and re-checks every requirement.
4. **`unitValue` is frozen at harvest.** Store it on the `Produce` row. Otherwise a player harvests cheap, waits for a balance patch, and sells dear.
5. **Genes are never accepted from the client.** No endpoint takes a `genes` payload. Ever.
6. **Rate limit everything**, but breed and harvest hardest. A bot that breeds 10k times a minute is the failure mode that matters.
7. **Commissions are generated server-side and bound to a player.** The `reqs` JSON is authoritative; the displayed text is derived from it, not the reverse.

---

## 7. Token model — $SEED

Deliberate design, keep it:

- **Coins** are the soft currency. Earned by selling produce, spent on seed and mutagen. They never convert to $SEED.
- **$SEED** is earned **only** from commissions, and commission slots are gated by reputation: 1 slot → 2 at rep 12 → 3 at rep 30.

This means token emission is throttled by *reputation*, not by farm size, so a whale with 15 beds does not out-mint a careful breeder. Same shape as AMBERVALE.

Implementation:

- `seedBalance` is an **off-chain ledger balance**. Commissions credit the ledger; nothing touches a chain.
- Withdrawal to wallet is a **separate, throttled, reviewable flow** — a `WithdrawalRequest` table, a minimum threshold, a cooldown, and a manual or multi-sig release step for anything above a limit ALFA sets.
- Never mint on-chain per commission. That is a gas bill and an exploit surface in one.

**Chain is not decided yet.** Robinhood Chain (following SUNMILL and AMBERVALE) vs Solana — ask ALFA before writing any contract code. Build the ledger first; it is chain-agnostic and you will need it either way.

---

## 8. Build order

Ship in this sequence. Each phase should be playable end-to-end before the next starts.

**Phase 1 — Skeleton (no genetics)**
Auth, `Player`, `GET /api/state`, the canvas renderer mounted in Next.js reading from the API, beds rendering from server data. No planting yet. Goal: the garden draws from the database.

**Phase 2 — The loop**
Plant, harvest, sell, buy seed. Server-side timers. Ledger writes. Goal: a player can earn coins.

**Phase 3 — Genetics**
The breed endpoint with the full formula set, the specimen plate, naming, herbarium. Port the test suite from the prototype (`test_genetics.js`) into Vitest against the server module. Goal: crossing works and is provably correct.

**Phase 4 — Commissions and $SEED**
Generation, rep gating, fulfilment, off-chain ledger. Goal: the token faucet exists and is throttled.

**Phase 5 — Hardening**
Rate limits, Redis locks, load test the breed endpoint, admin ledger view, withdrawal flow. Goal: safe to open to the public.

**Phase 6 — Chain**
Only after ALFA picks the chain.

---

## 9. Acceptance tests to port

The prototype ships with two suites. Port both — they caught real bugs during design.

`test_genetics.js` asserts:
- `5/2` expresses as `4`, not `3.5`
- crimson dominates ivory; ivory only expresses homozygous
- every child allele traces to a parent, except at the measured mutation rate
- mutagen raises the observed rate by more than 1.6×
- cross-species is refused
- max genotype scores 31 and reads Legendary; min scores 4 and reads Common
- **Ivory is reachable in 12/12 simulated runs with a median near 200 crosses** — this is the balance guard, keep it

`test_game.js` (jsdom) asserts the full session: boot state, 90 render frames across a day cycle, 150 plant-drawing permutations, all panels, plant→ripen→harvest→sell, breeding + plate, 400 generated commissions all satisfiable, fulfilment paying $SEED, rep gating, bed unlock curve, hit-testing on all 15 beds, and the complete 13-step tutorial walk.

Add for the server build:
- concurrent double-submit of `/api/breed` produces exactly one child and decrements one mutagen
- a forged `genes` payload on any endpoint is rejected
- a strain that does not match a commission is rejected server-side even if the client sent it

---

## 10. Open questions for ALFA

Do not guess on these — ask:

1. **Chain for $SEED** — Robinhood Chain or Solana?
2. **Timers** — keep prototype-speed (16–58s) or move to real idle timers (minutes/hours)? Changes whether you need a scheduler and push notifications.
3. **Strain trading between players** — the prototype has none. If it is coming, the schema above supports it, but marketplace escrow and anti-wash-trading need their own spec.
4. **Do commissions expire?** Currently they sit until filled or declined.
5. **Herbarium visibility** — private, or a public showcase page? A public accession page (`/herbarium/HB-4821`) would be strong for CT sharing, and the specimen plate is already built to be screenshotted.

---

## 11. Known prototype gaps

Things intentionally absent, so you do not go looking for them:

- No persistence of any kind — refresh resets everything
- No auth, no wallet, no network calls at all
- No sound assets (all audio is synthesised WebAudio, keep it)
- No image assets whatsoever — every pixel is procedural, keep it that way
- Blight is rolled once per planting at 55% growth; there is no cure item yet
- Day/night is a 240-second cosmetic cycle with no gameplay effect except Moonflower bloom intensity
