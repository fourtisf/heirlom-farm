# Logo references — HEIRLOOM on X

Six marks, drawn as SVG against the game's own palette (`apps/web/src/app/globals.css`): soil
`#241B12`, brass `#C9A227`, leaf `#7FB069`, verdant `#3E6B44`, ivory `#F0E6CE`.

Each file is 512×512 with a full-bleed background, so it crops to a circular X avatar with nothing
falling outside the mask. All six were rendered and checked at 150, 72, 40 and **24px** — 24 being
the size an avatar actually appears at in a timeline, and the only size that decides whether a mark
works.

| | mark | reads at 24px | best for |
|---|---|---|---|
| 01 | **Seed and ring** | yes | the safe, elegant choice. One shape, one ring. Most "heirloom", least "game". |
| 02 | **Helix sprout** | yes | **recommended.** The only mark that says *farm* and *genetics* in one silhouette. |
| 03 | **Punnett** | yes, best of the six | the most ownable. One cell in four is ivory — the game's whole thesis as four rectangles. |
| 04 | **Monogram H** | yes | strongest when the name must be carried by the mark alone. |
| 05 | **Colour ladder** | as a coloured asterisk | expressive, five morphs in rank order. Launch graphics over avatar. |
| 06 | **Herbarium tag** | no — becomes a pale blob | header, OG card, pinned-post art. Not an avatar. |

## Recommendation

**02 for the avatar, 06 for the header.** The helix sprout is the one a stranger can decode without
context, and it stops the account reading as a generic farm game — which is the actual positioning
problem, since the genetics *are* the product.

**03 is the sharper long-term brand** if you want a mark nobody else has: it is unmistakable at any
size, it carries the recessive-morph idea, and it does not compete with the thousand other
leaf-in-a-circle avatars. It is also the least immediately legible as "a game", which is the trade.

## Notes

- Nothing here contains text. At avatar size a wordmark is illegible, and the X handle already does
  that job directly beside the picture.
- Every mark is two or three colours. Anything more turns to mud once the browser downsamples it.
- These match `apps/web/src/app/icon.svg` in palette but not in construction — if one is adopted, the
  favicon should be redrawn from it so the tab and the profile agree.
- Redraw for other sizes rather than upscaling: SVG scales, but the stroke weights here were tuned
  for the small end and will look thin above ~400px.
