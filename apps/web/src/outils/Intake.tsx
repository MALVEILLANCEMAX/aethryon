// Entrée d'AETHRYON Tools : un lien OU un fichier, dans le même panneau. Le lien est reconnu sur l'appareil (mêmes règles
// que le service), puis le serveur dit ce qu'il contient (titre, vignette, durée, qualités) SANS rien consommer ;
// l'ouvrir dans l'éditeur compte pour une conversion du jour, dit avant. Un fichier part en morceaux vers le serveur
// pendant que l'éditeur le lit déjà sur l'appareil. Glisser un fichier n'importe où sur la page l'ouvre aussi.
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { useCalm, useMe } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { probeLink } from "../lib/probe.ts";
import { sharedFromHash } from "./link.ts";
import { PlatformMark } from "../ui/brand/PlatformMark.tsx";
import { IconAlert, IconArrowRight } from "../ui/Icon.tsx";
import { openSource, preview as fetchPreview, rememberFile, startUpload, type Preview, type ToolsLimits } from "./api.ts";
import type { Tool } from "./edit.ts";
import { bytes, duration, PLATFORM_NAME } from "./format.ts";
import { IconUpload } from "./icons.tsx";

const ACCEPT = "video/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac";
const mbLabel = (mb: number) => (mb >= 1024 ? `${String(Math.round((mb / 1024) * 10) / 10).replace(".", ",")}\u00a0Go` : `${mb}\u00a0Mo`);

export interface IntakeHandle { focus(): void; openFile(f: File): void }

/**
 * Lien transmis par l'extension (« Ouvrir dans Tools » : /outils#lien=<adresse encodée>) : dans le FRAGMENT, jamais
 * envoyé à un serveur par l'adresse ; retiré de la barre d'adresse aussitôt, gardé le temps d'une connexion
 * (sessionStorage de l'onglet). Seul un lien reconnu (YouTube, TikTok, X) est repris.
 */
const PENDING_LINK = "aethryon.outils.lien";
/** V3.5 : passage réglé dans la page, gardé avec le lien le temps de la connexion et de l'ouverture. */
const PENDING_RANGE = "aethryon.outils.passage";
type Range = { start: number; end: number };
function takePendingLink(): string | null {
  const shared = sharedFromHash(window.location.hash);
  if (shared) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    try {
      sessionStorage.setItem(PENDING_LINK, shared.url);
      if (shared.range) sessionStorage.setItem(PENDING_RANGE, JSON.stringify(shared.range));
      else sessionStorage.removeItem(PENDING_RANGE);
    } catch { /* stockage refusé : le champ suffit */ }
    return shared.url;
  }
  try {
    const kept = sessionStorage.getItem(PENDING_LINK);
    return kept && probeLink(kept).state === "ok" ? kept : null;
  } catch { return null; }
}
function pendingRange(): Range | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(PENDING_RANGE) ?? "null") as Range | null;
    return r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start >= 0.5 ? { start: r.start, end: r.end } : null;
  } catch { return null; }
}
function dropPendingLink(): void {
  try { sessionStorage.removeItem(PENDING_LINK); } catch { /* rien */ }
}
function dropPendingRange(): void {
  try { sessionStorage.removeItem(PENDING_RANGE); } catch { /* rien */ }
}

/** Qualité demandée au serveur : la meilleure en H.264 jusqu'à 1080p (lisible partout), sinon un réencodage. */
function pick(p: Preview): { quality: string; transcode: boolean } {
  const h264 = p.qualities.filter((q) => q.h264 && q.quality && q.quality <= 1080).map((q) => q.quality!);
  if (h264.length) return { quality: String(Math.max(...h264)), transcode: false };
  return { quality: "1080", transcode: (p.duration ?? 0) <= 900 };
}

