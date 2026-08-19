# HEIRLOOM

A browser farm game where **the crop is not the product — the genetics are**. Players cross plants,
inherit alleles, chase recessive colour morphs, and fill collector commissions that specify exact
gene thresholds. A rare strain is the only thing of value in the game.

That single sentence dictates the architecture:

> **Every genetic operation happens on the server. The client never rolls a die that matters.**

## Layout

```
packages/genetics    the engine — expression, breeding, tiers, traits, commissions
apps/server          Fastify + Prisma + Redis. Owns every roll and every balance.
apps/web             Next.js. Renders what the server sent, and nothing else.
prototype/           the original single-file prototype, for reference
docs/                the build handoff and the decisions taken since
```

### The client/server split is structural

`packages/genetics` has two entry points, and the boundary is enforced by the module graph rather
than by convention:

| import | contains | safe in a browser |
|---|---|---|
| `@heirloom/genetics` | constants, expression, derived stats, progression maths, `matches`, `forecast` | yes — none of it rolls a die |
| `@heirloom/genetics/server` | `breed`, `nurseryStock`, `generateCommission`, `cryptoRng` | **no** |

Importing the server half from client code fails the web build. That is deliberate: it is how we
found the boundary was worth enforcing in the first place.

## Running it

You need PostgreSQL and Redis.

```bash
npm install

# genetics package must be built before the server or web app can resolve it
npm run build -w @heirloom/genetics

# server
cp apps/server/.env.example apps/server/.env   # then edit DATABASE_URL and JWT_SECRET
npm run db:push -w @heirloom/server
npm run dev:server                             # http://localhost:4000

# web
cp apps/web/.env.example apps/web/.env.local
npm run dev:web                                # http://localhost:3000
```

`JWT_SECRET` must be at least 32 characters, and the server refuses to boot without it. A server
that starts without one is a server handing out forgeable sessions.

## Tests

```bash
npm test                  # everything
npm run test:genetics     # engine only, no services needed
```

`apps/server` tests run against a **real** Postgres and Redis. The behaviour under test is
transactional and racy; an in-memory fake would prove nothing about the races the tests exist to
catch. Point them at a throwaway database via `apps/server/.env.test`.

The genetics suite includes the **balance guard** — the assertion that Ivory stays reachable. If it
fails, the rarity curve has moved. Do not adjust the assertion; re-run the balance pass and update
the title-screen copy with ALFA.

## Anti-cheat, in one place

The rules from the handoff, and where each one lives:

| rule | where |
|---|---|
| Time is the server's | `ripeAt` computed at plant time in `routes/farm.ts`. No endpoint reads a client timestamp. |
| RNG is `crypto.randomInt` | `packages/genetics/src/crypto-rng.ts`, server-only by module graph |
| `matches()` re-runs on fulfilment | `routes/commission.ts` re-derives the phenotype from stored genes |
| `unitValue` frozen at harvest | stored on the `Produce` row; sales never recompute it |
| Genes are never accepted from the client | no route schema has a `genes` field, and zod drops unknown keys |
| Rate limit everything, breed hardest | `routes/breed.ts`: 1 per 2s, 400/day, plus a Redis lock |
| Commissions are server-generated | `lib/player.ts`, bound to the player, `reqs` authoritative |

Beyond the lock and the rate limit, `/api/breed` also uses conditional writes inside its
transaction, so even with both failing open a mutagen can only be spent once. There is a test for
exactly that: five concurrent calls produce one child.

**Every** coin and $SEED movement writes a `LedgerEntry`. No exceptions. When someone claims they
were robbed, the ledger is the answer.

## The exchange

Players trade specimens for **coins, never $SEED** — token emission is throttled by reputation, and
letting it trade would route around that gate.

A listing escrows its seed immediately, so it cannot be planted, bred, or sold while on the board.
The 6% fee is **burned rather than paid to anyone**, which is what makes trading a coin sink instead
of a coin shuffle — and is also the anti-wash-trading measure that actually works: a pair churning a
specimen between them is strictly poorer after every round trip. Self-trades are blocked and selling
is gated at level 3.

## Stakes, sinks, and goals

| | what it does |
|---|---|
| **Severe blight** | A share of blighted plantings are lost outright — no produce, no seed copy — with the odds gated by Hardiness. The only way to permanently lose a line. |
| **Estate upgrades** | Four permanent improvements (cold frame, irrigation, seed library, glasshouse). The mid-game coin sink. They move throughput, never the rarity curve. |
| **Milestones** | Seventeen long goals, evaluated server-side and awarded once. They survive selling the specimen that earned them. |
| **Punnett square** | The bench explains carrier logic — that a plain-looking plant may be the most valuable thing you own — which the game previously never said anywhere. |

Pressed specimens get a public page at `/herbarium/HB-xxxx` with a share button. Pressing is the
opt-in act: unpressed specimens 404, and the page carries nothing about the owner beyond their
chosen gardener name.

## What is not built

- **No chain.** `$SEED` is an off-chain ledger balance. Withdrawal is a request queue with a
  minimum, a cooldown, and a review step — no contract code until ALFA picks Robinhood Chain vs
  Solana. See `docs/DECISIONS.md`.
- **No price history on the exchange.** Sellers get an advisory quote from score and generation;
  nothing records what things actually sold for.
- **No blight cure item.** Blight is rolled once per planting, as in the prototype.
