/**
 * HEIRLOM — the exchange.
 *
 * The premise of the game is that a rare strain is the only thing of value.
 * Value needs somebody willing to pay, which is what this is for.
 *
 * Three rules shape the design:
 *
 *   1. **Coins, never $SEED.** $SEED emission is throttled by reputation on
 *      purpose. Letting players trade for it would route around that gate and
 *      turn every commission into a tradeable faucet.
 *   2. **Escrow on listing.** The seed leaves the seller's stack the moment they
 *      list. It cannot be planted, bred, or sold while it sits on the board.
 *   3. **The fee is burned.** It is not paid to anyone. That makes trading a
 *      coin sink rather than a coin shuffle, which is the other half of what
 *      the mid-game economy was missing.
 */

import {
  MARKET_MAX_OPEN_LISTINGS,
  MARKET_MAX_PRICE,
  MARKET_MIN_LEVEL,
  MARKET_MIN_PRICE,
  levelFor,
  marketFee,
  marketNet,
  strainScore,
  suggestedPrice,
  tierOf,
  type ColorPair,
  type Genes,
} from '@heirlom/genetics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { getState } from '../lib/player.js';
import { rateLimit, withLock } from '../lib/redis.js';
import { awardMilestones } from '../lib/milestones.js';

const listBody = z.object({
  strainId: z.string().min(1).max(64),
  price: z.number().int().min(MARKET_MIN_PRICE).max(MARKET_MAX_PRICE),
});
const idBody = z.object({ listingId: z.string().min(1).max(64) });

