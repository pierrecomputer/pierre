# @pierre/pipes

The classic Windows "3D Pipes" screensaver, recreated from scratch in raw
WebGL2. No dependencies — hand-written matrix math, procedural geometry, and
shaders in ~15 kB (5 kB gzipped).

A faithful port of the original `sspipes` source (Windows NT 4.0 SDK,
`MSTOOLS\SAMPLES\OPENGL\SCRSAVE`): pipes random-walk a 3D grid using the
original's weighted direction algorithm (1 pipe in 20 is a long straight
runner), with quarter-torus elbows at turns and √2-radius ball caps at pipe
starts and ends. Materials are the original's 16 "teapot" materials (emerald,
jade, pearl, ruby, brass, gold, silver...) lit with the exact fixed-function
formula — one white directional light in eye space, full-strength ambient light
model, per-material specular, no gamma correction — on pure black.

Ported behaviors beyond the basics:

- **Round structure**: a round draws a budget of pipes (5, ×1.5 in multi-pipe
  mode); each pipe grows until it traps itself, then a new one starts. Rounds
  run 2–4 simultaneous pipes (or one at a time with `multiPipes: false`).
- **Joint styles**: elbows (default), balls, mixed (1/3 balls — and a 1-in-1000
  chance the joint is a tiny Utah teapot), or cycling per round.
- **Chase mode**: 1 in 5 multi-pipe rounds picks a lead pipe the others chase.
- **Flex pipes** (`pipeStyle: 'flex'` or `'mixed'`): the original's second pipe
  type — extruded elliptical/random cross-sections with sweeping variable-radius
  bends, or "turnomania" rounds (10 pipes of nothing but full-cell quarter
  turns), with the ±5° scene tilts those frames got.
- **The camera never enters the pipe volume**: fixed eye distance, wide 90° FOV,
  grid height scaled to the window aspect ratio, and each round rotates the
  scene a further 9.73156° around Y.
- `growth: 'step'` pops whole segments per tick and `fadeSeconds: 0` cuts
  between rounds instantly — together, the original's exact cadence.

## Install

```sh
npm install @pierre/pipes
```

## Usage

```ts
import { createPipes } from '@pierre/pipes';

const pipes = createPipes(document.querySelector('canvas'));

// Later, if needed:
pipes.stop(); // pause the animation loop
pipes.start(); // resume
pipes.reset(); // fade out and start a fresh round
pipes.destroy(); // release all GL resources and observers
```

The canvas is sized automatically from its CSS layout size (via
`ResizeObserver`), so style it however you like — fullscreen, in a card,
wherever pipes belong.

## Options

All options are optional:

```ts
createPipes(canvas, {
  pipeCount: 4, // max simultaneous pipes; multi rounds use 2..pipeCount
  gridSize: 20, // cells along the longest grid dimension (height scales with aspect)
  speed: 11, // growth speed, cells per second
  straightBias: 0.65, // fixed straight probability; omit for the original's weighted algorithm
  pipeRadius: 1 / 7, // pipe radius in cell units (the original's proportion)
  bendRadius: 1 / 7, // elbow bend radius; defaults to pipeRadius, like the original
  capRadius: 0.2, // ball cap at pipe starts/ends; defaults to √2 × pipeRadius
  jointStyle: 'elbow', // 'elbow' | 'ball' | 'mixed' (rare teapot!) | 'cycle'
  teapotChance: 1 / 1000, // teapot odds per 'mixed' joint
  pipeStyle: 'normal', // 'normal' | 'flex' (curvy extruded pipes) | 'mixed'
  growth: 'smooth', // 'smooth' animated tip, or 'step' whole-segment pops like the original
  multiPipes: true, // several pipes at once; false = one at a time, sequentially
  pipesPerRound: 5, // pipe budget per round (original NORMAL_PIPE_COUNT)
  chase: true, // allow 1-in-5 rounds where pipes chase a lead pipe
  resetThreshold: 0.6, // grid occupancy backstop that forces a reset
  roundDuration: 45, // max seconds per round
  fadeSeconds: 1.2, // fade between rounds; 0 = instant cut like the original
  cameraDrift: false, // slow orbit during a round (the original is static)
  pixelSize: 2, // render at 1/pixelSize resolution, nearest-neighbor upscaled; 1 = full res + AA
  backgroundColor: [0, 0, 0], // or 'transparent' to composite over the page
  colors: [[1, 0.2, 0.2]], // simple palette (rendered as plastic), random pick per pipe
  materials: [
    /* full PipeMaterial entries; defaults to CLASSIC_MATERIALS */
  ],
});
```

`CLASSIC_MATERIALS` (the original's 16 teapot materials) and the `PipeMaterial`
type are exported for building custom palettes.

## Development

From the monorepo root:

```sh
pnpm install
moonx pipes:demo    # demo page at http://localhost:5173 (press "r" to force a reset)
moonx pipes:build   # library build + type declarations into dist/
```

## License

Apache-2.0
