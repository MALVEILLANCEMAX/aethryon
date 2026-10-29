// La chouette d'AETHRYON en pixel art (2026-10-29, demandes du propriétaire : « une chouette aethryon dans la DA de
// Datenshi, qui bouge en mode pixel », puis « plusieurs émotions, qu'elle soit animée ») : la chouette maître traduite
// point par point — écusson aux aigrettes, sommet champagne, face ivoire, grands yeux noirs en amande avec leur reflet,
// bec bicolore — sur un petit corps aux ailes brunes, les pattes dorées posées sur le bord du champ. 20 × 20 points,
// SVG net (crispEdges), couleurs fixes comme une icône.
// Émotions (`humeur`, choisie par la page d'après ce qui se passe VRAIMENT) : neutre, curieuse (elle regarde le champ),
// contente, joie (fichier prêt : joues, cœur, étincelles), surprise (« ! »), réfléchit (« … »), concentrée (elle hoche
// la tête pendant la conversion), triste (erreur : sourcils, larme), perplexe (« ? » : lien non reconnu), clin d'œil,
// endormie (« z »). Vivante : ses yeux suivent le pointeur, elle cligne, sourit au survol, réagit quand on la touche,
// s'endort après un long moment sans rien faire et se réveille en sursaut. Tout bouge par sauts d'un point, en courtes
// séquences JS (aucune animation CSS sans fin), seulement à l'écran et onglet visible ; en mouvement réduit, l'émotion
// reste lisible (yeux, bulle) mais rien ne bouge.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCalm } from "../../lib/hooks.ts";

export type Humeur = "neutre" | "curieuse" | "contente" | "joie" | "surprise" | "reflechit" | "concentree" | "triste" | "perplexe" | "clin" | "endormie";

const COULEURS: Record<string, string> = {
  C: "#dcc59f", c: "#b8996b", I: "#f4eee3", M: "#e5d6bb", E: "#141210", W: "#ffffff", O: "#d4ab68", D: "#8d6a39",
  B: "#a7895d", b: "#7c6342", G: "#c9a35f", w: "#8a6f4a", v: "#6b5537", k: "#4a3b2a",
  R: "#e9a497", T: "#8fc4ea", H: "#e47f86", Y: "#f3dc9c", // joues, larme, cœur, étincelle
};
// Moitié gauche (colonnes 0 à 9) ; la droite est son miroir, puis le bec est posé à part. Les yeux (E, W) sont redessinés
// selon l'émotion : sous eux, la face.
const GAUCHE = [
  "..C.......",
  "..CC......",
  "..CcC.....",
  "..CccCCCCC",
  ".CCCCCCCCC",
  ".CCIIIIICC",
  ".CIIIIIIIC",
  "CIIIEEEIIC",
  "CIIEEWEEIC",
  "CIIIEEEEIO",
  "CIIIIIIIIO",
  ".CMMMMMMMD",
  "..CMMMMMMM",
  "...CBBBBBB",
  "...BBBMMMM",
  "...BBMMMMM",
  "...BBBMMMM",
  "....BBBMMM",
  ".....BBBBB",
  "......GG..",
];
// Ailes (calques animés) : points de l'aile gauche, [x, y, couleur] ; la droite en miroir.
const AILE: Px[] = [
  [2, 13, "w"], [1, 14, "w"], [2, 14, "v"], [1, 15, "w"], [2, 15, "v"], [1, 16, "w"], [2, 16, "w"], [2, 17, "v"], [3, 17, "w"], [3, 18, "v"],
];
type Px = [number, number, string];

