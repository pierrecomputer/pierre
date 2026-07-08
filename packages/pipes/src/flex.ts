import type { Vec3 } from './math';
import {
  mat4ScaleTranslate,
  v3add,
  v3cross,
  v3dot,
  v3normalize,
  v3scale,
} from './math';
import type { GridDims } from './pipes';
import { DIRS } from './pipes';
import type { Batch, FlexBuffer } from './renderer';
import {
  flexUsage,
  pushFlexGeometry,
  pushFlexTail,
  pushInstance,
  resetFlexTail,
} from './renderer';

// Flex pipes (FPIPE.CXX): tubes with an extruded cross-section ("XC") that
// sweep through variable-radius bends. Two schemes, chosen 50/50 per round
// (FLEX_STATE::Reset): SC_EXTRUDED_XC — a weighted random walk like normal
// pipes but with sweeping bends whose radius varies with a per-pipe "turn
// factor" — and SC_TURNOMANIA — pipes that only turn, in quarter-circle arcs
// a full cell wide, 10 pipes per round.
//
// Geometry is generated on the CPU in world space (each tube is unique) and
// appended to the renderer's chunked FlexBuffer. In 'step' growth mode whole
// segments pop like the original; in 'smooth' mode the newest segment lives
// as a per-frame animated "tail" until complete, then is baked into a chunk.

const SLICES = 16;
const ARC_STEPS = 6;
const MAX_WEIGHT_STRAIGHT = 100;
const TURNOMANIA_PIPE_COUNT = 10;
const TEAPOT_FACTOR = 2.5;

export type FlexScheme = 'xc' | 'turnomania';

export interface FlexConfig {
  pipeCount: number;
  speed: number;
  straightBias?: number;
  pipeRadius: number;
  materialCount: number;
  multiPipes: boolean;
  pipesPerRound: number;
  chase: boolean;
  resetThreshold: number;
  growth: 'smooth' | 'step';
}

// Cross-section: closed 2D profile (SLICES+1 points) with outward 2D normals.
interface XC {
  points: number[];
  normals: number[];
  maxExtent: number;
}

interface Station {
  c: Vec3;
  right: Vec3;
  up: Vec3;
}

interface PendingPath {
  stations: Station[];
  cum: number[]; // cumulative path length at each station
  total: number;
}

interface FlexPipe {
  enabled: boolean;
  alive: boolean;
  matIndex: number;
  weight: number;
  turnFactorMin: number;
  turnFactorMax: number;
  xc: XC;
  cell: Vec3; // current node
  lastDir: number;
  endPos: Vec3; // world position of the tube's logical end
  right: Vec3; // transported frame, perpendicular to travel; right × up = -dir
  up: Vec3;
  zTrans: number; // end position relative to current node along lastDir
  pending?: PendingPath; // newest segment, still animating (smooth growth)
  t: number;
  speed: number;
}

export interface FlexSim {
  config: FlexConfig;
  scheme: FlexScheme;
  dims: GridDims;
  occ: Uint8Array;
  occupied: number;
  pipes: FlexPipe[];
  pipesDrawn: number;
  maxPipesThisRound: number;
  chaseMode: boolean;
  leadIndex: number;
  fb: FlexBuffer;
  sph: Batch;
  tea: Batch;
  stuck: boolean;
}

const MAT = new Float32Array(16);

function cellIndex(sim: FlexSim, c: Vec3): number {
  const [nx, ny] = sim.dims;
  return c[0] + c[1] * nx + c[2] * nx * ny;
}

