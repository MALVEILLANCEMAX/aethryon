// Médiathèque des exports d'un média (onglet « Exports ») : une carte compacte par fichier — vraie miniature, nom (deux
// lignes au plus), format, durée, image et poids RÉELS du fichier, état (en cours, prêt, échec, expiré), « Lire »,
// « Télécharger », menu « ⋯ » (et clic droit). « Lire » ouvre l'aperçu : la miniature grandit jusqu'au lecteur
// (transition partagée) qui lit le VRAI fichier ; Échap le referme et la miniature revient à sa place, le focus aussi.
// Miniatures : tout de suite la vignette de la planche du média (aucune requête), puis, quand la carte est visible, une
// image du fichier exporté lui-même (un appareil caché lit son début, une carte à la fois) ; un son : son onde.
// Aucune largeur imposée par une vidéo : cartes en grille minmax(0, 1fr), noms coupés proprement.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { IconCheck, IconClose, IconCopy, IconDownload, IconPlay, IconTrash } from "../ui/Icon.tsx";
import type { Storyboard, ToolsJob, Waveform } from "./api.ts";
import { bytes, dims, duration as dur, middleName, remaining, timecode } from "./format.ts";
import { IconLoop, IconMarkIn, IconMore } from "./icons.tsx";
import { kindOf, MediaPlayer, ratioOf } from "./MediaPlayer.tsx";
import { ContextZone, DropMenu, PortalTarget, type Entry } from "./menus.tsx";
import { drawTile, sprite as loadSprite } from "./thumbs.ts";
import type { ExportState } from "./useStudio.ts";

const STAGES: Record<string, string> = {
  queued: "En attente", starting: "Préparation", rendering: "Encodage", audio: "Encodage du son",
  "gif:palette": "Palette du GIF", "gif:encode": "Images du GIF", compressing: "Compression", sampling: "Échantillon",
  preview: "Finalisation", finalizing: "Finalisation", clipping: "Découpe", converting: "Conversion",
};
const KIND: Record<string, string> = { video: "Vidéo", audio: "Son", gif: "GIF", compress: "Vidéo compressée" };

/** Format montré sur la carte : l'extension réelle du fichier. */
/** Fichier dont la durée de conservation est passée (le serveur l'efface). */
const isExpired = (iso: string | null) => !!iso && Date.parse(iso) <= Date.now();
const formatOf = (j: ToolsJob) => (j.filename?.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (j.mediaType?.split("/")[1] ?? "")).toUpperCase();
const pitchLabel = (j: ToolsJob): string | null => {
  const d = j.derive as { speed?: number; pitch?: string } | undefined;
  if (!d?.speed || d.speed === 1) return null;
  const s = `×${String(d.speed).replace(".", ",")}`;
  return d.pitch === "shift" ? (d.speed > 1 ? `Sped up ${s}` : `Slowed ${s}`) : `Vitesse ${s}`;
};

// ---- miniatures : image réelle du fichier exporté, une capture à la fois -------------------------------------------

const posters = new Map<string, HTMLCanvasElement>();
const waiting: { id: string; url: string; t: number; done(c: HTMLCanvasElement | null): void }[] = [];
let capturing = false;
function capture(id: string, url: string, t: number, done: (c: HTMLCanvasElement | null) => void) {
  const known = posters.get(id);
  if (known) { done(known); return; }
  waiting.push({ id, url, t, done });
  pump();
}
function pump() {
  if (capturing) return;
  const job = waiting.shift();
  if (!job) return;
  capturing = true;
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  let over = false;
  const end = (c: HTMLCanvasElement | null) => {
    if (over) return;
    over = true;
    window.clearTimeout(timer);
    v.removeAttribute("src");
    v.load();
    capturing = false;
    job.done(c);
    pump();
  };
  const timer = window.setTimeout(() => end(null), 8000);
  v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(job.t, Math.max(0, (v.duration || 1) / 2)); }, { once: true });
  v.addEventListener("seeked", () => {
    if (!v.videoWidth) { end(null); return; }
    const c = document.createElement("canvas");
    c.width = Math.min(360, v.videoWidth);
    c.height = Math.max(1, Math.round((c.width * v.videoHeight) / v.videoWidth));
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    posters.set(job.id, c);
    end(c);
  }, { once: true });
  v.addEventListener("error", () => end(null), { once: true });
  v.src = job.url;
}

