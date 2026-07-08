import type { Vec3 } from './math';
import {
  mat4FromBasis,
  mat4ScaleTranslate,
  v3add,
  v3cross,
  v3scale,
} from './math';
import type { Batch } from './renderer';
import { pushInstance, updateInstance } from './renderer';

export interface PipeMaterial {
  ambient: Vec3;
  diffuse: Vec3;
  specular: Vec3;
  /** OpenGL-style specular exponent, 0–128. */
  shininess: number;
}

// The 16 "good" teapot materials the original picked from (goodMaterials[] +
// teaMaterialData[] in MATERIAL.C of the NT4 SDK sspipes source). Rendered
// with the fixed-function formula: ka*1.1 + kd*NdotL + ks*NdotH^shine.
export const CLASSIC_MATERIALS: PipeMaterial[] = [
  {
    ambient: [0.0215, 0.1745, 0.0215],
    diffuse: [0.07568, 0.61424, 0.07568],
    specular: [0.633, 0.727811, 0.633],
    shininess: 76.8,
  }, // emerald
  {
    ambient: [0.135, 0.2225, 0.1575],
    diffuse: [0.54, 0.89, 0.63],
    specular: [0.316228, 0.316228, 0.316228],
    shininess: 12.8,
  }, // jade
  {
    ambient: [0.25, 0.20725, 0.20725],
    diffuse: [1.0, 0.829, 0.829],
    specular: [0.296648, 0.296648, 0.296648],
    shininess: 11.264,
  }, // pearl
  {
    ambient: [0.1745, 0.01175, 0.01175],
    diffuse: [0.61424, 0.04136, 0.04136],
    specular: [0.727811, 0.626959, 0.626959],
    shininess: 76.8,
  }, // ruby
  {
    ambient: [0.1, 0.18725, 0.1745],
    diffuse: [0.396, 0.74151, 0.69102],
    specular: [0.297254, 0.30829, 0.306678],
    shininess: 12.8,
  }, // turquoise
  {
    ambient: [0.329412, 0.223529, 0.027451],
    diffuse: [0.780392, 0.568627, 0.113725],
    specular: [0.992157, 0.941176, 0.807843],
    shininess: 27.9,
  }, // brass
  {
    ambient: [0.2125, 0.1275, 0.054],
    diffuse: [0.714, 0.4284, 0.18144],
    specular: [0.393548, 0.271906, 0.166721],
    shininess: 25.6,
  }, // bronze
  {
    ambient: [0.19125, 0.0735, 0.0225],
    diffuse: [0.7038, 0.27048, 0.0828],
    specular: [0.256777, 0.137622, 0.086014],
    shininess: 12.8,
  }, // copper
  {
    ambient: [0.24725, 0.1995, 0.0745],
    diffuse: [0.75164, 0.60648, 0.22648],
    specular: [0.628281, 0.555802, 0.366065],
    shininess: 51.2,
  }, // gold
  {
    ambient: [0.19225, 0.19225, 0.19225],
    diffuse: [0.50754, 0.50754, 0.50754],
    specular: [0.508273, 0.508273, 0.508273],
    shininess: 51.2,
  }, // silver
  {
    ambient: [0.0, 0.1, 0.06],
    diffuse: [0.0, 0.5098, 0.5098],
    specular: [0.50196, 0.50196, 0.50196],
    shininess: 32,
  }, // cyan plastic
  {
    ambient: [0, 0, 0],
    diffuse: [0.55, 0.55, 0.55],
    specular: [0.7, 0.7, 0.7],
    shininess: 32,
  }, // white plastic
  {
    ambient: [0, 0, 0],
    diffuse: [0.5, 0.5, 0.0],
    specular: [0.6, 0.6, 0.5],
    shininess: 32,
  }, // yellow plastic
  {
    ambient: [0.0, 0.05, 0.05],
    diffuse: [0.4, 0.5, 0.5],
    specular: [0.04, 0.7, 0.7],
    shininess: 10,
  }, // cyan rubber
  {
    ambient: [0.0, 0.05, 0.0],
    diffuse: [0.4, 0.5, 0.4],
    specular: [0.04, 0.7, 0.04],
    shininess: 10,
  }, // green rubber
  {
    ambient: [0.05, 0.05, 0.05],
    diffuse: [0.5, 0.5, 0.5],
    specular: [0.7, 0.7, 0.7],
    shininess: 10,
  }, // white rubber
];