export const Intake = forwardRef<IntakeHandle, { tool: Tool | null; limits: ToolsLimits | null; remaining: number | null }>(function Intake({ tool, limits, remaining }, ref) {
  const calm = useCalm();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "probing" | "preview" | "opening" | "uploading">("idle");
  const [info, setInfo] = useState<Preview | null>(null);
  const [entry, setEntry] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** L'échec vient du serveur (source introuvable, plateforme qui bloque…) : proposer le fichier à la place. */
  const [serverError, setServerError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const live = probeLink(url);

  const go = (jobId: string, poster: string | null, range: Range | null = null) =>
    navigate(`/outils/studio/${encodeURIComponent(jobId)}${tool ? `?outil=${tool}` : ""}`, { state: { poster, ...(range ? { range } : {}) } });

  const openFile = async (file: File) => {
    setError(null);
    if (!signedIn) { setNeedLogin(true); return; }
    const max = (limits?.maxUploadMb ?? 1024) * 1024 * 1024;
    if (file.size > max) { setError(`Ce fichier pèse ${bytes(file.size)}\u00a0: la limite est de ${bytes(max)}.`); return; }
    if (file.size === 0) { setError("Ce fichier est vide."); return; }
    setState("uploading");
    try {
      const job = await startUpload(file);
      rememberFile(job.id, file);
      go(job.id, null);
    } catch (e) {
      setState("idle");
      setError(e instanceof ApiError ? e.message : "L'envoi n'a pas pu commencer.");
    }
  };

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), openFile: (f) => void openFile(f) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await runPreview(url);
  };

  const runPreview = async (raw: string) => {
    setError(null);
    setServerError(false);
    if (!raw.trim()) { input.current?.focus(); return; }
    const probed = probeLink(raw);
    if (probed.state === "refus") { setError(probed.message); return; }
    if (!signedIn) { setNeedLogin(true); return; }
    setState("probing");
    setInfo(null);
    try {
      const p = await fetchPreview(raw.trim());
      dropPendingLink();
      setInfo(p);
      setEntry(p.entries?.[0]?.index ?? 1);
      setState("preview");
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError ? err.message : "Ce lien n'a pas pu être lu.");
      setServerError(true);
    }
  };

  const open = async () => {
    if (!info) return;
    setState("opening");
    setError(null);
    try {
      const chosen = info.entries?.find((x) => x.index === entry) ?? info;
      const job = await openSource({ url: url.trim(), ...pick({ ...info, ...chosen } as Preview), ...(info.entries ? { index: entry } : {}) });
      const range = pendingRange();
      dropPendingRange();
      go(job.id, chosen.thumbnail ?? null, range);
    } catch (err) {
      setState("preview");
      setError(err instanceof ApiError ? err.message : "Ce média n'a pas pu être ouvert.");
      setServerError(!(err instanceof ApiError && err.code === "quota_exceeded"));
    }
  };

  useEffect(() => { if (state === "preview") card.current?.focus({ preventScroll: true }); }, [state]);

  // Lien venu de l'extension : posé dans le champ ; aperçu demandé dès que la session est connue (il ne consomme rien).
  const pending = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (pending.current === undefined) {
      pending.current = takePendingLink();
      if (pending.current) setUrl(pending.current);
    }
    if (!pending.current || me.loading) return;
    const link = pending.current;
    pending.current = null;
    if (signedIn) void runPreview(link);
    else setNeedLogin(true);
  }, [me.loading, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = info?.entries?.find((x) => x.index === entry) ?? info;
  const tooLong = !!shown?.duration && !!limits?.maxDurationS && shown.duration > limits.maxDurationS;

  return (
    <div className="intake" data-intake="">
      <form className="probe intake-link" data-state={live.state === "ok" ? "ok" : live.state === "refus" && url ? "refus" : undefined} onSubmit={submit} noValidate>
        <div className="probe-field">
          <span className="probe-mark" aria-hidden="true">{live.state === "ok" ? <PlatformMark id={live.platform} size={18} tone="light" /> : <LinkGlyph />}</span>
          <label htmlFor={`${id}-lien`} className="sr-only">Lien d'une vidéo YouTube, TikTok ou X</label>
          <input ref={input} id={`${id}-lien`} className="probe-input" type="url" inputMode="url" autoComplete="off" spellCheck={false}
            placeholder="Colle un lien YouTube, TikTok ou X" value={url}
            onChange={(e) => { setUrl(e.target.value); if (state === "preview") { setState("idle"); setInfo(null); } setError(null); }} data-intake-url="" />
          <button type="submit" className="intake-go" disabled={state === "probing"} aria-busy={state === "probing" || undefined}>
            {state === "probing" ? "Lecture…" : "Ouvrir"} <IconArrowRight size={16} />
          </button>
        </div>
        <div className="intake-or" aria-hidden="true"><span>ou</span></div>
        <button type="button" className="intake-drop" onClick={() => fileInput.current?.click()} disabled={state === "uploading"} data-intake-file="">
          <IconUpload size={20} />
          <span><b>{state === "uploading" ? "Préparation de l'envoi…" : "Importer un fichier"}</b> · vidéo ou son, {mbLabel(limits?.maxUploadMb ?? 1024)} au plus</span>
        </button>
        <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openFile(f); }} />
      </form>

      <div aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          {needLogin && !signedIn && (
            <motion.div key="login" className="intake-card intake-login" initial={calm ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }}>
              <p>Ouvre ce média avec ton compte AETHRYON, gratuit.</p>
              <div className="flex flex-wrap gap-2.5">
                <Link to={`/connexion?retour=${encodeURIComponent("/outils")}`} className="intake-btn">Se connecter</Link>
                <Link to="/commencer" className="intake-btn intake-btn-ghost">Créer un compte</Link>
              </div>
            </motion.div>
          )}
          {error && (
            <motion.div key="err" role="alert" className="intake-error" initial={calm ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <IconAlert size={17} className="mt-0.5 shrink-0" />
              <div>
                <p>{error}</p>
                {serverError && (
                  <button type="button" className="intake-alt" onClick={() => fileInput.current?.click()}>
                    Tu as le fichier sur ton appareil&nbsp;? Importe-le à la place
                  </button>
                )}
              </div>
            </motion.div>
          )}
          {info && shown && (state === "preview" || state === "opening") && (
            <motion.div key="preview" ref={card} tabIndex={-1} className="intake-card intake-preview" data-preview=""
              initial={calm ? false : { opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: DUR.component, ease: EASE.soft }}>
              <div className="pv-thumb">
                {shown.thumbnail ? <img src={shown.thumbnail} alt="" className="pv-img" /> : <span className="pv-noimg" aria-hidden="true" />}
                {shown.duration ? <span className="pv-dur tabular">{duration(shown.duration)}</span> : null}
              </div>
              <div className="pv-text">
                <p className="pv-platform">{PLATFORM_NAME[info.platform ?? ""] ?? info.platform}{shown.uploader ? ` · ${shown.uploader}` : ""}</p>
                <p className="pv-title">{shown.title ?? "Sans titre"}</p>
                <ul className="pv-chips" aria-label="Ce que contient ce lien">
                  {shown.bestH264 ? <li>Vidéo {Math.min(1080, shown.bestH264)}p</li> : shown.qualities[0]?.quality ? <li>Vidéo {Math.min(1080, shown.qualities[0].quality)}p</li> : null}
                  <li>{shown.audio === "no" ? "Sans son" : shown.audio === "yes" ? "Avec le son" : "Son : à vérifier"}</li>
                  {shown.isGif && <li>GIF animé</li>}
                </ul>
                {info.entries && info.entries.length > 1 && (
                  <div className="pv-entries" role="radiogroup" aria-label="Vidéo de la publication">
                    {info.entries.map((x) => (
                      <button key={x.index} type="button" role="radio" aria-checked={x.index === entry} className={cn("chip", x.index === entry && "is-on")} onClick={() => setEntry(x.index ?? 1)}>
                        Vidéo {x.index}
                      </button>
                    ))}
                  </div>
                )}
                {shown.live ? <p className="intake-error">Les directs ne s'ouvrent pas dans l'éditeur.</p>
                  : tooLong ? <p className="intake-error">Ce média dure plus de {Math.round((limits?.maxDurationS ?? 3600) / 60)} min, la limite du service.</p>
                  : (
                    <div className="pv-actions">
                      <button type="button" className="intake-btn" onClick={open} disabled={state === "opening"} aria-busy={state === "opening" || undefined} data-open="">
                        {state === "opening" ? "Ouverture…" : "Ouvrir dans l'éditeur"} <IconArrowRight size={16} />
                      </button>
                      <span className="pv-cost">1 conversion du jour{remaining !== null ? ` · il t'en reste ${remaining}` : ""}&nbsp;; les exports sont inclus.</span>
                    </div>
                  )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}
