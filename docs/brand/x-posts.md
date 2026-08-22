# HEIRLOM — the X posts

Six posts, one per asset in `export/`. Written to be posted a few days apart, in this order,
because each one assumes you have not explained the previous idea yet.

Everything factual in here is checked against `packages/genetics/src/constants.ts` and
`apps/web/src/game/ui.js`. **If you change a balance constant, this file is wrong.** Posts whose numbers come
straight out of the code are marked ⚙; those are the ones to re-check after a balance change.

X counts a URL as 23 characters no matter how long it is, and an attached image costs nothing.
Every post below fits in 280 with the link included; the counts are in `check-x-posts.mjs`.

---

## Profile first

Do this before post 1, or the launch post lands on an empty profile.

**Avatar** — `export/heirlom-avatar-400.png`
**Header** — `export/heirlom-banner.png`

**Bio** — X caps this at 160, both of these are under it:

```
A farm game where the plants have real genetics. Four genes, five colours, and the rarest one is recessive.
```

```
Game bertani dengan genetika sungguhan. Empat gen, lima warna, dan yang paling langka bersifat resesif.
```

**Link** — `heirlom.fun`

---

## Post 1 — Launch

**Image:** `export/x-ladder.png`
**Alt text:** Five cards climbing left to right — Crimson, Amber, Jade, Violet, Ivory — each one a rung higher than the last, with the score each colour is worth.

> HEIRLOM is live.
>
> A farm game where the plants have real genetics. Every plant carries two alleles per gene and passes one on at random.
>
> Five colours. Ivory is recessive to all four, so it only appears when both parents hide it.
>
> heirlom.fun

**Indonesian:**

> HEIRLOM sudah live.
>
> Game bertani dengan genetika sungguhan. Tiap tanaman punya dua alel per gen dan mewariskan satu secara acak.
>
> Lima warna. Ivory resesif terhadap keempatnya — hanya muncul kalau kedua induk menyembunyikannya.
>
> heirlom.fun

If you want a thread instead of a single post, add these as replies:

*⚙ checked against the code — see the note at the top.*

> Four quantitative genes — Yield, Vigor, Hardiness, Essence — alleles 1 to 6. Plus one colour locus that is classically Mendelian, with the *lower* rank dominant.
>
> That inversion is the whole design. The beautiful morphs are the recessive ones.

*⚙ checked against the code — see the note at the top.*

> Five species, unlocked by level: Tomato, Corn, Chili, Pumpkin, Moonflower.
>
> The moonflower's field note reads: "No ivory specimen has ever been recorded."
>
> That is not flavour text. Nobody has bred one.

---

## Post 2 — Carriers

The one that makes people stop scrolling. Post it 2–3 days after launch.

**Image:** `export/x-punnett.png`
**Alt text:** A two-by-two Punnett square. Three of the four offspring are Crimson, two of those secretly carry Ivory, and only the fourth shows Ivory.

> The plainest plant you own may be the most valuable one.
>
> Crimson dominates Ivory. Cross two carriers and three of four offspring look identical — but two of them are hiding it.
>
> Learning to tell those apart is the entire game.
>
> heirlom.fun

**Indonesian:**

> Tanaman paling biasa di kebun Anda bisa jadi yang paling berharga.
>
> Crimson dominan atas Ivory. Silangkan dua carrier: tiga dari empat anakan terlihat identik — tapi dua di antaranya menyembunyikannya.
>
> Membedakan keduanya itulah inti permainannya.

---

## Post 3 — The receipt

Your strongest post. It is the only one with a result in it rather than a claim.

**Image:** `export/x-receipt.png`
**Alt text:** Four data cards — 130 crosses made, 2 of 5 rungs climbed, 0 Ivory recorded, 15 levels reached.

*⚙ checked against the code — see the note at the top.*

> I let a script play HEIRLOM the way most people would: always pair the two best-looking parents.
>
> 130 crosses. Level 15. Never got past rung two.
>
> Greedy does not reach Ivory. Breeding for what a plant *hides* does.
>
> heirlom.fun

**Indonesian:**

