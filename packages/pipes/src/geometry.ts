export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

// Unit cylinder: radius 1, along +Y from y=0 to y=1, open-ended.
export function createCylinderMesh(radialSegments = 24): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= 1; y++) {
    for (let i = 0; i <= radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      positions.push(c, y, s);
      normals.push(c, 0, s);
    }
  }

  const ring = radialSegments + 1;
  for (let i = 0; i < radialSegments; i++) {
    const a = i;
    const b = i + 1;
    const c = ring + i;
    const d = ring + i + 1;
    indices.push(a, c, b, b, c, d);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// Quarter-torus elbow joining two perpendicular pipe runs at a corner.
// Canonical frame: the pipe travels along +X into the corner (at the origin)
// and exits along +Y. Incoming cylinder ends at (-bend, 0, 0), outgoing starts
// at (0, bend, 0). Real radii are baked in so instances are pure rotations.
// The tube profile must match createCylinderMesh so the seams line up.
export function createElbowMesh(
  bendRadius: number,
  tubeRadius: number,
  arcSegments = 14,
  radialSegments = 24
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Arc circle center.
  const ox = -bendRadius;
  const oy = bendRadius;

  for (let a = 0; a <= arcSegments; a++) {
    const theta = (a / arcSegments) * (Math.PI / 2);
    // Unit radial from the arc center to the tube centerline.
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta);
    const cx = ox + bendRadius * ux;
    const cy = oy + bendRadius * uy;
    for (let j = 0; j <= radialSegments; j++) {
      const phi = (j / radialSegments) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      // Tube ring spans the radial direction (u) and the bend axis (+Z).
      const nx = cp * ux;
      const ny = cp * uy;
      const nz = sp;
      positions.push(
        cx + tubeRadius * nx,
        cy + tubeRadius * ny,
        tubeRadius * nz
      );
      normals.push(nx, ny, nz);
    }
  }

  const ring = radialSegments + 1;
  for (let a = 0; a < arcSegments; a++) {
    for (let j = 0; j < radialSegments; j++) {
      const p = a * ring + j;
      const q = p + 1;
      const r = p + ring;
      const s = r + 1;
      indices.push(p, r, q, q, r, s);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// Unit disc in the XZ plane at the origin, radius 1. Double-sided (front face
// +Y, back face -Y) so the flat cap on a growing pipe reads correctly from
// both directions. Caps the open end of the unit cylinder.
export function createDiscMesh(radialSegments = 24): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const ny of [1, -1]) {
    const center = positions.length / 3;
    positions.push(0, 0, 0);
    normals.push(0, ny, 0);
    for (let i = 0; i <= radialSegments; i++) {
      const a = (i / radialSegments) * Math.PI * 2;
      positions.push(Math.cos(a), 0, Math.sin(a));
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < radialSegments; i++) {
      if (ny > 0) indices.push(center, center + 2 + i, center + 1 + i);
      else indices.push(center, center + 1 + i, center + 2 + i);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// Unit UV sphere centered at the origin.
export function createSphereMesh(latBands = 14, lonBands = 24): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const phi = (lat / latBands) * Math.PI;
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    for (let lon = 0; lon <= lonBands; lon++) {
      const theta = (lon / lonBands) * Math.PI * 2;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon;
      const second = first + lonBands + 1;
      indices.push(first, first + 1, second, second, first + 1, second + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}