export type JointStyle = 'elbow' | 'ball' | 'mixed' | 'cycle';

export interface SimConfig {
  pipeCount: number;
  speed: number;
  /**
   * Probability of continuing straight. If undefined (the default), uses the
   * original's per-pipe integer weighting: usually 1–4 against the number of
   * open turns, but 1 pipe in 20 gets a weight of 25–100 and runs long and
   * straight across the volume.
   */
  straightBias?: number;
  pipeRadius: number;
  bendRadius: number;
  capRadius: number;
  resetThreshold: number;
  materialCount: number;
  jointStyle: JointStyle;
  /** Chance a joint is the teapot, in 'mixed' joints. Original: 1/1000. */
  teapotChance: number;
  /** 'smooth' animates the growing tip; 'step' pops whole cells like the original. */
  growth: 'smooth' | 'step';
  /** Several pipes at once (original's "multiple pipes" checkbox). */
  multiPipes: boolean;
  /** Pipes drawn before the round ends (NORMAL_PIPE_COUNT = 5; ×1.5 when multi). */
  pipesPerRound: number;
  /** Allow chase rounds (1 in 5 multi-pipe rounds follow a lead pipe). */
  chase: boolean;
}

// From NODE.H in the original source.
const MAX_WEIGHT_STRAIGHT = 100;

// bigBall joint: √2·r / cos(π/nSlices), sized so pipe edges never poke out.
const BALL_JOINT_FACTOR = Math.SQRT2 / Math.cos(Math.PI / 24);

// auxSolidTeapot(2.5 * radius); our unit teapot has height 2 ≈ radius 1.
const TEAPOT_FACTOR = 2.5;

// Paired so that reverse(i) === i ^ 1.
export const DIRS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

interface Pipe {
  enabled: boolean; // participates in the current round
  alive: boolean;
  matIndex: number;
  weight: number; // straight-direction weight, original style
  head: Vec3; // cell currently being grown into (already occupied)
  dirIdx: number;
  runStart: Vec3; // cell where the current straight run began
  runLen: number; // whole cells from runStart to head along dir
  startsAtBend: boolean; // run begins at a joint, so the cylinder starts bendRadius short of it
  t: number; // fractional progress into the head cell
  speed: number;
  cylIndex: number;
  tipIndex: number;
}

export type GridDims = [number, number, number];

export interface Sim {
  config: SimConfig;
  dims: GridDims;
  occ: Uint8Array;
  occupied: number;
  pipes: Pipe[];
  pipesDrawn: number; // finished pipes this round
  maxPipesThisRound: number;
  chaseMode: boolean;
  leadIndex: number;
  cycleStyle: number; // rotates elbow -> ball -> mixed when jointStyle is 'cycle'
  cyl: Batch;
  elb: Batch;
  sph: Batch;
  disc: Batch;
  tea: Batch;
  stuck: boolean; // an instance batch overflowed; force a reset
}

const MAT = new Float32Array(16);

function cellIndex(sim: Sim, c: Vec3): number {
  const [nx, ny] = sim.dims;
  return c[0] + c[1] * nx + c[2] * nx * ny;
}

function isFree(sim: Sim, c: Vec3): boolean {
  const [nx, ny, nz] = sim.dims;
  if (
    c[0] < 0 ||
    c[0] >= nx ||
    c[1] < 0 ||
    c[1] >= ny ||
    c[2] < 0 ||
    c[2] >= nz
  )
    return false;
  return sim.occ[cellIndex(sim, c)] === 0;
}

function occupy(sim: Sim, c: Vec3): void {
  sim.occ[cellIndex(sim, c)] = 1;
  sim.occupied++;
}

