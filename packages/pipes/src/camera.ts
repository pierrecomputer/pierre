import type { Mat4, Vec3 } from './math';
import {
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4RotateX,
  mat4RotateZ,
} from './math';

// The original (VIEW.CXX / STATE.CXX) never moves the camera into the pipe
// volume: the eye sits at a fixed distance where the whole node box is always
// in front of it, a wide 90-degree FOV supplies the immersive feel, and each
// new round simply rotates the scene 9.73156 degrees further around Y.
// Orbiting the eye at elevation 0 is the equivalent transform.

// STATE::IncrementSceneRotation's magic constant, in radians.
export const SCENE_ROTATION_STEP: number = (9.73156 * Math.PI) / 180;

// Original proportions: eye distance 75 against a node-corner distance of
// ~69.3 (a margin ratio of 1.082), so pipes can never reach the camera.
const DISTANCE_MARGIN = 1.082;

export interface Camera {
  azimuth: number;
  distance: number;
  far: number;
  fov: number;
  driftRate: number;
  // Small scene tilts used by flex-pipe rounds (STATE::FrameReset applies
  // random ±5° X/Z rotations for those frames).
  tiltX: number;
  tiltZ: number;
}

export function createCamera(gridSize: number): Camera {
  const cornerDistance = ((gridSize - 1) / 2) * Math.SQRT2;
  return {
    // The original always starts at yRot = 0; a random start is nicer for a
    // library since every embed would otherwise open on the identical view.
    azimuth: Math.random() * Math.PI * 2,
    distance: DISTANCE_MARGIN * cornerDistance,
    far: DISTANCE_MARGIN * cornerDistance + gridSize * 2,
    fov: (90 * Math.PI) / 180,
    driftRate: (1.5 * Math.PI) / 180,
    tiltX: 0,
    tiltZ: 0,
  };
}

// New round: rotate the scene a fixed step further, like the original.
export function advanceCamera(cam: Camera): void {
  cam.azimuth = (cam.azimuth + SCENE_ROTATION_STEP) % (Math.PI * 2);
}

export function cameraEye(cam: Camera): Vec3 {
  return [
    cam.distance * Math.cos(cam.azimuth),
    0,
    cam.distance * Math.sin(cam.azimuth),
  ];
}

const PROJ = new Float32Array(16);
const VIEW = new Float32Array(16);
const ROT = new Float32Array(16);
const TMP = new Float32Array(16);

export function cameraViewProj(
  out: Mat4,
  cam: Camera,
  aspect: number,
  eye: Vec3
): Mat4 {
  mat4Perspective(PROJ, cam.fov, aspect, 0.5, cam.far);
  mat4LookAt(VIEW, eye, [0, 0, 0], [0, 1, 0]);
  if (cam.tiltX !== 0 || cam.tiltZ !== 0) {
    mat4Multiply(TMP, VIEW, mat4RotateX(ROT, cam.tiltX));
    mat4Multiply(VIEW, TMP, mat4RotateZ(ROT, cam.tiltZ));
  }
  return mat4Multiply(out, PROJ, VIEW);
}
