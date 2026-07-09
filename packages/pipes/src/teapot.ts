import type { Mesh } from './geometry';
import { TEAPOT_PATCHES, TEAPOT_VERTICES } from './teapot-data';

// Evaluate the Newell teapot's bicubic Bezier patches into a small mesh.
// The original drew it with auxSolidTeapot(2.5 * radius) as a rare joint;
// ours is normalized to height 2, Y-up, centered at the origin, so instances
// scale it by (2.5 * pipeRadius) like the original call.

function bernstein(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t];
}

function bernsteinDeriv(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [-3 * s * s, 3 * s * s - 6 * t * s, 6 * t * s - 3 * t * t, 3 * t * t];
}

export function createTeapotMesh(segments = 6): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const rows = segments + 1;

  const patchCount = TEAPOT_PATCHES.length / 16;
  for (let patch = 0; patch < patchCount; patch++) {
    const base = positions.length / 3;
    // 4x4 control grid for this patch (data is Z-up).
    const cp: number[][] = [];
    for (let i = 0; i < 16; i++) {
      const vi = TEAPOT_PATCHES[patch * 16 + i] * 3;
      cp.push([
        TEAPOT_VERTICES[vi],
        TEAPOT_VERTICES[vi + 1],
        TEAPOT_VERTICES[vi + 2],
      ]);
    }

    const evalPoint = (
      bu: number[],
      bv: number[]
    ): [number, number, number] => {
      let x = 0,
        y = 0,
        z = 0;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const w = bu[r] * bv[c];
          const p = cp[r * 4 + c];
          x += w * p[0];
          y += w * p[1];
          z += w * p[2];
        }
      }
      return [x, y, z];
    };

    for (let iu = 0; iu <= segments; iu++) {
      const u = iu / segments;
      for (let iv = 0; iv <= segments; iv++) {
        const v = iv / segments;
        const p = evalPoint(bernstein(u), bernstein(v));
        // Derivatives at slightly inset params so collapsed patch edges
        // (lid tip, handle seams) still yield a usable normal.
        const ud = Math.min(Math.max(u, 0.01), 0.99);
        const vd = Math.min(Math.max(v, 0.01), 0.99);
        const du = evalPoint(bernsteinDeriv(ud), bernstein(vd));
        const dv = evalPoint(bernstein(ud), bernsteinDeriv(vd));
        // The Newell patches wind clockwise (glaux drew them with
        // glFrontFace(GL_CW)), so cross(dv, du) points outward.
        let nx = dv[1] * du[2] - dv[2] * du[1];
        let ny = dv[2] * du[0] - dv[0] * du[2];
        let nz = dv[0] * du[1] - dv[1] * du[0];
        const hyp = Math.hypot(nx, ny, nz);
        const len = hyp === 0 ? 1 : hyp;
        nx /= len;
        ny /= len;
        nz /= len;
        // Z-up data -> Y-up mesh: (x, y, z) -> (x, z, -y)
        positions.push(p[0], p[2], -p[1]);
        normals.push(nx, nz, -ny);
      }
    }

    for (let iu = 0; iu < segments; iu++) {
      for (let iv = 0; iv < segments; iv++) {
        const a = base + iu * rows + iv;
        const b = a + 1;
        const c = a + rows;
        const d = c + 1;
        // Reversed relative to the naive CCW order, matching the CW data.
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  // Normalize: center vertically and scale to height 2.
  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i];
    if (positions[i] > maxY) maxY = positions[i];
  }
  const scale = 2 / (maxY - minY);
  const midY = (minY + maxY) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= scale;
    positions[i + 1] = (positions[i + 1] - midY) * scale;
    positions[i + 2] *= scale;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}
