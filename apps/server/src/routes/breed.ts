/**
 * The money endpoint.
 *
 * A cross is the only way value enters the game, so this is the one route worth
 * attacking. The order below is deliberate:
 *
 *   1. Redis lock, so a double-submit cannot race itself
 *   2. Rate limit, so a bot cannot grind crosses
 *   3. Transaction with conditional writes, so even if 1 and 2 both fail open
 *      the mutagen can only be spent once
 *
 * The client renders the specimen plate from the response. It never computes
 * the outcome and it never gets a second roll — no retry, no re-roll, no
 * "preview then confirm".
 */

import { xpForBreed, type ColorPair, type Genes } from '@heirloom/genetics';
import { CrossSpeciesError, breed, cryptoRng, autoName } from '@heirloom/genetics/server';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound, tooMany } from '../lib/errors.js';
import { recordLedger } from '../lib/ledger.js';
import { createStrain, getState } from '../lib/player.js';
import { rateLimit, withLock } from '../lib/redis.js';
import { strainView } from '../lib/serialize.js';
import { awardXp } from '../lib/xp.js';

/**
 * Note what is absent: there is no `genes` field, and there never will be.
 * Anything a client sends beyond these three keys is dropped by the parse.
 */
const breedBody = z.object({
  parentAId: z.string().min(1).max(64),
  parentBId: z.string().min(1).max(64),
  useMutagen: z.boolean().default(false),
});

export const BREED_LOCK_MS = 10_000;
export const BREED_BURST_LIMIT = 1;
export const BREED_BURST_WINDOW = 2;
export const BREED_DAILY_LIMIT = 400;

export async function breedRoutes(app: FastifyInstance) {
  app.post('/api/breed', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = breedBody.parse(req.body);

    if (body.parentAId === body.parentBId) {
      throw badRequest('same_parent', 'A strain cannot be crossed with itself.');
    }

    const burst = await rateLimit(
      app.redis,
      `rl:breed:burst:${playerId}`,
      BREED_BURST_LIMIT,
      BREED_BURST_WINDOW,
    );
    if (!burst.allowed) throw tooMany('One cross at a time. Give it a moment.');

    const daily = await rateLimit(app.redis, `rl:breed:day:${playerId}`, BREED_DAILY_LIMIT, 86_400);
    if (!daily.allowed) throw tooMany('Daily cross limit reached.');

    const child = await withLock(app.redis, `lock:breed:${playerId}`, BREED_LOCK_MS, async () =>
      prisma.$transaction(async (tx) => {
        const parents = await tx.strain.findMany({
          where: { id: { in: [body.parentAId, body.parentBId] }, playerId },
        });
        if (parents.length !== 2) throw notFound('no_parent', 'You do not hold both parents.');

        const pa = parents.find((p) => p.id === body.parentAId)!;
        const pb = parents.find((p) => p.id === body.parentBId)!;

        if (pa.species !== pb.species) {
          throw badRequest('cross_species', `Cannot cross ${pa.species} with ${pb.species}.`);
        }

        // Conditional decrements. Two concurrent crosses cannot both consume
        // the same last seed, lock or no lock.
        for (const parent of [pa, pb]) {
          const taken = await tx.strain.updateMany({
            where: { id: parent.id, playerId, qty: { gte: 1 } },
            data: { qty: { decrement: 1 } },
          });
          if (taken.count !== 1) throw conflict('no_seed', 'No seed left of one of those parents.');
        }

        if (body.useMutagen) {
          const spent = await tx.player.updateMany({
            where: { id: playerId, mutagen: { gte: 1 } },
            data: { mutagen: { decrement: 1 } },
          });
          if (spent.count !== 1) throw badRequest('no_mutagen', 'You have no mutagen.');
        }

        let result;
        try {
          result = breed(
            { species: pa.species, genes: pa.genes as Genes, color: pa.color as ColorPair, generation: pa.generation },
            { species: pb.species, genes: pb.genes as Genes, color: pb.color as ColorPair, generation: pb.generation },
            body.useMutagen,
            cryptoRng,
          );
        } catch (err) {
          if (err instanceof CrossSpeciesError) {
            throw badRequest('cross_species', err.message);
          }
          throw err;
        }

        const created = await createStrain(tx, playerId, {
          species: result.species,
          genes: result.genes,
          color: result.color,
          name: autoName(cryptoRng),
          generation: result.generation,
          qty: 1,
          parentAId: pa.id,
          parentBId: pb.id,
          mutations: result.mutations,
        });

        const xp = xpForBreed(result.generation);
        await awardXp(tx, playerId, xp);

        await recordLedger(tx, {
          playerId,
          kind: 'breed',
          meta: {
            childId: created.id,
            accession: created.accession,
            parentA: pa.id,
            parentB: pb.id,
            usedMutagen: body.useMutagen,
            mutations: result.mutations as unknown as Prisma.InputJsonValue,
            xp,
          },
        });

        return created;
      }),
    );

    return { child: strainView(child), state: await getState(playerId) };
  });
}