// Yeux : 5 × 4 points (rangées 6 à 9), œil gauche ; le droit est son miroir. E noir, W reflet, k paupière.
const YEUX = {
  ouvert: [".....", ".EEE.", "EEWEE", ".EEEE"],
  ferme: [".....", ".....", "kkkkk", "....."],
  rieur: [".....", ".EEE.", "E...E", "....."],
  rond: [".EEE.", "EWWEE", "EEEEE", ".EEE."],
  trait: [".....", ".....", "EEEEE", "....."],
  dort: [".....", ".....", "E...E", ".EEE."],
  triste: [".....", "..EEE", ".EEWE", "EEEE."], // coin extérieur tombant
  decide: [".....", "EEE..", "EEWEE", ".EEEE"], // coin intérieur baissé
} as const;
type Oeil = keyof typeof YEUX;
type Bulle = "!" | "?" | "…" | "z" | "♥";
type Spec = {
  g: Oeil; d?: Oeil; regard?: [number, number]; sourcils?: "triste" | "fronce"; joues?: boolean; bulle?: Bulle;
  etincelles?: boolean; larme?: boolean; tete?: "hoche" | "respire" | [number, number]; cligne?: boolean;
};
const HUMEURS: Record<Humeur, Spec> = {
  neutre: { g: "ouvert", cligne: true },
  curieuse: { g: "ouvert", regard: [-1, 1], cligne: true },
  contente: { g: "rieur" },
  joie: { g: "rieur", joues: true, bulle: "♥", etincelles: true },
  surprise: { g: "rond", bulle: "!" },
  reflechit: { g: "ouvert", regard: [1, -1], bulle: "…", cligne: true },
  concentree: { g: "decide", sourcils: "fronce", bulle: "…", tete: "hoche" },
  triste: { g: "triste", regard: [0, 1], sourcils: "triste", larme: true, cligne: true },
  perplexe: { g: "trait", d: "rond", bulle: "?", tete: [1, 0] },
  clin: { g: "rieur", d: "ouvert", joues: true },
  endormie: { g: "dort", bulle: "z", tete: "respire" },
};
// Cadence des images (ms) et nombre d'images pour les émotions animées ; les autres sont immobiles entre deux gestes.
const CADENCE: Partial<Record<Humeur, [number, number]>> = {
  joie: [200, 10], triste: [260, 16], reflechit: [320, Infinity], concentree: [320, Infinity], endormie: [650, Infinity],
};
const SOURCILS: Record<"triste" | "fronce", [number, number][]> = {
  triste: [[3, 6], [4, 6], [5, 6], [6, 5], [7, 5]],
  fronce: [[3, 5], [4, 5], [5, 6], [6, 6], [7, 6]],
};
const ETINCELLES: [number, number][] = [[-4, 5], [24, 9], [-3, 14], [22, 15]];
const REACTIONS: Humeur[] = ["joie", "clin", "surprise", "contente"];

function sprite() {
  const tete: Px[] = [], corps: Px[] = [];
  GAUCHE.forEach((ligne, y) => {
    for (let x = 0; x < 10; x++) {
      const k = ligne[x]!;
      if (k === ".") continue;
      for (const xx of [x, 19 - x]) {
        let col = k === "E" || k === "W" ? "I" : k;
        if (xx === 10 && (y === 9 || y === 10)) col = "D"; // bec : clair à gauche, sombre à droite
        (y <= 12 ? tete : corps).push([xx, y, col]);
      }
    }
  });
  return { tete, corps };
}

function oeil(o: Oeil, x0: number, miroir: boolean): Px[] {
  const px: Px[] = [];
  YEUX[o].forEach((r, j) => { for (let i = 0; i < 5; i++) { const k = r[miroir ? 4 - i : i]!; if (k !== ".") px.push([x0 + i, 6 + j, k]); } });
  return px;
}
const miroir = (px: [number, number][], c: string): Px[] => px.flatMap(([x, y]) => [[x, y, c], [19 - x, y, c]] as Px[]);

