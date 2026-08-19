import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Mono, Karla } from 'next/font/google';
import './globals.css';

/* The prototype pulled these from a stylesheet link; next/font self-hosts them
   so the first paint is not waiting on a third party. */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '900'],
  variable: '--font-display',
  display: 'swap',
});
const karla = Karla({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-body',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'HEIRLOOM — a breeding farm',
  description:
    'Anyone can grow a crop. Few can fix a line. Cross plants, inherit alleles, and chase recessive colour morphs.',
};

export const viewport: Viewport = {
  themeColor: '#241B12',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${karla.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