const browseQuery = z.object({
  species: z.string().max(32).optional(),
  minScore: z.coerce.number().int().min(0).max(31).optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  sort: z.enum(['new', 'price', 'score']).default('new'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

/** Sellers get a short cooldown so the board cannot be spammed or churned. */
const LIST_LIMIT = 20;
const LIST_WINDOW = 3600;
const BUY_LIMIT = 30;
const BUY_WINDOW = 60;

export async function marketRoutes(app: FastifyInstance) {
  /** Public-ish: still behind a session, but shows every player's listings. */
  app.get('/api/market', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const q = browseQuery.parse(req.query);

    const orderBy =
      q.sort === 'price'
        ? [{ price: 'asc' as const }, { id: 'asc' as const }]
        : q.sort === 'score'
          ? [{ score: 'desc' as const }, { id: 'asc' as const }]
          : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    const rows = await prisma.listing.findMany({
      where: {
        status: 'open',
        ...(q.species ? { species: q.species } : {}),
        ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
        ...(q.maxPrice !== undefined ? { price: { lte: q.maxPrice } } : {}),
      },
      orderBy,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { strain: { select: { genes: true, mutations: true } } },
    });

    const page = rows.slice(0, q.limit);
    return {
      listings: page.map((l) => ({
        id: l.id,
        accession: l.accession,
        name: l.name,
        species: l.species,
        score: l.score,
        tier: l.tier,
        color: l.color,
        generation: l.generation,
        price: l.price,
        // Buyers can see exactly what they are bidding on, carriers included.
        genes: l.strain.genes,
        createdAt: l.createdAt.toISOString(),
        mine: l.sellerId === playerId,
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]?.id ?? null : null,
    };
  });

  /** The player's own side of the board: what they are selling. */
  app.get('/api/market/mine', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const rows = await prisma.listing.findMany({
      where: { sellerId: playerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      listings: rows.map((l) => ({
        id: l.id,
        accession: l.accession,
        name: l.name,
        species: l.species,
        score: l.score,
        tier: l.tier,
        price: l.price,
        net: marketNet(l.price),
        status: l.status,
        createdAt: l.createdAt.toISOString(),
        soldAt: l.soldAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/api/market/list', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = listBody.parse(req.body);

    const limited = await rateLimit(app.redis, `rl:list:${playerId}`, LIST_LIMIT, LIST_WINDOW);
    if (!limited.allowed) throw tooMany('You have listed a lot recently. Try again later.');

    await prisma.$transaction(async (tx) => {
      const player = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { xp: true },
      });
      /* A brand-new account cannot sell. Without this, funnelling coins to an
         alt costs nothing but the time to make one. */
      if (levelFor(player.xp) < MARKET_MIN_LEVEL) {
        throw forbidden('too_new', `The exchange opens at level ${MARKET_MIN_LEVEL}.`);
      }

      const open = await tx.listing.count({ where: { sellerId: playerId, status: 'open' } });
      if (open >= MARKET_MAX_OPEN_LISTINGS) {
        throw badRequest('too_many_listings', `You can have ${MARKET_MAX_OPEN_LISTINGS} listings open at once.`);
      }

      const strain = await tx.strain.findUnique({ where: { id: body.strainId } });
      if (!strain || strain.playerId !== playerId) {
        throw notFound('no_strain', 'You do not hold that strain.');
      }

      // Escrow: the seed leaves the vault now, not at sale.
      const held = await tx.strain.updateMany({
        where: { id: strain.id, playerId, qty: { gte: 1 } },
        data: { qty: { decrement: 1 } },
      });
      if (held.count !== 1) throw conflict('no_seed', 'No seed of that strain left to list.');

      const shaped = {
        species: strain.species,
        genes: strain.genes as Genes,
        color: strain.color as ColorPair,
      };

      await tx.listing.create({
        data: {
          sellerId: playerId,
          strainId: strain.id,
          species: strain.species,
          accession: strain.accession,
          name: strain.name,
          score: strainScore(shaped),
          tier: tierOf(shaped).key,
          color: strain.color,
          generation: strain.generation,
          escrowQty: 1,
          price: body.price,
        },
      });
    });

    return getState(playerId);
  });

  app.post('/api/market/cancel', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { listingId } = idBody.parse(req.body);

    await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({ where: { id: listingId } });
      if (!listing || listing.sellerId !== playerId) {
        throw notFound('no_listing', 'No such listing.');
      }

      const closed = await tx.listing.updateMany({
        where: { id: listingId, status: 'open' },
        data: { status: 'cancelled' },
      });
      if (closed.count !== 1) throw conflict('listing_closed', 'That listing is no longer open.');

      // Escrow returns to the vault.
      await tx.strain.update({
        where: { id: listing.strainId },
        data: { qty: { increment: listing.escrowQty } },
      });
    });

    return getState(playerId);
  });

  app.post('/api/market/buy', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: buyerId } = requirePlayer(req);
    const { listingId } = idBody.parse(req.body);

    const limited = await rateLimit(app.redis, `rl:buy:${buyerId}`, BUY_LIMIT, BUY_WINDOW);
    if (!limited.allowed) throw tooMany('Slow down.');

    /* Locked on the listing rather than the buyer: two different buyers racing
       for the same specimen is the case that matters. */
    const result = await withLock(app.redis, `lock:listing:${listingId}`, 10_000, async () =>
      prisma.$transaction(async (tx) => {
        const listing = await tx.listing.findUnique({ where: { id: listingId } });
        if (!listing) throw notFound('no_listing', 'No such listing.');
        if (listing.status !== 'open') throw conflict('listing_closed', 'That specimen has gone.');
        if (listing.sellerId === buyerId) {
          throw badRequest('self_trade', 'You cannot buy your own listing.');
        }

        const price = BigInt(listing.price);
        const fee = BigInt(marketFee(listing.price));
        const net = price - fee;

        // Take the money first, conditionally: a buyer without the coins fails
        // here and nothing else has moved.
        const paid = await tx.player.updateMany({
          where: { id: buyerId, coins: { gte: price } },
          data: { coins: { decrement: price } },
        });
        if (paid.count !== 1) throw badRequest('poor', 'Not enough coins.');

        const closed = await tx.listing.updateMany({
          where: { id: listingId, status: 'open' },
          data: { status: 'sold', buyerId, soldAt: new Date() },
        });
        if (closed.count !== 1) throw conflict('listing_closed', 'That specimen has gone.');

        const source = await tx.strain.findUniqueOrThrow({ where: { id: listing.strainId } });

        /* The buyer receives a copy of the specimen rather than the row itself:
           the seller's own record, its herbarium entry and its parentage links
           all stay intact. Accession is preserved, so a traded specimen keeps
           the identity printed on its plate. */
        const existing = await tx.strain.findFirst({
          where: { playerId: buyerId, accession: source.accession },
        });
        if (existing) {
          await tx.strain.update({
            where: { id: existing.id },
            data: { qty: { increment: listing.escrowQty } },
          });
        } else {
          await tx.strain.create({
            data: {
              playerId: buyerId,
              // Accessions are unique per row, so a traded copy takes a suffix
              // while keeping the original visible on the plate.
              accession: `${source.accession}/${buyerId.slice(-4)}`,
              species: source.species,
              genes: source.genes as never,
              color: source.color,
              name: source.name,
              named: source.named,
              generation: source.generation,
              qty: listing.escrowQty,
              parentAId: source.parentAId,
              parentBId: source.parentBId,
              mutations: source.mutations as never,
            },
          });
        }

        await tx.player.update({
          where: { id: listing.sellerId },
          data: { coins: { increment: net } },
        });

        const meta = {
          listingId,
          accession: listing.accession,
          name: listing.name,
          species: listing.species,
          score: listing.score,
          price: listing.price,
          fee: Number(fee),
        };
        await recordLedger(tx, {
          playerId: buyerId,
          kind: 'purchase',
          coins: -price,
          meta: { ...meta, what: 'specimen', from: listing.sellerId },
        });
        await recordLedger(tx, {
          playerId: listing.sellerId,
          kind: 'sale',
          coins: net,
          meta: { ...meta, what: 'specimen', to: buyerId },
        });

        return { listing, net: Number(net), fee: Number(fee) };
      }),
    );

    // "Dealer" is earned by the seller, once their specimen finds a buyer.
    await awardMilestones(result.listing.sellerId);

    return {
      bought: {
        accession: result.listing.accession,
        name: result.listing.name,
        price: result.listing.price,
      },
      state: await getState(buyerId),
    };
  });

  /** Advisory guide price, so the board does not fill with wishful nonsense. */
  app.get('/api/market/quote/:strainId', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { strainId } = z.object({ strainId: z.string().min(1).max(64) }).parse(req.params);

    const strain = await prisma.strain.findUnique({ where: { id: strainId } });
    if (!strain || strain.playerId !== playerId) {
      throw notFound('no_strain', 'You do not hold that strain.');
    }
    const shaped = {
      species: strain.species,
      genes: strain.genes as Genes,
      color: strain.color as ColorPair,
    };
    const score = strainScore(shaped);
    const suggested = suggestedPrice(score, strain.generation);
    return { suggested, fee: marketFee(suggested), net: marketNet(suggested), score };
  });
}