function isFree(sim: FlexSim, c: Vec3): boolean {
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

function occupy(sim: FlexSim, c: Vec3): void {
  sim.occ[cellIndex(sim, c)] = 1;
  sim.occupied++;
}

function cellToWorld(sim: FlexSim, c: Vec3): Vec3 {
  return [
    c[0] - (sim.dims[0] - 1) / 2,
    c[1] - (sim.dims[1] - 1) / 2,
    c[2] - (sim.dims[2] - 1) / 2,
  ];
}

// Rodrigues rotation of v around unit axis w by angle a.
function rotate(v: Vec3, w: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cross = v3cross(w, v);
  const dot = v3dot(w, v) * (1 - c);
  return [
    v[0] * c + cross[0] * s + w[0] * dot,
    v[1] * c + cross[1] * s + w[1] * dot,
    v[2] * c + cross[2] * s + w[2] * dot,
  ];
}

// FLEX_PIPE::ChooseXCProfile: 3/4 elliptical (major 1.2–2 × r), else a
// random smooth blob (standing in for the original's 4-arc random XC).
function makeXC(r: number): XC {
  const points: number[] = [];
  const normals: number[] = [];
  let maxExtent = 0;

  if (Math.random() < 0.75) {
    const a = (1.2 + Math.random() * 0.8) * r;
    const b = r;
    for (let i = 0; i <= SLICES; i++) {
      const phi = (i / SLICES) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      points.push(a * cp, b * sp);
      const hyp = Math.hypot(b * cp, a * sp);
      const nl = hyp === 0 ? 1 : hyp;
      normals.push((b * cp) / nl, (a * sp) / nl);
    }
    maxExtent = a;
  } else {
    const base = (1.5 + Math.random() * 0.5) * r * 0.75;
    const p1 = Math.random() * Math.PI * 2;
    const p2 = Math.random() * Math.PI * 2;
    const radial = (phi: number) =>
      base *
      (1 + 0.25 * Math.sin(2 * phi + p1) + 0.15 * Math.sin(3 * phi + p2));
    for (let i = 0; i <= SLICES; i++) {
      const phi = (i / SLICES) * Math.PI * 2;
      const rr = radial(phi);
      points.push(rr * Math.cos(phi), rr * Math.sin(phi));
      if (rr > maxExtent) maxExtent = rr;
      // Outward normal from the numeric tangent.
      const e = 0.001;
      const r2 = radial(phi + e);
      const tx = r2 * Math.cos(phi + e) - rr * Math.cos(phi);
      const ty = r2 * Math.sin(phi + e) - rr * Math.sin(phi);
      const hyp = Math.hypot(ty, tx);
      const nl = hyp === 0 ? 1 : hyp;
      normals.push(ty / nl, -tx / nl);
    }
  }
  return { points, normals, maxExtent };
}

// Interleaved (pos, normal) vertex arrays for the XC swept through stations.
function tubeArrays(
  xc: XC,
  stations: Station[]
): { verts: number[]; idx: number[] } {
  const S = SLICES + 1;
  const verts: number[] = [];
  for (const st of stations) {
    for (let j = 0; j < S; j++) {
      const px = xc.points[j * 2];
      const py = xc.points[j * 2 + 1];
      const nx = xc.normals[j * 2];
      const ny = xc.normals[j * 2 + 1];
      verts.push(
        st.c[0] + px * st.right[0] + py * st.up[0],
        st.c[1] + px * st.right[1] + py * st.up[1],
        st.c[2] + px * st.right[2] + py * st.up[2],
        nx * st.right[0] + ny * st.up[0],
        nx * st.right[1] + ny * st.up[1],
        nx * st.right[2] + ny * st.up[2]
      );
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < stations.length - 1; k++) {
    for (let j = 0; j < SLICES; j++) {
      const a = k * S + j;
      const b = a + 1;
      const c = a + S;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { verts, idx };
}

// Flat plug over the tube's open end (facing the travel direction, which is
// cross(up, right) under our right × up = -dir frame convention).
function plugArrays(xc: XC, st: Station): { verts: number[]; idx: number[] } {
  const d = v3cross(st.up, st.right);
  const verts: number[] = [st.c[0], st.c[1], st.c[2], d[0], d[1], d[2]];
  const S = SLICES + 1;
  for (let j = 0; j < S; j++) {
    const px = xc.points[j * 2];
    const py = xc.points[j * 2 + 1];
    verts.push(
      st.c[0] + px * st.right[0] + py * st.up[0],
      st.c[1] + px * st.right[1] + py * st.up[1],
      st.c[2] + px * st.right[2] + py * st.up[2],
      d[0],
      d[1],
      d[2]
    );
  }
  const idx: number[] = [];
  for (let j = 0; j < SLICES; j++) idx.push(0, 2 + j, 1 + j);
  return { verts, idx };
}

function station(pipe: FlexPipe, c: Vec3): Station {
  return { c, right: pipe.right, up: pipe.up };
}

// Advance the pipe's end straight ahead, returning the swept stations.
function advanceStraight(pipe: FlexPipe, len: number): Station[] {
  if (len < 0.001) return [];
  const d = DIRS[pipe.lastDir];
  const start = station(pipe, pipe.endPos);
  const end = v3add(pipe.endPos, v3scale(d, len));
  pipe.endPos = end;
  return [start, station(pipe, end)];
}

// Advance around a quarter-circle bend, transporting the frame; returns stations.
function advanceArc(pipe: FlexPipe, newDir: number, radius: number): Station[] {
  const dOld = DIRS[pipe.lastDir];
  const dNew = DIRS[newDir];
  const w = v3normalize(v3cross(dOld, dNew));
  const center = v3add(pipe.endPos, v3scale(dNew, radius));
  const stations: Station[] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const theta = ((Math.PI / 2) * i) / ARC_STEPS;
    const c: Vec3 = [
      center[0] +
        radius * (Math.sin(theta) * dOld[0] - Math.cos(theta) * dNew[0]),
      center[1] +
        radius * (Math.sin(theta) * dOld[1] - Math.cos(theta) * dNew[1]),
      center[2] +
        radius * (Math.sin(theta) * dOld[2] - Math.cos(theta) * dNew[2]),
    ];
    stations.push({
      c,
      right: rotate(pipe.right, w, theta),
      up: rotate(pipe.up, w, theta),
    });
  }
  const last = stations[stations.length - 1];
  pipe.endPos = last.c;
  pipe.right = last.right;
  pipe.up = last.up;
  return stations;
}

function bakeStations(sim: FlexSim, pipe: FlexPipe, stations: Station[]): void {
  if (stations.length < 2) return;
  const tube = tubeArrays(pipe.xc, stations);
  if (!pushFlexGeometry(sim.fb, tube.verts, tube.idx, pipe.matIndex))
    sim.stuck = true;
}

function bakePending(sim: FlexSim, pipe: FlexPipe): void {
  if (pipe.pending == null) return;
  bakeStations(sim, pipe, pipe.pending.stations);
  pipe.pending = undefined;
}

// Hand a freshly computed segment either straight to the static chunks (step
// growth, with a plug over the mouth) or to the animated pending tail.
function deliver(sim: FlexSim, pipe: FlexPipe, stations: Station[]): void {
  if (stations.length < 2) return;
  if (sim.config.growth === 'step') {
    bakeStations(sim, pipe, stations);
    const plug = plugArrays(pipe.xc, stations[stations.length - 1]);
    if (!pushFlexGeometry(sim.fb, plug.verts, plug.idx, pipe.matIndex))
      sim.stuck = true;
    return;
  }
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1].c;
    const b = stations[i].c;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    cum.push(total);
  }
  pipe.pending = { stations, cum, total: Math.max(total, 0.001) };
}

// Build this frame's partial tail for a growing pipe: the pending path up to
// fraction f, cut with an interpolated station and sealed with a plug.
function appendTail(sim: FlexSim, pipe: FlexPipe, f: number): void {
  const pending = pipe.pending;
  if (pending == null) return;
  const target = Math.max(f * pending.total, 0.002);
  const stations = pending.stations;
  let k = 0;
  while (k + 1 < stations.length && pending.cum[k + 1] <= target) k++;

  let cut: Station;
  if (k + 1 >= stations.length) {
    cut = stations[stations.length - 1];
  } else {
    const segLen = pending.cum[k + 1] - pending.cum[k];
    const u = segLen > 0 ? (target - pending.cum[k]) / segLen : 0;
    const a = stations[k];
    const b = stations[k + 1];
    const lerp = (p: Vec3, q: Vec3): Vec3 => [
      p[0] + (q[0] - p[0]) * u,
      p[1] + (q[1] - p[1]) * u,
      p[2] + (q[2] - p[2]) * u,
    ];
    cut = {
      c: lerp(a.c, b.c),
      right: v3normalize(lerp(a.right, b.right)),
      up: v3normalize(lerp(a.up, b.up)),
    };
  }

  const list = [...stations.slice(0, k + 1), cut];
  const tube = tubeArrays(pipe.xc, list);
  pushFlexTail(sim.fb, tube.verts, tube.idx, pipe.matIndex);
  const plug = plugArrays(pipe.xc, cut);
  pushFlexTail(sim.fb, plug.verts, plug.idx, pipe.matIndex);
}

function emitCap(sim: FlexSim, pipe: FlexPipe, at: Vec3): void {
  const r = 1.15 * pipe.xc.maxExtent;
  if (
    pushInstance(
      sim.sph,
      mat4ScaleTranslate(MAT, r, r, r, at[0], at[1], at[2]),
      pipe.matIndex
    ) < 0
  ) {
    sim.stuck = true;
  }
}

function emitTeapot(sim: FlexSim, pipe: FlexPipe, at: Vec3): void {
  const s = TEAPOT_FACTOR * sim.config.pipeRadius;
  if (
    pushInstance(
      sim.tea,
      mat4ScaleTranslate(MAT, s, s, s, at[0], at[1], at[2]),
      pipe.matIndex
    ) < 0
  ) {
    sim.stuck = true;
  }
}

function setFrame(pipe: FlexPipe, dirIdx: number): void {
  const d = DIRS[dirIdx];
  const helper: Vec3 = Math.abs(d[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
  let right = v3normalize(v3cross(helper, d));
  // Random roll so elliptical cross-sections vary in orientation.
  right = rotate(right, d, Math.random() * Math.PI * 2);
  pipe.right = right;
  pipe.up = v3cross(right, d);
}

function dieWithCap(sim: FlexSim, pipe: FlexPipe): void {
  bakePending(sim, pipe);
  emitCap(sim, pipe, pipe.endPos);
  pipe.alive = false;
  sim.pipesDrawn++;
  if (sim.chaseMode && sim.leadIndex === sim.pipes.indexOf(pipe)) {
    const next = sim.pipes.findIndex((p) => p.alive);
    if (next >= 0) sim.leadIndex = next;
  }
}

// Weighted direction choice (same scheme as normal pipes).
// REGULAR_FLEX uses weight 0–3 (can be turn-crazy).
function chooseDirection(sim: FlexSim, pipe: FlexPipe): number {
  const lead = sim.chaseMode ? sim.pipes[sim.leadIndex] : undefined;
  if (lead != null && lead !== pipe && lead.alive) {
    const pref: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const delta = lead.cell[axis] - pipe.cell[axis];
      if (delta !== 0) pref.push(axis * 2 + (delta > 0 ? 0 : 1));
    }
    const open = pref.filter((i) => isFree(sim, v3add(pipe.cell, DIRS[i])));
    if (open.length > 0) return open[(Math.random() * open.length) | 0];
    const any: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (isFree(sim, v3add(pipe.cell, DIRS[i]))) any.push(i);
    }
    return any.length > 0 ? any[(Math.random() * any.length) | 0] : -1;
  }

  const straightFree = isFree(sim, v3add(pipe.cell, DIRS[pipe.lastDir]));
  const turns: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === pipe.lastDir || i === (pipe.lastDir ^ 1)) continue;
    if (isFree(sim, v3add(pipe.cell, DIRS[i]))) turns.push(i);
  }
  const bias = sim.config.straightBias;
  if (bias !== undefined) {
    if (straightFree && Math.random() < bias) return pipe.lastDir;
    if (turns.length > 0) return turns[(Math.random() * turns.length) | 0];
    return straightFree ? pipe.lastDir : -1;
  }
  const w = straightFree ? pipe.weight : 0;
  const total = w + turns.length;
  if (total === 0) return -1;
  const choice = (Math.random() * total) | 0;
  return choice < w ? pipe.lastDir : turns[choice - w];
}

