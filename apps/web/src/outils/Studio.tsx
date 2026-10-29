// Éditeur d'AETHRYON Tools (/outils/studio/:id) : plein écran, hors de la coque du site.
// Ordinateur : barre du haut (retour, titre, « Exporter »), outils à gauche, aperçu au centre avec sa barre de lecture,
// réglages à droite (panneau redimensionnable et repliable, défilement indépendant, pied d'export qui ne recouvre
// rien), frise sur toute la largeur en bas avec la barre flottante de la sélection. « Agrandir » (T) masque outils et
// réglages sans quitter l'édition ; plein écran (F) garde la barre de lecture et la sélection.
// Téléphone : aperçu d'abord, frise tactile, outils en bas, réglages dans un volet qui monte.
// Commandes partagées (commands.ts) par le clavier, les menus contextuels, la barre flottante et les info-bulles.
// Lecture : l'horloge ne tourne que pendant la lecture ; pendant un geste, la sélection « vivante » (live.ts) suit le
// pointeur sans rendre l'éditeur, la retouche n'est validée qu'au lâcher ; les sauts de la vidéo sont regroupés.
// /outils/studio#ref=… : lien « Ouvrir dans AETHRYON Tools » du bot Discord (vérifié pour le compte connecté).
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from "react";
import { EditHistory, changedKeys } from "./history.ts";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { cn } from "../lib/cn.ts";
import { useCalm, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { invalidate } from "../lib/store.ts";
import { BrandLogo } from "../ui/brand/BrandLogo.tsx";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconCopy, IconDownload, IconPause, IconPlay, IconReplay } from "../ui/Icon.tsx";
import { ApiError } from "../lib/api.ts";
import { redeemRef, type ToolsLimits } from "./api.ts";
import { AudioStage, type AudioStageHandle } from "./AudioStage.tsx";
import { commandFor, nativeKeyTarget, type Command, type CommandId, type Commands } from "./commands.ts";
import { DragExport, type DragStart } from "./DragExport.tsx";
import { exportBody, fitRatio, initialEdit, keepEdit, RATIOS, sampleBody, savedEdit, TOOL_ORDER, type Edit, type Tool } from "./edit.ts";
import { ExportPanel, type ExportOrigin, type PhaseExport } from "./ExportPanel.tsx";
import { Library } from "./Library.tsx";
import { bytes, remaining, spanLabel, timecode } from "./format.ts";
import {
  IconUndo, IconRedo, IconBack, IconCompress, IconCrop, IconCut, IconExpand, IconFitSel, IconFrame, IconGif, IconKeyboard, IconLoop, IconMagnet, IconMarkIn, IconMarkOut,
  IconMute, IconPanel, IconSelectAll, IconSend, IconSkipEnd, IconSkipStart, IconStepBack, IconStepFwd, IconTheater, IconWave, IconZoomIn, IconZoomOut,
} from "./icons.tsx";
import { ExportFoot, Inspector } from "./Inspector.tsx";
import { sameSpan, store, type Span } from "./live.ts";
import { cmd, ContextZone, KeyCombo, PortalTarget, sep, Tip, TipProvider, type Entry } from "./menus.tsx";
import { PlayerBar, PREVIEW_RATES, Scrubber, StageOverlay, type ScrubberHandle } from "./Player.tsx";
import { seeker } from "./seeker.ts";
import { drawTile, sprite as loadSprite } from "./thumbs.ts";
import { Stage } from "./Stage.tsx";
import { Timeline, type TimelineHandle } from "./Timeline.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useAudioGraph } from "./useAudioGraph.ts";
import { useStudio } from "./useStudio.ts";

const TOOLS: Record<Tool, { label: string; Icon: typeof IconCut }> = {
  couper: { label: "Couper", Icon: IconCut },
  recadrer: { label: "Recadrer", Icon: IconCrop },
  audio: { label: "Audio", Icon: IconWave },
  gif: { label: "GIF", Icon: IconGif },
  compresser: { label: "Compresser", Icon: IconCompress },
};
const isTool = (v: string | null): v is Tool => !!v && (TOOL_ORDER as readonly string[]).includes(v);
/** Raccourcis des outils : le chiffre (position de la touche, AZERTY compris) puis une lettre à retenir. */
const TOOL_KEYS: Record<Tool, string[]> = { couper: ["1", "X"], recadrer: ["2", "C"], audio: ["3", "S"], gif: ["4", "G"], compresser: ["5"] };

// Réglages de l'éditeur gardés dans CE navigateur (confort seulement) : aimantation, volume de l'aperçu, panneau.
const PREFS = "aethryon.tools.prefs";
interface Prefs { magnet: boolean; volume: number; muted: boolean; sideW: number; collapsed: boolean }
const PREFS_DEFAULT: Prefs = { magnet: true, volume: 1, muted: false, sideW: 360, collapsed: false };
function readPrefs(): Prefs {
  try { return { ...PREFS_DEFAULT, ...(JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>) }; } catch { return PREFS_DEFAULT; }
}
function writePrefs(p: Prefs) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* stockage indisponible */ } }
const SIDE_MIN = 300, SIDE_MAX = 560;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    f();
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** /outils/studio#ref=… : échange du lien contre le média, puis l'éditeur (le jeton quitte aussitôt l'adresse). */
export function StudioRef() {
  const navigate = useNavigate();
  const me = useMe();
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle("Ouverture dans AETHRYON Tools");
  useEffect(() => {
    if (me.loading) return;
    const ref = new URLSearchParams(window.location.hash.slice(1)).get("ref");
    if (!me.data) {
      // Connexion d'abord : le lien revient ensuite ici (le jeton reste dans la partie après #, jamais envoyée).
      navigate(`/connexion?suite=${encodeURIComponent(`/outils/studio${window.location.hash}`)}`, { replace: true });
      return;
    }
    if (!ref) { navigate("/outils", { replace: true }); return; }
    redeemRef(ref)
      .then((r) => navigate(`/outils/studio/${encodeURIComponent(r.id)}`, { replace: true }))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Ce lien n'a pas pu être ouvert."));
  }, [me.loading, me.data, navigate]);
  return (
    <div className="studio studio-center">
      <div className="studio-note">
        <AethryonMascot state={error ? "error" : "processing"} size={72} />
        <p role="status" className="mt-4 text-fg">{error ?? "Ouverture du média…"}</p>
        {error && <Link to="/outils" className="link-btn mt-5 inline-flex">Aller à AETHRYON Tools</Link>}
      </div>
    </div>
  );
}

