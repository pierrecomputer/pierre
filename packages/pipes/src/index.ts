import {
  advanceCamera,
  cameraEye,
  cameraViewProj,
  createCamera,
} from './camera';
import {
  createFlexSim,
  flexShouldReset,
  flexUpdate,
  resetFlexSim,
  suspendFlexSim,
} from './flex';
import type { Vec3 } from './math';
import { v3cross, v3normalize, v3scale } from './math';
import type { GridDims, JointStyle, PipeMaterial } from './pipes';
import {
  CLASSIC_MATERIALS,
  createSim,
  resetSim,
  simShouldReset,
  simUpdate,
  suspendSim,
} from './pipes';
import { createRenderer, resetBatch, resetFlexBuffer } from './renderer';

export { CLASSIC_MATERIALS } from './pipes';
export type { PipeMaterial, JointStyle } from './pipes';

export interface PipesOptions {
  /** Maximum simultaneous pipes; multi-pipe rounds use 2..pipeCount. Default 4. */
  pipeCount?: number;
  /**
   * Cells along the longest grid dimension. Like the original, the vertical
   * cell count is scaled by the window aspect ratio so the volume fills the
   * view. Default 20.
   */
  gridSize?: number;
  /** Growth speed in cells per second. Default 11. */
  speed?: number;
  /**
   * Probability of continuing straight at each cell. If omitted, uses the
   * original's per-pipe weighting: most pipes turn often, but 1 in 20 becomes
   * a long straight runner.
   */
  straightBias?: number;
  /** Pipe radius in cell units. Default 1/7, the original's proportion. */
  pipeRadius?: number;
  /** Elbow bend radius at turns. Default: equal to pipeRadius, like the original. */
  bendRadius?: number;
  /** Radius of the ball capping pipe starts and ends. Default √2 × pipeRadius, like the original. */
  capRadius?: number;
  /**
   * Joint style at turns: 'elbow' (default, the original's default setting),
   * 'ball', 'mixed' (1/3 balls — and very rarely a teapot), or 'cycle' to
   * rotate styles each round.
   */
  jointStyle?: JointStyle;
  /** Chance that a 'mixed' joint is the teapot. Original: 1/1000. */
  teapotChance?: number;
  /** Pipe style per round: 'normal', 'flex' (curvy extruded pipes), or 'mixed' (50/50). Default 'normal'. */
  pipeStyle?: 'normal' | 'flex' | 'mixed';
  /** 'smooth' animates the growing tip; 'step' pops whole segments like the original. Default 'smooth'. */
  growth?: 'smooth' | 'step';
  /** Several pipes at once — the original's "multiple pipes" setting. Default true. */
  multiPipes?: boolean;
  /** Pipes drawn before a round ends (original NORMAL_PIPE_COUNT = 5; ×1.5 when multi). Default 5. */
  pipesPerRound?: number;
  /** Allow chase rounds: 1 in 5 multi-pipe rounds follow a lead pipe. Default true. */
  chase?: boolean;
  /** Occupancy backstop that forces a reset. Default 0.6. */
  resetThreshold?: number;
  /** Maximum seconds per round before a reset. Default 45. */
  roundDuration?: number;
  /** Seconds for the fade-out between rounds (fade-in is ~80%). 0 = instant cut, like the original. Default 1.2. */
  fadeSeconds?: number;
  /** Slowly orbit the camera during a round. The original is static; default false. */
  cameraDrift?: boolean;
  /**
   * Retro mode: render at 1/pixelSize of the canvas's CSS size and stretch the
   * result with nearest-neighbor scaling, giving big hard aliased pixels.
   * 1 renders at full resolution with antialiasing. Default 2.
   */
  pixelSize?: number;
  /**
   * Background color as RGB in [0,1], or 'transparent' to composite the pipes
   * over whatever is behind the canvas. Default pure black.
   */
  backgroundColor?: [number, number, number] | 'transparent';
  /**
   * Simple palette: each entry becomes a plastic-like material. Picked at
   * random per pipe. For full control use `materials` instead.
   */
  colors?: [number, number, number][];
  /**
   * Full material palette (ambient/diffuse/specular/shininess per entry, max
   * 24). Default: the original's 16 "teapot" materials (CLASSIC_MATERIALS).
   */
  materials?: PipeMaterial[];
}

