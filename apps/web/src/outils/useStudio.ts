// État de l'éditeur d'AETHRYON Tools pour un média (job ytapi) : chargement et attente du fichier source (lien en cours
// de récupération, fichier en cours d'envoi ou à reprendre), informations du média, planche et forme d'onde, maintien
// en vie tant que la page est ouverte (POST …/garder toutes les 4 min, page visible), exports (lancement, suivi réel,
// annulation). Le fichier local d'un import en cours est lu sur place (blob:) : aperçu immédiat, rien en mémoire.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api.ts";
import {
  deleteJob, deriveJob, forgetFile, getInfo, getJob, getStoryboard, getWaveform, keepJob, listMedia, localFile, rememberFile,
  sendFile, waitJob, type MediaInfo, type Storyboard, type ToolsJob, type ToolsLimits, type UploadProgress, type Waveform,
} from "./api.ts";

export type SourcePhase =
  | { kind: "loading" }
  | { kind: "fetching"; job: ToolsJob }                       // lien : récupération par le serveur
  | { kind: "uploading"; job: ToolsJob; progress: UploadProgress | null } // fichier : envoi en cours (aperçu local)
  | { kind: "resume"; job: ToolsJob }                         // envoi interrompu (page rechargée) : choisir le fichier
  | { kind: "checking"; job: ToolsJob }                       // fichier reçu, vérification
  | { kind: "ready"; job: ToolsJob }
  | { kind: "error"; message: string; code: string; job?: ToolsJob };

/** `lost` : la connexion est coupée pendant le suivi (l'export continue sur le serveur). */
export interface ExportState { job: ToolsJob; tool: string; startedAt: number; lost?: boolean }

const KEEP_EVERY_MS = 4 * 60_000;

