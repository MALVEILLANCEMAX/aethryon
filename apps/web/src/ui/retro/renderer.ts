// Rendu « PlayStation 1 » en WebGL 1, sans bibliothèque : petite résolution agrandie au pixel près (CSS
// image-rendering: pixelated), sommets aimantés à la grille de pixels (le tremblement caractéristique), textures
// plaquées en affine (sans correction de perspective), éclairage par sommet (Gouraud) avec une lumière principale
// ivoire et un liseré or, couleurs ramenées à 15 bits avec un tramage ordonné de Bayer 4 × 4.
// Au repos, l'objet se pose (2026-10-28, règle « une page immobile ne travaille pas », docs/DESIGN.md § 12) : réveillé
// (arrivée à l'écran, pointeur, bond), il tourne quelques secondes, puis son temps ralentit jusqu'à l'arrêt et la boucle
// s'éteint ; aucune image n'est plus calculée tant que rien ne le réveille.
// Aucun appel réseau, aucune image : les textures sont des canvas dessinés au pixel (textures.ts).
import { lookAt, multiply, normalMatrix, perspective, rotationX, rotationY, rotationZ, translation } from "./math.ts";
import type { RetroDef } from "./objects.ts";

const VERT = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormal;
uniform vec2 uSnap;
uniform vec3 uEye;
varying vec3 vUvw;
varying vec3 vLight;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 clip = uViewProj * world;
  vec2 ndc = clip.xy / clip.w;
  ndc = floor(ndc * uSnap + 0.5) / uSnap;
  clip.xy = ndc * clip.w;
  gl_Position = clip;
  vUvw = vec3(aUv * clip.w, clip.w);
  vec3 n = normalize(uNormal * aNor);
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
  vec3 V = normalize(uEye - world.xyz);
  float key = max(dot(n, L), 0.0);
  float fill = max(dot(n, normalize(vec3(0.6, -0.2, 0.4))), 0.0);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vLight = vec3(0.34, 0.32, 0.33) + vec3(1.0, 0.95, 0.87) * key * 0.92 + vec3(0.45, 0.47, 0.55) * fill * 0.25 + vec3(0.92, 0.72, 0.46) * rim * 0.9;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