export interface PipesInstance {
  /** Resume the animation loop (createPipes auto-starts). */
  start(): void;
  /** Pause the animation loop, keeping the scene intact. */
  stop(): void;
  /** End the round and start a fresh one with the next camera rotation. */
  reset(): void;
  /**
   * Change options on the fly, without restarting the round where possible.
   * Live keys: pipeStyle, jointStyle, teapotChance, growth, speed,
   * straightBias, multiPipes, pipesPerRound, chase, resetThreshold,
   * roundDuration, fadeSeconds, cameraDrift, pixelSize, backgroundColor
   * (including 'transparent'), and gridSize (triggers a reset). Only
   * pipeCount, the radii, and the material palette are baked into the
   * instance and need a fresh createPipes.
   */
  setOptions(options: PipesOptions): void;
  /** Stop and release all GL resources and observers. */
  destroy(): void;
}

// The original's light, defined in eye space: direction (90, 90, 150) — from
// the upper right, behind the viewer — with an infinite viewer, making the
// Blinn half-vector a constant as well.
const LIGHT_EYE: Vec3 = [0.4575, 0.4575, 0.7625];
const HALF_EYE: Vec3 = [0.24367, 0.24367, 0.93875];

const TILT_RANGE = (5 * Math.PI) / 180;

// Options whose absence is meaningful stay optional (straightBias switches
// to the original's weighted algorithm; the radii and palettes derive their
// defaults from other options); everything else gets a concrete default.
type OptionDefaults = Required<
  Omit<
    PipesOptions,
    'straightBias' | 'bendRadius' | 'capRadius' | 'colors' | 'materials'
  >
> &
  Pick<
    PipesOptions,
    'straightBias' | 'bendRadius' | 'capRadius' | 'colors' | 'materials'
  >;

const DEFAULTS: OptionDefaults = {
  pipeCount: 4,
  gridSize: 20,
  speed: 11,
  straightBias: undefined,
  pipeRadius: 1 / 7,
  bendRadius: undefined,
  capRadius: undefined,
  jointStyle: 'elbow',
  teapotChance: 1 / 1000,
  pipeStyle: 'normal',
  growth: 'smooth',
  multiPipes: true,
  pipesPerRound: 5,
  chase: true,
  resetThreshold: 0.6,
  roundDuration: 45,
  fadeSeconds: 1.2,
  cameraDrift: false,
  pixelSize: 2,
  backgroundColor: [0, 0, 0],
  colors: undefined,
  materials: undefined,
};

type Phase = 'running' | 'fadeOut' | 'fadeIn';

// Port of VIEW::CalcNodeArraySize: the longest on-screen dimension gets the
// full grid size, the other is scaled by the aspect ratio, and depth matches
// the longest — so the volume always fills the window.
function calcGridDims(gridSize: number, aspect: number): GridDims {
  if (aspect >= 1) {
    return [gridSize, Math.max(2, Math.round(gridSize / aspect)), gridSize];
  }
  return [Math.max(2, Math.round(gridSize * aspect)), gridSize, gridSize];
}

