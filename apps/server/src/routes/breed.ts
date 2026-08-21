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

import { xpForBreed, type ColorPair, type Genes } from '@heirlom/genetics';
import { CrossSpeciesError, breed, cryptoRng, autoName } from '@heirlom/genetics/server';
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
import { awardMilestones } from '../lib/milestones.js';
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

        /* Both parents must be held, but a cross does not consume them.
         *
         * This was a bug: an earlier version decremented both parents, reading
         * the handoff's "qty >= 1" as a cost rather than a requirement. The
         * prototype never charged for a cross, and the difference is not
         * cosmetic — with four opening seeds and four beds, a player who plants
         * their beds could never breed at all, and two crosses would wipe a
         * vault. A playtest of the opening two minutes recorded zero crosses
         * because of it.
         *
         * It also quietly invalidated the balance pass: the ~200-crosses figure
         * assumes you can keep crossing your best pair, which is impossible if
         * each cross eats both of them.
         *
         * Breeding is limited by the rate limiter and by mutagen, not by seed. */
        if (pa.qty < 1 || pb.qty < 1) {
          throw conflict('no_seed', 'You need to be holding seed of both parents.');
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

    /* Awarded after the transaction commits, so a milestone is never granted
       for a cross that rolled back. */
    const earned = await awardMilestones(playerId);

    return { child: strainView(child), earned, state: await getState(playerId) };
  });
}
