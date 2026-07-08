import type { Mesh } from './geometry';
import {
  createCylinderMesh,
  createDiscMesh,
  createElbowMesh,
  createSphereMesh,
} from './geometry';
import type { Mat4, Vec3 } from './math';
import type { PipeMaterial } from './pipes';
import { createTeapotMesh } from './teapot';

// Per-instance layout: mat4 model (16 floats) + material index (1 float).
const FLOATS_PER_INSTANCE = 17;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

const MAX_MATERIALS = 24;

// Faithful port of the original's fixed-function lighting (GLInit in
// STATE.CXX + MATERIAL.C): one white directional light with 0.1 ambient, a
// full-strength 1.0 white light-model ambient, per-material ambient/diffuse/
// specular/shininess, an infinite viewer (constant half-vector), and no gamma
// correction. Final color = ka*1.1 + kd*NdotL + ks*NdotH^shine, clamped.
const VERT_INSTANCED = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_m0;
layout(location = 3) in vec4 a_m1;
layout(location = 4) in vec4 a_m2;
layout(location = 5) in vec4 a_m3;
layout(location = 6) in float a_matIndex;

uniform mat4 u_viewProj;

out vec3 v_normal;
flat out float v_matIndex;

void main() {
  mat4 model = mat4(a_m0, a_m1, a_m2, a_m3);
  vec4 world = model * vec4(a_pos, 1.0);
  v_normal = transpose(inverse(mat3(model))) * a_normal;
  v_matIndex = a_matIndex;
  gl_Position = u_viewProj * world;
}
`;

// Flex pipes generate world-space geometry on the CPU, so no model matrix.
const VERT_FLEX = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in float a_matIndex;

uniform mat4 u_viewProj;

out vec3 v_normal;
flat out float v_matIndex;

void main() {
  v_normal = a_normal;
  v_matIndex = a_matIndex;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

in vec3 v_normal;
flat in float v_matIndex;

uniform vec3 u_ka[${MAX_MATERIALS}];
uniform vec3 u_kd[${MAX_MATERIALS}];
uniform vec3 u_ks[${MAX_MATERIALS}];
uniform float u_shine[${MAX_MATERIALS}];
uniform vec3 u_lightDir;
uniform vec3 u_halfVec;
uniform float u_fade;
uniform float u_alpha;

out vec4 outColor;

void main() {
  vec3 N = normalize(v_normal);
  int idx = int(v_matIndex + 0.5);

  float diffuse = max(dot(N, u_lightDir), 0.0);
  // Fixed-function GL zeroes specular on faces turned away from the light.
  float specular = diffuse > 0.0 ? pow(max(dot(N, u_halfVec), 0.0), u_shine[idx]) : 0.0;

  vec3 rgb = u_ka[idx] * 1.1 + u_kd[idx] * diffuse + u_ks[idx] * specular;
  // u_alpha is 1 over a solid background; over a transparent one it carries
  // the fade so pipes dissolve to transparent between rounds.
  outColor = vec4(min(rgb, vec3(1.0)) * u_fade, u_alpha);
}
`;

export interface Batch {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexCount: number;
  instanceBuf: WebGLBuffer;
  capacity: number;
  count: number;
  data: Float32Array;
  dirtyLo: number;
  dirtyHi: number;
}

// Append-only world-space geometry for flex pipes, split into fixed-size
// chunks. Once a chunk fills up it is never written again, so the driver only
// ever has to synchronize the small active chunk instead of ghosting one huge
// in-flight buffer every frame (which tanks the frame rate as a round grows).
interface FlexChunk {
  vao: WebGLVertexArrayObject;
  vertBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  vertCount: number;
  indexCount: number;
  flushedVerts: number;
  flushedIndices: number;
  // Interleaved: x,y,z, nx,ny,nz, matIndex (7 floats per vertex).
  data: Float32Array;
  indices: Uint32Array;
}

