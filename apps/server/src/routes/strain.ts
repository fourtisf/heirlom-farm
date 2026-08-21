/**
 * Naming and pressing. Naming a strain files it in the herbarium: it becomes a
 * permanent record and stops being plantable stock, which is what makes the act
 * feel like a decision rather than a text field.
 */

import { NAME_MAX_LENGTH } from '@heirlom/genetics';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isClean, isWellFormedName } from '../lib/profanity.js';
import { getState } from '../lib/player.js';
import { strainView } from '../lib/serialize.js';
import { awardMilestones } from '../lib/milestones.js';

const nameBody = z.object({
  strainId: z.string().min(1).max(64),
  name: z.string().min(1).max(NAME_MAX_LENGTH),
});

export async function strainRoutes(app: FastifyInstance) {
  /* Tutorial completion belongs to the player, not the browser. */
  app.post('/api/tutorial', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    await prisma.player.update({ where: { id: playerId }, data: { tutorialDone: done } });
    return { done };
  });

  app.post('/api/strain/name', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const body = nameBody.parse(req.body);
    const name = body.name.trim();

    if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
      throw badRequest('bad_name', `A name must be 1 to ${NAME_MAX_LENGTH} characters.`);
    }
    if (!isWellFormedName(name)) {
      throw badRequest('bad_name', 'Letters, numbers and simple punctuation only.');
    }
    if (!isClean(name)) {
      throw badRequest('bad_name', 'Pick a different name.');
    }

    const strain = await prisma.$transaction(async (tx) => {
      const row = await tx.strain.findUnique({ where: { id: body.strainId } });
      if (!row || row.playerId !== playerId) {
        throw notFound('no_strain', 'You do not hold that strain.');
      }
      if (row.named) throw conflict('already_named', 'That specimen is already named.');

      const updated = await tx.strain.updateMany({
        where: { id: row.id, playerId, named: false },
        data: { name, named: true, pressed: true },
      });
      if (updated.count !== 1) throw conflict('already_named', 'That specimen is already named.');

      return tx.strain.findUniqueOrThrow({ where: { id: row.id } });
    });

    const earned = await awardMilestones(playerId);

    return { strain: strainView(strain), earned, state: await getState(playerId) };
  });

  /** A single specimen. Private for now — no public herbarium page yet. */
  app.get('/api/strain/:id', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: playerId } = requirePlayer(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const strain = await prisma.strain.findUnique({ where: { id } });
    if (!strain || strain.playerId !== playerId) {
      throw notFound('no_strain', 'No such specimen.');
    }
    return { strain: strainView(strain) };
  });
}
