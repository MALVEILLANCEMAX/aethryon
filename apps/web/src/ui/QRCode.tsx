// QR code en SVG React (uqr, MIT) : aucun canvas, aucune data: URI (compatible avec la CSP).
import { useMemo } from "react";
import { encode } from "uqr";

export function QRCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const { data, size: count } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, n: count };
  }, [value]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className="rounded-[10px] bg-white p-0">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#0b0d12" />
    </svg>
  );
}
