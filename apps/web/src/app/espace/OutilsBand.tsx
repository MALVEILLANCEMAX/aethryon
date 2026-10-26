// Espace › AETHRYON Tools : une bande sobre qui mène aux outils, avec les médias encore gardés sur le serveur (lus
// dans /api/outils/medias ; absente si les outils ne sont pas ouverts sur ce serveur).
import { Link } from "react-router";
import { useResource } from "../../lib/store.ts";
import type { ToolsJob } from "../../outils/api.ts";
import { IconCompress, IconCrop, IconCut, IconGif, IconWave } from "../../outils/icons.tsx";
import { remaining } from "../../outils/format.ts";

export function OutilsBand() {
  const res = useResource<{ items: ToolsJob[] }>("/api/outils/medias", 30_000);
  if (res.error?.status === 404) return null;
  const sources = (res.data?.items ?? []).filter((j) => j.kind !== "derive" && j.status === "done");
  const last = sources[0];
  return (
    <section className="outils-band" aria-labelledby="outils-band-title" data-outils-band="">
      <div className="outils-band-icons" aria-hidden="true">
        <IconCut size={18} /><IconCrop size={18} /><IconWave size={18} /><IconGif size={18} /><IconCompress size={18} />
      </div>
      <div className="min-w-0">
        <h2 id="outils-band-title" className="outils-band-title">AETHRYON Tools</h2>
        <p className="outils-band-text">
          {sources.length
            ? `${sources.length === 1 ? "1 média gardé" : `${sources.length} médias gardés`}${last?.expiresAt ? ` · le dernier ${remaining(last.expiresAt)}` : ""}.`
            : "Coupe, recadre, extrais le son, fais un GIF ou compresse, depuis un lien ou un fichier."}
        </p>
      </div>
      <Link to={last ? `/outils/studio/${encodeURIComponent(last.id)}` : "/outils"} className="outils-band-go">{last ? "Reprendre" : "Ouvrir Tools"}</Link>
    </section>
  );
}