function cellToWorld(sim: Sim, c: Vec3): Vec3 {
  return [
    c[0] - (sim.dims[0] - 1) / 2,
    c[1] - (sim.dims[1] - 1) / 2,
    c[2] - (sim.dims[2] - 1) / 2,
  ];
}

// Model matrix for the unit cylinder: starts startOffset cells past runStart
// along dir (to clear a joint at the run's start) and extends len cells.
function cylinderMatrix(
  sim: Sim,
  runStart: Vec3,
  dirIdx: number,
  startOffset: number,
  len: number
): Float32Array {
  const d = DIRS[dirIdx];
  const helper: Vec3 = Math.abs(d[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
  const x = v3cross(helper, d);
  const z = v3cross(x, d);
  const r = sim.config.pipeRadius;
  const w = cellToWorld(sim, runStart);
  return mat4FromBasis(
    MAT,
    v3scale(x, r),
    v3scale(d, Math.max(len, 0.001)),
    v3scale(z, r),
    [
      w[0] + d[0] * startOffset,
      w[1] + d[1] * startOffset,
      w[2] + d[2] * startOffset,
    ]
  );
}

// The canonical elbow mesh enters the corner along +X and leaves along +Y,
// so mapping (+X, +Y) onto (dirIn, dirOut) is a pure rotation.
function elbowMatrix(
  sim: Sim,
  corner: Vec3,
  dirInIdx: number,
  dirOutIdx: number
): Float32Array {
  const x = DIRS[dirInIdx];
  const y = DIRS[dirOutIdx];
  return mat4FromBasis(MAT, x, y, v3cross(x, y), cellToWorld(sim, corner));
}

function sphereMatrix(radius: number, at: Vec3): Float32Array {
  return mat4ScaleTranslate(MAT, radius, radius, radius, at[0], at[1], at[2]);
}

// Flat cap over the open end of a growing pipe, facing the growth direction.
function discMatrix(sim: Sim, at: Vec3, dirIdx: number): Float32Array {
  const d = DIRS[dirIdx];
  const helper: Vec3 = Math.abs(d[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
  const x = v3cross(helper, d);
  const z = v3cross(x, d);
  const r = sim.config.pipeRadius;
  return mat4FromBasis(MAT, v3scale(x, r), d, v3scale(z, r), at);
}

function startOffset(sim: Sim, pipe: Pipe): number {
  return pipe.startsAtBend ? sim.config.bendRadius : 0;
}

// NORMAL_PIPE constructor weighting: 1 in 20 pipes is a long straight runner.
function chooseWeight(): number {
  return Math.random() < 0.05
    ? 25 + ((Math.random() * (MAX_WEIGHT_STRAIGHT - 25 + 1)) | 0)
    : 1 + ((Math.random() * 4) | 0);
}

function initPipe(sim: Sim, pipe: Pipe): boolean {
  const [nx, ny, nz] = sim.dims;
  pipe.alive = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const cell: Vec3 = [
      (Math.random() * nx) | 0,
      (Math.random() * ny) | 0,
      (Math.random() * nz) | 0,
    ];
    if (!isFree(sim, cell)) continue;
    const freeDirs: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (isFree(sim, v3add(cell, DIRS[i]))) freeDirs.push(i);
    }
    if (freeDirs.length < 2) continue;

    const dirIdx = freeDirs[(Math.random() * freeDirs.length) | 0];
    const matIndex = (Math.random() * sim.config.materialCount) | 0;
    const head = v3add(cell, DIRS[dirIdx]);
    occupy(sim, cell);
    occupy(sim, head);

    const world = cellToWorld(sim, cell);
    // The starting spot gets its ball right away; the growing tip is a flat
    // disc sealing the open tube until the pipe finishes.
    const capIndex = pushInstance(
      sim.sph,
      sphereMatrix(sim.config.capRadius, world),
      matIndex
    );
    const cylIndex = pushInstance(
      sim.cyl,
      cylinderMatrix(sim, cell, dirIdx, 0, 0.001),
      matIndex
    );
    const tipIndex = pushInstance(
      sim.disc,
      discMatrix(sim, world, dirIdx),
      matIndex
    );
    if (capIndex < 0 || cylIndex < 0 || tipIndex < 0) {
      sim.stuck = true;
      return false;
    }

    pipe.alive = true;
    pipe.matIndex = matIndex;
    pipe.weight = chooseWeight();
    pipe.head = head;
    pipe.dirIdx = dirIdx;
    pipe.runStart = cell;
    pipe.runLen = 1;
    pipe.startsAtBend = false;
    pipe.t = 0;
    pipe.speed = sim.config.speed * (0.9 + Math.random() * 0.2);
    pipe.cylIndex = cylIndex;
    pipe.tipIndex = tipIndex;
    return true;
  }
  return false;
}

// Rest the pipe's geometry exactly at the head cell center and stop growing.
// The flat tip disc is swallowed by the bulged end ball that appears here.
function die(sim: Sim, pipe: Pipe): void {
  const off = startOffset(sim, pipe);
  const end = cellToWorld(sim, pipe.head);
  updateInstance(
    sim.cyl,
    pipe.cylIndex,
    cylinderMatrix(sim, pipe.runStart, pipe.dirIdx, off, pipe.runLen - off)
  );
  updateInstance(sim.disc, pipe.tipIndex, discMatrix(sim, end, pipe.dirIdx));
  if (
    pushInstance(
      sim.sph,
      sphereMatrix(sim.config.capRadius, end),
      pipe.matIndex
    ) < 0
  )
    sim.stuck = true;
  pipe.alive = false;
  sim.pipesDrawn++;
  if (sim.chaseMode && sim.leadIndex === sim.pipes.indexOf(pipe)) {
    const next = sim.pipes.findIndex((p) => p.alive);
    if (next >= 0) sim.leadIndex = next;
  }
}

// The per-round rotation order that jointStyle: 'cycle' steps through
// (sim.cycleStyle holds the current index).
const CYCLE_ORDER: readonly Exclude<JointStyle, 'cycle'>[] = [
  'elbow',
  'ball',
  'mixed',
];

// NORMAL_STATE::ChooseJointType, with the 1-in-1000 teapot in mixed mode.
function chooseJointType(sim: Sim): 'elbow' | 'ball' | 'teapot' {
  let style = sim.config.jointStyle;
  if (style === 'cycle') style = CYCLE_ORDER[sim.cycleStyle];
  if (style === 'elbow') return 'elbow';
  if (style === 'ball') return 'ball';
  if (Math.random() < sim.config.teapotChance) return 'teapot';
  return ((Math.random() * 3) | 0) !== 0 ? 'elbow' : 'ball';
}

// The tip just reached the center of pipe.head; pick where to go next.
// Mirrors NODE_ARRAY::ChooseRandomDirection (weighted straight vs turns) and
// ChoosePreferredDirection (chase mode) from the original.
function chooseDirection(sim: Sim, pipe: Pipe): number {
  const lead = sim.chaseMode ? sim.pipes[sim.leadIndex] : undefined;
  if (lead != null && lead !== pipe && lead.alive) {
    const pref: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const delta = lead.head[axis] - pipe.head[axis];
      if (delta !== 0) pref.push(axis * 2 + (delta > 0 ? 0 : 1));
    }
    const open = pref.filter((i) => isFree(sim, v3add(pipe.head, DIRS[i])));
    if (open.length > 0) return open[(Math.random() * open.length) | 0];
    // No preferred dir open: any empty neighbor will do.
    const any: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (isFree(sim, v3add(pipe.head, DIRS[i]))) any.push(i);
    }
    return any.length > 0 ? any[(Math.random() * any.length) | 0] : -1;
  }

  const straightFree = isFree(sim, v3add(pipe.head, DIRS[pipe.dirIdx]));
  const turns: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === pipe.dirIdx || i === (pipe.dirIdx ^ 1)) continue;
    if (isFree(sim, v3add(pipe.head, DIRS[i]))) turns.push(i);
  }

  const bias = sim.config.straightBias;
  if (bias !== undefined) {
    if (straightFree && Math.random() < bias) return pipe.dirIdx;
    if (turns.length > 0) return turns[(Math.random() * turns.length) | 0];
    return straightFree ? pipe.dirIdx : -1;
  }
  const w = straightFree ? pipe.weight : 0;
  const total = w + turns.length;
  if (total === 0) return -1;
  const choice = (Math.random() * total) | 0;
  return choice < w ? pipe.dirIdx : turns[choice - w];
}