function initFlexPipe(sim: FlexSim, pipe: FlexPipe): boolean {
  const [nx, ny, nz] = sim.dims;
  pipe.alive = false;
  pipe.pending = undefined;
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

    pipe.matIndex = (Math.random() * sim.config.materialCount) | 0;
    // REGULAR_FLEX_PIPE constructor: weight 0–3, with the 1-in-20 runner.
    pipe.weight =
      Math.random() < 0.05
        ? 25 + ((Math.random() * (MAX_WEIGHT_STRAIGHT - 25 + 1)) | 0)
        : (Math.random() * 4) | 0;
    const avgTurn = 0.11 + Math.random() * 0.7;
    pipe.turnFactorMin = Math.max(avgTurn - 0.1, 0);
    pipe.turnFactorMax = Math.min(avgTurn + 0.1, 1);
    pipe.xc = makeXC(sim.config.pipeRadius);
    pipe.t = 0;
    pipe.speed = sim.config.speed * (0.9 + Math.random() * 0.2);
    pipe.cell = cell;
    occupy(sim, cell);
    pipe.endPos = cellToWorld(sim, cell);
    emitCap(sim, pipe, pipe.endPos);

    const dirIdx = freeDirs[(Math.random() * freeDirs.length) | 0];
    pipe.lastDir = dirIdx;
    setFrame(pipe, dirIdx);

    if (sim.scheme === 'xc') {
      // Advance into the first cell; the tube end stays a full cell behind.
      occupy(sim, v3add(cell, DIRS[dirIdx]));
      pipe.cell = v3add(cell, DIRS[dirIdx]);
      pipe.zTrans = -1;
    } else {
      // Turnomania starts right at the node.
      pipe.zTrans = 0;
    }
    pipe.alive = true;
    return true;
  }
  return false;
}

