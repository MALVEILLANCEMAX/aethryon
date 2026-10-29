// Géométrie des objets rétro : quelques centaines de triangles, facettes franches (ombrage plat) sauf les formes
// tournées (ombrage doux), comme sur PlayStation. Les UV pointent dans une texture de 64 × 64 px dont la dernière
// rangée sert de palette d'aplats (chants, biseaux, pièces unies) : voir textures.ts, `swatch`.
export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class MeshBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private t: number[] = [];
  private i: number[] = [];

  vertex(pos: V3, nor: V3, uv: V2): number {
    this.p.push(pos[0], pos[1], pos[2]);
    this.n.push(nor[0], nor[1], nor[2]);
    this.t.push(uv[0], uv[1]);
    return this.p.length / 3 - 1;
  }

  /** Face plane convexe, normale plate tournée vers l'extérieur (`outward` : point de référence intérieur). */
  face(points: readonly V3[], uvOf: (p: V3, k: number) => V2, inside: V3 = [0, 0, 0]): void {
    let pts = points;
    let nrm = norm(cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!)));
    const center = pts.reduce<V3>((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length, s[2] + q[2] / pts.length], [0, 0, 0]);
    if (dot(nrm, sub(center, inside)) < 0) {
      pts = [...pts].reverse();
      nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const first = this.p.length / 3;
    pts.forEach((q, k) => this.vertex(q, nrm, uvOf(q, k)));
    for (let k = 1; k < pts.length - 1; k++) this.i.push(first, first + k, first + k + 1);
  }

  /** Triangle à normales lissées (formes tournées). */
  smoothTri(a: [V3, V3, V2], b: [V3, V3, V2], c: [V3, V3, V2]): void {
    const ia = this.vertex(...a), ib = this.vertex(...b), ic = this.vertex(...c);
    this.i.push(ia, ib, ic);
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      uvs: new Float32Array(this.t),
      indices: new Uint16Array(this.i),
    };
  }
}

/** Pavé à arêtes chanfreinées : 6 faces principales (texture entière), 12 biseaux et 8 coins (aplat `edgeUv`). */
export function chamferedBox(b: MeshBuilder, size: V3, c: number, faceUv: (axis: number, sign: number, p: V3) => V2, edgeUv: V2, at: V3 = [0, 0, 0]): void {
  const [X, Y, Z] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const T = (p: V3): V3 => [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
  const P = (...pts: V3[]): V3[] => pts.map(T);
  const inside = at;
  for (const s of [1, -1]) {
    b.face(P([s * X, -(Y - c), -(Z - c)], [s * X, Y - c, -(Z - c)], [s * X, Y - c, Z - c], [s * X, -(Y - c), Z - c]), (p) => faceUv(0, s, p), inside);
    b.face(P([-(X - c), s * Y, -(Z - c)], [X - c, s * Y, -(Z - c)], [X - c, s * Y, Z - c], [-(X - c), s * Y, Z - c]), (p) => faceUv(1, s, p), inside);
    b.face(P([-(X - c), -(Y - c), s * Z], [X - c, -(Y - c), s * Z], [X - c, Y - c, s * Z], [-(X - c), Y - c, s * Z]), (p) => faceUv(2, s, p), inside);
  }
  const e = () => edgeUv;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    b.face(P([sx * X, sy * (Y - c), -(Z - c)], [sx * (X - c), sy * Y, -(Z - c)], [sx * (X - c), sy * Y, Z - c], [sx * X, sy * (Y - c), Z - c]), e, inside);
  }
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    b.face(P([sx * X, -(Y - c), sz * (Z - c)], [sx * X, Y - c, sz * (Z - c)], [sx * (X - c), Y - c, sz * Z], [sx * (X - c), -(Y - c), sz * Z]), e, inside);
  }
  for (const sy of [1, -1]) for (const sz of [1, -1]) {
    b.face(P([-(X - c), sy * Y, sz * (Z - c)], [X - c, sy * Y, sz * (Z - c)], [X - c, sy * (Y - c), sz * Z], [-(X - c), sy * (Y - c), sz * Z]), e, inside);
  }
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    b.face(P([sx * X, sy * (Y - c), sz * (Z - c)], [sx * (X - c), sy * Y, sz * (Z - c)], [sx * (X - c), sy * (Y - c), sz * Z]), e, inside);
  }
}