export function useStudio(id: string) {
  const [phase, setPhase] = useState<SourcePhase>({ kind: "loading" });
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [limits, setLimits] = useState<ToolsLimits | null>(null);
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [wave, setWave] = useState<Waveform | null>(null);
  const [exports, setExports] = useState<ExportState[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // URL locale (blob:) du fichier en cours d'envoi : aperçu immédiat, libérée en quittant.
  useEffect(() => {
    const f = localFile(id);
    if (!f) return;
    const url = URL.createObjectURL(f);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [id]);

  const finishReady = useCallback(async (job: ToolsJob, signal: AbortSignal) => {
    setPhase({ kind: "ready", job });
    setExpiresAt(job.expiresAt);
    const media = job.media ?? await getInfo(job.id);
    if (signal.aborted) return;
    setInfo(media);
    // Planche et forme d'onde : en parallèle, chacune à son rythme (la frise s'affiche dès que l'une arrive).
    if (media.has_video) getStoryboard(job.id).then((b) => { if (!signal.aborted) setBoard(b); }).catch(() => setBoard({ count: 0 }));
    if (media.has_audio) getWaveform(job.id).then((w) => { if (!signal.aborted) setWave(w); }).catch(() => setWave({ count: 0 }));
    keepJob(job.id).then((k) => { if (!signal.aborted && k.expiresAt) setExpiresAt(k.expiresAt); }).catch(() => undefined);
  }, []);

  const follow = useCallback(async (job: ToolsJob, signal: AbortSignal) => {
    const end = await waitJob(job.id, (j) => {
      if (signal.aborted) return;
      if (j.kind === "upload" && j.stage === "checking") setPhase({ kind: "checking", job: j });
      else if (j.status === "queued" || j.status === "running") setPhase({ kind: j.kind === "upload" ? "checking" : "fetching", job: j });
    }, signal);
    if (signal.aborted) return;
    if (end.status === "done") await finishReady(end, signal);
    else setPhase({ kind: "error", message: end.message ?? "Le média n'a pas pu être préparé.", code: end.error ?? "error", job: end });
  }, [finishReady]);

  const upload = useCallback(async (job: ToolsJob, file: File, signal: AbortSignal) => {
    rememberFile(job.id, file);
    setPhase({ kind: "uploading", job, progress: null });
    const after = await sendFile(job, file, (p) => { if (!signal.aborted) setPhase({ kind: "uploading", job, progress: p }); }, signal);
    forgetFile(job.id);
    if (after.status === "done") { await finishReady(after, signal); return; }
    if (after.status === "error") { setPhase({ kind: "error", message: after.message ?? "Fichier refusé.", code: after.error ?? "error", job: after }); return; }
    setPhase({ kind: "checking", job: after });
    await follow(after, signal);
  }, [finishReady, follow]);

  const start = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: "loading" });
    try {
      const [job, list] = await Promise.all([getJob(id), listMedia().catch(() => null)]);
      if (ctrl.signal.aborted) return;
      if (list) {
        setLimits(list.limits);
        setExports(list.items.filter((j) => j.kind === "derive" && j.derive?.sourceId === id)
          .map((j) => ({ job: j, tool: String(j.derive?.op ?? ""), startedAt: Date.parse(j.createdAt ?? "") || Date.now() })));
      }
      if (job.status === "done") { await finishReady(job, ctrl.signal); return; }
      if (job.status === "error") { setPhase({ kind: "error", message: job.message ?? "Ce média n'a pas pu être préparé.", code: job.error ?? "error", job }); return; }
      if (job.kind === "upload" && job.stage === "uploading") {
        const f = localFile(id);
        if (f) { await upload(job, f, ctrl.signal); return; }
        setPhase({ kind: "resume", job });
        return;
      }
      await follow(job, ctrl.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "Connexion impossible.");
      setPhase({ kind: "error", message: err.status === 404 ? "Ce média n'existe plus\u00a0: il a expiré ou il a été supprimé." : err.message, code: err.code });
    }
  }, [id, finishReady, follow, upload]);

  useEffect(() => { void start(); return () => abort.current?.abort(); }, [start]);

  /** Reprise d'un envoi interrompu : le même fichier (nom et taille) est demandé. */
  const resume = useCallback(async (file: File) => {
    if (phase.kind !== "resume") return;
    const up = phase.job.upload;
    if (up && file.size !== up.size_bytes) throw new Error("Ce n'est pas le même fichier (taille différente).");
    const ctrl = abort.current ?? new AbortController();
    setLocalUrl(URL.createObjectURL(file));
    try { await upload(phase.job, file, ctrl.signal); } catch (e) {
      if ((e as Error).name !== "AbortError") setPhase({ kind: "error", message: (e as Error).message, code: "upload_error", job: phase.job });
    }
  }, [phase, upload]);

  // Maintien en vie : tant que la page est visible, le serveur garde le média (et ses exports).
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const tick = () => { if (document.visibilityState === "visible") keepJob(id).then((k) => k.expiresAt && setExpiresAt(k.expiresAt)).catch(() => undefined); };
    const t = window.setInterval(tick, KEEP_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [phase.kind, id]);

  // ---- exports ---------------------------------------------------------------------------------------------------

  const watchers = useRef(new Map<string, AbortController>());
  const track = useCallback((job: ToolsJob, tool: string) => {
    setExports((list) => [{ job, tool, startedAt: Date.now() }, ...list.filter((x) => x.job.id !== job.id)]);
    if (job.status === "done" || job.status === "error" || watchers.current.has(job.id)) return;
    const ctrl = new AbortController();
    watchers.current.set(job.id, ctrl);
    void waitJob(job.id, (j) => setExports((list) => list.map((x) => (x.job.id === j.id ? { ...x, job: j } : x))), ctrl.signal,
      (lost) => setExports((list) => list.map((x) => (x.job.id === job.id ? { ...x, lost } : x))))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setExports((list) => list.map((x) => (x.job.id === job.id ? { ...x, job: { ...x.job, status: "error", message: (e as Error).message } } : x)));
      })
      .finally(() => watchers.current.delete(job.id));
  }, []);

  useEffect(() => {
    // Exports d'une visite précédente encore en cours : suivis à nouveau.
    for (const x of exports) if ((x.job.status === "queued" || x.job.status === "running") && !watchers.current.has(x.job.id)) track(x.job, x.tool);
  }, [exports, track]);

  useEffect(() => () => { for (const c of watchers.current.values()) c.abort(); }, []);

  const runExport = useCallback(async (tool: string, body: Record<string, unknown>) => {
    const job = await deriveJob(id, body);
    track(job, tool);
    return job;
  }, [id, track]);

  const cancelExport = useCallback(async (exportId: string) => {
    watchers.current.get(exportId)?.abort();
    await deleteJob(exportId).catch(() => undefined);
    setExports((list) => list.filter((x) => x.job.id !== exportId));
  }, []);

  return { phase, info, limits, board, wave, exports, expiresAt, localUrl, resume, retry: start, runExport, cancelExport };
}