export interface FlexBuffer {
  gl: WebGL2RenderingContext;
  chunks: FlexChunk[];
  active: number;
  // Small fully-rewritten-per-frame chunk holding the animated growing tails.
  tail: FlexChunk;
}

const FLEX_FLOATS_PER_VERT = 7;
const FLEX_CHUNK_VERTS = 24_000;
const FLEX_CHUNK_INDICES = 80_000;
const FLEX_MAX_CHUNKS = 16;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
  if (!compiled) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`@pierre/pipes: shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  if (!linked) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`@pierre/pipes: program link failed: ${log}`);
  }
  return program;
}

export function createBatch(
  gl: WebGL2RenderingContext,
  mesh: Mesh,
  capacity: number
): Batch {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const nrmBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const instanceBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    capacity * BYTES_PER_INSTANCE,
    gl.DYNAMIC_DRAW
  );
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(2 + i);
    gl.vertexAttribPointer(
      2 + i,
      4,
      gl.FLOAT,
      false,
      BYTES_PER_INSTANCE,
      i * 16
    );
    gl.vertexAttribDivisor(2 + i, 1);
  }
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 1, gl.FLOAT, false, BYTES_PER_INSTANCE, 64);
  gl.vertexAttribDivisor(6, 1);

  gl.bindVertexArray(null);

  return {
    vao,
    buffers: [posBuf, nrmBuf, idxBuf, instanceBuf],
    indexCount: mesh.indices.length,
    instanceBuf,
    capacity,
    count: 0,
    data: new Float32Array(capacity * FLOATS_PER_INSTANCE),
    dirtyLo: Infinity,
    dirtyHi: 0,
  };
}

function markDirty(batch: Batch, index: number): void {
  if (index < batch.dirtyLo) batch.dirtyLo = index;
  if (index + 1 > batch.dirtyHi) batch.dirtyHi = index + 1;
}

// Returns the instance index, or -1 if the batch is full.
export function pushInstance(
  batch: Batch,
  mat: Mat4,
  matIndex: number
): number {
  if (batch.count >= batch.capacity) return -1;
  const i = batch.count++;
  const o = i * FLOATS_PER_INSTANCE;
  batch.data.set(mat, o);
  batch.data[o + 16] = matIndex;
  markDirty(batch, i);
  return i;
}

// Rewrites an instance's model matrix (material index is untouched).
export function updateInstance(batch: Batch, index: number, mat: Mat4): void {
  batch.data.set(mat, index * FLOATS_PER_INSTANCE);
  markDirty(batch, index);
}

export function resetBatch(batch: Batch): void {
  batch.count = 0;
  batch.dirtyLo = Infinity;
  batch.dirtyHi = 0;
}

function flushBatch(gl: WebGL2RenderingContext, batch: Batch): void {
  if (batch.dirtyHi <= batch.dirtyLo) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, batch.instanceBuf);
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    batch.dirtyLo * BYTES_PER_INSTANCE,
    batch.data.subarray(
      batch.dirtyLo * FLOATS_PER_INSTANCE,
      batch.dirtyHi * FLOATS_PER_INSTANCE
    )
  );
  batch.dirtyLo = Infinity;
  batch.dirtyHi = 0;
}

function createFlexChunk(gl: WebGL2RenderingContext): FlexChunk {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vertBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    FLEX_CHUNK_VERTS * FLEX_FLOATS_PER_VERT * 4,
    gl.DYNAMIC_DRAW
  );
  const stride = FLEX_FLOATS_PER_VERT * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    FLEX_CHUNK_INDICES * 4,
    gl.DYNAMIC_DRAW
  );

  gl.bindVertexArray(null);

  return {
    vao,
    vertBuf,
    idxBuf,
    vertCount: 0,
    indexCount: 0,
    flushedVerts: 0,
    flushedIndices: 0,
    data: new Float32Array(FLEX_CHUNK_VERTS * FLEX_FLOATS_PER_VERT),
    indices: new Uint32Array(FLEX_CHUNK_INDICES),
  };
}

function createFlexBuffer(gl: WebGL2RenderingContext): FlexBuffer {
  return {
    gl,
    chunks: [createFlexChunk(gl)],
    active: 0,
    tail: createFlexChunk(gl),
  };
}

// Append world-space vertices (x,y,z,nx,ny,nz per vertex) and local indices.
// Returns false (dropping the geometry) if all chunks are full.
export function pushFlexGeometry(
  fb: FlexBuffer,
  verts: number[],
  localIndices: number[],
  matIndex: number
): boolean {
  const nVerts = verts.length / 6;
  let chunk = fb.chunks[fb.active];
  if (
    chunk.vertCount + nVerts > FLEX_CHUNK_VERTS ||
    chunk.indexCount + localIndices.length > FLEX_CHUNK_INDICES
  ) {
    if (fb.active + 1 >= FLEX_MAX_CHUNKS) return false;
    fb.active++;
    if (fb.chunks.length <= fb.active)
      fb.chunks[fb.active] = createFlexChunk(fb.gl);
    chunk = fb.chunks[fb.active];
  }
  const base = chunk.vertCount;
  let o = base * FLEX_FLOATS_PER_VERT;
  for (let i = 0; i < verts.length; i += 6) {
    chunk.data[o++] = verts[i];
    chunk.data[o++] = verts[i + 1];
    chunk.data[o++] = verts[i + 2];
    chunk.data[o++] = verts[i + 3];
    chunk.data[o++] = verts[i + 4];
    chunk.data[o++] = verts[i + 5];
    chunk.data[o++] = matIndex;
  }
  for (let i = 0; i < localIndices.length; i++) {
    chunk.indices[chunk.indexCount + i] = base + localIndices[i];
  }
  chunk.vertCount += nVerts;
  chunk.indexCount += localIndices.length;
  return true;
}

export function resetFlexBuffer(fb: FlexBuffer): void {
  for (const chunk of fb.chunks) {
    chunk.vertCount = 0;
    chunk.indexCount = 0;
    chunk.flushedVerts = 0;
    chunk.flushedIndices = 0;
  }
  fb.active = 0;
  resetFlexTail(fb);
}

export function resetFlexTail(fb: FlexBuffer): void {
  fb.tail.vertCount = 0;
  fb.tail.indexCount = 0;
}

// Append to the per-frame tail chunk (same packing as pushFlexGeometry).
export function pushFlexTail(
  fb: FlexBuffer,
  verts: number[],
  localIndices: number[],
  matIndex: number
): boolean {
  const chunk = fb.tail;
  const nVerts = verts.length / 6;
  if (chunk.vertCount + nVerts > FLEX_CHUNK_VERTS) return false;
  if (chunk.indexCount + localIndices.length > FLEX_CHUNK_INDICES) return false;
  const base = chunk.vertCount;
  let o = base * FLEX_FLOATS_PER_VERT;
  for (let i = 0; i < verts.length; i += 6) {
    chunk.data[o++] = verts[i];
    chunk.data[o++] = verts[i + 1];
    chunk.data[o++] = verts[i + 2];
    chunk.data[o++] = verts[i + 3];
    chunk.data[o++] = verts[i + 4];
    chunk.data[o++] = verts[i + 5];
    chunk.data[o++] = matIndex;
  }
  for (let i = 0; i < localIndices.length; i++) {
    chunk.indices[chunk.indexCount + i] = base + localIndices[i];
  }
  chunk.vertCount += nVerts;
  chunk.indexCount += localIndices.length;
  return true;
}

// Fraction of total flex capacity in use (for the round-reset backstop).
export function flexUsage(fb: FlexBuffer): number {
  return (
    (fb.active + fb.chunks[fb.active].vertCount / FLEX_CHUNK_VERTS) /
    FLEX_MAX_CHUNKS
  );
}

export function flexIsEmpty(fb: FlexBuffer): boolean {
  return (
    fb.active === 0 && fb.chunks[0].indexCount === 0 && fb.tail.indexCount === 0
  );
}

function flushAndDrawFlex(gl: WebGL2RenderingContext, fb: FlexBuffer): void {
  for (const chunk of fb.chunks) {
    if (chunk.indexCount === 0) continue;
    // Bind the chunk's VAO before touching its element buffer — that binding
    // is VAO state and must not be captured into another batch's VAO.
    gl.bindVertexArray(chunk.vao);
    if (chunk.vertCount > chunk.flushedVerts) {
      gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vertBuf);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        chunk.flushedVerts * FLEX_FLOATS_PER_VERT * 4,
        chunk.data.subarray(
          chunk.flushedVerts * FLEX_FLOATS_PER_VERT,
          chunk.vertCount * FLEX_FLOATS_PER_VERT
        )
      );
      chunk.flushedVerts = chunk.vertCount;
    }
    if (chunk.indexCount > chunk.flushedIndices) {
      gl.bufferSubData(
        gl.ELEMENT_ARRAY_BUFFER,
        chunk.flushedIndices * 4,
        chunk.indices.subarray(chunk.flushedIndices, chunk.indexCount)
      );
      chunk.flushedIndices = chunk.indexCount;
    }
    gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
  }

  // The animated tails: tiny, rebuilt from scratch every frame.
  const tail = fb.tail;
  if (tail.indexCount > 0) {
    gl.bindVertexArray(tail.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, tail.vertBuf);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      tail.data.subarray(0, tail.vertCount * FLEX_FLOATS_PER_VERT)
    );
    gl.bufferSubData(
      gl.ELEMENT_ARRAY_BUFFER,
      0,
      tail.indices.subarray(0, tail.indexCount)
    );
    gl.drawElements(gl.TRIANGLES, tail.indexCount, gl.UNSIGNED_INT, 0);
  }
}

interface ProgramInfo {
  program: WebGLProgram;
  uViewProj: WebGLUniformLocation | null;
  uLightDir: WebGLUniformLocation | null;
  uHalfVec: WebGLUniformLocation | null;
  uFade: WebGLUniformLocation | null;
  uAlpha: WebGLUniformLocation | null;
}

export interface Renderer {
  gl: WebGL2RenderingContext;
  cylinders: Batch;
  elbows: Batch;
  spheres: Batch;
  discs: Batch;
  teapots: Batch;
  flex: FlexBuffer;
  draw(viewProj: Mat4, lightDir: Vec3, halfVec: Vec3, fade: number): void;
  /** Swap the background at runtime — solid colors and 'transparent' alike. */
  setBackground(color: Vec3 | 'transparent'): void;
  /** Change the retro pixel-scale at runtime (1 = full resolution + MSAA). */
  setPixelSize(size: number): void;
  destroy(): void;
}

// The offscreen framebuffer the scene renders into before blitting to the
// canvas; all-null until ensureTarget allocates it at the first draw.
interface OffscreenTarget {
  fbo: WebGLFramebuffer | null;
  colorRb: WebGLRenderbuffer | null;
  depthRb: WebGLRenderbuffer | null;
  width: number;
  height: number;
  samples: number;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  background: Vec3 | 'transparent',
  pipeRadius: number,
  bendRadius: number,
  pixelSize: number,
  materials: PipeMaterial[]
): Renderer {
  let transparent = background === 'transparent';
  let bg: Vec3 = background === 'transparent' ? [0, 0, 0] : background;
  let pxSize = Math.max(1, pixelSize);
  // Context attributes are immutable, so nothing quality-related lives there:
  // the scene renders into an offscreen framebuffer we can resize and
  // multisample at will (MSAA at pixelSize 1, chunky low-res otherwise), then
  // blits to the canvas with nearest-neighbor scaling. The alpha channel is
  // always present so transparency can be toggled live too.
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
  });
  if (gl == null) throw new Error('@pierre/pipes: WebGL2 is not supported');
  const maxSamples = Math.min(4, Number(gl.getParameter(gl.MAX_SAMPLES)));

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  // Offscreen render target, recreated on demand when size/samples change.
  const target: OffscreenTarget = {
    fbo: null,
    colorRb: null,
    depthRb: null,
    width: 0,
    height: 0,
    samples: -1,
  };

  function ensureTarget(width: number, height: number, samples: number): void {
    if (
      target.width === width &&
      target.height === height &&
      target.samples === samples
    )
      return;
    if (target.fbo != null) {
      gl!.deleteFramebuffer(target.fbo);
      gl!.deleteRenderbuffer(target.colorRb);
      gl!.deleteRenderbuffer(target.depthRb);
    }
    target.fbo = gl!.createFramebuffer();
    target.colorRb = gl!.createRenderbuffer();
    target.depthRb = gl!.createRenderbuffer();
    gl!.bindRenderbuffer(gl!.RENDERBUFFER, target.colorRb);
    if (samples > 0)
      gl!.renderbufferStorageMultisample(
        gl!.RENDERBUFFER,
        samples,
        gl!.RGBA8,
        width,
        height
      );
    else gl!.renderbufferStorage(gl!.RENDERBUFFER, gl!.RGBA8, width, height);
    gl!.bindRenderbuffer(gl!.RENDERBUFFER, target.depthRb);
    if (samples > 0)
      gl!.renderbufferStorageMultisample(
        gl!.RENDERBUFFER,
        samples,
        gl!.DEPTH_COMPONENT24,
        width,
        height
      );
    else
      gl!.renderbufferStorage(
        gl!.RENDERBUFFER,
        gl!.DEPTH_COMPONENT24,
        width,
        height
      );
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo);
    gl!.framebufferRenderbuffer(
      gl!.FRAMEBUFFER,
      gl!.COLOR_ATTACHMENT0,
      gl!.RENDERBUFFER,
      target.colorRb
    );
    gl!.framebufferRenderbuffer(
      gl!.FRAMEBUFFER,
      gl!.DEPTH_ATTACHMENT,
      gl!.RENDERBUFFER,
      target.depthRb
    );
    target.width = width;
    target.height = height;
    target.samples = samples;
  }

  // Material table, shared by both programs.
  const count = Math.min(materials.length, MAX_MATERIALS);
  const ka = new Float32Array(count * 3);
  const kd = new Float32Array(count * 3);
  const ks = new Float32Array(count * 3);
  const shine = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ka.set(materials[i].ambient, i * 3);
    kd.set(materials[i].diffuse, i * 3);
    ks.set(materials[i].specular, i * 3);
    shine[i] = Math.max(materials[i].shininess, 0.001);
  }

  function setupProgram(vertSrc: string): ProgramInfo {
    const program = createProgram(gl!, vertSrc);
    gl!.useProgram(program);
    gl!.uniform3fv(gl!.getUniformLocation(program, 'u_ka'), ka);
    gl!.uniform3fv(gl!.getUniformLocation(program, 'u_kd'), kd);
    gl!.uniform3fv(gl!.getUniformLocation(program, 'u_ks'), ks);
    gl!.uniform1fv(gl!.getUniformLocation(program, 'u_shine'), shine);
    return {
      program,
      uViewProj: gl!.getUniformLocation(program, 'u_viewProj'),
      uLightDir: gl!.getUniformLocation(program, 'u_lightDir'),
      uHalfVec: gl!.getUniformLocation(program, 'u_halfVec'),
      uFade: gl!.getUniformLocation(program, 'u_fade'),
      uAlpha: gl!.getUniformLocation(program, 'u_alpha'),
    };
  }

  const instanced = setupProgram(VERT_INSTANCED);
  const flexProg = setupProgram(VERT_FLEX);

  const cylinders = createBatch(gl, createCylinderMesh(), 4096);
  const elbows = createBatch(gl, createElbowMesh(bendRadius, pipeRadius), 4096);
  const spheres = createBatch(gl, createSphereMesh(), 2048);
  const discs = createBatch(gl, createDiscMesh(), 2048);
  const teapots = createBatch(gl, createTeapotMesh(), 64);
  const flex = createFlexBuffer(gl);

  function setSharedUniforms(
    p: ProgramInfo,
    viewProj: Mat4,
    lightDir: Vec3,
    halfVec: Vec3,
    fade: number
  ): void {
    gl!.useProgram(p.program);
    gl!.uniformMatrix4fv(p.uViewProj, false, viewProj);
    gl!.uniform3fv(p.uLightDir, lightDir);
    gl!.uniform3fv(p.uHalfVec, halfVec);
    gl!.uniform1f(p.uFade, fade);
    gl!.uniform1f(p.uAlpha, transparent ? fade : 1);
  }

  return {
    gl,
    cylinders,
    elbows,
    spheres,
    discs,
    teapots,
    flex,
    draw(viewProj, lightDir, halfVec, fade) {
      // Fat pixels are sized in CSS pixels (matching the old CSS-upscale
      // behavior); full resolution renders at the backing-store size + MSAA.
      const pw =
        pxSize > 1
          ? Math.max(1, Math.round(canvas.clientWidth / pxSize))
          : canvas.width;
      const ph =
        pxSize > 1
          ? Math.max(1, Math.round(canvas.clientHeight / pxSize))
          : canvas.height;
      ensureTarget(pw, ph, pxSize > 1 ? 0 : maxSamples);

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, pw, ph);
      if (transparent) gl.clearColor(0, 0, 0, 0);
      else gl.clearColor(bg[0] * fade, bg[1] * fade, bg[2] * fade, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      setSharedUniforms(instanced, viewProj, lightDir, halfVec, fade);
      for (const batch of [cylinders, elbows, spheres, discs, teapots]) {
        flushBatch(gl, batch);
        if (batch.count === 0) continue;
        gl.bindVertexArray(batch.vao);
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          batch.indexCount,
          gl.UNSIGNED_SHORT,
          0,
          batch.count
        );
      }

      if (!flexIsEmpty(flex)) {
        setSharedUniforms(flexProg, viewProj, lightDir, halfVec, fade);
        flushAndDrawFlex(gl, flex);
      }
      gl.bindVertexArray(null);

      // Present: nearest-neighbor stretch (or 1:1 MSAA resolve) to the canvas.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(
        0,
        0,
        pw,
        ph,
        0,
        0,
        canvas.width,
        canvas.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    setBackground(color) {
      transparent = color === 'transparent';
      if (color !== 'transparent') bg = color;
    },
    setPixelSize(size) {
      pxSize = Math.max(1, size);
    },
    destroy() {
      for (const batch of [cylinders, elbows, spheres, discs, teapots]) {
        for (const buf of batch.buffers) gl.deleteBuffer(buf);
        gl.deleteVertexArray(batch.vao);
      }
      for (const chunk of [...flex.chunks, flex.tail]) {
        gl.deleteBuffer(chunk.vertBuf);
        gl.deleteBuffer(chunk.idxBuf);
        gl.deleteVertexArray(chunk.vao);
      }
      gl.deleteProgram(instanced.program);
      gl.deleteProgram(flexProg.program);
      if (target.fbo != null) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteRenderbuffer(target.colorRb);
        gl.deleteRenderbuffer(target.depthRb);
      }
      // Note: we deliberately do NOT lose the context — the browser hands the
      // same context back if createPipes is called again on this canvas.
    },
  };
}