function glyphe(motif: string[], x0: number, y0: number, c: string): Px[] {
  const px: Px[] = [];
  motif.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "X") px.push([x0 + i, y0 + j, c]); });
  return px;
}
/** Une ombre d'un point en bas à droite : la bulle se lit sur fond clair comme sur fond sombre. */
function ombre(px: Px[]): Px[] {
  const pris = new Set(px.map(([x, y]) => `${x},${y}`));
  return [...px.map(([x, y]) => [x + 1, y + 1, "D"] as Px).filter(([x, y]) => !pris.has(`${x},${y}`)), ...px];
}
// Bulles à droite de la tête (au-dessus, il y a la phrase de l'accueil).
function bulle(b: Bulle, f: number, calme: boolean): Px[] {
  switch (b) {
    case "!": return ombre(glyphe(["X", "X", "X", ".", "X"], 21, -2, "O"));
    case "?": return ombre(glyphe(["XXX", "..X", ".X.", "...", ".X."], 21, -2, "O"));
    case "♥": return ombre(glyphe([".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."], 21, -3, "H"));
    case "…": return ombre(([[21, 3, "O"], [23, 1, "O"], [25, -1, "O"]] as Px[]).slice(0, calme ? 3 : 1 + (f % 3)));
    case "z": {
      const z = [glyphe(["XXX", ".X.", "X..", "XXX"], 21, 1, "C"), glyphe(["XXX", ".X.", "X..", "XXX"], 24, -4, "C"), glyphe(["XXXX", "..X.", ".X..", "X...", "XXXX"], 28, -10, "C")];
      return ombre(z.slice(0, calme ? 3 : 1 + (f % 3)).flat());
    }
  }
}
/** Chacune scintille à son tour (croix, puis un point) : neuf images, puis plus rien. */
function etincelles(f: number): Px[] {
  const px: Px[] = [];
  ETINCELLES.forEach(([x, y], i) => {
    const t = f - i * 2;
    if (t === 0 || t === 1) px.push([x, y - 1, "Y"], [x - 1, y, "Y"], [x, y, "W"], [x + 1, y, "Y"], [x, y + 1, "Y"]);
    else if (t === 2) px.push([x, y, "Y"]);
  });
  return px;
}

/** Rectangles fusionnés par rangée et par couleur (moins de nœuds). */
function Rects({ px }: { px: Px[] }) {
  const runs: { x: number; y: number; w: number; c: string }[] = [];
  const tri = [...px].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y, c] of tri) {
    const last = runs[runs.length - 1];
    if (last && last.y === y && last.c === c && last.x + last.w === x) last.w++;
    else runs.push({ x, y, w: 1, c });
  }
  return <>{runs.map((r) => <rect key={`${r.x}-${r.y}-${r.c}`} x={r.x} y={r.y} width={r.w} height={1} fill={COULEURS[r.c]} />)}</>;
}

