// Les objets rétro d'AETHRYON : des reliques des formats, pas des modèles génériques. Chacun dit quelque chose du
// service — le cube grec gravé (Athéna, la marque), la disquette (le fichier qu'on garde : MP4), le disque compact
// (le son : MP3), le sablier (le quota qui se renouvelle chaque jour). Quelques centaines de triangles chacun.
import { identity, multiply, rotationX, rotationY, rotationZ, translation, type Mat4 } from "./math.ts";
import { chamferedBox, extrude, lathe, MeshBuilder, ring, type Mesh, type V2 } from "./mesh.ts";
import { cookieTexture, discTexture, floppyTexture, hourglassTexture, stoneTexture, swatch, TEX } from "./textures.ts";

export type RetroKind = "cube" | "disquette" | "disque" | "sablier" | "cookie";

export interface Part {
  mesh: Mesh;
  texture: HTMLCanvasElement;
  /** < 1 : partie translucide, dessinée après les parties opaques (verre). */
  alpha?: number;
}

export interface RetroDef {
  parts: Part[];
  /** Position de l'objet à l'instant t (secondes) : rotation lente et léger flottement. */
  pose: (t: number) => Mat4;
}

const AREA = 56 / TEX; // zone dessinée de la texture (la rangée du bas est la palette)
const lin = (v: number, a: number, b: number) => ((v - a) / (b - a)) * AREA;
const float = (t: number, amp = 0.05) => translation(0, Math.sin(t * 0.9) * amp, 0);

function cube(): RetroDef {
  const b = new MeshBuilder();
  const h = 0.85 - 0.16;
  chamferedBox(b, [1.7, 1.7, 1.7], 0.16, (axis, sign, p) => {
    if (axis === 0) return [lin(sign * p[2], -h, h), lin(-p[1], -h, h)];
    if (axis === 1) return [lin(p[0], -h, h), lin(sign * p[2], -h, h)];
    return [lin(-sign * p[0], -h, h), lin(-p[1], -h, h)];
  }, swatch(0));
  return {
    parts: [{ mesh: b.build(), texture: stoneTexture() }],
    pose: (t) => multiply(float(t), multiply(rotationX(0.38 + Math.sin(t * 0.5) * 0.06), rotationY(t * 0.38 + 0.6))),
  };
}

function disquette(label: string): RetroDef {
  const b = new MeshBuilder();
  const outline: V2[] = [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.74], [0.74, 0.9], [-0.9, 0.9]];
  extrude(b, outline, 0.12,
    (x, y) => [lin(x, -0.9, 0.9), lin(-y, -0.9, 0.9)],
    (x, y) => [(1 + ((x + 0.9) / 1.8) * 4) / TEX, (1 + ((0.9 - y) / 1.8) * 18) / TEX],
    swatch(0));
  const body = b.build();
  const m = new MeshBuilder();
  // volet métallique (haut), fenêtre sombre, moyeu au dos
  chamferedBox(m, [0.92, 0.66, 0.15], 0.03, () => swatch(1), swatch(2), [0.02, 0.56, 0]);
  chamferedBox(m, [0.24, 0.44, 0.17], 0.02, () => swatch(4), swatch(4), [0.14, 0.58, 0]);
  return {
    parts: [{ mesh: body, texture: floppyTexture(label) }, { mesh: m.build(), texture: floppyTexture(label) }],
    pose: (t) => multiply(float(t, 0.06), multiply(rotationX(0.16 + Math.sin(t * 0.55) * 0.05), multiply(rotationY(t * 0.42 - 0.5), rotationZ(Math.sin(t * 0.6) * 0.05)))),
  };
}

function disque(label: string): RetroDef {
  const b = new MeshBuilder();
  ring(b, 1.15, 0.17, 0.05, 36, (x, z) => [((x / 1.15) * 0.5 + 0.5) * AREA, ((z / 1.15) * 0.5 + 0.5) * AREA], swatch(0));
  return {
    parts: [{ mesh: b.build(), texture: discTexture(label) }],
    // il tourne sur son axe comme dans un lecteur, incliné vers le visiteur, avec une lente précession
    pose: (t) => multiply(float(t, 0.05), multiply(rotationZ(Math.sin(t * 0.4) * 0.16 - 0.12), multiply(rotationX(1.02), rotationY(-t * 0.9)))),
  };
}