export function createPipes(
  canvas: HTMLCanvasElement,
  options: PipesOptions = {}
): PipesInstance {
  const opts = { ...DEFAULTS, ...options };
  const pipeRadius = opts.pipeRadius;
  const bendRadius = opts.bendRadius ?? pipeRadius;
  const capRadius = opts.capRadius ?? Math.SQRT2 * pipeRadius;

  const materials: PipeMaterial[] =
    opts.materials ??
    (opts.colors != null && opts.colors.length > 0
      ? opts.colors.map(
          (c): PipeMaterial => ({
            ambient: [0, 0, 0],
            diffuse: c,
            specular: [0.5, 0.5, 0.5],
            shininess: 32,
          })
        )
      : CLASSIC_MATERIALS);
  const materialCount = Math.min(materials.length, 24);

  function applySize(): boolean {
    // The backing store is always full resolution; the renderer's offscreen
    // target handles retro downscaling, so pixelSize can change live.
    const dpr = window.devicePixelRatio;
    const scale = Math.min(dpr > 0 ? dpr : 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  applySize();

  const aspect = () => canvas.width / Math.max(canvas.height, 1);

  const renderer = createRenderer(
    canvas,
    opts.backgroundColor,
    pipeRadius,
    bendRadius,
    opts.pixelSize,
    materials
  );
  let pendingDims = calcGridDims(opts.gridSize, aspect());

  const sim = createSim(
    {
      pipeCount: opts.pipeCount,
      speed: opts.speed,
      straightBias: opts.straightBias,
      pipeRadius,
      bendRadius,
      capRadius,
      resetThreshold: opts.resetThreshold,
      materialCount,
      jointStyle: opts.jointStyle,
      teapotChance: opts.teapotChance,
      growth: opts.growth,
      multiPipes: opts.multiPipes,
      pipesPerRound: opts.pipesPerRound,
      chase: opts.chase,
    },
    pendingDims,
    renderer.cylinders,
    renderer.elbows,
    renderer.spheres,
    renderer.discs,
    renderer.teapots
  );
  const flexSim = createFlexSim(
    {
      pipeCount: opts.pipeCount,
      speed: opts.speed,
      straightBias: opts.straightBias,
      pipeRadius,
      materialCount,
      multiPipes: opts.multiPipes,
      pipesPerRound: opts.pipesPerRound,
      chase: opts.chase,
      resetThreshold: opts.resetThreshold,
      growth: opts.growth,
    },
    pendingDims,
    renderer.flex,
    renderer.spheres,
    renderer.teapots
  );
  const cam = createCamera(opts.gridSize);

  let mode: 'normal' | 'flex' = 'normal';
  let dimsResetRequested = false;
  let phase: Phase = 'running';
  let fade = 1;
  let fadeT = 0;
  let roundAge = 0;
  let raf = 0;
  let last = 0;
  let running = false;
  let destroyed = false;
  const viewProj = new Float32Array(16);

  const fadeOutSeconds = () => Math.max(opts.fadeSeconds, 0);
  const fadeInSeconds = () => fadeOutSeconds() * 0.83;

  function hardReset(): void {
    for (const batch of [
      renderer.cylinders,
      renderer.elbows,
      renderer.spheres,
      renderer.discs,
      renderer.teapots,
    ]) {
      resetBatch(batch);
    }
    resetFlexBuffer(renderer.flex);

    const flexRound =
      opts.pipeStyle === 'flex' ||
      (opts.pipeStyle === 'mixed' && Math.random() < 0.5);
    if (flexRound) {
      suspendSim(sim);
      resetFlexSim(flexSim, pendingDims);
      mode = 'flex';
      // Flex frames get a small random scene tilt (STATE::FrameReset).
      cam.tiltX = (Math.random() * 2 - 1) * TILT_RANGE;
      cam.tiltZ = (Math.random() * 2 - 1) * TILT_RANGE;
    } else {
      suspendFlexSim(flexSim);
      resetSim(sim, pendingDims);
      mode = 'normal';
      cam.tiltX = 0;
      cam.tiltZ = 0;
    }
    advanceCamera(cam);
    roundAge = 0;
    dimsResetRequested = false;
  }

  function update(dt: number): void {
    if (mode === 'flex') flexUpdate(flexSim, dt);
    else simUpdate(sim, dt);
  }

  function roundOver(): boolean {
    return mode === 'flex' ? flexShouldReset(flexSim) : simShouldReset(sim);
  }

  function render(): void {
    const eye = cameraEye(cam);
    cameraViewProj(viewProj, cam, aspect(), eye);
    // Rotate the original's constant eye-space light and half-vector into
    // world space so they follow the camera exactly like fixed-function GL.
    const forward = v3scale(v3normalize(eye), -1);
    const right = v3normalize(v3cross(forward, [0, 1, 0]));
    const up = v3cross(right, forward);
    const toWorld = (v: Vec3): Vec3 => [
      v[0] * right[0] + v[1] * up[0] - v[2] * forward[0],
      v[0] * right[1] + v[1] * up[1] - v[2] * forward[1],
      v[0] * right[2] + v[1] * up[2] - v[2] * forward[2],
    ];
    renderer.draw(viewProj, toWorld(LIGHT_EYE), toWorld(HALF_EYE), fade);
  }

  function resize(): void {
    if (applySize()) {
      // New aspect-fitted grid dimensions apply at the NEXT round change —
      // a resize (or fullscreen toggle) never interrupts the current round.
      // The immediate repaint matters though: ResizeObserver runs before
      // paint, so no blank frame is ever shown.
      pendingDims = calcGridDims(opts.gridSize, aspect());
      render();
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function beginReset(): void {
    if (fadeOutSeconds() === 0) {
      // Authentic: clear and start the next round on the very next frame.
      hardReset();
      phase = 'running';
      fade = 1;
    } else {
      phase = 'fadeOut';
      fadeT = 0;
    }
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    roundAge += dt;

    if (phase === 'running') {
      fade = 1;
      update(dt);
      if (roundOver() || roundAge > opts.roundDuration || dimsResetRequested)
        beginReset();
    } else if (phase === 'fadeOut') {
      update(dt);
      fadeT += dt / Math.max(fadeOutSeconds(), 0.001);
      fade = Math.max(1 - fadeT, 0);
      if (fadeT >= 1) {
        hardReset();
        phase = 'fadeIn';
        fadeT = 0;
        fade = 0;
      }
    } else {
      update(dt);
      fadeT += dt / Math.max(fadeInSeconds(), 0.001);
      fade = Math.min(fadeT, 1);
      if (fadeT >= 1) {
        phase = 'running';
        fade = 1;
      }
    }

    if (opts.cameraDrift) cam.azimuth += cam.driftRate * dt;
    render();
  }

  function start(): void {
    if (running || destroyed) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
  }

  function reset(): void {
    if (destroyed) return;
    if (phase === 'running') beginReset();
  }

  function setOptions(partial: PipesOptions): void {
    if (destroyed) return;
    if (partial.speed !== undefined) {
      opts.speed = sim.config.speed = flexSim.config.speed = partial.speed;
      for (const p of sim.pipes)
        if (p.alive) p.speed = partial.speed * (0.9 + Math.random() * 0.2);
      for (const p of flexSim.pipes)
        if (p.alive) p.speed = partial.speed * (0.9 + Math.random() * 0.2);
    }
    if ('straightBias' in partial) {
      opts.straightBias =
        sim.config.straightBias =
        flexSim.config.straightBias =
          partial.straightBias;
    }
    if (partial.pipeStyle !== undefined) opts.pipeStyle = partial.pipeStyle;
    if (partial.jointStyle !== undefined)
      opts.jointStyle = sim.config.jointStyle = partial.jointStyle;
    if (partial.teapotChance !== undefined)
      opts.teapotChance = sim.config.teapotChance = partial.teapotChance;
    if (partial.growth !== undefined)
      opts.growth = sim.config.growth = flexSim.config.growth = partial.growth;
    if (partial.multiPipes !== undefined)
      opts.multiPipes =
        sim.config.multiPipes =
        flexSim.config.multiPipes =
          partial.multiPipes;
    if (partial.pipesPerRound !== undefined)
      opts.pipesPerRound =
        sim.config.pipesPerRound =
        flexSim.config.pipesPerRound =
          partial.pipesPerRound;
    if (partial.chase !== undefined)
      opts.chase = sim.config.chase = flexSim.config.chase = partial.chase;
    if (partial.resetThreshold !== undefined) {
      opts.resetThreshold =
        sim.config.resetThreshold =
        flexSim.config.resetThreshold =
          partial.resetThreshold;
    }
    if (partial.roundDuration !== undefined)
      opts.roundDuration = partial.roundDuration;
    if (partial.fadeSeconds !== undefined)
      opts.fadeSeconds = partial.fadeSeconds;
    if (partial.cameraDrift !== undefined)
      opts.cameraDrift = partial.cameraDrift;
    if (partial.backgroundColor !== undefined) {
      opts.backgroundColor = partial.backgroundColor;
      renderer.setBackground(partial.backgroundColor);
    }
    if (partial.pixelSize !== undefined) {
      opts.pixelSize = partial.pixelSize;
      renderer.setPixelSize(partial.pixelSize);
    }
    if (partial.gridSize !== undefined && partial.gridSize !== opts.gridSize) {
      opts.gridSize = partial.gridSize;
      pendingDims = calcGridDims(opts.gridSize, aspect());
      const fresh = createCamera(opts.gridSize);
      cam.distance = fresh.distance;
      cam.far = fresh.far;
      // Unlike window resizes, an explicit grid-size change should be seen
      // right away: fade into a fresh round.
      dimsResetRequested = true;
    }
  }

  function destroy(): void {
    if (destroyed) return;
    stop();
    observer.disconnect();
    renderer.destroy();
    destroyed = true;
  }

  // First round.
  hardReset();
  if (fadeOutSeconds() > 0) {
    phase = 'fadeIn';
    fade = 0;
    fadeT = 0;
  }

  start();
  return { start, stop, reset, setOptions, destroy };
}