> Saya biarkan skrip memainkan HEIRLOM seperti kebanyakan orang: selalu menyilangkan dua induk yang paling bagus.
>
> 130 silang. Level 15. Tidak pernah lewat anak tangga kedua.
>
> Serakah tidak sampai ke Ivory. Membiakkan apa yang *disembunyikan* tanaman, itu yang sampai.

Reply to your own post with this, it is the payoff:

*⚙ checked against the code — see the note at the top.*

> Roughly two hundred crosses to the end of the ladder — if you keep your carriers.
>
> Far more than that if you throw them away for looking plain.

---

## Post 4 — Server-authoritative

For the crypto timeline. Post it when someone asks whether the game can be cheated.

**Image:** `export/x-fair.png`
**Alt text:** Five rows — every genetic roll, ripeness, genes from the client, commission match, and every coin move — each one marked as decided on the server.

> The rare strain is the only thing of value in HEIRLOM.
>
> So the browser is never allowed to decide one.
>
> Every roll is crypto.randomInt server-side. Ripeness is stamped at plant time. Genes are never accepted from the client. Every coin move hits a ledger.

**Indonesian:**

> Strain langka adalah satu-satunya hal bernilai di HEIRLOM.
>
> Karena itu browser tidak pernah boleh menentukannya.
>
> Semua undian pakai crypto.randomInt di server. Kematangan dicap saat menanam. Gen tidak pernah diterima dari client. Setiap perpindahan koin masuk ledger.

---

## Post 5 — The herbarium

The one people screenshot and reply to with their own.

**Image:** `export/x-specimen.png`
**Alt text:** A pressed herbarium plate for a jade tomato named Pale Row Jade, accession HB-4417, generation 97, marked as carrying Ivory.

> Name it, press it, and it outlives the farm.
>
> Every specimen you press gets an accession number, its full genotype, its parentage, and a page anyone can open.
>
> Show me the best thing in your herbarium.
>
> heirlom.fun

**Indonesian:**

> Beri nama, keringkan, dan ia hidup lebih lama dari kebunnya.
>
> Tiap spesimen yang Anda simpan dapat nomor aksesi, genotipe lengkap, garis keturunan, dan halaman yang bisa dibuka siapa saja.
>
> Tunjukkan koleksi terbaik di herbarium Anda.

---

## Post 6 — Dailies

Use this one to bring lapsed players back, not to acquire new ones.

**Image:** `export/heirlom-daily-banner.png`
**Alt text:** The daily task card — three tasks a day, each with a guide button that walks you through it.

*⚙ checked against the code — see the note at the top.*

> Three tasks a day. Reap, trade, cross, brief.
>
> Press Guide on any of them and the game walks you through it, step by step, and stays there until the task is actually finished — not until you close the tooltip.
>
> heirlom.fun

**Indonesian:**

> Tiga tugas per hari. Panen, jual, silang, pesanan.
>
> Tekan Guide di salah satunya dan game akan menuntun Anda langkah demi langkah — dan tetap di sana sampai tugasnya benar-benar selesai, bukan sampai Anda menutup tooltip-nya.

---

## Order and spacing

| day | post | why here |
|---|---|---|
| 0 | 1 — Launch | pin this one |
| 2 | 2 — Carriers | the hook; it needs post 1's setup to land |
| 5 | 3 — Receipt | your proof post, once people know the ladder exists |
| 8 | 5 — Herbarium | asks for a reply, so it wants an audience first |
| 12 | 4 — Fair | reactive; move it earlier if the question comes up sooner |
| 15 | 6 — Dailies | aimed at people who already played once |

Post between 20:00 and 23:00 WIB if you want the Indonesian timeline, or 21:00–00:00 WIB
(09:00–12:00 ET) for the US one. Do not post both languages in the same tweet — pick per post.

## Things not to write

- No token price, listing, supply or market-cap language. `$SEED` is an in-game balance in this
  copy and nothing more.
- No player counts, revenue or funding numbers. You do not have analytics wired up yet, so any
  number you post is one you cannot back.
- No roadmap dates. Guest play is not built; do not announce it.
- Do not call the genetics "AI". It is a Punnett square and a seeded RNG, and someone will check.
