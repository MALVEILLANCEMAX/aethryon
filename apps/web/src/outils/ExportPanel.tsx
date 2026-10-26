// Panneau d'export qui se déploie DEPUIS le bouton qui l'a ouvert (bouton « Exporter » du haut, bouton du panneau,
// barre de la sélection, ou dépôt d'une sélection glissée) et s'y replie à la fermeture : un seul objet qui change de
// forme, sans saut de mise en page. Trois temps, chacun dans le même panneau dont la hauteur suit en douceur :
// 1. Préparation : format (vidéo, son, GIF, compressée), passage exact (début, fin, durée), ce que produira l'export,
//    taille estimée ; rien ne démarre avant « Exporter ».
// 2. Traitement : étapes réelles du serveur, pourcentage réel quand il existe, annulation réelle, « Continuer
//    l'édition » (le bouton du haut porte alors l'avancement).
// 3. Prêt : coche champagne, miniature puis aperçu du VRAI fichier, nom, durée, poids réels, « Télécharger ».
// Fenêtre modale native (<dialog>) : focus piégé, Échap, fond inerte. Mouvement réduit : fondus seuls.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { useCalm, useMe } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { IconCheck, IconClose, IconDownload, IconFilm } from "../ui/Icon.tsx";
import type { MediaInfo, Storyboard, ToolsJob, ToolsLimits } from "./api.ts";
import { exportCost } from "./cost.ts";
import { estimateSize, exportBody, exportProblem, outputDims, outputLength, type Edit, type Tool } from "./edit.ts";
import { MediaPlayer } from "./MediaPlayer.tsx";
import { PortalTarget } from "./menus.tsx";
import { bytes, bytesRange, duration as dur, middleName, remaining, spanLabel, timecode } from "./format.ts";
import { IconCompress, IconGif, IconMarkIn, IconMarkOut, IconWave } from "./icons.tsx";
import { ACTION, outputTags } from "./Inspector.tsx";
import { drawTile, sprite as loadSprite } from "./thumbs.ts";

export type PhaseExport = "preparation" | "traitement" | "pret" | "echec";
export type ExportOrigin = "top" | "foot" | "toolbar";

const PRET: Record<Tool, string> = {
  couper: "Ta vidéo est prête", recadrer: "Ta vidéo est prête", audio: "Ton son est prêt", gif: "Ton GIF est prêt", compresser: "Ta vidéo compressée est prête",
};
const ETAPES = ["Préparation", "Traitement", "Finalisation"] as const;
function etapeDe(stage: string | null, status: string | null): number {
  if (status === "queued" || !stage || stage === "queued" || stage === "starting") return 0;
  if (stage === "finalizing" || stage === "preview") return 2;
  return 1;
}

/** Formats proposés : l'outil qui produira le fichier (la vidéo garde l'outil Couper ou Recadrer en cours). */
const FORMATS: { id: "video" | "audio" | "gif" | "compresser"; label: string; Icon: typeof IconWave }[] = [
  { id: "video", label: "Vidéo", Icon: IconFilm as typeof IconWave },
  { id: "audio", label: "Son", Icon: IconWave },
  { id: "gif", label: "GIF", Icon: IconGif },
  { id: "compresser", label: "Compressée", Icon: IconCompress },
];
const formatOf = (t: Tool) => (t === "couper" || t === "recadrer" ? "video" : t);

function Coche() {
  return (
    <span className="xd-ok" aria-hidden="true">
      <span className="xd-glow" />
      <svg viewBox="0 0 64 64" className="xd-check">
        <circle cx="32" cy="32" r="28" />
        <path d="M20 33.5l8 8L45 24" />
      </svg>
    </span>
  );
}

function Anneau({ value }: { value: number | null }) {
  const fg = useRef<SVGCircleElement>(null);
  // Part réelle quand le serveur la donne (l'arc se remplit), sinon un arc qui tourne.
  useLayoutEffect(() => { if (value !== null) fg.current?.style.setProperty("--ring", String(163.4 * (1 - Math.max(0.02, Math.min(1, value / 100))))); }, [value]);
  return (
    <span className={cn("xd-ring", value !== null && "is-known")} aria-hidden="true">
      <svg viewBox="0 0 64 64"><circle className="xd-ring-bg" cx="32" cy="32" r="26" /><circle ref={fg} className="xd-ring-fg" cx="32" cy="32" r="26" /></svg>
      {value !== null && <span className="xd-ring-pct tabular">{value}<small>&nbsp;%</small></span>}
    </span>
  );
}

function Barre({ value }: { value: number | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { if (value !== null) ref.current?.style.setProperty("--p", `${Math.max(2, Math.min(100, value))}%`); }, [value]);
  return <div className="xd-bar" aria-hidden="true"><span ref={ref} className={cn("xd-fill", value === null && "is-indet")} /></div>;
}