// REGULAR_FLEX_PIPE::Draw — one node advance per call, with turn-factor
// driven splits between straight length and bend radius.
function stepXC(sim: FlexSim, pipe: FlexPipe): void {
  bakePending(sim, pipe);
  const newDir = chooseDirection(sim, pipe);
  if (newDir < 0) {
    dieWithCap(sim, pipe);
    return;
  }
  occupy(sim, v3add(pipe.cell, DIRS[newDir]));

  const ext = pipe.xc.maxExtent;
  const mix =
    1 -
    (pipe.turnFactorMin +
      Math.random() * (pipe.turnFactorMax - pipe.turnFactorMin));

  if (newDir !== pipe.lastDir) {
    const minTurnRadius = ext;
    const maxPipeLen = -pipe.zTrans - minTurnRadius;
    let minPipeLen = ext - (1 + pipe.zTrans);
    if (minPipeLen < 0) minPipeLen = 0;
    const span = Math.max(maxPipeLen - minPipeLen, 0);
    const pipeLen = minPipeLen + mix * span;
    const turnRadius = Math.max(maxPipeLen - pipeLen + minTurnRadius, 0.05);

    const straight = advanceStraight(pipe, pipeLen);
    const arc = advanceArc(pipe, newDir, turnRadius);
    deliver(
      sim,
      pipe,
      straight.length > 0 ? [...straight, ...arc.slice(1)] : arc
    );
    pipe.zTrans = -(1 - turnRadius);
  } else {
    const minPipeLen = -pipe.zTrans;
    const maxPipeLen = minPipeLen + 1 - ext;
    const span = Math.max(maxPipeLen - minPipeLen, 0);
    const pipeLen = minPipeLen + mix * span;
    deliver(sim, pipe, advanceStraight(pipe, pipeLen));
    pipe.zTrans += -1 + pipeLen;
  }

  pipe.cell = v3add(pipe.cell, DIRS[newDir]);
  pipe.lastDir = newDir;
}