/** Dessine `src` (image ou toile) en « contain » dans la toile `cv`. */
function contain(cv: HTMLCanvasElement, src: CanvasImageSource & { width: number; height: number }) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h || !src.width || !src.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const s = Math.min(w / src.width, h / src.height);
  g.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
}

function Thumb({ job, board, boardUrl, wave, sourceDuration, visible }: {
  job: ToolsJob; board: Storyboard | null; boardUrl: string | null; wave: Waveform | null; sourceDuration: number; visible: boolean;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const kind = kindOf(job);
  const start = Number(job.derive?.start_s ?? 0);
  const len = Number(job.derive?.duration_s ?? 0) || (job.media?.duration ?? 0);
  useLayoutEffect(() => {
    const c = cv.current;
    if (!c) return;
    if (kind === "audio") {
      // Onde du passage exporté, tirée de l'onde de la source (aucune requête).
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#d4af7c";
      const peaks = wave?.peaks ?? [];
      let max = 1;
      for (const x of peaks) if (x > max) max = x;
      for (let x = 6; x < w - 6; x += 4) {
        let amp = 0.25;
        if (peaks.length && sourceDuration) {
          const a = Math.floor(((start + (len * (x - 6)) / (w - 12)) / sourceDuration) * peaks.length);
          const z = Math.max(a + 1, Math.floor(((start + (len * (x - 2)) / (w - 12)) / sourceDuration) * peaks.length));
          let pk = 0;
          for (let i = a; i < z && i < peaks.length; i++) if (peaks[i]! > pk) pk = peaks[i]!;
          amp = Math.pow(pk / max, 0.7);
        }
        const bh = Math.max(2, amp * (h - 18));
        g.fillRect(x, (h - bh) / 2, 2, bh);
      }
      return;
    }
    const known = posters.get(job.id);
    if (known) { contain(c, known); return; }
    // Tout de suite : la vignette de la planche à l'instant exporté.
    loadSprite(boardUrl, (img) => { if (cv.current && !posters.has(job.id)) drawTile(cv.current, board, img, start + Math.min(0.5, len / 2)); });
  }, [job.id, kind, board, boardUrl, wave, start, len, sourceDuration]);
  // Puis l'image réelle du fichier, quand la carte est visible (vidéo seulement ; un GIF reste léger en vignette).
  useEffect(() => {
    if (!visible || kind !== "video" || !job.streamUrl || job.status !== "done" || posters.has(job.id)) return;
    let alive = true;
    capture(job.id, job.streamUrl, 0.5, (c) => { if (alive && c && cv.current) contain(cv.current, c); });
    return () => { alive = false; };
  }, [visible, kind, job.id, job.streamUrl, job.status]);
  return <canvas ref={cv} className={cn("lib-cv", kind === "audio" && "is-wave")} aria-hidden="true" />;
}

// ---- aperçu ---------------------------------------------------------------------------------------------------------

function Preview({ job, onClose, peaks, sourceDuration, onGone }: {
  job: ToolsJob | null; onClose(): void; peaks: readonly number[] | null; sourceDuration: number; onGone(id: string): void;
}) {
  const calm = useCalm();
  const dlg = useRef<HTMLDialogElement>(null);
  // Menus et info-bulles du lecteur : DANS la fenêtre (le reste de la page est inerte pendant un aperçu).
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const setDlg = useCallback((d: HTMLDialogElement | null) => { dlg.current = d; setEl(d); }, []);
  const frame = useRef<HTMLDivElement>(null);
  const open = !!job;
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Focus sur le lecteur lui-même (pas sur un bouton : son info-bulle prendrait le premier Échap) : Espace, flèches,
      // M et F agissent tout de suite, Tab mène aux commandes, un seul Échap ferme.
      requestAnimationFrame(() => d.querySelector<HTMLElement>("[data-player]")?.focus({ preventScroll: true }));
    } else if (!open && d.open) d.close();
  }, [open]);
  useLayoutEffect(() => {
    if (!job) return;
    frame.current?.style.setProperty("--ar", String(ratioOf(job)));
    // Un GIF (souvent 480 px de large) n'est jamais agrandi plus de deux fois : au-delà, il devient flou.
    if (kindOf(job) === "gif" && job.media?.width) frame.current?.style.setProperty("--max-w", `${Math.max(320, job.media.width * 2)}px`);
    else frame.current?.style.removeProperty("--max-w");
  }, [job]);
  const kind = job ? kindOf(job) : "video";
  const facts = job ? [formatOf(job), job.media?.duration ? dur(job.media.duration) : null, job.media?.width ? dims(job.media.width, job.media.height) : null, bytes(job.sizeBytes), pitchLabel(job)]
    .filter(Boolean).join(" · ") : "";
  return (
    <dialog ref={setDlg} className="pv-dialog" aria-label={job ? `Aperçu : ${job.filename ?? "export"}` : "Aperçu"} data-preview=""
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dlg.current) onClose(); }}>
      <PortalTarget.Provider value={el}>
        {job && (
          <div className={cn("pv", `is-${kind}`)}>
            <motion.div ref={frame} layoutId={`lib-${job.id}`} className="pv-stage" transition={calm ? { duration: 0 } : SPRING.soft}>
              <motion.div className="pv-in" initial={calm ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.18, delay: calm ? 0 : 0.12 } }}>
                <MediaPlayer job={job} autoPlay={kind !== "gif"} peaks={peaks} sourceDuration={sourceDuration} onGone={() => onGone(job.id)} />
              </motion.div>
            </motion.div>
            <motion.div className="pv-foot" initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: calm ? 0 : 0.16, ease: EASE.soft } }}>
              <div className="pv-text">
                <p className="pv-name" title={job.filename ?? undefined}>{middleName(job.filename ?? "", 80)}</p>
                <p className="pv-facts tabular">{facts}</p>
              </div>
              {job.fileUrl && <a className="pv-dl" href={job.fileUrl} download data-pv-download=""><IconDownload size={18} />Télécharger</a>}
              <button type="button" className="pv-x" onClick={onClose} aria-label="Fermer l'aperçu" data-pv-close=""><IconClose size={18} /></button>
            </motion.div>
          </div>
        )}
      </PortalTarget.Provider>
    </dialog>
  );
}

