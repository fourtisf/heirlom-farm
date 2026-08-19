/**
 * The three assertions the handoff asks for on top of the ported prototype
 * suites, plus the surrounding anti-cheat rules from §6.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('breed: double-submit', () => {
  it('produces exactly one child and decrements exactly one mutagen', async () => {
    const me = await signIn(app);

    // Two seeds of each parent, so seed supply is not what stops the second call.
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];
    await prisma.strain.update({ where: { id: starter.id }, data: { qty: 8 } });

    await grantCoins(me.playerId, 100_000);
    const bought = await app.inject({
      method: 'POST',
      url: '/api/buy-seed',
      headers: me.auth,
      payload: { species: 'tomato' },
    });
    const second = bought.json().strain;
    await prisma.strain.update({ where: { id: second.id }, data: { qty: 8 } });
    await prisma.player.update({ where: { id: me.playerId }, data: { mutagen: 1 } });

    const fire = () =>
      app.inject({
        method: 'POST',
        url: '/api/breed',
        headers: me.auth,
        payload: { parentAId: starter.id, parentBId: second.id, useMutagen: true },
      });

    const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
    const ok = results.filter((r) => r.statusCode === 200);

    expect(ok).toHaveLength(1);

    const player = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });
    expect(player.mutagen).toBe(0);

    const children = await prisma.strain.count({
      where: { playerId: me.playerId, parentAId: { not: null } },
    });
    expect(children).toBe(1);

    const ledger = await prisma.ledgerEntry.count({
      where: { playerId: me.playerId, kind: 'breed' },
    });
    expect(ledger).toBe(1);
  });

  it('refuses to spend a mutagen the player does not have', async () => {
    const me = await signIn(app);
    await prisma.player.update({ where: { id: me.playerId }, data: { mutagen: 0 } });

    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];
    await prisma.strain.update({ where: { id: starter.id }, data: { qty: 8 } });

    await grantCoins(me.playerId, 100_000);
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
      payload: { parentAId: starter.id, parentBId: bought.json().strain.id, useMutagen: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_mutagen');
    // Nothing partially applied: the parents keep their seed.
    const parent = await prisma.strain.findUniqueOrThrow({ where: { id: starter.id } });
    expect(parent.qty).toBe(8);
  });
});

describe('forged payloads', () => {
  it('ignores a genes payload on /api/breed', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];
    await prisma.strain.update({ where: { id: starter.id }, data: { qty: 8 } });

    await grantCoins(me.playerId, 100_000);
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
      payload: {
        parentAId: starter.id,
        parentBId: bought.json().strain.id,
        useMutagen: false,
        // The whole point of the exercise.
        genes: { Y: [6, 6], V: [6, 6], H: [6, 6], E: [6, 6] },
        color: ['ivory', 'ivory'],
        score: 31,
        tier: 'legendary',
      },
    });

    expect(res.statusCode).toBe(200);
    const child = res.json().child;
    // Nursery parents cap out well below a forged legendary.
    expect(child.score).toBeLessThan(20);
    expect(child.color).not.toEqual(['ivory', 'ivory']);

    const row = await prisma.strain.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.genes).toEqual(child.genes);
  });

  it('has no endpoint that accepts genes at all', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];

    // Try every mutation route with a genes payload bolted on.
    const attempts = [
      { url: '/api/plant', payload: { bedIndex: 0, strainId: starter.id, genes: { Y: [6, 6] } } },
      { url: '/api/buy-seed', payload: { species: 'tomato', genes: { Y: [6, 6] } } },
      {
        url: '/api/strain/name',
        payload: { strainId: starter.id, name: 'Forged', genes: { Y: [6, 6] } },
      },
    ];

    for (const attempt of attempts) {
      await app.inject({ method: 'POST', url: attempt.url, headers: me.auth, payload: attempt.payload });
    }

    const rows = await prisma.strain.findMany({ where: { playerId: me.playerId } });
    for (const row of rows) {
      const genes = row.genes as Record<string, [number, number]>;
      for (const pair of Object.values(genes)) {
        for (const allele of pair) expect(allele).toBeLessThanOrEqual(3);
      }
    }
  });

  it('rejects a client-supplied ripeAt or elapsed time', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];

    await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: me.auth,
      payload: { bedIndex: 0, strainId: starter.id, ripeAt: new Date(0).toISOString(), elapsed: 99999 },
    });

    const harvest = await app.inject({
      method: 'POST',
      url: '/api/harvest',
      headers: me.auth,
      payload: { bedIndex: 0, elapsed: 99999, now: Date.now() + 10 ** 9 },
    });

    expect(harvest.statusCode).toBe(400);
    expect(harvest.json().error).toBe('not_ripe');
  });
});

describe('commissions', () => {
  it('rejects a non-matching strain server-side even when the client sends it', async () => {
    const me = await signIn(app);
    // Level 9 so commissions can demand real thresholds.
    await setXp(me.playerId, 5300);

    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const commission = state.json().commissions[0];
    expect(commission).toBeDefined();

    // A deliberately worthless specimen of the right species.
    const starter = state.json().vault[0];
    await prisma.strain.update({
      where: { id: starter.id },
      data: {
        species: commission.species,
        genes: { Y: [1, 1], V: [1, 1], H: [1, 1], E: [1, 1] },
        color: ['crimson', 'crimson'],
        qty: 5,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/commission/fulfil',
      headers: me.auth,
      payload: { commissionId: commission.id, strainId: starter.id },
    });

    // The only way this passes is a commission with no requirement above 1,
    // which generateCommission cannot produce (minimum threshold is 2).
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_match');

    const after = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(after.status).toBe('open');
    const player = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });
    expect(player.seedBalance.toNumber()).toBe(0);
  });

  it('pays coins, $SEED and rep on a genuine match, exactly once', async () => {
    const me = await signIn(app);
    await setXp(me.playerId, 5300);

    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const commission = state.json().commissions[0];

    // A maximal specimen satisfies any requirement the generator can produce.
    const starter = state.json().vault[0];
    await prisma.strain.update({
      where: { id: starter.id },
      data: {
        species: commission.species,
        genes: { Y: [6, 6], V: [6, 6], H: [6, 6], E: [6, 6] },
        color: ['ivory', 'ivory'],
        qty: 4,
      },
    });

    const fire = () =>
      app.inject({
        method: 'POST',
        url: '/api/commission/fulfil',
        headers: me.auth,
        payload: { commissionId: commission.id, strainId: starter.id },
      });

    const [a, b] = await Promise.all([fire(), fire()]);
    const ok = [a, b].filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);

    const player = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });
    expect(Number(player.coins)).toBeGreaterThan(260);
    expect(player.rep).toBeGreaterThan(0);

    const entries = await prisma.ledgerEntry.findMany({
      where: { playerId: me.playerId, kind: 'commission' },
    });
    expect(entries).toHaveLength(1);
    expect(player.seedBalance.toString()).toBe(entries[0]!.seed.toString());
  });

  it('gates open slots on reputation, not on farm size', async () => {
    const me = await signIn(app);

    const at = async (rep: number) => {
      await prisma.player.update({ where: { id: me.playerId }, data: { rep } });
      const res = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
      return res.json().commissions.length;
    };

    expect(await at(0)).toBe(1);
    expect(await at(12)).toBe(2);
    expect(await at(30)).toBe(3);
  });
});

describe('ownership', () => {
  it('will not let one player touch another player’s strain', async () => {
    const a = await signIn(app);
    const b = await signIn(app);

    const aState = await app.inject({ method: 'GET', url: '/api/state', headers: a.auth });
    const victim = aState.json().vault[0];

    const plant = await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: b.auth,
      payload: { bedIndex: 0, strainId: victim.id },
    });
    expect(plant.statusCode).toBe(404);

    const rename = await app.inject({
      method: 'POST',
      url: '/api/strain/name',
      headers: b.auth,
      payload: { strainId: victim.id, name: 'Stolen' },
    });
    expect(rename.statusCode).toBe(404);

    const read = await app.inject({
      method: 'GET',
      url: `/api/strain/${victim.id}`,
      headers: b.auth,
    });
    expect(read.statusCode).toBe(404);
  });

  it('refuses every mutation without a session', async () => {
    for (const url of ['/api/plant', '/api/harvest', '/api/sell', '/api/breed', '/api/buy-mutagen']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/api/state' })).statusCode).toBe(401);
  });
});

describe('economy integrity', () => {
  it('freezes unit value at harvest', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];

    await forceGenes(starter.id, { Y: [1, 1], V: [6, 6], H: [6, 6], E: [1, 1] }, ['crimson', 'crimson']);
    await prisma.strain.update({ where: { id: starter.id }, data: { qty: 5 } });

    await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: me.auth,
      payload: { bedIndex: 0, strainId: starter.id },
    });
    await forceRipe(me.playerId, 0);
    const harvest = await app.inject({
      method: 'POST',
      url: '/api/harvest',
      headers: me.auth,
      payload: { bedIndex: 0 },
    });
    const harvested = harvest.json();

    // A "balance patch" arrives: the strain is now far more valuable.
    await forceGenes(starter.id, { Y: [6, 6], V: [6, 6], H: [6, 6], E: [6, 6] }, ['ivory', 'ivory']);

    const sell = await app.inject({
      method: 'POST',
      url: '/api/sell',
      headers: me.auth,
      payload: { species: 'tomato', color: harvested.color },
    });

    expect(sell.json().unitValue).toBe(harvested.value);
  });

  it('writes a ledger entry for every coin movement', async () => {
    const me = await signIn(app);
    await grantCoins(me.playerId, 100_000);

    await app.inject({
      method: 'POST',
      url: '/api/buy-seed',
      headers: me.auth,
      payload: { species: 'tomato' },
    });
    await app.inject({ method: 'POST', url: '/api/buy-mutagen', headers: me.auth });

    const entries = await prisma.ledgerEntry.findMany({
      where: { playerId: me.playerId },
      orderBy: { createdAt: 'asc' },
    });
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('grant');
    expect(kinds.filter((k) => k === 'purchase')).toHaveLength(2);

    const spent = entries
      .filter((e) => e.kind === 'purchase')
      .reduce((acc, e) => acc + Number(e.coins), 0);
    expect(spent).toBe(-(40 + 450));
  });

  it('will not sell produce the player does not hold', async () => {
    const me = await signIn(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sell',
      headers: me.auth,
      payload: { species: 'tomato', color: 'crimson', qty: 9999 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('will not plant into a locked bed', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];

    // Level 1 unlocks four beds: 0..3.
    const res = await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: me.auth,
      payload: { bedIndex: 9, strainId: starter.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('bed_locked');
  });

  it('will not harvest a bed twice', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const starter = state.json().vault[0];
    await prisma.strain.update({ where: { id: starter.id }, data: { qty: 5 } });

    await app.inject({
      method: 'POST',
      url: '/api/plant',
      headers: me.auth,
      payload: { bedIndex: 0, strainId: starter.id },
    });
    await forceRipe(me.playerId, 0);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/harvest', headers: me.auth, payload: { bedIndex: 0 } }),
      app.inject({ method: 'POST', url: '/api/harvest', headers: me.auth, payload: { bedIndex: 0 } }),
    ]);
    expect([a, b].filter((r) => r.statusCode === 200)).toHaveLength(1);
  });
});

describe('auth', () => {
  it('refuses a replayed nonce', async () => {
    const me = await signIn(app);

    const nonceRes = await app.inject({
      method: 'POST',
      url: '/api/auth/nonce',
      payload: { wallet: me.account.address },
    });
    const { nonce, message } = nonceRes.json();
    const signature = await me.account.signMessage({ message });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { wallet: me.account.address, nonce, signature },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { wallet: me.account.address, nonce, signature },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('refuses a signature from a different wallet', async () => {
    const victim = await signIn(app);
    const attacker = await signIn(app);

    const nonceRes = await app.inject({
      method: 'POST',
      url: '/api/auth/nonce',
      payload: { wallet: victim.account.address },
    });
    const { nonce, message } = nonceRes.json();
    const signature = await attacker.account.signMessage({ message });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { wallet: victim.account.address, nonce, signature },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('withdrawals', () => {
  it('debits the balance when a request is filed and enforces the cooldown', async () => {
    const me = await signIn(app);
    await prisma.player.update({
      where: { id: me.playerId },
      data: { seedBalance: 100 },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/withdraw',
      headers: me.auth,
      payload: { amount: 20, destination: me.account.address },
    });
    expect(first.statusCode).toBe(200);

    const player = await prisma.player.findUniqueOrThrow({ where: { id: me.playerId } });
    expect(player.seedBalance.toNumber()).toBe(80);

    const second = await app.inject({
      method: 'POST',
      url: '/api/withdraw',
      headers: me.auth,
      payload: { amount: 10, destination: me.account.address },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('cooldown');
  });

  it('refuses to queue more $SEED than the player holds', async () => {
    const me = await signIn(app);
    await prisma.player.update({ where: { id: me.playerId }, data: { seedBalance: 6 } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/withdraw',
      headers: me.auth,
      payload: { amount: 500, destination: me.account.address },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('insufficient');
  });
});

describe('a cross does not consume its parents', () => {
  it('leaves the seed of both parents untouched', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const [a, b] = state.json().vault;
    expect(b, 'a new player should hold two distinct lines').toBeDefined();

    const before = await prisma.strain.findMany({ where: { id: { in: [a.id, b.id] } } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/breed',
      headers: me.auth,
      payload: { parentAId: a.id, parentBId: b.id, useMutagen: false },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.strain.findMany({ where: { id: { in: [a.id, b.id] } } });
    for (const row of after) {
      const was = before.find((x) => x.id === row.id)!;
      expect(row.qty, `${row.name} lost seed to a cross`).toBe(was.qty);
    }
  });

  it('still refuses a parent the player holds none of', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const [a, b] = state.json().vault;
    await prisma.strain.update({ where: { id: a.id }, data: { qty: 0 } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/breed',
      headers: me.auth,
      payload: { parentAId: a.id, parentBId: b.id, useMutagen: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_seed');
  });

  it('gives a new player two distinct lines, so the bench works immediately', async () => {
    const me = await signIn(app);
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: me.auth });
    const vault = state.json().vault;

    expect(vault.length).toBe(2);
    expect(vault[0].id).not.toBe(vault[1].id);
    // Four seeds for the four beds a level-1 player has open.
    expect(vault.reduce((n: number, s: { qty: number }) => n + s.qty, 0)).toBe(4);
    expect(state.json().player.plotCapacity).toBe(4);
  });
});
