// Monte la chouette dans une page sans React (guide de marque, aperçus) : construit le SVG depuis le graphe
// de scène de geometry.ts (createElementNS, aucun innerHTML, aucun style en ligne) puis l'anime avec
// OwlPlayer. Le composant React AthenaOwl rend exactement le même graphe.
import { owlScene, rigTransforms, stateFor, type Node, type Pose } from "./geometry.ts";
import { OwlPlayer, type PlayerOptions } from "./player.ts";

const NS = "http://www.w3.org/2000/svg";
let seq = 0;

/** Construit les éléments SVG d'un graphe (identifiants des découpes préfixés, pièces en data-part). */
export function buildNodes(nodes: Node[], prefix: string, parent: Element, initial?: ReturnType<typeof rigTransforms>) {
  for (const n of nodes) {
    const el = document.createElementNS(NS, n.tag);
    if (n.tag === "clipPath") el.setAttribute("id", prefix + (n.part ?? ""));
    else if (n.part) el.setAttribute("data-part", n.part);
    for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== undefined && k !== "data-pivot") el.setAttribute(k, String(v));
    if (n.rig) {
      el.setAttribute("data-rig", n.rig);
      const r = initial?.[n.rig];
      if (r?.transform) el.setAttribute("transform", r.transform);
      if (r?.opacity !== undefined) el.setAttribute("opacity", String(r.opacity));
    }
    if (n.clip) el.setAttribute("clip-path", `url(#${prefix}${n.clip})`);
    if (n.text) el.textContent = n.text;
    if (n.children) buildNodes(n.children, prefix, el, initial);
    parent.appendChild(el);
  }
}

export interface MountOptions extends Omit<PlayerOptions, "pose"> {
  pose?: Pose;
  /** Nom accessible ; absent : décorative. */
  label?: string;
}

/** Insère une chouette animée dans `host` (carré réservé par la page) et renvoie son lecteur. */
export function mountOwl(host: Element, o: MountOptions = {}): OwlPlayer {
  const pose = o.pose ?? "three-quarter";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 400 400");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("focusable", "false");
  if (o.label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", o.label); } else svg.setAttribute("aria-hidden", "true");
  const reduced = o.reduced ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  buildNodes(owlScene(pose), `owl${seq++}-`, svg, rigTransforms(pose, stateFor(o.expression ?? "neutral")));
  host.replaceChildren(svg);
  return new OwlPlayer(svg as SVGSVGElement, { ...o, pose, reduced });
}
