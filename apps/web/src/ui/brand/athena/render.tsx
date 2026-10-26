// Rendu React du graphe de scène de geometry.ts (mêmes éléments que l'export SVG et que mount.ts).
// Attributs SVG en camelCase pour React ; identifiants des découpes préfixés ; pièces en data-part ;
// groupes animés en data-rig avec leur transformation initiale (aucun saut au premier rendu).
import { createElement, type ReactNode } from "react";
import type { Node, RigKey, RigOut } from "./geometry.ts";

const camel = (k: string) => (k.startsWith("data-") || k.startsWith("aria-") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

export function renderNodes(nodes: Node[], prefix: string, initial?: Partial<Record<RigKey, RigOut>>): ReactNode[] {
  return nodes.map((n, i) => {
    const props: Record<string, unknown> = { key: i };
    if (n.tag === "clipPath") props.id = prefix + (n.part ?? "");
    else if (n.part) props["data-part"] = n.part;
    for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== undefined && k !== "data-pivot") props[camel(k)] = v;
    if (n.rig) {
      props["data-rig"] = n.rig;
      const r = initial?.[n.rig];
      if (r?.transform) props.transform = r.transform;
      if (r?.opacity !== undefined) props.opacity = r.opacity;
    }
    if (n.clip) props.clipPath = `url(#${prefix}${n.clip})`;
    const kids = n.text ? [n.text] : n.children ? renderNodes(n.children, prefix, initial) : [];
    return createElement(n.tag, props, ...kids);
  });
}

/** Préfixe d'identifiants sûr dans url(#…) à partir de useId(). */
export const safePrefix = (id: string, base: string) => `${base}${id.replace(/[^a-zA-Z0-9_-]/g, "")}-`;