function step(sim: Sim, pipe: Pipe): void {
  const nextIdx = chooseDirection(sim, pipe);
  if (nextIdx < 0) {
    die(sim, pipe);
    return;
  }

  if (nextIdx === pipe.dirIdx) {
    pipe.head = v3add(pipe.head, DIRS[pipe.dirIdx]);
    occupy(sim, pipe.head);
    pipe.runLen++;
    return;
  }

  // Turn: freeze the current run short of the corner, place the joint,
  // and start a new run on the far side of it.
  const bend = sim.config.bendRadius;
  const off = startOffset(sim, pipe);
  updateInstance(
    sim.cyl,
    pipe.cylIndex,
    cylinderMatrix(
      sim,
      pipe.runStart,
      pipe.dirIdx,
      off,
      pipe.runLen - off - bend
    )
  );

  const joint = chooseJointType(sim);
  const corner = cellToWorld(sim, pipe.head);
  let jointIndex: number;
  if (joint === 'ball') {
    jointIndex = pushInstance(
      sim.sph,
      sphereMatrix(BALL_JOINT_FACTOR * sim.config.pipeRadius, corner),
      pipe.matIndex
    );
  } else if (joint === 'teapot') {
    // Upright in scene space, like the original's un-aligned auxSolidTeapot.
    const s = TEAPOT_FACTOR * sim.config.pipeRadius;
    jointIndex = pushInstance(
      sim.tea,
      mat4ScaleTranslate(MAT, s, s, s, corner[0], corner[1], corner[2]),
      pipe.matIndex
    );
  } else {
    jointIndex = pushInstance(
      sim.elb,
      elbowMatrix(sim, pipe.head, pipe.dirIdx, nextIdx),
      pipe.matIndex
    );
  }

  pipe.runStart = pipe.head;
  pipe.dirIdx = nextIdx;
  pipe.head = v3add(pipe.head, DIRS[nextIdx]);
  occupy(sim, pipe.head);
  pipe.runLen = 1;
  pipe.startsAtBend = true;
  const cylIndex = pushInstance(
    sim.cyl,
    cylinderMatrix(sim, pipe.runStart, nextIdx, bend, 0.001),
    pipe.matIndex
  );
  if (jointIndex < 0 || cylIndex < 0) {
    sim.stuck = true;
    die(sim, pipe);
    return;
  }
  pipe.cylIndex = cylIndex;
}

