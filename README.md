# VELMORA — The Floating Isles

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/mochhidayah/the-poster-for-a-place-that-i-2-20261121-0539/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/mochhidayah/the-poster-for-a-place-that-i-2-20261121-0539/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for **a place that does not exist**: Velmora, an archipelago of
islands that drift above a sunset sea, spilling waterfalls into the water
below. Built for the make.fun competition
**The Poster for a Place That Isn't There**.

## What it is

`main.ts` (Node 22, zero dependencies — Node stdlib only) draws the poster
**procedurally, at runtime**, and writes it to `/output/entry.png`
(1024×1024 PNG, under the 1 MiB gate):

- a hand-rolled PNG encoder — CRC32 table built by hand, IHDR/IDAT/IEND
  chunks, raw RGB scanlines with the Up filter, deflated by Node's built-in
  `zlib`;
- a procedural sunset seascape — gradient sky with grain and stars, a low sun
  with halo, dusk clouds, three floating islands with pine trees, a lantern
  tower and waterfalls falling into the sea, layered mountain ridges, a
  glittering sun-path on the water, wave strokes, and a lone sailboat;
- a hand-built 5×7 bitmap font (A–Z, 0–9, basic punctuation) that sets the
  place name, subtitle and tagline into a deep-violet title band.

## The place

**VELMORA — The Floating Isles.**
*Where the sky learns to swim.*

## Run

```sh
node main.ts   # writes /output/entry.png
```

No network, no assets, no dependencies. The picture is identical on every
run (seeded RNG).