// TURNING_FLEX_PIPE::Draw — nothing but full-cell quarter turns, going
// straight only when no turn is open.
function stepTurnomania(sim: FlexSim, pipe: FlexPipe): void {
  bakePending(sim, pipe);
  const ahead = v3add(pipe.cell, DIRS[pipe.lastDir]);
  const turns: number[] = [];
  if (isFree(sim, ahead)) {
    for (let i = 0; i < 6; i++) {
      if (i === pipe.lastDir || i === (pipe.lastDir ^ 1)) continue;
      if (isFree(sim, v3add(ahead, DIRS[i]))) turns.push(i);
    }
  }

  if (turns.length > 0) {
    const newDir = turns[(Math.random() * turns.length) | 0];
    const arc = advanceArc(pipe, newDir, 1);
    occupy(sim, ahead);
    const dest = v3add(ahead, DIRS[newDir]);
    occupy(sim, dest);
    pipe.cell = dest;
    pipe.lastDir = newDir;
    deliver(sim, pipe, arc);
  } else if (isFree(sim, ahead)) {
    const straight = advanceStraight(pipe, 1);
    occupy(sim, ahead);
    pipe.cell = ahead;
    deliver(sim, pipe, straight);
  } else {
    dieWithCap(sim, pipe);
  }
}

