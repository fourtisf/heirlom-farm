# HEIRLOM — brand assets

**The mark is 01, Seed and ring.** Chosen by ALFA from the six references below. Everything in this
folder now descends from it.

## Files

| file | what it is |
|---|---|
| `heirlom-mark.svg` | the mark, 512×512, full bleed. Crops to a circular avatar with nothing lost. |
| `heirlom-mark-flat.svg` | the same geometry without its soil disc, for placing over artwork or a light surface. |
| `export/heirlom-avatar-400.png` | **X profile picture.** 400×400, the size X serves. |
| `export/heirlom-avatar-1000.png` | same, for anywhere that wants more pixels. |
| `export/heirlom-banner.png` | **X header.** 1500×500. |
| `export/heirlom-banner@2x.png` | 3000×1000, for retina or print. |
| `export/opengraph-image.png` | 1200×630 link-preview card. |
| `banner.src.html` / `opengraph.src.html` | the sources both PNGs are rendered from. Edit these, re-render, never touch the PNGs by hand. |

## Where it is wired into the app

| path | serves |
|---|---|
| `apps/web/src/app/icon.svg` | the favicon — **redrawn** for 16px, not the mark scaled down |
| `apps/web/src/app/apple-icon.png` | 180×180 home-screen icon |
| `apps/web/src/app/opengraph-image.png` | the link-preview card, picked up by the App Router automatically |
| `apps/web/public/brand/` | the same assets served as static files, for press or partners |

`layout.tsx` sets `metadataBase` from `NEXT_PUBLIC_SITE_URL`. **Set that in production** — a
relative `og:image` is ignored by every scraper, so without it link previews fall back to
`localhost` and show nothing.

## The banner, and why it is laid out the way it is

X overlays the profile picture across the header's bottom-left. Measured in the banner's own
1500×500 space, that disc covers **x 40–372, y 334–500**. Every piece of type therefore starts at
x=424, and the mark is pulled in to end at x=1314 so it survives a narrower crop. There is a
proof render of exactly this in the commit that added it.

## The favicon is a redraw, not a resize

The mark's double ring and its four veins both turn to mud below about 24px. The favicon keeps the
silhouette, one ring, the midrib and the brass seed, and drops the rest. Checked at 16, 24, 32 and
64px before it was committed.

## The other five references

Kept for the record; none of them is the brand.

| | mark | reads at 24px |
|---|---|---|
| 02 | Helix sprout | yes — the runner-up, and the one that says *genetics* loudest |
| 03 | Punnett | yes, best of the six |
| 04 | Monogram H | yes |
| 05 | Colour ladder | as a coloured asterisk; launch art, not an avatar |
| 06 | Herbarium tag | no — header and OG art only |

## Rules

- No text inside the mark. At avatar size a wordmark is illegible and the handle sits beside it anyway.
- Two or three colours, never more. Anything else turns to mud once a browser downsamples it.
- Redraw for small sizes rather than scaling; the stroke weights here were tuned for the small end.
- Palette is the game's own, from `apps/web/src/app/globals.css`: soil `#241B12`, brass `#C9A227`,
  ivory `#F0E6CE`, leaf `#7FB069`.
