// QR code « ordinateur → iPhone » : sur ordinateur, on ne peut pas installer le raccourci ; ce code, scanné
// avec l'appareil photo de l'iPhone, ouvre le guide d'installation sur le téléphone. Matrice calculée dans
// le navigateur (uqr, licence MIT), dessinée en un seul tracé SVG : aucune image, aucun service externe,
// compatible avec la CSP. Zone de silence de 4 modules (norme ISO/IEC 18004), modules obsidienne sur fond
// ivoire pur pour un contraste maximal. Le texte et le lien donnent la même chose sans appareil photo.
import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "../lib/cn.ts";

const QUIET = 4;

/** Tracé SVG des modules sombres (un rectangle par série horizontale de modules). */
function qrPath(data: boolean[][]): string {
  let d = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += `M${x + QUIET} ${y + QUIET}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return d;
}

export function InstallQr({ url, className }: { url: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(url, { ecc: "M", border: 0 });
    return { path: qrPath(qr.data), size: qr.size + QUIET * 2 };
  }, [url]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size * 4}
      height={size * 4}
      role="img"
      aria-label={`QR code vers ${url.replace(/^https?:\/\//, "")}`}
      shapeRendering="crispEdges"
      className={cn("rounded-[14px] bg-[#fff]", className)}
      data-qr={url}
    >
      <path d={path} fill="#0F0F10" />
    </svg>
  );
}