export function flexUpdate(sim: FlexSim, dt: number): void {
  for (const pipe of sim.pipes) {
    if (!pipe.enabled || !pipe.alive) continue;
    pipe.t += pipe.speed * dt;
    while (pipe.t >= 1 && pipe.alive && !sim.stuck) {
      pipe.t -= 1;
      if (sim.scheme === 'xc') stepXC(sim, pipe);
      else stepTurnomania(sim, pipe);
    }
    if (!pipe.alive && !sim.stuck && sim.pipesDrawn < sim.maxPipesThisRound) {
      if (!initFlexPipe(sim, pipe)) sim.maxPipesThisRound = sim.pipesDrawn;
    }
  }

  // Smooth growth: rebuild the animated tails from scratch each frame.
  resetFlexTail(sim.fb);
  if (sim.config.growth === 'smooth') {
    for (const pipe of sim.pipes) {
      if (pipe.enabled && pipe.alive)
        appendTail(sim, pipe, Math.min(Math.max(pipe.t, 0), 1));
    }
  }
}

export function flexShouldReset(sim: FlexSim): boolean {
  if (sim.stuck) return true;
  if (sim.pipes.every((p) => !p.alive)) return true;
  if (sim.occupied / sim.occ.length > sim.config.resetThreshold) return true;
  if (flexUsage(sim.fb) > 0.9) return true;
  return false;
}

// Start a flex round. The caller has already cleared the GL batches.
export function resetFlexSim(sim: FlexSim, dims?: GridDims): void {
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
  // FLEX_STATE::Reset: 50/50 between the two schemes each round.
  sim.scheme = Math.random() < 0.5 ? 'xc' : 'turnomania';

  const cfg = sim.config;
  const perRound =
    sim.scheme === 'turnomania' ? TURNOMANIA_PIPE_COUNT : cfg.pipesPerRound;
  const threads =
    cfg.multiPipes && cfg.pipeCount >= 2
      ? 2 + ((Math.random() * (cfg.pipeCount - 1)) | 0)
      : 1;
  sim.maxPipesThisRound = cfg.multiPipes
    ? Math.floor(perRound * 1.5)
    : perRound;
  // FLEX_STATE::OKToUseChase: no chase during turnomania.
  sim.chaseMode =
    cfg.chase &&
    cfg.multiPipes &&
    threads >= 2 &&
    sim.scheme === 'xc' &&
    ((Math.random() * 5) | 0) === 0;
  sim.leadIndex = 0;

  for (let i = 0; i < sim.pipes.length; i++) {
    const pipe = sim.pipes[i];
    pipe.enabled = i < threads;
    pipe.alive = false;
    pipe.pending = undefined;
    if (pipe.enabled) {
      if (!initFlexPipe(sim, pipe)) {
        // A start with nowhere to go pours tea instead (FPIPE Start()).
        emitTeapot(sim, pipe, cellToWorld(sim, pipe.cell));
      }
    }
  }
}

export function suspendFlexSim(sim: FlexSim): void {
  for (const pipe of sim.pipes) {
    pipe.enabled = false;
    pipe.alive = false;
    pipe.pending = undefined;
  }
  resetFlexTail(sim.fb);
}

export function createFlexSim(
  config: FlexConfig,
  dims: GridDims,
  fb: FlexBuffer,
  sph: Batch,
  tea: Batch
): FlexSim {
  const sim: FlexSim = {
    config,
    scheme: 'xc',
    dims: [...dims],
    occ: new Uint8Array(dims[0] * dims[1] * dims[2]),
    occupied: 0,
    pipes: [],
    pipesDrawn: 0,
    maxPipesThisRound: config.pipesPerRound,
    chaseMode: false,
    leadIndex: 0,
    fb,
    sph,
    tea,
    stuck: false,
  };
  for (let i = 0; i < config.pipeCount; i++) {
    sim.pipes.push({
      enabled: false,
      alive: false,
      matIndex: 0,
      weight: 1,
      turnFactorMin: 0.3,
      turnFactorMax: 0.5,
      xc: makeXC(config.pipeRadius),
      cell: [0, 0, 0],
      lastDir: 0,
      endPos: [0, 0, 0],
      right: [1, 0, 0],
      up: [0, 1, 0],
      zTrans: 0,
      t: 0,
      speed: config.speed,
    });
  }
  return sim;
}
