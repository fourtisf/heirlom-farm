'use client';

/**
 * The public specimen plate.
 *
 * Same plate the game shows, rendered standalone. The plant is drawn with the
 * same procedural art engine as the garden — no image assets here either.
 */

import { useEffect, useRef } from 'react';
import { COLORS, LOCI, SPECIES, TIERS, TRAITS } from '@heirlom/genetics';
import type { PublicSpecimen } from '@/app/herbarium/[accession]/page';

export default function SpecimenPlate({ specimen }: { specimen: PublicSpecimen }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    /* The art engine reaches for `window` and the store, so it is loaded only in
       the browser and only once the plate is on screen. */
    void (async () => {
      const [{ drawPlant }, store] = await Promise.all([
        import('@/game/art.js'),
        import('@/game/store.js'),
      ]);
      if (cancelled) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // The engine reads phenotype and yield off the strain view, as in game.
      const shaped = {
        ...specimen,
        id: specimen.accession,
        yieldCount: Math.max(1, Math.round(0.6 + specimen.phenotype.Y * specimen.phenotype.Y * 0.3)),
      };

      const form = SPECIES[specimen.species as keyof typeof SPECIES]?.form;
      const scale = form === 'stalk' ? 1.35 : form === 'gourd' ? 1.5 : 1.7;

      store.G.dayT = 0.3;
      ctx.save();
      ctx.translate(rect.width / 2, rect.height * (form === 'gourd' ? 0.62 : 0.84));
      drawPlant(ctx, 0, 0, shaped, 1, 0.4, { scale, noBadge: true });
      ctx.restore();
    })();

    return () => {
      cancelled = true;
    };
  }, [specimen]);

  const species = SPECIES[specimen.species as keyof typeof SPECIES];
  const tier = TIERS.find((t) => t.key === specimen.tier) ?? TIERS[0];
  const traits = TRAITS.filter((t) => specimen.traits.includes(t.k));
  const shortColor = (k: string) => COLORS[k as keyof typeof COLORS].name.slice(0, 2);

  const notation =
    LOCI.map((l) => `${l.k}${specimen.genes[l.k][0]}/${specimen.genes[l.k][1]}`).join('  ') +
    `  C${shortColor(specimen.color[0])}/${shortColor(specimen.color[1])}`;

  const pressed = new Date(specimen.pressedOn).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <main className="publicplate">
      <div className="plate is-drawn">
        <div
          className="plate__ribbon"
          style={{
            background: tier.hex,
            color: tier.key === 'common' || tier.key === 'prized' ? '#231A10' : '#FFF6E6',
          }}
        >
          {tier.name}
        </div>

        <div className="plate__eyebrow">
          Vale Herbarium · Accession <span>{specimen.accession}</span>
        </div>
        <div className="plate__species">{species?.name ?? specimen.species}</div>
        <div className="plate__latin">{species?.latin}</div>

        <canvas className="plate__art" ref={canvasRef} />

        <div className="plate__name">{specimen.name}</div>
        <div className="plate__gen">Generation {specimen.generation}</div>
        <div className="plate__rule" />
        <div className="plate__notation">{notation}</div>

        <div className="plate__traits">
          {traits.length ? (
            traits.map((t) => (
              <span className="ptrait" key={t.k} title={t.desc}>
                {t.name}
              </span>
            ))
          ) : (
            <span className="ptrait ptrait--none">No distinguishing traits</span>
          )}
        </div>

        <div className="plate__meta">
          <div>
            <span>Pressed</span>
            <b>{pressed}</b>
          </div>
          <div>
            <span>Breeding score</span>
            <b>{specimen.score}</b>
          </div>
          <div>
            <span>Recorded by</span>
            <b>{specimen.gardener}</b>
          </div>
          <div>
            <span>Locality</span>
            <b>Vale estate, west beds</b>
          </div>
        </div>

        {specimen.mutations.length ? (
          <div className="plate__mut">
            <b>Mutations recorded:</b>{' '}
            {specimen.mutations.map((m) => `${m.locus} ${m.from}→${m.to}`).join(', ')}
          </div>
        ) : null}
      </div>

      <a className="publicplate__cta" href="/">
        HEIRLOM — grow your own line
      </a>
    </main>
  );
}