/** Polygone convexe (plan x, y) extrudé sur z : faces avant/arrière texturées, chants en aplat. */
export function extrude(b: MeshBuilder, poly: readonly V2[], depth: number, frontUv: (x: number, y: number) => V2, backUv: (x: number, y: number) => V2, sideUv: V2, at: V3 = [0, 0, 0]): void {
  const d = depth / 2;
  const T = (x: number, y: number, z: number): V3 => [x + at[0], y + at[1], z + at[2]];
  b.face(poly.map(([x, y]) => T(x, y, d)), (p) => frontUv(p[0] - at[0], p[1] - at[1]), at);
  b.face(poly.map(([x, y]) => T(x, y, -d)), (p) => backUv(p[0] - at[0], p[1] - at[1]), at);
  for (let k = 0; k < poly.length; k++) {
    const [x0, y0] = poly[k]!, [x1, y1] = poly[(k + 1) % poly.length]!;
    b.face([T(x0, y0, -d), T(x1, y1, -d), T(x1, y1, d), T(x0, y0, d)], () => sideUv, at);
  }
}

/** Anneau plat (disque troué) dans le plan x, z, épaisseur sur y : dessus/dessous en projection plane. */
export function ring(b: MeshBuilder, outer: number, inner: number, thickness: number, segments: number, topUv: (x: number, z: number) => V2, edgeUv: V2, y = 0): void {
  const h = thickness / 2;
  for (let k = 0; k < segments; k++) {
    const a0 = (k / segments) * Math.PI * 2, a1 = ((k + 1) / segments) * Math.PI * 2;
    const o0: V2 = [Math.cos(a0) * outer, Math.sin(a0) * outer], o1: V2 = [Math.cos(a1) * outer, Math.sin(a1) * outer];
    const i0: V2 = [Math.cos(a0) * inner, Math.sin(a0) * inner], i1: V2 = [Math.cos(a1) * inner, Math.sin(a1) * inner];
    for (const s of [1, -1]) {
      const fy = y + s * h;
      if (inner > 0) b.face([[o0[0], fy, o0[1]], [o1[0], fy, o1[1]], [i1[0], fy, i1[1]], [i0[0], fy, i0[1]]], (p) => topUv(p[0], s * p[2]), [0, y - s, 0]);
      else b.face([[o0[0], fy, o0[1]], [o1[0], fy, o1[1]], [0, fy, 0]], (p) => topUv(p[0], s * p[2]), [0, y - s, 0]);
    }
    // chant extérieur, puis bord du trou (normale vers l'axe)
    const mid: V3 = [Math.cos((a0 + a1) / 2) * outer * 2, y, Math.sin((a0 + a1) / 2) * outer * 2];
    b.face([[o0[0], y - h, o0[1]], [o1[0], y - h, o1[1]], [o1[0], y + h, o1[1]], [o0[0], y + h, o0[1]]], () => edgeUv, [0, y, 0]);
    if (inner > 0) b.face([[i0[0], y - h, i0[1]], [i1[0], y - h, i1[1]], [i1[0], y + h, i1[1]], [i0[0], y + h, i0[1]]], () => edgeUv, mid);
  }
}

/** Forme tournée autour de l'axe y (profil [rayon, hauteur] de bas en haut), normales lissées. */
export function lathe(b: MeshBuilder, profile: readonly V2[], segments: number, uvOf: (u: number, v: number) => V2, at: V3 = [0, 0, 0]): void {
  // normale du profil en chaque point : perpendiculaire à la tangente moyenne
  const pn = profile.map((_, k) => {
    const a = profile[Math.max(0, k - 1)]!, c = profile[Math.min(profile.length - 1, k + 1)]!;
    const tr = c[0] - a[0], ty = c[1] - a[1];
    const l = Math.hypot(tr, ty) || 1;
    return [ty / l, -tr / l] as const; // (dr, dy) tourné de -90°
  });
  const pt = (k: number, s: number): [V3, V3, V2] => {
    const ang = (s / segments) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
    const [r, y] = profile[k]!, [nr, ny] = pn[k]!;
    return [[r * cs + at[0], y + at[1], r * sn + at[2]], norm([nr * cs, ny, nr * sn]), uvOf(s / segments, k / (profile.length - 1))];
  };
  for (let k = 0; k < profile.length - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = pt(k, s), c = pt(k + 1, s + 1), d = pt(k + 1, s), e = pt(k, s + 1);
      b.smoothTri(a, d, c);
      b.smoothTri(a, c, e);
    }
  }
}
