/**
 * The public accession page.
 *
 * A specimen becomes visible here when its owner names and presses it, which is
 * a deliberate act — nobody's holdings are published by default. Rendered on the
 * server so a shared link unfurls with a real title and description instead of
 * an empty client shell.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SpecimenPlate from '@/components/SpecimenPlate';

export const dynamic = 'force-dynamic';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PublicSpecimen {
  accession: string;
  name: string;
  species: string;
  genes: Record<'Y' | 'V' | 'H' | 'E', [number, number]>;
  color: [string, string];
  generation: number;
  phenotype: { Y: number; V: number; H: number; E: number; color: string };
  score: number;
  tier: string;
  traits: string[];
  mutations: Array<{ locus: string; from: string | number; to: string | number }>;
  pressedOn: string;
  gardener: string;
}

async function load(accession: string): Promise<PublicSpecimen | null> {
  try {
    const res = await fetch(`${API_URL}/api/herbarium/${encodeURIComponent(accession)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicSpecimen;
  } catch {
    // The API being down should read as "not found", not as a crash.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { accession: string };
}): Promise<Metadata> {
  const specimen = await load(params.accession);
  if (!specimen) return { title: 'Unknown specimen — HEIRLOOM' };

  const description =
    `${specimen.species} · generation ${specimen.generation} · breeding score ${specimen.score}. ` +
    `Pressed into the Vale herbarium by ${specimen.gardener}.`;

  return {
    title: `${specimen.name} (${specimen.accession}) — HEIRLOOM`,
    description,
    openGraph: { title: `${specimen.name} — ${specimen.accession}`, description },
    twitter: { card: 'summary_large_image', title: specimen.name, description },
  };
}

export default async function Page({ params }: { params: { accession: string } }) {
  const specimen = await load(params.accession);
  if (!specimen) notFound();
  return <SpecimenPlate specimen={specimen} />;
}
