/**
 * The exchange, the coin sinks, the stakes, and the goals.
 *
 * The marketplace is the first place two players' money touches, so most of
 * this file is about what happens when they touch it at the same time.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MARKET_MIN_LEVEL, UPGRADES, marketFee, upgradeCost } from '@heirlom/genetics';
import { prisma } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { forceGenes, forceRipe, grantCoins, makeApp, resetRedis, setXp, signIn } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await closeRedis();
});

beforeEach(async () => {
  await resetRedis();
});

/** A signed-in player at a level that can trade, with coins. */
async function trader(coins = 1_000_000) {
  const me = await signIn(app);
  await setXp(me.playerId, 360); // level 4
  await grantCoins(me.playerId, coins);
  const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
  const starter = state.json().vault[0];
  await prisma.strain.update({ where: { id: starter.id }, data: { qty: 6 } });
  return { ...me, starter };
}

const list = (who: { auth: Record<string, string> }, strainId: string, price: number) =>
  app.inject({ method: 'POST', url: '/api/market/list', headers: who.auth, payload: { strainId, price } });

const buy = (who: { auth: Record<string, string> }, listingId: string) =>
  app.inject({ method: 'POST', url: '/api/market/buy', headers: who.auth, payload: { listingId } });

async function openListing(seller: Awaited<ReturnType<typeof trader>>, price = 500) {
  await list(seller, seller.starter.id, price);
  const mine = await app.inject({ method: 'GET', url: '/api/market/mine', headers: seller.auth });
  return mine.json().listings.find((l: { status: string }) => l.status === 'open');
}

describe('escrow', () => {
  it('takes the seed out of the vault the moment it is listed', async () => {
    const seller = await trader();
    const before = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });

    const res = await list(seller, seller.starter.id, 500);
    expect(res.statusCode).toBe(200);

    const after = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });
    expect(after.qty).toBe(before.qty - 1);
  });

  it('will not let an escrowed seed be planted', async () => {
    const seller = await trader();
    await prisma.strain.update({ where: { id: seller.starter.id }, data: { qty: 1 } });
    await list(seller, seller.starter.id, 500);

    const plant = await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: seller.auth,
      payload: { bedIndex: 0, strainId: seller.starter.id },
    });
    expect(plant.statusCode).toBe(409);
    expect(plant.json().error).toBe('no_seed');
  });

  it('returns the seed on cancel', async () => {
    const seller = await trader();
    const listing = await openListing(seller);
    const escrowed = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/market/cancel',
      headers: seller.auth,
      payload: { listingId: listing.id },
    });
    expect(res.statusCode).toBe(200);

    const back = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });
    expect(back.qty).toBe(escrowed.qty + 1);
  });

  it('cannot cancel the same listing twice and duplicate the seed', async () => {
    const seller = await trader();
    const listing = await openListing(seller);
    const escrowed = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });

    const fire = () =>
      app.inject({
        method: 'POST',
        url: '/api/market/cancel',
        headers: seller.auth,
        payload: { listingId: listing.id },
      });
    const results = await Promise.all([fire(), fire(), fire()]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);

    const back = await prisma.strain.findUniqueOrThrow({ where: { id: seller.starter.id } });
    expect(back.qty).toBe(escrowed.qty + 1);
  });
});

