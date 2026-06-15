# Accessibility

## Color-Vision-Deficiency (CVD) themes

Pierre ships four themes designed for people with a **color vision deficiency
(CVD)**, the condition commonly called "color blindness." This document explains
what CVD is and how the themes are engineered around it.

| `name`                                 | label                                  | type  | targets     |
| -------------------------------------- | -------------------------------------- | ----- | ----------- |
| `pierre-light-protanopia-deuteranopia` | Pierre Light Protanopia & Deuteranopia | light | red-green   |
| `pierre-light-tritanopia`              | Pierre Light Tritanopia                | light | blue-yellow |
| `pierre-dark-protanopia-deuteranopia`  | Pierre Dark Protanopia & Deuteranopia  | dark  | red-green   |
| `pierre-dark-tritanopia`               | Pierre Dark Tritanopia                 | dark  | blue-yellow |

---

### What is CVD?

The retina senses color with three cone types — **L** (long / "red"), **M**
(medium / "green") and **S** (short / "blue") wavelengths. When one type is
missing or shifted, colors that differ mainly along that cone's axis collapse
into the same perceived color. CVD affects roughly **8% of men and 0.5% of
women**.

The three dichromacies (the strongest, "complete" forms) we target:

| Type             | Missing cone | Confuses                           | **Preserved** axis (what can still be told apart) |
| ---------------- | ------------ | ---------------------------------- | ------------------------------------------------- |
| **Protanopia**   | L ("red")    | red ↔ green                        | **blue ↔ orange/yellow** + luminance              |
| **Deuteranopia** | M ("green")  | red ↔ green                        | **blue ↔ orange/yellow** + luminance              |
| **Tritanopia**   | S ("blue")   | blue ↔ green (and yellow ↔ violet) | **red ↔ cyan/teal** + luminance                   |

> Tritanopia is loosely called "blue-yellow," but blue and yellow differ a lot
> in _luminance_ (which is preserved), so they stay apparent. The pair that
> truly collapses is **blue ↔ green**.

The key consequence for a code editor: a normal theme encodes the most important
signals — **added vs deleted**, **pass vs fail**, **error vs warning** — as
**red vs green**. To a protanope or deuteranope (the most common CVD), red and
green look nearly identical, so those signals become ambiguous.

---

### How the themes are engineered

Four principles, each enforced or made checkable by the build:

1. **Identical chrome = family fit.** Each CVD theme reuses the base
   `light`/`dark` roles for `bg`, `fg`, and `border` **verbatim**. Windows,
   text, and borders are pixel-for-pixel identical to Pierre Light / Pierre Dark
   — that is what keeps them recognizably "Pierre." Only the chromatic roles
   (`accent`, `states`, `syntax`, `ansi`) change.

2. **Signals ride the preserved axis.** Every meaningful color is re-mapped onto
   the hue axis that the target deficiency keeps:
   - **Protan/Deutan:** positive/added → **blue**, negative/deleted →
     **orange**.
   - **Tritan:** positive/added → **teal/cyan**, negative/deleted →
     **red/vermillion**.

3. **Luminance is the backup channel.** Under dichromacy there are only ~2
   usable hue poles + luminance, but ~20 chromatic roles. Where two roles must
   share a pole (e.g. several "cool" syntax tokens), they are separated by
   **luminance** (different palette stops) — the channel CVD users rely on most.

4. **Reuse the existing palette.** All colors come from scales already in
   `src/palettes.ts` (`blue`, `orange`, `teal`, `vermillion`, `magenta`, …). No
   off-brand hues were invented.

#### Role mapping (the actual choices)

Stops shift lighter on dark backgrounds (mirroring how `dark` shifts vs
`light`).

**Protan/Deutan — axis blue ↔ orange:**