export function simUpdate(sim: Sim, dt: number): void {
  for (const pipe of sim.pipes) {
    if (!pipe.enabled || !pipe.alive) continue;
    pipe.t += pipe.speed * dt;
    while (pipe.t >= 1 && pipe.alive) {
      pipe.t -= 1;
      step(sim, pipe);
    }
    if (!pipe.alive) {
      // Original round structure: keep starting pipes in this slot until the
      // round's pipe budget is spent, then the slot winds down.
      if (!sim.stuck && sim.pipesDrawn < sim.maxPipesThisRound) {
        if (!initPipe(sim, pipe)) sim.maxPipesThisRound = sim.pipesDrawn;
      }
      continue;
    }
    // Growth: 'smooth' stretches the tube continuously; 'step' pops whole
    // cells like the original did each draw tick.
    const off = startOffset(sim, pipe);
    const extent =
      sim.config.growth === 'step' ? pipe.runLen : pipe.runLen - 1 + pipe.t;
    updateInstance(
      sim.cyl,
      pipe.cylIndex,
      cylinderMatrix(sim, pipe.runStart, pipe.dirIdx, off, extent - off)
    );
    const d = DIRS[pipe.dirIdx];
    const start = cellToWorld(sim, pipe.runStart);
    const tip: Vec3 = [
      start[0] + d[0] * extent,
      start[1] + d[1] * extent,
      start[2] + d[2] * extent,
    ];
    updateInstance(sim.disc, pipe.tipIndex, discMatrix(sim, tip, pipe.dirIdx));
  }
}