describe('buying', () => {
  it('moves coins, burns the fee, and hands over the specimen', async () => {
    const seller = await trader();
    const buyer = await trader();
    const listing = await openListing(seller, 1000);

    const sellerBefore = await prisma.player.findUniqueOrThrow({ where: { id: seller.playerId } });
    const buyerBefore = await prisma.player.findUniqueOrThrow({ where: { id: buyer.playerId } });

    const res = await buy(buyer, listing.id);
    expect(res.statusCode).toBe(200);

    const sellerAfter = await prisma.player.findUniqueOrThrow({ where: { id: seller.playerId } });
    const buyerAfter = await prisma.player.findUniqueOrThrow({ where: { id: buyer.playerId } });

    const fee = marketFee(1000);
    expect(Number(buyerBefore.coins - buyerAfter.coins)).toBe(1000);
    expect(Number(sellerAfter.coins - sellerBefore.coins)).toBe(1000 - fee);

    // The fee is burned, not paid to anyone: the two sides do not balance.
    const moved = Number(buyerBefore.coins - buyerAfter.coins) - Number(sellerAfter.coins - sellerBefore.coins);
    expect(moved).toBe(fee);

    const owned = await prisma.strain.findFirst({
      where: { playerId: buyer.playerId, accession: { startsWith: listing.accession } },
    });
    expect(owned).not.toBeNull();
    expect(owned!.qty).toBeGreaterThanOrEqual(1);
  });

  it('sells to exactly one of two racing buyers', async () => {
    const seller = await trader();
    const a = await trader();
    const b = await trader();
    const listing = await openListing(seller, 800);

    const results = await Promise.all([buy(a, listing.id), buy(b, listing.id), buy(a, listing.id)]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('sold');

    // Exactly one copy exists across both buyers.
    const copies = await prisma.strain.findMany({
      where: {
        playerId: { in: [a.playerId, b.playerId] },
        accession: { startsWith: listing.accession },
      },
    });
    expect(copies.reduce((n, c) => n + c.qty, 0)).toBe(1);
  });

  it('refuses a buyer who cannot afford it, and moves nothing', async () => {
    const seller = await trader();
    const pauper = await trader(0);
    await prisma.player.update({ where: { id: pauper.playerId }, data: { coins: 10 } });
    const listing = await openListing(seller, 5000);

    const res = await buy(pauper, listing.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('poor');

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('open');
    const after = await prisma.player.findUniqueOrThrow({ where: { id: pauper.playerId } });
    expect(Number(after.coins)).toBe(10);
  });

  it('writes a ledger entry on both sides', async () => {
    const seller = await trader();
    const buyer = await trader();
    const listing = await openListing(seller, 1200);
    await buy(buyer, listing.id);

    const sellerEntry = await prisma.ledgerEntry.findFirst({
      where: { playerId: seller.playerId, kind: 'sale' },
      orderBy: { createdAt: 'desc' },
    });
    const buyerEntry = await prisma.ledgerEntry.findFirst({
      where: { playerId: buyer.playerId, kind: 'purchase' },
      orderBy: { createdAt: 'desc' },
    });
    expect(Number(sellerEntry!.coins)).toBe(1200 - marketFee(1200));
    expect(Number(buyerEntry!.coins)).toBe(-1200);
  });
});

describe('anti-wash-trading', () => {
  it('refuses to let a player buy their own listing', async () => {
    const seller = await trader();
    const listing = await openListing(seller);

    const res = await buy(seller, listing.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('self_trade');
  });

  it('keeps a fresh account off the exchange', async () => {
    const rookie = await signIn(app);
    await grantCoins(rookie.playerId, 10_000);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: rookie.auth });

    const res = await list(rookie, state.json().vault[0].id, 500);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('too_new');
  });

  it('makes every round trip cost the fee, so churn drains rather than launders', async () => {
    const a = await trader();
    const b = await trader();

    const startA = await prisma.player.findUniqueOrThrow({ where: { id: a.playerId } });
    const startB = await prisma.player.findUniqueOrThrow({ where: { id: b.playerId } });

    // A sells to B, then B sells the copy back to A, at the same price.
    const first = await openListing(a, 1000);
    await buy(b, first.id);

    const copy = await prisma.strain.findFirstOrThrow({
      where: { playerId: b.playerId, accession: { startsWith: first.accession } },
    });
    await list(b, copy.id, 1000);
    const bListings = await app.inject({ method: 'GET', url: '/api/market/mine', headers: b.auth });
    const second = bListings.json().listings.find((l: { status: string }) => l.status === 'open');
    await buy(a, second.id);

    const endA = await prisma.player.findUniqueOrThrow({ where: { id: a.playerId } });
    const endB = await prisma.player.findUniqueOrThrow({ where: { id: b.playerId } });

    const total =
      Number(startA.coins) + Number(startB.coins) - (Number(endA.coins) + Number(endB.coins));
    // Two trades, two fees burned. The pair is strictly poorer for the churn.
    expect(total).toBe(marketFee(1000) * 2);
  });

  it('caps how many listings one player can have open', async () => {
    const seller = await trader();
    await prisma.strain.update({ where: { id: seller.starter.id }, data: { qty: 40 } });

    for (let i = 0; i < 12; i++) {
      const res = await list(seller, seller.starter.id, 100);
      expect(res.statusCode, `listing ${i}`).toBe(200);
    }
    const overflow = await list(seller, seller.starter.id, 100);
    expect(overflow.statusCode).toBe(400);
    expect(overflow.json().error).toBe('too_many_listings');
  });
});

describe('severe blight', () => {
  it('can destroy a planting outright, returning nothing at all', async () => {
    const me = await trader();
    // Hardiness 1: blight is likely, and likely to be fatal when it lands.
    await forceGenes(
      me.starter.id,
      { Y: [6, 6], V: [6, 6], H: [1, 1], E: [1, 1] },
      ['crimson', 'crimson'],
    );
    await prisma.strain.update({ where: { id: me.starter.id }, data: { qty: 400 } });

    let severe = 0;
    let survived = 0;

    for (let i = 0; i < 60; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/plant',
        headers: me.auth,
        payload: { bedIndex: 0, strainId: me.starter.id },
      });
      await forceRipe(me.playerId, 0);
      const res = await app.inject({
        method: 'POST',
        url: '/api/harvest',
        headers: me.auth,
        payload: { bedIndex: 0 },
      });
      const body = res.json();
      if (body.severe) {
        severe++;
        // A lost planting pays nothing and returns no seed.
        expect(body.units).toBe(0);
        expect(body.copies).toBe(0);
      } else {
        survived++;
      }
    }

    expect(severe).toBeGreaterThan(0);
    expect(survived).toBeGreaterThan(0);
  });

  it('lets a hardy line survive where a fragile one is destroyed', async () => {
    const me = await trader();
    await prisma.strain.update({ where: { id: me.starter.id }, data: { qty: 1000 } });

    const rateFor = async (h: number) => {
      await forceGenes(
        me.starter.id,
        { Y: [3, 3], V: [6, 6], H: [h, h], E: [1, 1] },
        ['crimson', 'crimson'],
      );
      let severe = 0;
      const runs = 80;
      for (let i = 0; i < runs; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/plant',
          headers: me.auth,
          payload: { bedIndex: 0, strainId: me.starter.id },
        });
        await forceRipe(me.playerId, 0);
        const res = await app.inject({
          method: 'POST',
          url: '/api/harvest',
          headers: me.auth,
          payload: { bedIndex: 0 },
        });
        if (res.json().severe) severe++;
      }
      return severe / runs;
    };

    const fragile = await rateFor(1);
    const hardy = await rateFor(6);
    expect(fragile).toBeGreaterThan(hardy);
  });

  it('never destroys a healthy planting', async () => {
    const me = await trader();
    // Hardiness 6 gives the floor blight chance; over many runs most are clean.
    await forceGenes(
      me.starter.id,
      { Y: [3, 3], V: [6, 6], H: [6, 6], E: [1, 1] },
      ['crimson', 'crimson'],
    );
    await prisma.strain.update({ where: { id: me.starter.id }, data: { qty: 200 } });

    for (let i = 0; i < 40; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/plant',
        headers: me.auth,
        payload: { bedIndex: 0, strainId: me.starter.id },
      });
      await forceRipe(me.playerId, 0);
      const body = (
        await app.inject({
          method: 'POST',
          url: '/api/harvest',
          headers: me.auth,
          payload: { bedIndex: 0 },
        })
      ).json();
      if (!body.blighted) {
        expect(body.severe).toBe(false);
        expect(body.units).toBeGreaterThan(0);
        expect(body.copies).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('estate upgrades', () => {
  it('charges the published price and records it in the ledger', async () => {
    const me = await trader();
    await setXp(me.playerId, 1650); // level 7, everything unlocked
    const before = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/upgrades/buy',
      headers: me.auth,
      payload: { key: 'coldframe' },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });
    expect(Number(before.coins - after.coins)).toBe(upgradeCost('coldframe', 0));

    const entry = await prisma.ledgerEntry.findFirst({
      where: { playerId: me.playerId, kind: 'purchase' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
  });

  it('will not sell past the maximum level', async () => {
    const me = await trader(50_000_000);
    await setXp(me.playerId, 1650);

    for (let i = 0; i < UPGRADES.coldframe.maxLevel; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/upgrades/buy',
        headers: me.auth,
        payload: { key: 'coldframe' },
      });
      expect(res.statusCode, `level ${i + 1}`).toBe(200);
    }
    const extra = await app.inject({
      method: 'POST',
      url: '/api/upgrades/buy',
      headers: me.auth,
      payload: { key: 'coldframe' },
    });
    expect(extra.statusCode).toBe(409);
    expect(extra.json().error).toBe('maxed');
  });

  it('gives exactly one level to concurrent buys', async () => {
    const me = await trader(50_000_000);
    await setXp(me.playerId, 1650);

    const fire = () =>
      app.inject({
        method: 'POST',
        url: '/api/upgrades/buy',
        headers: me.auth,
        payload: { key: 'irrigation' },
      });
    const results = await Promise.all([fire(), fire(), fire()]);
    const ok = results.filter((r) => r.statusCode === 200).length;

    const row = await prisma.playerUpgrade.findUniqueOrThrow({
      where: { playerId_key: { playerId: me.playerId, key: 'irrigation' } },
    });
    expect(row.level).toBe(ok);
  });

  it('keeps an upgrade locked until its level', async () => {
    const me = await trader();
    await setXp(me.playerId, 0);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upgrades/buy',
      headers: me.auth,
      payload: { key: 'glasshouse' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('makes the glasshouse actually pay more at the till', async () => {
    const sellFor = async (withGlasshouse: boolean) => {
      const me = await trader(50_000_000);
      await setXp(me.playerId, 2500);
      if (withGlasshouse) {
        await app.inject({
          method: 'POST',
          url: '/api/upgrades/buy',
          headers: me.auth,
          payload: { key: 'glasshouse' },
        });
      }
      await forceGenes(
        me.starter.id,
        { Y: [3, 3], V: [6, 6], H: [6, 6], E: [4, 4] },
        ['crimson', 'crimson'],
      );
      await app.inject({
        method: 'POST',
        url: '/api/plant',
        headers: me.auth,
        payload: { bedIndex: 0, strainId: me.starter.id },
      });
      await forceRipe(me.playerId, 0);
      const h = await app.inject({
        method: 'POST',
        url: '/api/harvest',
        headers: me.auth,
        payload: { bedIndex: 0 },
      });
      const sale = await app.inject({
        method: 'POST',
        url: '/api/sell',
        headers: me.auth,
        payload: { species: 'tomato', color: h.json().color },
      });
      return sale.json().unitValue;
    };

    expect(await sellFor(true)).toBeGreaterThan(await sellFor(false));
  });
});

describe('milestones', () => {
  it('awards the first cross, once, and keeps it', async () => {
    const me = await trader();
    const bought = await app.inject({
      method: 'POST',
      url: '/api/buy-seed',
      headers: me.auth,
      payload: { species: 'tomato' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/breed',
      headers: me.auth,
      payload: { parentAId: me.starter.id, parentBId: bought.json().strain.id, useMutagen: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().earned).toContain('first_cross');

    const rows = await prisma.playerMilestone.findMany({
      where: { playerId: me.playerId, key: 'first_cross' },
    });
    expect(rows).toHaveLength(1);
  });

  it('does not award ivory to a mere carrier', async () => {
    const me = await trader();
    await forceGenes(
      me.starter.id,
      { Y: [3, 3], V: [3, 3], H: [3, 3], E: [3, 3] },
      ['crimson', 'ivory'],
    );
    await app.inject({
      method: 'POST',
      url: '/api/strain/name',
      headers: me.auth,
      payload: { strainId: me.starter.id, name: 'Carrier' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/milestones', headers: me.auth });
    const ivory = res.json().milestones.find((m: { key: string }) => m.key === 'ivory');
    expect(ivory.achieved).toBe(false);
  });

  it('keeps a milestone after the specimen that earned it is gone', async () => {
    const me = await trader();
    await forceGenes(
      me.starter.id,
      { Y: [6, 6], V: [6, 6], H: [6, 6], E: [6, 6] },
      ['ivory', 'ivory'],
    );
    await app.inject({
      method: 'POST',
      url: '/api/strain/name',
      headers: me.auth,
      payload: { strainId: me.starter.id, name: 'Ivory Line' },
    });

    let res = await app.inject({ method: 'GET', url: '/api/milestones', headers: me.auth });
    expect(res.json().milestones.find((m: { key: string }) => m.key === 'perfect').achieved).toBe(true);

    // Sell every copy away.
    await prisma.strain.delete({ where: { id: me.starter.id } });

    res = await app.inject({ method: 'GET', url: '/api/milestones', headers: me.auth });
    expect(res.json().milestones.find((m: { key: string }) => m.key === 'perfect').achieved).toBe(true);
  });

  it('awards the seller "dealer" when their specimen finds a buyer', async () => {
    const seller = await trader();
    const buyer = await trader();
    const listing = await openListing(seller, 600);
    await buy(buyer, listing.id);

    const res = await app.inject({ method: 'GET', url: '/api/milestones', headers: seller.auth });
    expect(res.json().milestones.find((m: { key: string }) => m.key === 'trader').achieved).toBe(true);
  });
});

describe('public herbarium', () => {
  it('serves a pressed specimen with no session at all', async () => {
    const me = await trader();
    await app.inject({
      method: 'POST',
      url: '/api/strain/name',
      headers: me.auth,
      payload: { strainId: me.starter.id, name: 'Vale Row' },
    });
    const strain = await prisma.strain.findUniqueOrThrow({ where: { id: me.starter.id } });

    const res = await app.inject({ method: 'GET', url: `/api/herbarium/${strain.accession}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Vale Row');
    expect(body.accession).toBe(strain.accession);
    expect(body.score).toBeGreaterThan(0);
  });

  it('does not expose an unpressed specimen', async () => {
    const me = await trader();
    const strain = await prisma.strain.findUniqueOrThrow({ where: { id: me.starter.id } });

    const res = await app.inject({ method: 'GET', url: `/api/herbarium/${strain.accession}` });
    expect(res.statusCode).toBe(404);
  });

  it('leaks nothing about the owner beyond their chosen gardener name', async () => {
    const me = await trader();
    await app.inject({
      method: 'POST',
      url: '/api/strain/name',
      headers: me.auth,
      payload: { strainId: me.starter.id, name: 'Quiet Line' },
    });
    const strain = await prisma.strain.findUniqueOrThrow({ where: { id: me.starter.id } });

    const res = await app.inject({ method: 'GET', url: `/api/herbarium/${strain.accession}` });
    const raw = res.body;
    expect(raw).not.toContain(me.playerId);
    expect(raw).not.toContain(me.account.address.toLowerCase());
    expect(res.json().playerId).toBeUndefined();
  });
});
