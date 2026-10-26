// Médias encore gardés sur le serveur pour ce compte (liens ouverts, fichiers importés, exports), avec le temps qu'il
// leur reste. Rien n'est conservé au-delà : la liste vient du serveur qui les garde, pas d'un historique local.
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { IconDownload, IconFilm, IconTrash } from "../ui/Icon.tsx";
import { deleteJob, type ToolsJob } from "./api.ts";
import { bytes, duration, PLATFORM_NAME, remaining } from "./format.ts";
import { IconUpload, IconWave } from "./icons.tsx";

const OP: Record<string, string> = { video: "Vidéo", audio: "Son", gif: "GIF", compress: "Compressé" };

/** Format lisible (MP4, MP3…) tiré du nom du fichier : deux conversions d'un même lien se distinguent. */
function formatOf(j: ToolsJob): string | null {
  const m = /\.([a-z0-9]{2,4})$/i.exec(j.filename ?? j.upload?.name ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export function Recents({ items, loading, reload, keepH, keepMaxH }: { items: ToolsJob[] | null; loading: boolean; reload(): Promise<void>; keepH: number; keepMaxH: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // suppression demandée, à confirmer (média ET exports)
  const sources = (items ?? []).filter((j) => j.kind !== "derive" && (j.status !== "error" || j.kind === "upload"));
  const exportsOf = (id: string) => (items ?? []).filter((j) => j.kind === "derive" && j.derive?.sourceId === id && j.status === "done"
    && j.derive?.op !== "echantillon" && j.derive?.op !== "apercu");
  const remove = async (id: string) => { setBusy(id); try { await deleteJob(id); await reload(); } finally { setBusy(null); } };

  return (
    <section aria-labelledby="outils-recents" className="section-pearl outils-recents" data-recents="">
      <div className="container-site">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="outils-recents" className="outils-h2">Tes médias</h2>
          <p className="text-[14px] text-muted">Gardés {keepH}&nbsp;h après ta dernière action, {keepMaxH}&nbsp;h au plus.</p>
        </div>
        {loading && !items ? <div className="recent-skeleton" aria-busy="true" />
          : sources.length === 0 ? <p className="recent-empty">Rien pour l'instant&nbsp;: colle un lien ou importe un fichier pour commencer.</p>
          : (
            <ul className="recent-list">
              {sources.map((j) => {
                const uploading = j.kind === "upload" && j.stage === "uploading";
                const working = !uploading && (j.status === "queued" || j.status === "running");
                const done = j.status === "done";
                const outs = exportsOf(j.id);
                return (
                  <li key={j.id} className={cn("recent", uploading && "is-paused")} data-recent={j.status ?? ""}>
                    <div className="recent-main">
                      <span className="recent-ico" aria-hidden="true">{uploading ? <IconUpload size={18} /> : j.media && !j.media.has_video ? <IconWave size={18} /> : <IconFilm size={18} />}</span>
                      <div className="min-w-0">
                        <p className="recent-title" title={j.title ?? j.upload?.name ?? undefined}>{j.title ?? j.upload?.name ?? "Média"}</p>
                        <p className="recent-meta">
                          {PLATFORM_NAME[j.platform ?? ""] ?? j.platform}
                          {formatOf(j) ? ` · ${formatOf(j)}` : ""}
                          {j.media?.duration ? ` · ${duration(j.media.duration)}` : ""}
                          {j.sizeBytes ? ` · ${bytes(j.sizeBytes)}` : ""}
                          {uploading ? " · envoi interrompu" : working ? ` · en préparation ${Math.round(j.progress ?? 0)} %` : ""}
                          {j.status === "error" ? ` · ${j.message ?? "échec"}` : ""}
                          {done && j.expiresAt ? ` · ${remaining(j.expiresAt)}` : ""}
                        </p>
                      </div>
                      <div className="recent-actions">
                        {confirm === j.id ? (
                          <>
                            <span className="recent-confirm" role="status">{outs.length ? `Supprimer aussi ${outs.length === 1 ? "son export" : `ses ${outs.length} exports`}\u00a0?` : "Supprimer\u00a0?"}</span>
                            <button type="button" className="recent-yes" onClick={() => { setConfirm(null); void remove(j.id); }}>Supprimer</button>
                            <button type="button" className="recent-no" onClick={() => setConfirm(null)} autoFocus>Garder</button>
                          </>
                        ) : (
                          <>
                            {(done || working || uploading) && <Link to={`/outils/studio/${encodeURIComponent(j.id)}`} className="recent-open">{uploading ? "Reprendre" : "Ouvrir"}</Link>}
                            <button type="button" className="recent-del" onClick={() => setConfirm(j.id)} disabled={busy === j.id} aria-label={`Supprimer ${j.title ?? j.upload?.name ?? "ce média"}`}><IconTrash size={17} /></button>
                          </>
                        )}
                      </div>
                    </div>
                    {outs.length > 0 && (
                      <ul className="recent-outs" aria-label="Exports">
                        {outs.map((o) => (
                          <li key={o.id} className="recent-out">
                            <span className="recent-out-kind">{OP[String(o.derive?.op)] ?? "Export"}</span>
                            <span className="truncate">{o.filename}</span>
                            <span className="recent-out-size tabular">{bytes(o.sizeBytes)}</span>
                            {o.fileUrl && <a href={o.fileUrl} download className="recent-dl" aria-label={`Télécharger ${o.filename ?? ""}`}><IconDownload size={17} /></a>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
}