| Role                        | Light         | Dark          | Why                                           |
| --------------------------- | ------------- | ------------- | --------------------------------------------- |
| `accent.primary` / `link`   | blue 500      | blue 500      | keep Pierre blue (brand)                      |
| `success` (added)           | blue 700      | blue 300      | positive → blue, luminance-split from accent  |
| `danger` (deleted/error)    | orange 700    | orange 400    | negative → orange                             |
| `warn`                      | yellow 500    | yellow 300    | bright caution; big luminance gap from danger |
| `info`                      | cyan 700      | cyan 400      | cool side; pairs against merge                |
| `merge`                     | violet 700    | violet 400    | blue-violet conflict color                    |
| `ansi.red` / `ansi.green`   | orange / blue | orange / blue | terminal pass/fail separable                  |
| `syntax.string` (=inserted) | blue 800      | blue 300      | added pole                                    |
| `syntax.tag` (=deleted)     | orange 700    | orange 400    | deleted pole                                  |

**Tritanopia — axis red ↔ cyan/teal:**

| Role                        | Light             | Dark              | Why                                                   |
| --------------------------- | ----------------- | ----------------- | ----------------------------------------------------- |
| `accent.primary` / `link`   | blue 500          | blue 500          | reads cyan-blue, clearly ≠ red                        |
| `success` (added)           | teal 700          | teal 300          | positive → teal/cyan                                  |
| `danger` (deleted/error)    | vermillion 600    | vermillion 400    | negative → red (preserved)                            |
| `warn`                      | amber 600         | amber 400         | caution; ΔE-separated from danger                     |
| `info`                      | blue 600          | blue 400          | cyan side                                             |
| `merge`                     | magenta 700       | magenta 400       | reddish-purple — tritan-safe, far from blue _and_ red |
| `ansi.red` / `ansi.green`   | vermillion / teal | vermillion / teal | terminal pass/fail separable                          |
| `syntax.string` (=inserted) | teal 700          | teal 300          | added pole                                            |
| `syntax.tag` (=deleted)     | vermillion 600    | vermillion 400    | deleted pole                                          |

---

### The objective test

A hard gate in `test/` simulates every chromatic role for each deficiency —
under _both_ the linear-RGB and gamma-sRGB Machado (2009) conventions — and
fails the build if any must-distinguish pair stops being separable (CIEDE2000
ΔE) or legible (WCAG contrast). It enforces the tiers and contrast policy below.
For how to run and read the report, see
[CONTRIBUTING.md](CONTRIBUTING.md#testing).

#### Tiers — graded by _what carries the signal when color fails_

Under dichromacy not every pair can be hue-unique, so we gate hardest where
color is the _only_ cue and lean on the editor's built-in non-color cues
elsewhere:

| Tier  | Bar      | What                                                                                                        | Why this bar                                                                                               |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **1** | ΔE ≥ 11  | diff add/delete backgrounds, diff inserted/deleted **text**, merge-conflict backgrounds, terminal red/green | color is the **sole** disambiguator — no glyph fallback                                                    |
| **2** | ΔE ≥ 8   | diagnostics (error/warn/info), core syntax (keyword/string/variable), comment-vs-code                       | color **plus** a non-color cue (icon shapes; position)                                                     |
| **3** | advisory | git-tree clique, extended syntax                                                                            | every git entry has an **M/A/D/U/C letter badge**; syntax has bold/italic + position. Reported, not gated. |

#### Contrast policy

We hold the themes to WCAG bars, but only the bar that fits how each color
renders:

- **Body text** (editor foreground) → **4.5:1** (SC 1.4.3 normal text).
- **Syntax tokens & meaningful signal colors** → **3:1** (SC 1.4.11 UI / large
  text), checked normal **and** after simulation.
- **Report-only** (printed, never fails the build): colors whose canonical/brand
  hue is intrinsically high-luminance and that base Pierre itself keeps bright —
  `accent.primary`/`link` (brand blue), `warn` (caution yellow/amber), and the
  decorative ansi colors. Their _distinguishability_ is gated; their raw
  contrast is not.