/**
 * Miniature du passage : vignette de la planche du serveur (affichée tout de suite, avant le fichier réel) ; pour un
 * média sans image, l'onde du passage.
 */
function Miniature({ board, boardUrl, t, className, w = 112, h = 63, peaks, span, duration }: {
  board: Storyboard | null; boardUrl: string | null; t: number; className?: string; w?: number; h?: number;
  peaks?: readonly number[] | null; span?: [number, number]; duration?: number;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    if (!board?.count && peaks?.length && span && duration) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#18181a"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#d4af7c";
      let max = 1;
      for (const x of peaks) if (x > max) max = x;
      for (let x = 6; x < w - 6; x += 4) {
        const a = Math.floor(((span[0] + ((span[1] - span[0]) * (x - 6)) / (w - 12)) / duration) * peaks.length);
        const z = Math.max(a + 1, Math.floor(((span[0] + ((span[1] - span[0]) * (x - 2)) / (w - 12)) / duration) * peaks.length));
        let pk = 0;
        for (let i = a; i < z && i < peaks.length; i++) if (peaks[i]! > pk) pk = peaks[i]!;
        const bh = Math.max(2, Math.pow(pk / max, 0.7) * (h - 14));
        g.fillRect(x, (h - bh) / 2, 2, bh);
      }
      setOk(true);
      return;
    }
    loadSprite(boardUrl, (img) => { if (cv.current) setOk(drawTile(cv.current, board, img, t, { w, h })); });
  }, [board, boardUrl, t, w, h, peaks, span?.[0], span?.[1], duration]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={cv} className={cn("xm-mini", ok && "is-on", className)} aria-hidden="true" />;
}