// ---- cartes -----------------------------------------------------------------------------------------------------------

function Progress({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { ref.current?.style.setProperty("--p", `${Math.max(2, Math.min(100, value))}%`); }, [value]);
  return <span ref={ref} className="lib-bar" aria-hidden="true"><span className="lib-fill" /></span>;
}

function Card({ x, board, boardUrl, wave, sourceDuration, previewing, gone, fresh, onPreview, onDelete, onRetry, onLocate, onCopy, onDownload }: {
  x: ExportState; board: Storyboard | null; boardUrl: string | null; wave: Waveform | null; sourceDuration: number; previewing: boolean; gone: boolean;
  /** Export lancé ici qui vient d'aboutir : liseré or, une fois. */
  fresh: boolean;
  onPreview(): void; onDelete(): void; onRetry?(): void; onLocate?(): void; onCopy(): void; onDownload(): void;
}) {
  const calm = useCalm();
  const j = x.job;
  const li = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  const [ask, setAsk] = useState(false);
  const [sent, setSent] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = li.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Demande de suppression : « Garder » a le focus ; y renoncer (Garder, Échap) le rend au bouton « ⋯ » d'où elle venait.
  const asked = useRef(false);
  useEffect(() => {
    if (ask) { asked.current = true; keep.current?.focus(); }
    else if (asked.current) { asked.current = false; li.current?.querySelector<HTMLElement>("[data-lib-more]")?.focus(); }
  }, [ask]);
  // Comme dans le Finder : la miniature tirée hors de la fenêtre y dépose le fichier (Chromium : DownloadURL, le
  // navigateur le télécharge avec la session ; ailleurs, rien ne se passe). Glisser natif, hors des gestes de Motion.
  const thumb = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = thumb.current;
    if (!el || j.status !== "done" || !j.fileUrl) return;
    const url = new URL(j.fileUrl, location.href).href;
    const start = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("DownloadURL", `${j.mediaType ?? "application/octet-stream"}:${(j.filename ?? "export").replace(/:/g, " ")}:${url}`);
      li.current?.classList.add("is-dragging");
    };
    const end = () => li.current?.classList.remove("is-dragging");
    el.addEventListener("dragstart", start);
    el.addEventListener("dragend", end);
    return () => { el.removeEventListener("dragstart", start); el.removeEventListener("dragend", end); };
  }, [j.status, j.fileUrl, j.mediaType, j.filename]);
  useEffect(() => { if (!sent) return; const t = window.setTimeout(() => setSent(false), 4000); return () => window.clearTimeout(t); }, [sent]);
  const running = j.status === "queued" || j.status === "running";
  const left = remaining(j.expiresAt);
  const expired = j.status === "done" && (isExpired(j.expiresAt) || gone);
  const ready = j.status === "done" && !expired;
  const kind = String(j.derive?.op ?? x.tool);
  const name = j.filename ?? "export";
  const meta = [formatOf(j), j.media?.duration ? dur(j.media.duration) : null, j.media?.width ? dims(j.media.width, j.media.height) : null, j.sizeBytes ? bytes(j.sizeBytes) : null]
    .filter(Boolean).join(" · ");
  const badge = pitchLabel(j);
  const menu = (): Entry[] => ready ? [
    { kind: "cmd", cmd: { id: "libPlay", label: kindOf(j) === "audio" ? "Écouter" : "Lire l'aperçu", icon: IconPlay, run: onPreview } },
    { kind: "cmd", cmd: { id: "libDownload", label: "Télécharger", icon: IconDownload, run: () => { const a = li.current?.querySelector<HTMLAnchorElement>("[data-download]"); a?.click(); } } },
    { kind: "sep" },
    ...(onLocate ? [{ kind: "cmd", cmd: { id: "libLocate", label: "Retrouver le passage dans la frise", icon: IconMarkIn, run: onLocate } } as Entry] : []),
    { kind: "cmd", cmd: { id: "libCopy", label: "Copier le nom du fichier", icon: IconCopy, run: onCopy } },
    { kind: "sep" },
    { kind: "cmd", cmd: { id: "libDelete", label: "Supprimer…", icon: IconTrash, run: () => setAsk(true) } },
  ] : [{ kind: "cmd", cmd: { id: "libDelete", label: running ? "Annuler l'export" : "Retirer", icon: IconTrash, run: onDelete } }];
  return (
    <motion.li ref={li} layout={!calm} initial={calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={calm ? { opacity: 0, transition: { duration: DUR.calm } } : { opacity: 0, scale: 0.97, transition: { duration: DUR.exit, ease: EASE.exit } }} transition={SPRING.soft}
      className={cn("lib-card", running && "is-running", j.status === "error" && "is-error", expired && "is-expired", ready && "is-ready", fresh && ready && "is-new")}
      data-export-item={expired ? "expired" : j.status ?? ""} data-export-id={j.id} data-export-kind={kind}>
      <ContextZone label={`Actions : ${name}`} entries={menu}>
        <div className="lib-inner">
        <div className="lib-row">
          <div className="lib-thumbwrap">
            {previewing ? <span className="lib-thumb is-placeholder" aria-hidden="true" /> : (
              <motion.button layoutId={`lib-${j.id}`} type="button" className={cn("lib-thumb", kindOf(j) === "audio" && "is-audio")} onClick={onPreview} disabled={!ready}
                ref={thumb} draggable={ready && !!j.fileUrl}
                aria-label={ready ? `${kindOf(j) === "audio" ? "Écouter" : "Lire"} : ${name}` : name} transition={calm ? { duration: 0 } : SPRING.soft} data-lib-play="">
                <Thumb job={j} board={board} boardUrl={boardUrl} wave={wave} sourceDuration={sourceDuration} visible={visible} />
                {running && <span className="lib-veil" aria-hidden="true" />}
                {ready && <span className="lib-play" aria-hidden="true"><IconPlay size={16} className="translate-x-px" /></span>}
              </motion.button>
            )}
            {/* Étiquettes posées sur la miniature, hors du bouton : son nom accessible reste « Lire : nom ». */}
            {!previewing && j.media?.duration ? <span className="lib-len tabular" aria-hidden="true">{timecode(j.media.duration, 0)}</span> : null}
            {!previewing && kindOf(j) === "gif" && ready && <span className="lib-gif" aria-hidden="true"><IconLoop size={12} />GIF</span>}
          </div>
          <div className="lib-body">
            <p className="lib-name" title={name}>{middleName(name, 72)}</p>
            {ready && <p className="lib-meta tabular">{meta}</p>}
            <p className={cn("lib-state", j.status === "error" && "is-error")}>
              {running ? (x.lost ? "Connexion perdue · l'export continue" : <>{STAGES[j.stage ?? ""] ?? "Traitement"} · <span className="tabular">{Math.round(j.progress ?? 0)}&nbsp;%</span></>)
                : j.status === "error" ? "Échec"
                : expired ? (gone ? "Indisponible" : "Expiré")
                : <>{KIND[kind] ?? "Fichier"} · {left}</>}
              {badge && <span className="lib-pitch">{badge}</span>}
            </p>
          </div>
        </div>
        {running && (
          <div className="lib-run">
            <Progress value={j.progress ?? 0} />
            <button type="button" className="lib-text" onClick={onDelete}>Annuler</button>
          </div>
        )}
        {j.status === "error" && (
          <div className="lib-run">
            <p className="lib-error" role="alert">{j.message ?? "L'export a échoué."}</p>
            <div className="lib-links">
              {onRetry && <button type="button" className="lib-text" onClick={onRetry}>Réessayer</button>}
              <button type="button" className="lib-text" onClick={onDelete}>Retirer</button>
            </div>
          </div>
        )}
        {expired && (
          <div className="lib-run">
            <p className="lib-note">{gone ? "Le serveur ne l'a plus : il a expiré ou il a été supprimé." : "Les fichiers sont gardés 2 h environ, puis effacés."}</p>
            <div className="lib-links"><button type="button" className="lib-text" onClick={onDelete}>Retirer</button></div>
          </div>
        )}
        {ready && (ask ? (
          <div className="lib-actions lib-confirm" role="group" aria-label={`Supprimer ${name} ?`} data-xp-confirm=""
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsk(false); } }}>
            <span className="lib-confirm-q">Supprimer ce fichier&nbsp;?</span>
            <button ref={keep} type="button" className="lib-text" onClick={() => setAsk(false)}>Garder</button>
            <button type="button" className="lib-del" onClick={onDelete} data-xp-supprimer="">Supprimer</button>
          </div>
        ) : (
          <div className="lib-actions">
            <button type="button" className="lib-btn is-primary" onClick={onPreview} data-lib-open="">
              <IconPlay size={16} className="translate-x-px" />{kindOf(j) === "audio" ? "Écouter" : "Lire"}
            </button>
            {j.fileUrl && (
              <a className={cn("lib-btn", sent && "is-sent")} href={j.fileUrl} download data-download="" aria-label={`Télécharger ${name}`} onClick={() => { setSent(true); onDownload(); }}>
                {sent ? <IconCheck size={16} /> : <IconDownload size={16} />}<span className="lib-btn-label">{sent ? "Lancé" : "Télécharger"}</span>
              </a>
            )}
            <DropMenu label={`Actions : ${name}`} entries={menu()} side="bottom" align="end"
              trigger={<button type="button" className="lib-icon" aria-label={`Plus d'actions : ${name}`} data-lib-more=""><IconMore size={18} /></button>} />
          </div>
        ))}
        </div>
      </ContextZone>
    </motion.li>
  );
}