export function simShouldReset(sim: Sim): boolean {
  if (sim.stuck) return true;
  if (sim.pipes.every((p) => !p.alive)) return true;
  if (sim.occupied / sim.occ.length > sim.config.resetThreshold) return true;
  if (sim.cyl.count > sim.cyl.capacity * 0.95) return true;
  if (sim.elb.count > sim.elb.capacity * 0.95) return true;
  if (sim.sph.count > sim.sph.capacity * 0.95) return true;
  if (sim.disc.count > sim.disc.capacity * 0.95) return true;
  return false;
}

// Clear the grid and start a fresh round; pass dims to resize the grid
// (the original recalculates node dimensions from the window aspect ratio).
// Does NOT reset the GL batches — the caller owns those, since flex rounds
// share the sphere/teapot batches.
export function resetSim(sim: Sim, dims?: GridDims): void {
  if (
    dims != null &&
    (dims[0] !== sim.dims[0] ||
      dims[1] !== sim.dims[1] ||
      dims[2] !== sim.dims[2])
  ) {
    sim.dims = [...dims];
    sim.occ = new Uint8Array(dims[0] * dims[1] * dims[2]);
  } else {
    sim.occ.fill(0);
  }
  sim.occupied = 0;
  sim.stuck = false;
  sim.pipesDrawn = 0;

  const cfg = sim.config;
  // STATE::FrameReset: 2..maxDrawThreads simultaneous pipes when multi,
  // pipe budget ×1.5; chase mode every now and then (1 in 5).
  const threads =
    cfg.multiPipes && cfg.pipeCount >= 2
      ? 2 + ((Math.random() * (cfg.pipeCount - 1)) | 0)
      : 1;
  sim.maxPipesThisRound = cfg.multiPipes
    ? Math.floor(cfg.pipesPerRound * 1.5)
    : cfg.pipesPerRound;
  sim.chaseMode =
    cfg.chase &&
    cfg.multiPipes &&
    threads >= 2 &&
    ((Math.random() * 5) | 0) === 0;
  sim.leadIndex = 0;
  if (cfg.jointStyle === 'cycle') sim.cycleStyle = (sim.cycleStyle + 1) % 3;

  for (let i = 0; i < sim.pipes.length; i++) {
    const pipe = sim.pipes[i];
    pipe.enabled = i < threads;
    pipe.alive = false;
    if (pipe.enabled) initPipe(sim, pipe);
  }
}

// Park every pipe (used when a flex round takes over the scene).
export function suspendSim(sim: Sim): void {
  for (const pipe of sim.pipes) {
    pipe.enabled = false;
    pipe.alive = false;
  }
}

export function createSim(
  config: SimConfig,
  dims: GridDims,
  cyl: Batch,
  elb: Batch,
  sph: Batch,
  disc: Batch,
  tea: Batch
): Sim {
  const sim: Sim = {
    config,
    dims: [...dims],
    occ: new Uint8Array(dims[0] * dims[1] * dims[2]),
    occupied: 0,
    pipes: [],
    pipesDrawn: 0,
    maxPipesThisRound: config.pipesPerRound,
    chaseMode: false,
    leadIndex: 0,
    cycleStyle: -1,
    cyl,
    elb,
    sph,
    disc,
    tea,
    stuck: false,
  };
  for (let i = 0; i < config.pipeCount; i++) {
    sim.pipes.push({
      enabled: false,
      alive: false,
      matIndex: 0,
      weight: 1,
      head: [0, 0, 0],
      dirIdx: 0,
      runStart: [0, 0, 0],
      runLen: 1,
      startsAtBend: false,
      t: 0,
      speed: config.speed,
      cylIndex: -1,
      tipIndex: -1,
    });
  }
  return sim;
}