function sablier(): RetroDef {
  const tex = hourglassTexture();
  const frame = new MeshBuilder();
  const capUv = (x: number, z: number): V2 => [((x / 0.72) * 0.5 + 0.5) * AREA, ((z / 0.72) * 0.5 + 0.5) * AREA];
  ring(frame, 0.72, 0, 0.12, 20, capUv, swatch(3), 0.95);
  ring(frame, 0.72, 0, 0.12, 20, capUv, swatch(3), -0.95);
  for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
    chamferedBox(frame, [0.08, 1.78, 0.08], 0.02, () => swatch(0), swatch(0), [Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6]);
  }
  const sand = new MeshBuilder();
  lathe(sand, [[0, -0.84], [0.47, -0.78], [0.3, -0.56], [0.1, -0.44], [0, -0.41]], 14, () => swatch(1));
  lathe(sand, [[0, 0.16], [0.16, 0.2], [0.34, 0.36], [0.4, 0.5], [0, 0.52]], 14, () => swatch(1));
  chamferedBox(sand, [0.025, 0.42, 0.025], 0.005, () => swatch(1), swatch(1), [0, -0.22, 0]);
  const glass = new MeshBuilder();
  lathe(glass, [[0.04, -0.89], [0.4, -0.82], [0.54, -0.6], [0.46, -0.3], [0.13, -0.06], [0.07, 0], [0.13, 0.06], [0.46, 0.3], [0.54, 0.6], [0.4, 0.82], [0.04, 0.89]], 18, () => swatch(2));
  return {
    parts: [{ mesh: frame.build(), texture: tex }, { mesh: sand.build(), texture: tex }, { mesh: glass.build(), texture: tex, alpha: 0.3 }],
    pose: (t) => multiply(float(t, 0.05), multiply(rotationZ(Math.sin(t * 0.5) * 0.07), multiply(rotationX(0.22), rotationY(t * 0.32)))),
  };
}

/**
 * Cookie du consentement (V3.5) : biscuit bombé à facettes franches (ombrage plat, rayon irrégulier d'une facette à
 * l'autre : fait main, pas un disque parfait), sept pépites de chocolat en volume. Tourne lentement, incliné vers le
 * visiteur ; jamais de visage (mignon, pas enfantin).
 */
function cookie(): RetroDef {
  const b = new MeshBuilder();
  const SEG = 13;
  // Profil [rayon, hauteur] du dessous au sommet : bord arrondi, dessus légèrement bombé.
  const profile: V2[] = [[0, -0.2], [0.86, -0.19], [1.04, -0.1], [1.07, 0.02], [0.98, 0.13], [0.72, 0.21], [0.36, 0.25], [0, 0.26]];
  const jitter = (s: number) => 1 + Math.sin(s * 12.9898 + 4.1) * 0.045;
  const at = (k: number, s: number): readonly [number, number, number] => {
    const [r, y] = profile[k]!;
    const a = ((s % SEG) / SEG) * Math.PI * 2 + 0.2;
    const rr = r * jitter(s % SEG);
    return [Math.cos(a) * rr, y, Math.sin(a) * rr];
  };
  const top = (p: readonly [number, number, number]): V2 => [((p[0] / 1.1) * 0.5 + 0.5) * AREA, ((p[2] / 1.1) * 0.5 + 0.5) * AREA];
  for (let k = 0; k < profile.length - 1; k++) {
    for (let s = 0; s < SEG; s++) {
      const a = at(k, s), c = at(k, s + 1), d = at(k + 1, s + 1), e = at(k + 1, s);
      // dessous plus clair (aplat), chant et dessus texturés (projection plane)
      const uv = k === 0 ? () => swatch(3) : k === 1 ? () => swatch(0) : (p: readonly [number, number, number]) => top(p);
      // Normale plate tournée vers l'extérieur : le centre du biscuit est à l'intérieur de toutes les faces.
      if (profile[k]![0] === 0) b.face([a, d, e], uv);
      else if (profile[k + 1]![0] === 0) b.face([a, c, d], uv);
      else b.face([a, c, d, e], uv);
    }
  }
  // Pépites : petits volumes chanfreinés posés sur le dessus (hauteur suivant le bombé).
  const chips: [number, number, number][] = [[-0.38, 0.22, 0.22], [0.28, 0.44, 0.19], [0.52, -0.12, 0.21], [-0.06, -0.5, 0.2], [-0.62, -0.22, 0.17], [0.06, 0.04, 0.22], [0.66, 0.32, 0.15]];
  for (const [x, z, w] of chips) {
    const r = Math.hypot(x, z);
    const y = 0.26 - 0.13 * Math.min(1, (r / 0.95) ** 2);
    chamferedBox(b, [w, w * 0.78, w * 0.88], w * 0.2, (axis, sign) => (axis === 1 && sign > 0 ? swatch(2) : swatch(1)), swatch(1), [x, y + w * 0.16, z]);
  }
  return {
    parts: [{ mesh: b.build(), texture: cookieTexture() }],
    pose: (t) => multiply(float(t, 0.035), multiply(rotationX(0.82 + Math.sin(t * 0.6) * 0.06), multiply(rotationZ(Math.sin(t * 0.45) * 0.07), rotationY(t * 0.32 + 0.5)))),
  };
}

export function buildObject(kind: RetroKind, label = ""): RetroDef {
  switch (kind) {
    case "cube": return cube();
    case "disquette": return disquette(label || "MP4");
    case "disque": return disque(label || "MP3");
    case "sablier": return sablier();
    case "cookie": return cookie();
  }
}

export const IDENTITY = identity();