export function ChouettePixel({ humeur = "neutre", saut = 0, taille = 52, vivante = true, className = "" }: {
  humeur?: Humeur;
  /** Change de valeur : un saut et quelques battements d'ailes (un lien arrive, le fichier est prêt). */
  saut?: number;
  taille?: number;
  /** Yeux qui suivent le pointeur, survol, toucher, sommeil ; faux pour une image figée (avatar). */
  vivante?: boolean;
  className?: string;
}) {
  const calm = useCalm();
  const { tete: teteBase, corps } = useMemo(sprite, []);
  const aileD = useMemo(() => AILE.map(([x, y, c]) => [19 - x, y, c] as Px), []);
  const ref = useRef<HTMLSpanElement>(null);
  const vu = useRef(true);
  const [cligne, setCligne] = useState(false);
  const [haut, setHaut] = useState(0);
  const [aile, setAile] = useState(0);
  const [suivi, setSuivi] = useState<[number, number]>([0, 0]);
  const [coup, setCoup] = useState<[number, number] | null>(null);
  const [survol, setSurvol] = useState(false);
  const [dort, setDort] = useState(false);
  const [reaction, setReaction] = useState<Humeur | null>(null);
  const [f, setF] = useState(0);
  const touches = useRef(0);

  const effective: Humeur = reaction ?? (dort ? "endormie" : survol && (humeur === "neutre" || humeur === "curieuse") ? "contente" : humeur);
  const spec = HUMEURS[effective];
  const etat = useRef({ humeur, effective, dort });
  etat.current = { humeur, effective, dort };

  // Minuteries des courtes séquences, toutes annulées au démontage.
  const minuteries = useRef(new Set<number>());
  const apres = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { minuteries.current.delete(id); fn(); }, ms);
    minuteries.current.add(id);
  };
  useEffect(() => () => { minuteries.current.forEach((id) => window.clearTimeout(id)); }, []);
  const suite = (set: (v: number) => void, valeurs: number[], pas: number) => valeurs.forEach((v, i) => apres(() => set(v), i * pas));
  const sauter = () => suite(setHaut, [-1, -3, -2, 0], 80);
  const battre = () => suite(setAile, [1, 0, 1, 0, 1, 0], 110);
  const jeton = useRef(0);
  const reagir = (h: Humeur, ms: number) => { const n = ++jeton.current; setReaction(h); apres(() => { if (jeton.current === n) setReaction(null); }, ms); };

  // Une émotion qui arrive de la page efface le sommeil et les réactions en cours.
  useEffect(() => { setDort(false); setReaction(null); }, [humeur]);
  // Un lien arrive, le fichier est prêt : un saut et quelques battements d'ailes.
  useEffect(() => { if (saut && !calm) { sauter(); battre(); } }, [saut, calm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (effective === "joie" && !calm) battre(); }, [effective, calm]); // eslint-disable-line react-hooks/exhaustive-deps

  // À l'écran ?
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { vu.current = e.some((x) => x.isIntersecting); });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Images des émotions animées (bulle « … », « z », hochement, étincelles, larme) : un compteur, arrêté à la limite.
  const [periode, limite] = calm ? [0, 0] : CADENCE[effective] ?? [0, 0];
  useEffect(() => {
    setF(0);
    if (!periode) return;
    let n = 0;
    const iv = window.setInterval(() => {
      if (!vu.current || document.hidden) return;
      n += 1;
      setF(n);
      if (n >= limite) window.clearInterval(iv);
    }, periode);
    return () => window.clearInterval(iv);
  }, [effective, periode, limite]);

  // Clignements de temps en temps (et un battement, un regard de côté plus rarement).
  useEffect(() => {
    if (calm || !vivante) return;
    let t = 0;
    let tour = 0;
    const suivant = () => {
      t = window.setTimeout(() => {
        if (vu.current && !document.hidden && !etat.current.dort) {
          tour += 1;
          setCligne(true);
          apres(() => setCligne(false), 140);
          if (tour % 3 === 0) apres(() => { setCligne(true); apres(() => setCligne(false), 120); }, 300);
          const calme = etat.current.effective === "neutre" || etat.current.effective === "curieuse";
          if (tour % 4 === 0 && calme) battre();
          if (tour % 5 === 2 && etat.current.effective === "neutre") { setCoup([-1, 0]); apres(() => setCoup([1, 0]), 650); apres(() => setCoup(null), 1300); }
        }
        suivant();
      }, 3200 + Math.random() * 3200);
    };
    suivant();
    return () => window.clearTimeout(t);
  }, [calm, vivante]); // eslint-disable-line react-hooks/exhaustive-deps

  // Les yeux suivent le pointeur (souris), à un point près dans chaque direction.
  useEffect(() => {
    if (calm || !vivante || !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0, px = 0, py = 0;
    const lire = () => {
      raf = 0;
      const el = ref.current;
      if (!el || !vu.current) return;
      const r = el.getBoundingClientRect();
      const vx = px - (r.left + r.width / 2), vy = py - (r.top + r.height * 0.42);
      const nx = vx > r.width * 0.6 ? 1 : vx < -r.width * 0.6 ? -1 : 0;
      const ny = vy > r.height * 0.6 ? 1 : vy < -r.height * 0.9 ? -1 : 0;
      setSuivi((o) => (o[0] === nx && o[1] === ny ? o : [nx, ny]));
    };
    const bouge = (e: PointerEvent) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(lire); };
    window.addEventListener("pointermove", bouge, { passive: true });
    return () => { window.removeEventListener("pointermove", bouge); if (raf) cancelAnimationFrame(raf); };
  }, [calm, vivante]);

  // Sommeil : 45 s sans rien faire, page au repos ; le moindre geste la réveille en sursaut.
  useEffect(() => {
    if (calm || !vivante) return;
    let derniere = Date.now();
    const actif = () => {
      derniere = Date.now();
      if (etat.current.dort) { setDort(false); reagir("surprise", 900); sauter(); battre(); }
    };
    const noms = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    noms.forEach((n) => window.addEventListener(n, actif, { passive: true }));
    const iv = window.setInterval(() => {
      const e = etat.current;
      if (!e.dort && e.humeur === "neutre" && e.effective === "neutre" && vu.current && !document.hidden && Date.now() - derniere > 45_000) setDort(true);
    }, 5000);
    return () => { noms.forEach((n) => window.removeEventListener(n, actif)); window.clearInterval(iv); };
  }, [calm, vivante]); // eslint-disable-line react-hooks/exhaustive-deps

  const toucher = () => {
    if (!vivante) return;
    const h = REACTIONS[touches.current++ % REACTIONS.length]!;
    reagir(h, 1600);
    if (!calm) { sauter(); battre(); }
  };

  const fermes = cligne && spec.cligne;
  const regard = spec.regard ?? (effective === "neutre" ? coup ?? suivi : [0, 0]);
  const tete: [number, number] = Array.isArray(spec.tete) ? spec.tete
    : spec.tete === "hoche" && !calm ? [0, f % 4 === 2 ? 1 : 0]
    : spec.tete === "respire" && !calm ? [0, f % 4 >= 2 ? 1 : 0]
    : [0, 0];
  const yeux = [...oeil(fermes ? "ferme" : spec.g, 3, false), ...oeil(fermes ? "ferme" : spec.d ?? spec.g, 12, true)];
  // Larme : une goutte de deux points qui tombe le long de la joue, deux fois.
  const larme = spec.larme && (calm ? [[2, 10, "T"], [2, 11, "T"]] as Px[] : f < 16 && f % 8 < 3 ? [[2, 10 + (f % 8), "T"], [2, 11 + (f % 8), "T"]] as Px[] : null);

  return (
    <span ref={ref} className={`ac-chouette ${className}`} data-humeur={effective} aria-hidden="true">
      <svg viewBox="0 0 20 20" width={taille} height={taille} shapeRendering="crispEdges" focusable="false" overflow="visible"
        onPointerEnter={(e) => { if (vivante && e.pointerType === "mouse") { setSurvol(true); if (!calm) battre(); } }}
        onPointerLeave={() => setSurvol(false)} onClick={toucher}>
        <g transform={haut ? `translate(0 ${haut})` : undefined}>
          <g transform={aile ? "translate(-1 -2)" : undefined}><Rects px={AILE} /></g>
          <g transform={aile ? "translate(1 -2)" : undefined}><Rects px={aileD} /></g>
          <Rects px={corps} />
          <g transform={tete[0] || tete[1] ? `translate(${tete[0]} ${tete[1]})` : undefined}>
            <Rects px={teteBase} />
            {spec.joues && <Rects px={miroir([[2, 10], [3, 10]], "R")} />}
            <g transform={regard[0] || regard[1] ? `translate(${regard[0]} ${regard[1]})` : undefined}><Rects px={yeux} /></g>
            {spec.sourcils && <Rects px={miroir(SOURCILS[spec.sourcils], "v")} />}
            {larme && <Rects px={larme} />}
          </g>
          {spec.bulle && <Rects px={bulle(spec.bulle, f, calm)} />}
        </g>
        {spec.etincelles && !calm && <Rects px={etincelles(f)} />}
      </svg>
    </span>
  );
}