varying vec3 vUvw;
varying vec3 vLight;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 uv = vUvw.xy / vUvw.z;
  vec3 c = texture2D(uTex, uv).rgb * vLight;
  float d = bayer4(gl_FragCoord.xy) - 0.5;
  c = clamp(floor(c * 31.0 + d + 0.5) / 31.0, 0.0, 1.0);
  gl_FragColor = vec4(c * uAlpha, uAlpha);
}`;

const UNIFORMS = ["uModel", "uViewProj", "uNormal", "uSnap", "uEye", "uTex", "uAlpha"] as const;
type Uniform = (typeof UNIFORMS)[number];

interface GpuPart {
  buffers: { pos: WebGLBuffer; nor: WebGLBuffer; uv: WebGLBuffer; idx: WebGLBuffer };
  count: number;
  texture: WebGLTexture;
  alpha: number;
}

export class RetroRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private parts: GpuPart[] = [];
  private loc: Record<Uniform, WebGLUniformLocation | null>;
  private attrs: { pos: number; nor: number; uv: number };
  private raf = 0;
  private running = false;
  private last = 0;
  private clock = 0;
  /** Se poser : instant (ms) où l'objet peut commencer, horloge à atteindre d'abord (angle de repos) et début du ralenti. */
  private settleAt = 0;
  private alignClock = -1;
  private decayFrom = -1;
  /** Instant de l'affiche (angle de repos), donné par le composant ; avec `def.period`, l'objet s'y pose. */
  private restT: number | null = null;
  private static readonly SETTLE_MS = 1400;
  /** Avance de l'horloge pendant le ralenti (intégrale de (1 − k)² sur SETTLE_MS), en secondes. */
  private static readonly SETTLE_ADVANCE = 1.4 / 3;
  private readonly eye = [0, 0.32, 6.3] as const;
  /** Orientation vers le pointeur (radians) : cible et valeur amortie, ajoutées à la pose de l'objet. */
  private tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  constructor(private canvas: HTMLCanvasElement, private def: RetroDef, private fps = 30) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, depth: true, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL indisponible");
    this.gl = gl;
    this.program = this.link();
    this.attrs = {
      pos: gl.getAttribLocation(this.program, "aPos"),
      nor: gl.getAttribLocation(this.program, "aNor"),
      uv: gl.getAttribLocation(this.program, "aUv"),
    };
    const program = this.program;
    this.loc = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<Uniform, WebGLUniformLocation | null>;
    this.parts = def.parts.map((p) => this.upload(p.mesh, p.texture, p.alpha ?? 1));
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  }

  private link(): WebGLProgram {
    const gl = this.gl, p = gl.createProgram()!;
    gl.attachShader(p, this.shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "programme");
    return p;
  }

  private upload(mesh: RetroDef["parts"][number]["mesh"], source: HTMLCanvasElement, alpha: number): GpuPart {
    const gl = this.gl;
    const buf = (target: number, data: ArrayBufferView) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return {
      buffers: {
        pos: buf(gl.ARRAY_BUFFER, mesh.positions),
        nor: buf(gl.ARRAY_BUFFER, mesh.normals),
        uv: buf(gl.ARRAY_BUFFER, mesh.uvs),
        idx: buf(gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
      },
      count: mesh.indices.length,
      texture,
      alpha,
    };
  }

  /** Dessine l'objet à l'instant t (secondes). */
  render(t: number): void {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const view = lookAt(this.eye, [0, 0, 0]);
    gl.uniformMatrix4fv(this.loc.uViewProj, false, multiply(perspective(0.42, w / h, 0.1, 40), view));
    // Amorti à chaque image (≈ 0,35 s pour rejoindre la cible à 30 i/s) ; borné par setTilt.
    this.tilt.x += (this.tilt.tx - this.tilt.x) * 0.12;
    this.tilt.y += (this.tilt.ty - this.tilt.y) * 0.12;
    let model = this.tilt.x || this.tilt.y ? multiply(multiply(rotationX(this.tilt.x), rotationY(this.tilt.y)), this.def.pose(t)) : this.def.pose(t);
    if (this.hop >= 0) {
      const k = (t - this.hop) / 0.6;
      if (k >= 0 && k < 1) model = multiply(translation(0, Math.sin(k * Math.PI) * 0.5 * (1 - k * 0.35), 0), multiply(rotationZ(Math.sin(k * Math.PI * 2) * 0.12), model));
      else if (k >= 1) this.hop = -1;
    }
    gl.uniformMatrix4fv(this.loc.uModel, false, model);
    gl.uniformMatrix3fv(this.loc.uNormal, false, normalMatrix(model));
    gl.uniform2f(this.loc.uSnap, w / 2, h / 2);
    gl.uniform3f(this.loc.uEye, this.eye[0], this.eye[1], this.eye[2]);
    gl.uniform1i(this.loc.uTex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const draw = (p: GpuPart) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, p.buffers.pos);
      gl.enableVertexAttribArray(this.attrs.pos);
      gl.vertexAttribPointer(this.attrs.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.buffers.nor);
      gl.enableVertexAttribArray(this.attrs.nor);
      gl.vertexAttribPointer(this.attrs.nor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, p.buffers.uv);
      gl.enableVertexAttribArray(this.attrs.uv);
      gl.vertexAttribPointer(this.attrs.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.buffers.idx);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.texture);
      gl.uniform1f(this.loc.uAlpha, p.alpha);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_SHORT, 0);
    };
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const p of this.parts) if (p.alpha >= 1) draw(p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const p of this.parts) if (p.alpha < 1) draw(p);
    gl.depthMask(true);
  }

  /**
   * Réveille l'objet : il tourne `ms` millisecondes (au moins), puis se pose en ralentissant (SETTLE_MS) et la boucle
   * s'arrête. Boucle limitée à `fps` images par seconde ; le temps ne s'écoule que pendant la lecture.
   */
  wake(ms = 4000): void {
    this.settleAt = Math.max(this.settleAt, performance.now() + ms);
    this.alignClock = this.decayFrom = -1;
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = now - this.last;
      if (dt < 1000 / this.fps - 2) return;
      this.last = now;
      // Se poser : tourner jusqu'à l'angle de repos (l'affiche, à une période près), puis la vitesse du temps décroît
      // en douceur (sortie quadratique) de 1 à 0.
      let k = 0;
      if (now >= this.settleAt) {
        if (this.decayFrom < 0) {
          if (this.alignClock < 0) this.alignClock = this.restStart(this.clock);
          if (this.clock >= this.alignClock) this.decayFrom = now;
        }
        if (this.decayFrom >= 0) k = Math.min(1, (now - this.decayFrom) / RetroRenderer.SETTLE_MS);
      }
      this.clock += (Math.min(dt, 100) / 1000) * (1 - k) * (1 - k);
      this.render(this.clock);
      const tiltPose = Math.abs(this.tilt.tx - this.tilt.x) < 0.002 && Math.abs(this.tilt.ty - this.tilt.y) < 0.002;
      if (k >= 1 && tiltPose && this.hop < 0) this.stop();
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Lecture (arrivée à l'écran, onglet de nouveau affiché) : quelques secondes de mouvement, puis le repos. */
  start(): void {
    this.wake();
  }

  /** Angle de repos : l'instant de l'affiche (même pose que l'image fixe), à une période de rotation près. */
  setRest(t: number): void {
    this.restT = t;
  }

  /** Horloge où commencer le ralenti pour finir à l'angle de repos (au plus tôt maintenant). */
  private restStart(clock: number): number {
    const p = this.def.period;
    if (!p || this.restT === null) return clock;
    const first = this.restT - RetroRenderer.SETTLE_ADVANCE;
    return first + Math.max(0, Math.ceil((clock - first) / p)) * p;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private hop = -1;
  /**
   * Petit bond, une seule fois (V3.5 : cookie du consentement accepté) : 0,6 s, montée puis retombée amortie. Sans
   * boucle en cours (mouvement réduit), rien ne bouge.
   */
  bounce(): void {
    this.hop = this.clock;
    this.wake(1600);
  }

  /** Oriente doucement l'objet vers le pointeur : -1 → 1 sur chaque axe (au plus ±0,26 rad en lacet, ±0,14 rad en tangage). */
  setTilt(nx: number, ny: number): void {
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    this.tilt.ty = c(nx) * 0.26;
    this.tilt.tx = c(ny) * 0.14;
    this.wake(2500);
  }

  /** Image fixe (mouvement réduit, affiche) à un instant choisi. */
  still(t: number): void {
    this.clock = t;
    this.render(t);
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;
    for (const p of this.parts) {
      for (const b of Object.values(p.buffers)) gl.deleteBuffer(b);
      gl.deleteTexture(p.texture);
    }
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