export function ExportPanel(p: {
  open: boolean;
  origin: ExportOrigin;
  phase: PhaseExport;
  nom: string;
  tool: Tool;
  edit: Edit;
  info: MediaInfo;
  limits: ToolsLimits | null;
  job: ToolsJob | null;
  perdu: boolean;
  erreur: string | null;
  envoi: boolean;
  board: Storyboard | null;
  boardUrl: string | null;
  /** Onde de la source (lecteur d'un son exporté). */
  peaks?: readonly number[] | null;
  /** Le panneau vient d'un dépôt (sélection glissée) : dit discrètement. */
  dropped: boolean;
  usable(t: Tool): boolean;
  onTool(t: Tool): void;
  onConfirm(): void;
  onCancelJob(id: string): void;
  onClose(): void;
}) {
  const calm = useCalm();
  const dlg = useRef<HTMLDialogElement>(null);
  // Menus et info-bulles du lecteur : DANS la fenêtre modale (le reste de la page est alors inerte).
  const [dlgEl, setDlgEl] = useState<HTMLDialogElement | null>(null);
  const setDlg = useCallback((d: HTMLDialogElement | null) => { dlg.current = d; setDlgEl(d); }, []);
  const { tool, edit: e, info, job } = p;
  const [lance, setLance] = useState(false);
  useEffect(() => { setLance(false); }, [job?.id, p.phase]);
  const principal = useRef<HTMLElement | null>(null);

  // Ouverture : <dialog> modal natif ; fermeture : tout de suite (le bouton d'origine reprend la forme, voir Studio).
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (p.open && !d.open) d.showModal();
    else if (!p.open && d.open) d.close();
  }, [p.open]);
  useEffect(() => {
    if (!p.open) return;
    const t = window.setTimeout(() => principal.current?.focus({ preventScroll: true }), calm ? 40 : 260);
    return () => window.clearTimeout(t);
  }, [p.open, p.phase, calm]);

  const len = outputLength(e);
  const est = estimateSize(tool, e, info);
  const tags = outputTags(tool, e, info, outputDims(e, info, tool));
  const taille = !est ? null : est.range ? bytesRange(est.range[0], est.range[1]) : `${est.exact ? "" : tool === "compresser" ? "≤ " : "≈ "}${bytes(est.bytes)}`;
  const problem = exportProblem(tool, e, info, p.limits);
  // Minutes d'export que cet export comptera, et ce qu'il reste aujourd'hui (le serveur reste seul juge).
  const me = useMe();
  const quota = me.data?.exportMinutes ?? null;
  const cost = exportCost(exportBody(tool, e, info), info);
  const left = quota && quota.limit !== null ? Math.max(0, Math.round((quota.limit - quota.used) * 10) / 10) : null;
  const f1 = (n: number) => String(n).replace(".", ",");
  const progres = job && job.status === "running" && (job.progress ?? 0) > 0 ? Math.round(job.progress ?? 0) : null;
  const etape = etapeDe(job?.stage ?? null, job?.status ?? null);
  const annonce = p.phase === "traitement" ? (p.perdu ? "Connexion perdue. L'export continue sur le serveur." : `Export en cours : ${ETAPES[etape]}.`)
    : p.phase === "pret" ? `${PRET[tool]}. ${job?.filename ?? ""}`
    : p.phase === "echec" ? `L'export n'a pas abouti : ${p.erreur ?? job?.message ?? ""}` : "";
  const titre = p.phase === "preparation" ? ACTION[tool] : p.phase === "traitement" ? "Export en cours" : p.phase === "pret" ? `${PRET[tool]} !` : "L'export n'a pas abouti";

  // Le VRAI fichier, dans le lecteur d'AETHRYON (le même que la médiathèque) : commandes, rapport réel, aucun
  // téléchargement automatique.
  const media = job && p.phase === "pret" && job.streamUrl ? <MediaPlayer job={job} compact peaks={p.peaks} sourceDuration={info.duration} /> : null;

  const fade = calm
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: DUR.calm } }, exit: { opacity: 0, transition: { duration: DUR.calm } } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE.soft, delay: 0.06 } }, exit: { opacity: 0, y: -4, transition: { duration: DUR.exit, ease: EASE.exit } } };

  return (
    <dialog ref={setDlg} className="xm-dialog" aria-labelledby="xm-title" data-export-dialog=""
      onCancel={(ev) => { ev.preventDefault(); p.onClose(); }}
      onClick={(ev) => { if (ev.target === dlg.current) p.onClose(); }}>
      <PortalTarget.Provider value={dlgEl}>
      {p.open && (
        <motion.div layoutId={`xm-${p.origin}`} className={cn("xm", `is-${p.phase}`)} data-xd-panel=""
          transition={calm ? { duration: 0 } : SPRING.soft}>
          <motion.div className="xm-in" initial={calm ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.18, delay: calm ? 0 : 0.1 } }}>
            <div className="xm-head">
              {p.phase === "pret" ? <Coche /> : p.phase === "traitement" ? <Anneau value={progres} /> : null}
              <h2 id="xm-title" className="xm-title">{titre}</h2>
              <button type="button" className="xm-x" onClick={p.onClose} aria-label="Fermer"><IconClose size={18} /></button>
            </div>
            <p className="sr-only" aria-live="polite" data-xd-annonce="">{p.open ? annonce : ""}</p>
            {/* « wait » : l'ancienne étape sort, puis la nouvelle entre (« popLayout » injecterait une feuille de style, que la
                CSP du site refuse) ; la hauteur du panneau suit en douceur (layout). */}
            <AnimatePresence mode="wait" initial={false}>
              {p.phase === "preparation" && (
                <motion.div key="prep" className="xm-body xd-recap" data-xd-phase="preparation" {...fade}>
                  {p.dropped && <p className="xm-dropped"><IconCheck size={15} />Passage prêt à exporter : vérifie, puis lance l'export.</p>}
                  <div className="xm-formats" role="radiogroup" aria-label="Type de fichier">
                    {FORMATS.map((f) => {
                      const target: Tool = f.id === "video" ? (formatOf(tool) === "video" ? tool : "couper") : f.id;
                      const on = formatOf(tool) === f.id;
                      const ok = p.usable(target);
                      return (
                        <button key={f.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={!ok}
                          className={cn("xm-format", on && "is-on")} onClick={() => p.onTool(target)} data-xm-format={f.id}>
                          {on && <motion.span layoutId="xm-format-pill" className="xm-format-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
                          <f.Icon size={16} className="relative" /><span className="relative">{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="xm-pass">
                    <Miniature board={p.board} boardUrl={p.boardUrl} t={e.start} peaks={p.peaks} span={[e.start, e.end]} duration={info.duration} />
                    <div className="xm-pass-text">
                      <p className="xd-name" title={p.nom}>{p.nom}</p>
                      <p className="xm-tc tabular" data-xm-timecodes="">
                        <IconMarkIn size={15} /><span>{timecode(e.start, 2)}</span>
                        <IconMarkOut size={15} /><span>{timecode(e.end, 2)}</span>
                      </p>
                    </div>
                  </div>
                  <ul className="out-tags tabular" aria-label="Fichier exporté">{tags.map((t) => <li key={t}>{t}</li>)}</ul>
                  <dl className="xd-dl tabular">
                    <div><dt>Durée</dt><dd>{spanLabel(len)}</dd></div>
                    {taille && <div><dt>{est?.exact ? "Taille" : "Taille estimée"}</dt><dd>{taille}</dd></div>}
                  </dl>
                  {cost > 0 && left !== null && (
                    <p className={cn("xd-quota tabular", cost > left && "is-over")} data-xd-quota={cost}>
                      {cost > left
                        ? `Il te reste ${f1(left)}\u00a0min d'export aujourd'hui, cet export en compte ${f1(cost)}. Raccourcis le passage ou baisse la qualité.`
                        : `Compte ${f1(cost)}\u00a0min d'export · il t'en restera ${f1(Math.round((left - cost) * 10) / 10)} aujourd'hui.`}
                    </p>
                  )}
                  {problem && <p className="insp-problem" role="status">{problem}</p>}
                </motion.div>
              )}
              {p.phase === "traitement" && (
                <motion.div key="run" className="xm-body xd-run" data-xd-phase="traitement" {...fade}>
                  <ol className="xd-steps" aria-label="Étapes de l'export">
                    {ETAPES.map((l, k) => <li key={l} className={cn(k < etape && "is-done", k === etape && "is-now")} aria-current={k === etape ? "step" : undefined}>{l}</li>)}
                  </ol>
                  <Barre value={progres} />
                  <p className="xd-note tabular">{p.perdu ? "Connexion perdue : l'export continue sur le serveur, le suivi reprend tout seul."
                    : progres !== null ? `${progres} % · tu peux continuer l'édition` : "Tu peux continuer l'édition : l'export continue."}</p>
                </motion.div>
              )}
              {p.phase === "pret" && job && (
                <motion.div key="ok" className="xm-body xd-done" data-xd-phase="pret" {...fade}>
                  <div className={cn("xd-preview xm-reveal", !calm && "is-animated")}>
                    <Miniature board={p.board} boardUrl={p.boardUrl} t={e.start} className="xm-poster" w={444} h={250} peaks={p.peaks} span={[e.start, e.end]} duration={info.duration} />
                    {media}
                    {!calm && <span className="xm-sweep" aria-hidden="true" />}
                  </div>
                  <p className="xd-name" title={job.filename ?? undefined}>{middleName(job.filename ?? "", 80)}</p>
                  <ul className="xm-facts tabular" aria-label="Fichier obtenu">
                    {job.media?.duration ? <li><span>Durée</span><b>{dur(job.media.duration)}</b></li> : null}
                    <li><span>Poids</span><b>{bytes(job.sizeBytes)}</b></li>
                    {remaining(job.expiresAt) && <li><span>Disponible encore</span><b>{remaining(job.expiresAt).replace(/^encore /, "")}</b></li>}
                  </ul>
                  {lance && <p className="xd-sent" role="status" data-xd-lance=""><IconCheck size={16} />Téléchargement lancé dans ton navigateur.</p>}
                </motion.div>
              )}
              {p.phase === "echec" && (
                <motion.p key="ko" className="xm-body xd-error" data-xd-phase="echec" {...fade}>{p.erreur ?? job?.message ?? "Le serveur n'a pas pu produire le fichier."}</motion.p>
              )}
            </AnimatePresence>
            <div className="xm-foot">
              {p.phase === "preparation" ? (
                <>
                  <button type="button" className="xd-btn" onClick={p.onClose}>Annuler</button>
                  <button type="button" className="xd-btn is-primary" ref={(el) => { principal.current = el; }} onClick={() => { if (!p.envoi && !problem) p.onConfirm(); }}
                    aria-disabled={p.envoi || !!problem || undefined} data-xd-exporter="">
                    <IconDownload size={18} />{p.envoi ? "Envoi…" : "Exporter"}
                  </button>
                </>
              ) : p.phase === "traitement" ? (
                <>
                  {job && (job.status === "queued" || job.status === "running") && (
                    <button type="button" className="xd-btn" onClick={() => p.onCancelJob(job.id)} data-xd-annuler="">Annuler l'export</button>
                  )}
                  <button type="button" className="xd-btn is-primary" ref={(el) => { principal.current = el; }} onClick={p.onClose}>Continuer l'édition</button>
                </>
              ) : p.phase === "pret" ? (
                <>
                  <button type="button" className="xd-btn" onClick={p.onClose}>Continuer l'édition</button>
                  {job?.fileUrl && (
                    <a className={cn("xd-btn", !lance && "is-primary")} href={job.fileUrl} download ref={(el) => { principal.current = el; }}
                      onClick={() => setLance(true)} data-xd-telecharger="">
                      <IconDownload size={18} />Télécharger
                    </a>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="xd-btn" onClick={p.onClose}>Fermer</button>
                  <button type="button" className="xd-btn is-primary" ref={(el) => { principal.current = el; }} onClick={() => { if (!p.envoi) p.onConfirm(); }} data-xd-reessayer="">Réessayer</button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </PortalTarget.Provider>
    </dialog>
  );
}
