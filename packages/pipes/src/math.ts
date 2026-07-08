export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export function v3add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function v3scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function v3length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function v3normalize(a: Vec3): Vec3 {
  const len = v3length(a);
  return len > 0 ? v3scale(a, 1 / len) : [0, 0, 0];
}

// All mat4s are column-major Float32Array(16), matching WebGL conventions.

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4],
      b1 = b[c * 4 + 1],
      b2 = b[c * 4 + 2],
      b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}

export function mat4Perspective(
  out: Mat4,
  fovyRad: number,
  aspect: number,
  near: number,
  far: number
): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4LookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = v3normalize(v3sub(eye, center));
  const x = v3normalize(v3cross(up, z));
  const y = v3cross(z, x);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -v3dot(x, eye);
  out[13] = -v3dot(y, eye);
  out[14] = -v3dot(z, eye);
  out[15] = 1;
  return out;
}

// Model matrix whose columns are the given (scaled) basis vectors plus origin.
// Pipe directions are the 6 grid axes, so this replaces all rotation matrices.
export function mat4FromBasis(
  out: Mat4,
  x: Vec3,
  y: Vec3,
  z: Vec3,
  origin: Vec3
): Mat4 {
  out[0] = x[0];
  out[1] = x[1];
  out[2] = x[2];
  out[3] = 0;
  out[4] = y[0];
  out[5] = y[1];
  out[6] = y[2];
  out[7] = 0;
  out[8] = z[0];
  out[9] = z[1];
  out[10] = z[2];
  out[11] = 0;
  out[12] = origin[0];
  out[13] = origin[1];
  out[14] = origin[2];
  out[15] = 1;
  return out;
}

export function mat4RotateX(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad),
    s = Math.sin(rad);
  mat4Identity(out);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

export function mat4RotateZ(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad),
    s = Math.sin(rad);
  mat4Identity(out);
  out[0] = c;
  out[1] = s;
  out[4] = -s;
  out[5] = c;
  return out;
}

export function mat4ScaleTranslate(
  out: Mat4,
  sx: number,
  sy: number,
  sz: number,
  tx: number,
  ty: number,
  tz: number
): Mat4 {
  out.fill(0);
  out[0] = sx;
  out[5] = sy;
  out[10] = sz;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}