export function Library({ items, board, boardUrl, wave, sourceDuration, onDelete, onRetry, onLocate, follow }: {
  items: ExportState[]; board: Storyboard | null; boardUrl: string | null; wave: Waveform | null; sourceDuration: number;
  onDelete(id: string): void; onRetry?(x: ExportState): void;
  /** Sélectionne dans la frise le passage d'où vient l'export. */
  onLocate?(start: number, end: number): void;
  /** Export que l'on vient de lancer : sa carte est amenée à l'écran. */
  follow?: string | null;
}) {
  const visible = items.filter((x) => x.tool !== "echantillon" && x.job.derive?.op !== "echantillon" && x.job.derive?.op !== "apercu");
  const [preview, setPreview] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [said, setSaid] = useState("");
  const list = useRef<HTMLUListElement>(null);
  // L'expiration passe sans autre événement : la liste se relit chaque demi-minute.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { const t = window.setInterval(tick, 30_000); return () => window.clearInterval(t); }, []);
  const job = preview ? visible.find((x) => x.job.id === preview)?.job ?? null : null;
  // L'export qu'on vient de lancer, puis son résultat, sont amenés dans le volet (rien ne bouge au chargement).
  const followed = follow ? visible.find((x) => x.job.id === follow) : undefined;
  const step = followed ? `${followed.job.id}:${followed.job.status}` : "";
  useEffect(() => {
    if (!step || !follow) return;
    const t = window.setTimeout(() => list.current?.querySelector<HTMLElement>(`[data-export-id="${CSS.escape(follow)}"]`)?.scrollIntoView({ block: "nearest" }), 120);
    return () => window.clearTimeout(t);
  }, [step, follow]);
  const close = () => {
    const id = preview;
    setPreview(null);
    // Le focus revient à la carte d'où l'aperçu était parti (son bouton « Lire », sinon sa miniature).
    requestAnimationFrame(() => {
      const card = id ? list.current?.querySelector<HTMLElement>(`[data-export-id="${CSS.escape(id)}"]`) : null;
      (card?.querySelector<HTMLElement>("[data-lib-open]") ?? card?.querySelector<HTMLElement>("[data-lib-play]"))?.focus({ preventScroll: true });
    });
  };
  const total = visible.filter((x) => x.job.status === "done").reduce((s, x) => s + (x.job.sizeBytes ?? 0), 0);
  const ready = visible.filter((x) => x.job.status === "done").length;
  return (
    <section className="lib" aria-labelledby="lib-title" data-exports="">
      <div className="lib-head">
        <h2 id="lib-title" className="lib-title">Exports</h2>
        {ready > 0 && <span className="lib-sum tabular">{ready} fichier{ready > 1 ? "s" : ""} · {bytes(total)}</span>}
      </div>
      <p className="sr-only" aria-live="polite" data-xp-annonce="">{said}</p>
      {visible.length ? (
        <ul className="lib-list" ref={list}>
          <AnimatePresence initial={false}>
            {visible.map((x) => {
              const j = x.job;
              const start = Number(j.derive?.start_s ?? 0);
              const length = Number(j.derive?.duration_s ?? 0);
              return (
                <Card key={j.id} x={x} board={board} boardUrl={boardUrl} wave={wave} sourceDuration={sourceDuration} previewing={preview === j.id} gone={gone.has(j.id)} fresh={j.id === follow}
                  onPreview={() => setPreview(j.id)}
                  onDelete={() => onDelete(j.id)}
                  onRetry={onRetry ? () => onRetry(x) : undefined}
                  onLocate={onLocate && length > 0 ? () => onLocate(start, start + length) : undefined}
                  onCopy={() => { void navigator.clipboard?.writeText(j.filename ?? "").then(() => setSaid(`Nom copié : ${j.filename ?? ""}.`), () => setSaid("Le presse-papiers n'est pas accessible.")); }}
                  onDownload={() => setSaid(`Téléchargement lancé : ${j.filename ?? "le fichier"}.`)} />
              );
            })}
          </AnimatePresence>
        </ul>
      ) : <p className="lib-empty">Tes exports de ce média apparaîtront ici : tu pourras les lire, puis les télécharger.</p>}
      <Preview job={job} onClose={close} peaks={wave?.peaks ?? null} sourceDuration={sourceDuration}
        onGone={(id) => setGone((g) => new Set(g).add(id))} />
    </section>
  );
}