/** Mac, iPhone, iPad : ⌘ à la place de Ctrl dans les raccourcis affichés (les deux fonctionnent partout). */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export default function Studio() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const calm = useCalm();
  const me = useMe();
  const s = useStudio(id);
  const narrow = useMedia("(max-width: 1023.98px)");
  const tiny = useMedia("(max-width: 639.98px)");
  const poster = (location.state as { poster?: string } | null)?.poster ?? null;
  const [tool, setTool] = useState<Tool>(() => {
    const q = new URLSearchParams(location.search).get("outil");
    return isTool(q) ? q : "couper";
  });
  const [edit, setEdit] = useState<Edit | null>(null);
  // Annuler / Rétablir (history.ts) : un historique par média (un éditeur par média, StudioParMedia) ; chaque
  // changement de réglages y est noté après le rendu, sans rendu de plus (seuls les boutons s'abonnent).
  const history = useMemo(() => new EditHistory(), []);
  const histState = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const prevEdit = useRef<Edit | null>(null);
  const applying = useRef(false);
  const editNow = useRef(edit);
  editNow.current = edit;
  useEffect(() => {
    const prev = prevEdit.current;
    prevEdit.current = edit;
    if (applying.current) { applying.current = false; return; }
    if (prev && edit) history.record(prev, changedKeys(prev, edit));
  }, [edit, history]);
  const undo = useCallback(() => {
    const cur = editNow.current;
    const p = cur ? history.undo(cur) : null;
    if (p) { applying.current = true; setEdit(p); }
  }, [history]);
  const redo = useCallback(() => {
    const cur = editNow.current;
    const n = cur ? history.redo(cur) : null;
    if (n) { applying.current = true; setEdit(n); }
  }, [history]);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; writePrefs(n); return n; }), []);
  const [theater, setTheater] = useState(false);
  const [tab, setTab] = useState<"reglages" | "exports">("reglages");
  const [rate, setRate] = useState(1);
  const [help, setHelp] = useState(false);
  const [fsEl, setFsEl] = useState<HTMLElement | null>(null);
  const [xdrag, setXdrag] = useState<DragStart | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const exportTop = useRef<HTMLButtonElement>(null);
  // Hauteur réelle du volet (téléphone) : la zone principale lui laisse cette place.
  useLayoutEffect(() => {
    const el = side.current, r = root.current;
    if (!el || !r) return;
    const ro = new ResizeObserver(() => r.style.setProperty("--sheet-h", `${Math.round(el.offsetHeight)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => { root.current?.style.setProperty("--side-w", `${prefs.sideW}px`); }, [prefs.sideW]);
  const [follow, setFollow] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const timeline = useRef<TimelineHandle>(null);
  const scrubber = useRef<ScrubberHandle>(null);
  const audioStage = useRef<AudioStageHandle>(null);
  const graph = useAudioGraph(video);
  const clock = useRef<HTMLSpanElement>(null);
  const title = s.phase.kind === "ready" || s.phase.kind === "fetching" || s.phase.kind === "checking" || s.phase.kind === "uploading" || s.phase.kind === "resume"
    ? s.phase.job.title ?? s.phase.job.upload?.name ?? "Média" : "Média";
  useDocumentTitle(`${title} · Tools`);

  useEffect(() => { if (!me.loading && !me.data) navigate(`/connexion?suite=${encodeURIComponent(location.pathname)}`, { replace: true }); }, [me.loading, me.data, navigate, location.pathname]);

  // Le média prêt : réglages initiaux (une fois) ; un son seul s'ouvre sur Audio. V3.5 : passage réglé dans une page
  // par l'extension (« Continuer dans Tools avec ce passage ») présélectionné, borné au média ; il l'emporte sur un
  // brouillon gardé (l'utilisateur vient de le choisir).
  const sharedRange = (location.state as { range?: { start: number; end: number } } | null)?.range ?? null;
  useEffect(() => {
    if (!s.info || edit) return;
    const base = initialEdit(s.info, s.limits);
    const start = sharedRange ? Math.max(0, Math.min(sharedRange.start, base.end)) : null;
    const end = sharedRange ? Math.min(base.end, Math.max(sharedRange.end, (start ?? 0) + 0.5)) : null;
    if (start !== null && end !== null && end - start >= 0.5) setEdit({ ...(savedEdit(id, s.info, base) ?? base), start, end });
    else setEdit(savedEdit(id, s.info, base) ?? base);
  }, [s.info, s.limits, edit, id, sharedRange]);
  useEffect(() => {
    if (!edit || !s.info) return;
    const info = s.info;
    const t = window.setTimeout(() => keepEdit(id, info, edit), 400);
    return () => window.clearTimeout(t);
  }, [edit, id, s.info]);
  useEffect(() => {
    if (s.info && !s.info.has_video && tool !== "audio") setTool("audio");
    else if (s.info && !s.info.has_audio && tool === "audio") setTool("couper");
  }, [s.info]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("outil") !== tool) { q.set("outil", tool); navigate({ search: `?${q}` }, { replace: true, state: location.state }); }
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((patch: Partial<Edit>) => setEdit((e) => (e ? { ...e, ...patch } : e)), []);
  const info = s.info;
  const audioOnly = !!info && !info.has_video;
  const audioView = audioOnly || tool === "audio";
  const d = info?.duration ?? 0;

  // ---- sélection vivante ---------------------------------------------------------------------------------------------
  const live = useMemo(() => store<Span>({ start: 0, end: 0, gesture: null }, sameSpan), []);
  useLayoutEffect(() => { if (edit && !live.get().gesture) live.set({ start: edit.start, end: edit.end, gesture: null }); }, [edit?.start, edit?.end, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = useCallback((a: number, b: number) => { live.set({ start: a, end: b, gesture: null }); set({ start: a, end: b }); }, [live, set]);

  // Recadrage : le cadre suit le format choisi (Original = toute l'image, Libre = cadre libre).
  useEffect(() => {
    if (!edit || !s.info?.width || !s.info.height) return;
    const r = RATIOS.find((x) => x.id === edit.ratio)!;
    if (edit.ratio === "original") { if (edit.crop) set({ crop: null }); return; }
    if (edit.ratio === "libre") { if (!edit.crop) set({ crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }); return; }
    set({ crop: fitRatio(r.value!, s.info.width, s.info.height, edit.rotate, edit.crop) });
  }, [edit?.ratio, edit?.rotate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- horloge : tête de lecture, minutage (hors de React), seulement pendant la lecture ---------------------------
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const clockText = useCallback((t: number) => {
    const c = timecode(t, 2);
    if (clock.current && clock.current.textContent !== c) clock.current.textContent = c;
  }, []);
  const paint = useCallback((t: number, follow = false, withClock = true) => {
    timeline.current?.setTime(t, follow);
    scrubber.current?.setTime(t);
    audioStage.current?.setTime(t);
    if (withClock) clockText(t);
  }, [clockText]);
  useEffect(() => {
    const v = videoEl;
    if (!v) return;
    let raf = 0, vfc = 0;
    type VFC = { requestVideoFrameCallback?(cb: (now: number, m: { mediaTime: number }) => void): number; cancelVideoFrameCallback?(id: number): void };
    const fv = v as HTMLVideoElement & VFC;
    const byFrame = typeof fv.requestVideoFrameCallback === "function";
    const frame = (_now: number, m: { mediaTime: number }) => { clockText(m.mediaTime); if (!v.paused) vfc = fv.requestVideoFrameCallback!(frame); };
    const tick = () => {
      let t = v.currentTime;
      const sel = live.get();
      // Lecture de la SÉLECTION : arrêt à sa fin exacte, ou retour à son début en boucle.
      if (!v.paused && sel.end - sel.start > 0.02 && t >= sel.end - 0.005) {
        if (loopRef.current) v.currentTime = t = sel.start;
        else { v.pause(); v.currentTime = t = sel.end; }
      }
      paint(t, !v.paused, !byFrame);
      if (!v.paused) raf = requestAnimationFrame(tick);
      else raf = 0;
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(tick);
      if (byFrame && !vfc) vfc = fv.requestVideoFrameCallback!(frame);
      setPlaying(true);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      if (vfc) fv.cancelVideoFrameCallback?.(vfc);
      raf = 0; vfc = 0;
      setPlaying(false);
      paint(v.currentTime);
    };
    const still = () => { if (v.paused) paint(v.currentTime); };
    v.addEventListener("play", run);
    v.addEventListener("pause", stop);
    v.addEventListener("ended", stop);
    v.addEventListener("seeked", still);
    v.addEventListener("loadeddata", still);
    if (!v.paused) run(); else still();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (vfc) fv.cancelVideoFrameCallback?.(vfc);
      v.removeEventListener("play", run);
      v.removeEventListener("pause", stop);
      v.removeEventListener("ended", stop);
      v.removeEventListener("seeked", still);
      v.removeEventListener("loadeddata", still);
    };
  }, [videoEl, live, paint, clockText]);
  // Sélection changée PENDANT la lecture (champs, clavier) : la lecture reste dedans.
  useEffect(() => {
    const v = video.current;
    if (!v || !edit || v.paused) return;
    if (v.currentTime < edit.start - 0.01 || v.currentTime >= edit.end - 0.005) v.currentTime = edit.start;
  }, [edit?.start, edit?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aperçu : vitesse de l'export × vitesse d'aperçu ; volume de l'export × volume de l'aperçu (le second n'agit pas
  // sur le fichier). « Sans le son » ne vaut pas pour l'outil Audio. Hauteur du son : celle de l'export — conservée
  // (étirement du navigateur, comme atempo), ou Sped Up / Slowed (rééchantillonnage, comme le serveur) : on entend
  // avant d'exporter ce que donnera le fichier. La vitesse d'aperçu seule ne change jamais l'export.
  useEffect(() => {
    const v = video.current;
    if (!v || !edit) return;
    v.playbackRate = edit.speed * rate;
    const shift = edit.pitch === "shift" && edit.speed !== 1 && tool !== "gif";
    const m = v as HTMLVideoElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    if ("preservesPitch" in m) m.preservesPitch = !shift;
    if ("mozPreservesPitch" in m) m.mozPreservesPitch = !shift;
    if ("webkitPreservesPitch" in m) m.webkitPreservesPitch = !shift;
    const exportGain = tool !== "audio" && edit.mute ? 0 : Math.pow(10, edit.volumeDb / 20);
    graph.setLevel(exportGain * (prefs.muted ? 0 : prefs.volume));
  }, [edit?.speed, edit?.pitch, edit?.mute, edit?.volumeDb, tool, rate, prefs.muted, prefs.volume, videoEl, graph.setLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const onVideo = useCallback((v: HTMLVideoElement | null) => { setVideoEl(v); }, []);
  // Lueur d'ambiance : vignette de la planche à l'instant donné (32 × 18 suffisent, l'agrandissement adoucit).
  const boardRef = useRef(s.board);
  boardRef.current = s.board;
  const glowTile = useCallback((cv: HTMLCanvasElement, t: number) => {
    const b = boardRef.current;
    return drawTile(cv, b, loadSprite(b?.image), t, { w: 32, h: 18 });
  }, []);

  const seekr = useMemo(() => seeker(() => video.current), []);
  const seek = useCallback((t: number, how: "drag" | "jump" = "jump") => {
    const v = video.current;
    const sel = live.get();
    // Explorer hors de la sélection met la lecture en pause (Play reviendra à la sélection).
    if (v && !v.paused && (t < sel.start - 0.01 || t >= sel.end - 0.005)) v.pause();
    if (how === "drag") seekr.to(t); else seekr.now(t);
    paint(t);
  }, [live, seekr, paint]);
  const { connect } = graph;
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    connect();
    const sel = live.get();
    if (sel.end - sel.start > 0.02 && (v.currentTime < sel.start - 0.01 || v.currentTime >= sel.end - 0.02)) seek(sel.start);
    void v.play().catch(() => undefined);
  }, [connect, seek, live]);
  const replay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    connect();
    seek(live.get().start);
    void v.play().catch(() => undefined);
  }, [connect, seek, live]);
  const onScrub = useCallback((active: boolean) => { if (active) video.current?.pause(); }, []);

  // ---- plein écran ---------------------------------------------------------------------------------------------------
  useEffect(() => {
    const f = () => setFsEl((document.fullscreenElement as HTMLElement | null) ?? null);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  // Entrée en plein écran : la barre de progression part du temps actuel.
  useEffect(() => { if (fsEl) requestAnimationFrame(() => paint(video.current?.currentTime ?? 0)); }, [fsEl, paint]);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const el = viewer.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else (video.current as unknown as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.(); // iPhone : lecteur du système
  }, []);

  // ---- export --------------------------------------------------------------------------------------------------------
  const [sample, setSample] = useState<string | null>(null);
  const [xd, setXd] = useState<{ open: boolean; phase: PhaseExport; jobId: string | null; erreur: string | null; origin: ExportOrigin; dropped: boolean }>(
    { open: false, phase: "preparation", jobId: null, erreur: null, origin: "top", dropped: false });
  const xdState = xd.jobId ? s.exports.find((x) => x.job.id === xd.jobId) ?? null : null;
  const xdJob = xdState?.job ?? null;
  useEffect(() => {
    if (!xd.jobId) return;
    if (!xdJob) { setXd((x) => (x.phase === "traitement" ? { ...x, open: false, jobId: null } : x)); return; }
    if (xdJob.status === "done") setXd((x) => (x.phase === "pret" ? x : { ...x, open: true, phase: "pret" }));
    else if (xdJob.status === "error") setXd((x) => (x.phase === "echec" ? x : { ...x, open: true, phase: "echec", erreur: null }));
  }, [xd.jobId, xdJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fermeture du panneau : le focus revient au bouton d'où il s'était déployé (il vient d'y reprendre sa forme).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !xd.open) {
      const sel = xd.origin === "foot" ? "[data-export]" : xd.origin === "toolbar" ? "[data-ft-export]" : "[data-export-top]";
      requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }));
    }
    wasOpen.current = xd.open;
  }, [xd.open, xd.origin]);
  const doExport = async () => {
    if (!edit || !s.info) return;
    setBusy(true); setNotice(null);
    try {
      const job = await s.runExport(tool, exportBody(tool, edit, s.info));
      invalidate("/api/me"); // minutes d'export du jour : relues après chaque export
      setFollow(job.id);
      setXd((x) => ({ ...x, open: true, phase: "traitement", jobId: job.id, erreur: null, dropped: false }));
    } catch (e) {
      setXd((x) => ({ ...x, open: true, phase: "echec", jobId: null, erreur: e instanceof ApiError ? e.message : "L'export n'a pas pu démarrer." }));
    } finally { setBusy(false); }
  };
  const doSample = async () => {
    if (!edit || !s.info) return;
    setSample(null);
    try {
      const job = await s.runExport("echantillon", sampleBody(edit, s.info));
      setSample(job.id);
    } catch (e) { setNotice(e instanceof ApiError ? e.message : "L'échantillon n'a pas pu être préparé."); }
  };
  const sampleJob = s.exports.find((x) => x.job.id === sample)?.job;
  const sampleView = sample ? (
    <div className="sample" data-sample="">
      {sampleJob?.status === "done" && sampleJob.streamUrl ? (
        <>
          <video src={sampleJob.streamUrl} className="sample-video" controls autoPlay={!calm} loop muted playsInline />
          <p className="insp-note tabular">Échantillon réel : {bytes(sampleJob.sizeBytes)} pour 2&nbsp;s · {sampleJob.notes[0] ?? ""}</p>
        </>
      ) : sampleJob?.status === "error" ? <p className="insp-problem">{sampleJob.message}</p>
        : <p className="insp-note" role="status">Encodage de l'échantillon… {Math.round(sampleJob?.progress ?? 0)}&nbsp;%</p>}
    </div>
  ) : null;

  const visibleExports = s.exports.filter((x) => x.tool !== "echantillon" && x.job.derive?.op !== "echantillon" && x.job.derive?.op !== "apercu");
  const running = s.exports.find((x) => (x.job.status === "queued" || x.job.status === "running") && x.tool !== "echantillon");
  const ready = s.phase.kind === "ready" && !!s.info && !!edit;
  const src = s.localUrl ?? (s.phase.kind === "ready" ? s.phase.job.streamUrl : null);
  const disabledReason = s.phase.kind === "uploading" ? "L'export sera possible à la fin de l'envoi." : s.phase.kind === "checking" ? "Vérification du fichier…" : null;
  const unusableWhy = (t: Tool): string | null => (audioOnly && t !== "audio" ? "Ce média n'a pas d'image" : info && !info.has_audio && t === "audio" ? "Ce média n'a pas de son" : null);
  const unusable = (t: Tool) => !!unusableWhy(t);
  const mode = audioView ? "audio" : "video";
  /** Ouvre le panneau d'export, depuis l'élément qui l'a demandé (il s'y déploie). Un export en cours y est repris. */
  const openExport = useCallback((origin: ExportOrigin, opts: { tool?: Tool; dropped?: boolean } = {}) => {
    if (!ready) return;
    if (opts.tool && !unusable(opts.tool)) setTool(opts.tool);
    video.current?.pause();
    if (running) setXd({ open: true, phase: "traitement", jobId: running.job.id, erreur: null, origin, dropped: false });
    else setXd({ open: true, phase: "preparation", jobId: null, erreur: null, origin, dropped: !!opts.dropped });
  }, [ready, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const showCrop = tool === "recadrer" && !!edit?.crop;
  const cropRatio = useMemo(() => {
    if (!edit) return null;
    const r = RATIOS.find((x) => x.id === edit.ratio);
    if (!r?.value) return null;
    return edit.rotate === 90 || edit.rotate === 270 ? 1 / r.value : r.value;
  }, [edit]);

  // ---- glisser la sélection vers l'export ------------------------------------------------------------------------
  const startDrag = useCallback((e: RPointerEvent, from: DOMRect) => {
    if (!ready || running) return;
    video.current?.pause();
    setXdrag({ x: e.clientX, y: e.clientY, from, pointerId: e.pointerId });
  }, [ready, running]);
  const onGrip = useCallback((e: RPointerEvent<HTMLButtonElement>) => {
    const from = timeline.current?.selectionRect() ?? e.currentTarget.getBoundingClientRect();
    // La poignée rend le focus : au retour du panneau, il ira au bouton « Exporter » (là où la sélection a été déposée).
    e.currentTarget.blur();
    startDrag(e, from);
  }, [startDrag]);

  // ---- commandes -------------------------------------------------------------------------------------------------------
  const fps = info?.fps && info.fps > 0 && info.fps < 241 ? info.fps : 30;
  const nudge = useCallback((delta: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    seek(Math.min(d, Math.max(0, v.currentTime + delta)));
  }, [d, seek]);
  const copyTimes = useCallback(() => {
    const sel = live.get();
    const text = `${timecode(sel.start, 2)} – ${timecode(sel.end, 2)} (${spanLabel(sel.end - sel.start)})`;
    void navigator.clipboard?.writeText(text).then(() => setNotice(null), () => setNotice("Le presse-papiers n'est pas accessible dans ce navigateur."));
  }, [live]);
  const exportLabel = tool === "audio" ? "Exporter le son" : tool === "gif" ? "Créer le GIF" : tool === "compresser" ? "Compresser" : "Exporter";
  const commands: Commands = useMemo(() => {
    const none = !ready;
    const toolCmd = (k: number): Command => {
      const t = TOOL_ORDER[k]!;
      return { id: `tool${k + 1}` as CommandId, label: TOOLS[t].label, icon: TOOLS[t].Icon, keys: TOOL_KEYS[t], disabled: unusable(t), run: () => setTool(t), checked: tool === t };
    };
    const c: Commands = {
      play: { id: "play", label: playing ? "Pause" : "Lire la sélection", icon: playing ? IconPause : IconPlay, keys: ["Espace", "K"], disabled: !src, run: toggle },
      replay: { id: "replay", label: "Rejouer la sélection", icon: IconReplay, keys: ["R"], disabled: !src, run: replay },
      loop: { id: "loop", label: "Lire en boucle", icon: IconLoop, keys: ["L"], disabled: none, checked: loop, run: () => setLoop((l) => !l) },
      prevFrame: { id: "prevFrame", label: "Image précédente", icon: IconStepBack, keys: ["←"], disabled: !src, run: () => nudge(-1 / fps) },
      nextFrame: { id: "nextFrame", label: "Image suivante", icon: IconStepFwd, keys: ["→"], disabled: !src, run: () => nudge(1 / fps) },
      back1s: { id: "back1s", label: "Reculer d'une seconde", keys: ["Maj+←"], disabled: !src, run: () => nudge(-1) },
      fwd1s: { id: "fwd1s", label: "Avancer d'une seconde", keys: ["Maj+→"], disabled: !src, run: () => nudge(1) },
      setIn: {
        id: "setIn", label: "Début à la tête de lecture", icon: IconMarkIn, keys: ["I"], disabled: none,
        run: () => { const v = video.current; const sel = live.get(); if (v && v.currentTime < sel.end - 0.1) commit(v.currentTime, sel.end); },
      },
      setOut: {
        id: "setOut", label: "Fin à la tête de lecture", icon: IconMarkOut, keys: ["O"], disabled: none,
        run: () => { const v = video.current; const sel = live.get(); if (v && v.currentTime > sel.start + 0.1) commit(sel.start, v.currentTime); },
      },
      goIn: { id: "goIn", label: "Aller au début de la sélection", icon: IconSkipStart, keys: ["Début"], disabled: none, run: () => seek(live.get().start) },
      goOut: { id: "goOut", label: "Aller à la fin de la sélection", icon: IconSkipEnd, keys: ["Fin"], disabled: none, run: () => seek(live.get().end) },
      goStart: { id: "goStart", label: "Aller au début du média", keys: ["Maj+Début"], disabled: none, run: () => seek(0) },
      goEnd: { id: "goEnd", label: "Aller à la fin du média", keys: ["Maj+Fin"], disabled: none, run: () => seek(d) },
      selectAll: {
        id: "selectAll", label: "Sélectionner tout le média", icon: IconSelectAll, keys: ["A"], disabled: none,
        run: () => { if (!info) return; const cap = info.has_video && tool !== "audio" ? (s.limits?.videoMaxS ?? 900) : (s.limits?.maxDurationS ?? 3600); commit(0, Math.min(d, cap) || d); },
      },
      copyTimes: { id: "copyTimes", label: "Copier les temps de la sélection", icon: IconCopy, disabled: none, run: copyTimes },
      export: { id: "export", label: `${exportLabel}…`, icon: IconDownload, keys: ["E"], disabled: none, run: () => openExport("toolbar") },
      // Action explicite du geste de transport (clic, doigt, clavier) : le panneau s'ouvre depuis « Exporter », préréglé.
      sendExport: { id: "sendExport", label: "Envoyer vers Export", icon: IconSend, disabled: none, run: () => openExport("top", { dropped: true }) },
      exportVideo: { id: "exportVideo", label: "Vidéo", icon: IconFrame, disabled: none || unusable("couper"), run: () => openExport("toolbar", { tool: tool === "recadrer" ? "recadrer" : "couper" }) },
      exportAudio: { id: "exportAudio", label: "Son", icon: IconWave, disabled: none || unusable("audio"), run: () => openExport("toolbar", { tool: "audio" }) },
      exportGif: { id: "exportGif", label: "GIF", icon: IconGif, disabled: none || unusable("gif"), run: () => openExport("toolbar", { tool: "gif" }) },
      exportCompress: { id: "exportCompress", label: "Vidéo compressée", icon: IconCompress, disabled: none || unusable("compresser"), run: () => openExport("toolbar", { tool: "compresser" }) },
      zoomSel: { id: "zoomSel", label: "Zoom sur la sélection", icon: IconFitSel, keys: ["Z"], disabled: none, run: () => timeline.current?.zoomToSelection() },
      zoomAll: { id: "zoomAll", label: "Toute la durée", keys: ["Maj+Z"], disabled: none, run: () => timeline.current?.zoomAll() },
      zoomIn: { id: "zoomIn", label: "Zoomer", icon: IconZoomIn, keys: ["+"], disabled: none, run: () => timeline.current?.zoomIn() },
      zoomOut: { id: "zoomOut", label: "Dézoomer", icon: IconZoomOut, keys: ["−"], disabled: none, run: () => timeline.current?.zoomOut() },
      magnet: { id: "magnet", label: "Aimantation", icon: IconMagnet, keys: ["N"], checked: prefs.magnet, run: () => setPrefs({ magnet: !prefs.magnet }) },
      mute: { id: "mute", label: "Couper le son de l'aperçu", icon: IconMute, keys: ["M"], checked: prefs.muted, disabled: !info?.has_audio, run: () => setPrefs({ muted: !prefs.muted }) },
      fullscreen: { id: "fullscreen", label: fsEl ? "Quitter le plein écran" : "Plein écran", icon: IconExpand, keys: ["F"], disabled: !src, run: fullscreen },
      theater: { id: "theater", label: "Agrandir l'aperçu", icon: IconTheater, keys: ["T"], checked: theater, run: () => setTheater((v) => !v) },
      panel: {
        id: "panel", label: "Panneau des réglages", icon: IconPanel, checked: !prefs.collapsed && !theater,
        run: () => { if (theater) { setTheater(false); setPrefs({ collapsed: false }); } else setPrefs({ collapsed: !prefs.collapsed }); },
      },
      help: { id: "help", label: "Raccourcis clavier", icon: IconKeyboard, keys: ["?"], run: () => setHelp(true) },
      // Raccourcis système (Ctrl ou ⌘) : lus à part par le clavier de l'éditeur, jamais dans un champ de saisie.
      undo: { id: "undo", label: "Annuler", icon: IconUndo, keys: [MAC ? "⌘+Z" : "Ctrl+Z"], disabled: !histState.undo, run: undo },
      redo: { id: "redo", label: "Rétablir", icon: IconRedo, keys: MAC ? ["⌘+Maj+Z"] : ["Ctrl+Maj+Z", "Ctrl+Y"], disabled: !histState.redo, run: redo },
      tool1: toolCmd(0), tool2: toolCmd(1), tool3: toolCmd(2), tool4: toolCmd(3), tool5: toolCmd(4),
    };
    return c;
  }, [ready, src, playing, loop, fps, d, info, tool, prefs, fsEl, theater, exportLabel, s.limits, toggle, replay, nudge, seek, commit, copyTimes, openExport, fullscreen, live, setPrefs, histState, undo, redo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- clavier de l'éditeur ----------------------------------------------------------------------------------------
  const cmdRef = useRef(commands);
  cmdRef.current = commands;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return; // fenêtre ouverte : ses touches à elle
      const el = e.target as Element | null;
      if (nativeKeyTarget(el, e.key)) return;
      // Annuler / Rétablir : Ctrl (⌘ sur Mac) + Z, + Maj pour rétablir, ou Ctrl + Y ; Alt (AltGr) jamais. Hors d'un
      // champ seulement (un champ garde son propre « annuler » : nativeKeyTarget ci-dessus).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing) {
        const k = e.key.toLowerCase();
        const which = k === "z" ? (e.shiftKey ? "redo" : "undo") : k === "y" && !e.shiftKey ? "redo" : null;
        if (which) {
          e.preventDefault();
          const c = cmdRef.current[which];
          if (c && !c.disabled) c.run();
          return;
        }
      }
      const id = commandFor(e);
      if (!id) return;
      const c = cmdRef.current[id];
      if (!c || c.disabled) return;
      e.preventDefault();
      c.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onRailKey = (e: React.KeyboardEvent) => {
    const usable = TOOL_ORDER.filter((t) => !unusable(t));
    const i = usable.indexOf(tool);
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1
      : e.key === "Home" ? 0 : e.key === "End" ? usable.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = usable[(to + usable.length) % usable.length]!;
    setTool(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  // ---- menus contextuels ---------------------------------------------------------------------------------------------
  const c = commands;
  const exportSub: Entry = { kind: "sub", label: "Exporter la sélection", icon: IconDownload, disabled: !ready,
    items: [cmd(c.exportVideo), cmd(c.exportAudio), cmd(c.exportGif), cmd(c.exportCompress)] };
  const speedSub: Entry = { kind: "sub", label: "Vitesse de l'aperçu", items: [{ kind: "radio", value: String(rate), options: PREVIEW_RATES.map((r) => ({ value: String(r), label: `×${String(r).replace(".", ",")}` })), onChange: (v) => setRate(Number(v)) }] };
  // Durées rapides, depuis le début de la sélection (en durée exportée : la vitesse de l'export est comptée).
  const durationSub = (): Entry => ({
    kind: "sub", label: "Durée de la sélection", icon: IconCut, disabled: !ready,
    items: [3, 5, 10, 15, 30].map((n) => {
      const a = live.get().start, b = a + n * (edit?.speed ?? 1);
      return cmd({ id: "selectAll", label: `${n} s depuis le début`, disabled: !ready || b > d + 0.001, run: () => commit(a, Math.min(d, b)) });
    }),
  });
  const selectionMenu = (): Entry[] => [
    cmd(c.play), cmd(c.replay), cmd(c.loop), sep,
    cmd(c.sendExport), exportSub, sep,
    cmd(c.setIn), cmd(c.setOut), durationSub(), cmd(c.selectAll), sep,
    cmd(c.zoomSel), cmd(c.copyTimes),
  ];
  const timelineMenu = (target: Element | null, at: number): Entry[] => {
    const handle = target?.closest<HTMLElement>("[data-handle]")?.dataset.handle as "start" | "end" | undefined;
    if (handle) {
      const sel = live.get();
      return [
        { kind: "label", text: handle === "start" ? `Début · ${timecode(sel.start, 2)}` : `Fin · ${timecode(sel.end, 2)}` },
        cmd({ id: handle === "start" ? "setIn" : "setOut", label: "Placer à la tête de lecture", icon: handle === "start" ? IconMarkIn : IconMarkOut, keys: [handle === "start" ? "I" : "O"], run: handle === "start" ? c.setIn.run : c.setOut.run }),
        cmd({ id: handle === "start" ? "goIn" : "goOut", label: "Aller à ce point", icon: handle === "start" ? IconSkipStart : IconSkipEnd, run: () => seek(handle === "start" ? sel.start : sel.end) }),
        cmd({ id: handle === "start" ? "goStart" : "goEnd", label: handle === "start" ? "Au début du média" : "À la fin du média", run: () => handle === "start" ? commit(0, sel.end) : commit(sel.start, d) }),
      ];
    }
    if (target?.closest("[data-selection]")) return selectionMenu();
    const sel = live.get();
    return [
      { kind: "label", text: `À ${timecode(at, 2)}` },
      cmd({ id: "goIn", label: "Placer la tête ici", icon: IconPlay, run: () => seek(at) }),
      cmd({ id: "setIn", label: "Début ici", icon: IconMarkIn, disabled: at >= sel.end - 0.1, run: () => commit(at, sel.end) }),
      cmd({ id: "setOut", label: "Fin ici", icon: IconMarkOut, disabled: at <= sel.start + 0.1, run: () => commit(sel.start, at) }),
      sep, cmd(c.selectAll), exportSub, sep,
      { kind: "sub", label: "Zoom", icon: IconZoomIn, items: [cmd(c.zoomSel), cmd(c.zoomAll), cmd(c.zoomIn), cmd(c.zoomOut)] },
      cmd(c.magnet),
    ];
  };
  const stageMenu = (target: Element | null): Entry[] => {
    if (!ready) return [cmd(c.help)];
    if (audioView) {
      return [
        cmd(c.play), cmd(c.replay), cmd(c.loop), cmd(c.mute), sep,
        { kind: "sub", label: "Volume de l'export", icon: IconWave, items: [-6, -3, 0, 3, 6].map((db) => cmd({ id: "mute", label: db ? `${db > 0 ? "+" : "−"}${Math.abs(db)} dB` : "Inchangé", checked: (edit?.volumeDb ?? 0) === db, run: () => set({ volumeDb: db }) })) },
        { kind: "sub", label: "Fondus", items: [0, 1, 2, 3].map((f) => cmd({ id: "mute", label: f ? `${f} s au début et à la fin` : "Aucun", checked: (edit?.fadeIn ?? 0) === f && (edit?.fadeOut ?? 0) === f, run: () => set({ fadeIn: f, fadeOut: f }) })) },
        exportSub, sep, speedSub, cmd(c.help),
      ];
    }
    if (target?.closest("[data-frame]")) {
      return [
        cmd(c.play), cmd(c.replay), cmd(c.loop), sep,
        cmd(c.prevFrame), cmd(c.nextFrame), cmd(c.setIn), cmd(c.setOut), sep,
        cmd(c.mute), speedSub, cmd(c.theater), cmd(c.fullscreen), sep,
        exportSub,
      ];
    }
    // Zone vide autour de l'image.
    return [
      cmd(c.play), cmd(c.theater), cmd(c.fullscreen), cmd(c.panel), sep,
      cmd({ id: "help", label: "Importer un autre média", icon: IconDownload, run: () => navigate("/outils") }),
      cmd(c.help),
    ];
  };

  // ---- panneau : largeur réglable ----------------------------------------------------------------------------------
  const resize = useRef<{ x0: number; w0: number; w: number } | null>(null);
  const onResizeDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* relâché */ }
    resize.current = { x0: e.clientX, w0: prefs.sideW, w: prefs.sideW };
    root.current?.classList.add("is-resizing");
  };
  const clampSide = (w: number) => {
    const max = Math.min(SIDE_MAX, Math.max(SIDE_MIN, (root.current?.clientWidth ?? 1440) - 88 - 520));
    return Math.round(Math.min(max, Math.max(SIDE_MIN, w)));
  };
  const onResizeMove = (e: RPointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r) return;
    r.w = clampSide(r.w0 + (r.x0 - e.clientX));
    root.current?.style.setProperty("--side-w", `${r.w}px`);
  };
  const onResizeUp = () => {
    const r = resize.current;
    resize.current = null;
    root.current?.classList.remove("is-resizing");
    if (r) setPrefs({ sideW: r.w });
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const w = e.key === "ArrowLeft" ? prefs.sideW + step : e.key === "ArrowRight" ? prefs.sideW - step : e.key === "Home" ? SIDE_MAX : e.key === "End" ? SIDE_MIN : null;
    if (e.key === "Enter") { e.preventDefault(); setPrefs({ collapsed: !prefs.collapsed }); return; }
    if (w === null) return;
    e.preventDefault();
    setPrefs({ sideW: clampSide(w) });
  };
  const collapsed = !narrow && (prefs.collapsed || theater);

  const exportPct = running ? Math.round(running.job.progress ?? 0) : 0;
  const topFace = (
    <>
      <span className="xt-face">
        {running ? <Ring value={running.job.progress ?? 0} /> : <IconDownload size={17} />}
        <span className="tabular">{running ? `${exportPct} %` : "Exporter"}</span>
      </span>
      <span className="xt-drop" aria-hidden="true"><IconDownload size={17} />Déposer pour exporter</span>
    </>
  );
  const topBtn = (
    <motion.button ref={exportTop} layoutId="xm-top" type="button" className={cn("studio-export-top", running && "is-running")} onClick={() => openExport("top")} disabled={!ready}
      data-export-top="" data-drop-target="" aria-label={running ? `Export en cours, ${exportPct} %` : "Exporter"} transition={calm ? { duration: 0 } : SPRING.soft}>
      {topFace}
    </motion.button>
  );

  // Un export de plus : la pastille de l'onglet « Exports » le signale (une pulsation), sans quitter les réglages.
  const doneCount = visibleExports.filter((x) => x.job.status === "done").length;
  const tabs = (
    <div className="side-tabs" role="tablist" aria-label="Panneau">
      {(["reglages", "exports"] as const).map((t) => {
        const on = tab === t;
        return (
          <button key={t} type="button" role="tab" aria-selected={on} aria-controls={t === "reglages" ? "studio-panel" : "studio-exports"} tabIndex={on ? 0 : -1}
            className={cn("side-tab", on && "is-on")} onClick={() => setTab(t)} data-side-tab={t}
            onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setTab(t === "reglages" ? "exports" : "reglages"); } }}>
            {on && <motion.span layoutId="side-tab-pill" className="side-tab-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
            <span className="relative">{t === "reglages" ? "Réglages" : "Exports"}</span>
            {t === "exports" && visibleExports.length > 0 && <span key={doneCount} className="relative side-count tabular" data-pulse={doneCount > 0 || undefined}>{visibleExports.length}</span>}
          </button>
        );
      })}
    </div>
  );

  // Réglages et médiathèque. Sur ordinateur, les deux restent montés, l'un sur l'autre : changer d'onglet ne perd ni la
  // position de défilement ni une saisie en cours, et la vidéo n'est jamais recréée. Sur téléphone, le volet les garde
  // l'un sous l'autre (pas d'onglets dans un volet de 56 % d'écran).
  const inspector = info && edit ? (
    <motion.div key={tool} initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE.soft }}>
      <Inspector tool={tool} edit={edit} set={set} info={info} limits={s.limits} currentTime={() => video.current?.currentTime ?? 0} peaks={s.wave?.peaks ?? null} live={live}
        onSample={tool === "compresser" ? doSample : undefined} sample={tool === "compresser" ? sampleView : undefined} />
    </motion.div>
  ) : <div className="insp insp-skeleton" aria-hidden="true" />;
  const library = info ? (
    <Library items={s.exports} board={s.board} boardUrl={s.board?.image ?? null} wave={s.wave} sourceDuration={info.duration}
      onDelete={(id) => void s.cancelExport(id)} onRetry={() => openExport("foot")} follow={follow}
      onLocate={(a, b) => { commit(a, Math.min(d, b)); seek(a); requestAnimationFrame(() => timeline.current?.zoomToSelection()); }} />
  ) : null;

  return (
    <TipProvider>
    <PortalTarget.Provider value={fsEl}>
    <div ref={root} className={cn("studio", sheet && "has-sheet", theater && "is-theater", collapsed && "is-collapsed", fsEl && "is-fs")} data-studio="" data-phase={s.phase.kind}>
      <header className="studio-top">
        <Link to="/outils" className="studio-back" aria-label="Retour à AETHRYON Tools"><IconBack size={18} /><span className="hidden sm:inline">Tools</span></Link>
        <Link to="/" className="studio-brand" aria-label="AETHRYON, accueil"><BrandLogo size="sm" tone="ivory" /></Link>
        <div className="studio-title" title={title}>
          <span className="truncate">{title}</span>
          {info && (
            <span className="studio-kind tabular">
              {audioOnly ? <IconWave size={14} /> : <IconFrame size={14} />}
              <span className="sr-only">{audioOnly ? "Son, " : "Vidéo, "}</span>{timecode(info.duration, 0)}
            </span>
          )}
          {s.expiresAt && <span className="studio-expiry">{remaining(s.expiresAt)}</span>}
        </div>
        <div className="studio-actions">
          <Tip label="Annuler" keys={c.undo.keys} side="bottom">
            <button type="button" className="studio-icon" onClick={c.undo.run} disabled={c.undo.disabled} aria-label="Annuler" data-undo=""><IconUndo size={18} /></button>
          </Tip>
          <Tip label="Rétablir" keys={c.redo.keys} side="bottom">
            <button type="button" className="studio-icon" onClick={c.redo.run} disabled={c.redo.disabled} aria-label="Rétablir" data-redo=""><IconRedo size={18} /></button>
          </Tip>
          {!narrow && (
            <Tip label="Raccourcis clavier" keys={["?"]} side="bottom">
              <button type="button" className="studio-icon" onClick={() => setHelp(true)} aria-label="Raccourcis clavier" data-help=""><IconKeyboard size={18} /></button>
            </Tip>
          )}
          {!narrow && (
            <Tip label={collapsed ? "Afficher les réglages" : "Masquer les réglages"} side="bottom">
              <button type="button" className={cn("studio-icon", !collapsed && "is-on")} onClick={c.panel.run} aria-pressed={!collapsed} aria-label="Panneau des réglages" data-panel-toggle=""><IconPanel size={18} /></button>
            </Tip>
          )}
          {xd.open && xd.origin === "top" ? <span className={cn("studio-export-top is-placeholder", running && "is-running")} aria-hidden="true">{topFace}</span> : topBtn}
        </div>
      </header>

      <nav className="studio-rail" aria-label="Outils">
        <div className="rail-tabs" role="tablist" aria-label="Outils" aria-orientation="vertical" onKeyDown={onRailKey}>
        {TOOL_ORDER.map((t, k) => {
          const { label, Icon } = TOOLS[t];
          const on = t === tool;
          return (
            <Tip key={t} label={unusableWhy(t) ?? label} keys={TOOL_KEYS[t]} side="right">
              <button type="button" role="tab" id={`tab-${t}`} aria-selected={on} aria-controls="studio-panel" tabIndex={on ? 0 : -1} className={cn("rail-btn", on && "is-on")}
                aria-disabled={unusable(t) || undefined} onClick={() => { if (unusable(t)) return; setTool(t); setTab("reglages"); if (narrow) setSheet(true); }} data-tool={t}>
                {on && <motion.span layoutId="rail-pill" className="rail-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
                <Icon size={22} className="relative" />
                <span className="relative rail-label">{label}</span>
              </button>
            </Tip>
          );
        })}
        </div>
      </nav>

      <main className="studio-main">
        <div ref={viewer} className="viewer" data-viewer="">
          <ContextZone label="Menu de l'aperçu" entries={stageMenu}>
            <div className="viewer-stage">
              <Stage
                ref={video}
                src={src}
                poster={poster}
                frameW={info?.width ?? 16}
                frameH={info?.height ?? 9}
                rotate={edit?.rotate ?? 0}
                flipH={edit?.flipH ?? false}
                flipV={edit?.flipV ?? false}
                crop={edit?.crop ?? null}
                ratio={cropRatio}
                showCrop={showCrop}
                onCrop={(cr) => set({ crop: cr })}
                audioOnly={audioView}
                onVideoReady={onVideo}
                onFrameClick={toggle}
                onFrameDoubleClick={fullscreen}
                glowTile={glowTile}
              >
                <AnimatePresence>
                  {s.phase.kind !== "ready" && (
                    <motion.div className="stage-overlay" initial={calm ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DUR.exit } }}>
                      <PhaseCard phase={s.phase} limits={s.limits} onResume={s.resume} onRetry={s.retry} />
                    </motion.div>
                  )}
                </AnimatePresence>
                {!audioView && <StageOverlay video={video} src={src} calm={calm} onPlay={toggle} showPlay={!showCrop && s.phase.kind === "ready"} />}
                {audioView && s.phase.kind === "ready" && info && edit && (
                  <AudioStage
                    ref={audioStage}
                    title={title}
                    info={info}
                    peaks={s.wave ? s.wave.peaks ?? [] : null}
                    shape={{ start: edit.start, end: edit.end, speed: edit.speed, volumeDb: edit.volumeDb, fadeIn: edit.fadeIn, fadeOut: edit.fadeOut }}
                    playing={playing}
                    analyser={graph.analyser}
                    routeBlocked={graph.blocked}
                    calm={calm}
                    onToggle={toggle}
                    onSeek={seek}
                    currentTime={() => video.current?.currentTime ?? 0}
                  />
                )}
              </Stage>
            </div>
          </ContextZone>
          {fsEl && info && (
            <Scrubber ref={scrubber} duration={info.duration} live={live} onSeek={seek} onCommit={(a, b) => commit(a, b)} onScrub={onScrub} board={s.board} boardUrl={s.board?.image ?? null} />
          )}
          <PlayerBar commands={commands} playing={playing} clock={clock} duration={info?.duration ?? 0} volume={prefs.volume} muted={prefs.muted}
            onVolume={(v) => setPrefs({ volume: v, muted: v === 0 ? prefs.muted : false })} rate={rate} onRate={setRate} disabled={!src} hasAudio={!!info?.has_audio} compact={tiny} />
        </div>
      </main>

      <aside ref={side} className={cn("studio-side", sheet && "is-open")} aria-label="Réglages et exports" data-side="">
        {!narrow && (
          <div className="studio-resizer" role="separator" aria-orientation="vertical" aria-label="Largeur du panneau des réglages" tabIndex={collapsed ? -1 : 0}
            aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={prefs.sideW}
            onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp}
            onDoubleClick={() => setPrefs({ sideW: PREFS_DEFAULT.sideW })} onKeyDown={onResizeKey} data-resizer="" />
        )}
        <button type="button" className="sheet-grip" onClick={() => setSheet((v) => !v)} aria-label={sheet ? "Réduire les réglages" : "Ouvrir les réglages"} aria-expanded={sheet} />
        {!narrow && <div className="side-head">{tabs}</div>}
        {narrow ? (
          <div className="side-scroll" id="studio-panel" role="tabpanel" aria-labelledby={`tab-${tool}`}>
            {inspector}
            {library}
            {notice && <p className="studio-notice" role="alert">{notice}</p>}
          </div>
        ) : (
          <div className="side-panes" data-tab={tab}>
            <div className={cn("side-scroll side-pane", tab === "reglages" && "is-on")} id="studio-panel" role="tabpanel" aria-label="Réglages" inert={tab !== "reglages"} data-pane="reglages">
              {inspector}
              {notice && <p className="studio-notice" role="alert">{notice}</p>}
            </div>
            <div className={cn("side-scroll side-pane", tab === "exports" && "is-on")} id="studio-exports" role="tabpanel" aria-label="Exports" inert={tab !== "exports"} data-pane="exports">
              {library}
            </div>
          </div>
        )}
        {info && edit && (narrow || tab === "reglages") && (
          <div className="side-foot">
            <ExportFoot tool={tool} edit={edit} set={set} info={info} limits={s.limits} disabledReason={disabledReason} exporting={busy} onExport={() => openExport("foot")}
              button={({ className, children, disabled, onClick }) => xd.open && xd.origin === "foot"
                ? <span className={cn(className, "is-placeholder")} aria-hidden="true" />
                : (
                  <motion.button layoutId="xm-foot" type="button" className={className} onClick={onClick} disabled={disabled} aria-busy={busy || undefined} data-export=""
                    transition={calm ? { duration: 0 } : SPRING.soft}>{children}</motion.button>
                )} />
          </div>
        )}
      </aside>

      <section className="studio-bottom" aria-label="Frise">
        {info && edit ? (
          <Timeline
            ref={timeline}
            duration={info.duration}
            fps={info.fps}
            live={live}
            onCommit={(a, b) => commit(a, b)}
            onSeek={seek}
            onScrub={onScrub}
            board={s.board}
            boardUrl={s.board?.image ?? null}
            wave={s.wave}
            mode={mode}
            disabled={!ready}
            over={tool === "gif" && (edit.end - edit.start) / edit.speed > (s.limits?.gifMaxS ?? 30)}
            magnet={prefs.magnet}
            onMagnet={c.magnet.run}
            onExportDrag={(e, from) => startDrag(e, from)}
            onSend={c.sendExport.run}
            transporting={!!xdrag}
            menu={timelineMenu}
            toolbar={ready ? (
              <Toolbar live={live} commands={commands} onGrip={onGrip} onSend={c.sendExport.run} compact={tiny} exportLabel={exportLabel}
                exportButton={(props) => xd.open && xd.origin === "toolbar" ? <span className="ft-export is-placeholder" aria-hidden="true" />
                  : <motion.button layoutId="xm-toolbar" {...props} transition={calm ? { duration: 0 } : SPRING.soft} />}
                more={[...selectionMenu(), cmd(c.zoomAll), sep, cmd(c.magnet), cmd(c.help)]} />
            ) : null}
          />
        ) : <div className="tl tl-skeleton" aria-hidden="true" />}
      </section>

      {info && edit && (
        <ExportPanel open={xd.open} origin={xd.origin} phase={xd.phase} nom={title} tool={tool} edit={edit} info={info} limits={s.limits} job={xdJob} perdu={!!xdState?.lost}
          erreur={xd.erreur} envoi={busy} board={s.board} boardUrl={s.board?.image ?? null} peaks={s.wave?.peaks ?? null} dropped={xd.dropped} usable={(t) => !unusable(t)} onTool={(t) => setTool(t)}
          onConfirm={() => void doExport()} onCancelJob={(jid) => { void s.cancelExport(jid); setXd((x) => ({ ...x, open: false, phase: "preparation", jobId: null, erreur: null })); }}
          onClose={() => setXd((x) => ({ ...x, open: false }))} />
      )}

      {xdrag && edit && (
        <DragExport start={xdrag} span={live.get()} title={title} board={s.board} boardUrl={s.board?.image ?? null} container={fsEl}
          target={() => exportTop.current} onDrop={() => { setXdrag(null); exportTop.current?.focus({ preventScroll: true }); openExport("top", { dropped: true }); }} onCancel={() => setXdrag(null)} />
      )}

      <Shortcuts open={help} onClose={() => setHelp(false)} commands={commands} />

      <nav className="studio-dock" aria-label="Outils">
        {TOOL_ORDER.map((t) => {
          const { label, Icon } = TOOLS[t];
          const on = t === tool;
          return (
            <motion.button key={t} type="button" className={cn("dock-btn", on && "is-on")} aria-pressed={on} onClick={() => { setTool(t); setSheet(true); }} data-dock={t}
              disabled={unusable(t)} title={unusableWhy(t) ?? undefined} whileTap={calm || unusable(t) ? undefined : { scale: 0.94 }} transition={SPRING.snappy}>
              <span className="dock-ico">
                {on && <motion.span layoutId="dock-pill" className="dock-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
                <Icon size={21} className="relative" />
              </span>
              <span className="dock-label">{label}</span>
            </motion.button>
          );
        })}
      </nav>
    </div>
    </PortalTarget.Provider>
    </TipProvider>
  );
}

/** Aide des raccourcis : toutes les commandes qui en ont un, par groupe. */
function Shortcuts({ open, onClose, commands: c }: { open: boolean; onClose(): void; commands: Commands }) {
  const groups: { title: string; ids: CommandId[] }[] = [
    { title: "Lecture", ids: ["play", "replay", "loop", "prevFrame", "nextFrame", "back1s", "fwd1s", "mute"] },
    { title: "Sélection", ids: ["setIn", "setOut", "goIn", "goOut", "goStart", "goEnd", "selectAll", "export"] },
    { title: "Frise et affichage", ids: ["zoomSel", "zoomAll", "zoomIn", "zoomOut", "magnet", "theater", "fullscreen", "help"] },
    { title: "Édition", ids: ["undo", "redo"] },
    { title: "Outils", ids: ["tool1", "tool2", "tool3", "tool4", "tool5"] },
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Raccourcis clavier" className="kb" wide>
      <div className="kb-grid">
        {groups.map((g) => (
          <section key={g.title} className="kb-group">
            <h3 className="kb-title">{g.title}</h3>
            <dl>
              {g.ids.map((id) => {
                const x = c[id];
                return x.keys ? (
                  <div key={id} className="kb-row"><dt>{id === "play" ? "Lire la sélection / Pause" : x.label.replace(/…$/, "")}</dt>
                    <dd>{x.keys.map((k, i) => <span key={k} className="kc-combo">{i > 0 && <span className="kc-or">ou</span>}<KeyCombo combo={k} /></span>)}</dd></div>
                ) : null;
              })}
            </dl>
          </section>
        ))}
      </div>
      <p className="kb-note">Outils : les touches 1 à 5 de la rangée du haut, avec ou sans Maj (sur un clavier AZERTY : &amp;, é, &quot;, &apos;, &#40;), ou le pavé numérique. Aucun raccourci n'agit pendant une saisie.</p>
      <p className="kb-note">Porter la sélection vers « Exporter » : la poignée au-dessus de la sélection, Alt + glisser, ou double-clic maintenu. Alt maintenue sur une poignée : sans aimantation. Échap : annule le geste en cours. Clic droit (ou appui long) sur l'aperçu et la frise : actions de l'endroit visé.</p>
    </Dialog>
  );
}

/** Anneau d'avancement (part réelle donnée par le serveur), posé par variable CSS. */
function Ring({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { ref.current?.style.setProperty("--p", `${Math.max(3, Math.min(100, value))}%`); }, [value]);
  return <span ref={ref} className="ring" aria-hidden="true" />;
}

/** Échecs d'une plateforme (le lien) : le fichier, s'il est sur l'appareil, passe quand même par l'import. */
const PLATFORM_FAILURES = new Set(["not_found", "unavailable", "geo_restricted", "login_required", "age_restricted", "bot_check", "upstream_rate_limited",
  "upstream_unavailable", "upstream_timeout", "extractor_broken", "upstream_forbidden", "download_failed", "format_unavailable", "upstream_error"]);

function PhaseCard({ phase, limits, onResume, onRetry }: {
  phase: ReturnType<typeof useStudio>["phase"]; limits: ToolsLimits | null; onResume(f: File): Promise<void>; onRetry(): void;
}) {
  const [err, setErr] = useState<string | null>(null);
  if (phase.kind === "loading") return <div className="phase"><AethryonMascot state="processing" size={64} /><p role="status">Ouverture…</p></div>;
  if (phase.kind === "fetching") {
    const p = Math.round(phase.job.progress ?? 0);
    return (
      <div className="phase">
        <AethryonMascot state="processing" size={64} />
        <p role="status">Récupération du média · <span className="tabular">{p}&nbsp;%</span></p>
        <Bar value={p} />
        <p className="phase-sub">Le serveur d'AETHRYON prépare le fichier une seule fois&nbsp;; tous tes exports partiront de lui.</p>
      </div>
    );
  }
  if (phase.kind === "uploading") {
    const pr = phase.progress;
    const pct = pr ? Math.round((pr.sent / Math.max(1, pr.total)) * 100) : 0;
    if (pr?.waiting) {
      return (
        <div className="phase phase-compact">
          <p role="status">Fichier envoyé · en attente</p>
          <Bar value={100} />
          <p className="phase-sub">Un autre traitement de ton compte se termine&nbsp;; la vérification suit, sans rien renvoyer.</p>
        </div>
      );
    }
    return (
      <div className="phase phase-compact">
        <p role="status">Envoi · <span className="tabular">{pct}&nbsp;% · {bytes(pr?.sent ?? 0)} / {bytes(pr?.total ?? phase.job.upload?.size_bytes ?? 0)}</span></p>
        <Bar value={pct} />
        <p className="phase-sub">L'aperçu joue déjà ton fichier&nbsp;; l'export s'ouvre à la fin de l'envoi.</p>
      </div>
    );
  }
  if (phase.kind === "checking") return <div className="phase phase-compact"><p role="status">Vérification du fichier…</p><Bar value={98} /></div>;
  if (phase.kind === "resume") {
    return (
      <div className="phase">
        <AethryonMascot state="curious" size={64} />
        <p>L'envoi de « {phase.job.title ?? phase.job.upload?.name ?? "ton fichier"} » s'est interrompu.</p>
        <label className="phase-btn">
          Choisir à nouveau le fichier pour reprendre
          <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onResume(f).catch((x: Error) => setErr(x.message)); }} />
        </label>
        {err && <p className="phase-error" role="alert">{err}</p>}
      </div>
    );
  }
  if (phase.kind === "error") {
    const limit = phase.code === "too_long" && limits?.maxDurationS ? `AETHRYON Tools accepte jusqu'à ${Math.round(limits.maxDurationS / 60)} min.`
      : phase.code === "too_large" && limits?.maxUploadMb ? `AETHRYON Tools accepte jusqu'à ${limits.maxUploadMb >= 1024 ? `${String(Math.round(limits.maxUploadMb / 102.4) / 10).replace(".", ",")} Go` : `${limits.maxUploadMb} Mo`}.`
      : null;
    return (
      <div className="phase">
        <AethryonMascot state="error" size={64} />
        <p role="alert">{phase.message}{limit && <> {limit}</>}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link to="/outils" className="phase-btn">Revenir aux outils</Link>
          {phase.code === "network" && <button type="button" className="phase-btn phase-btn-ghost" onClick={onRetry}>Réessayer</button>}
        </div>
        {phase.job?.kind === "download" && PLATFORM_FAILURES.has(phase.code) && <p className="phase-sub">Tu as le fichier sur ton appareil&nbsp;? Importe-le depuis la page des outils.</p>}
      </div>
    );
  }
  return null;
}

function Bar({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { ref.current?.style.setProperty("--p", `${Math.max(2, Math.min(100, value))}%`); }, [value]);
  return <span ref={ref} className="phase-bar" aria-hidden="true"><span className="phase-fill" /></span>;
}

