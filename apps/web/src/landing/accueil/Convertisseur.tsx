// Le champ de l'accueil (2026-10-29 ; composition de référence : Datenshi, docs/DESIGN.md §0) : l'identité, une phrase,
// le champ du lien et son action, trois formats. Puis, sur place, le VRAI parcours d'AETHRYON Tools, sans aucune autre
// route : aperçu du média (aucune unité de quota), format et passage éventuel, ouverture de la source (une conversion du
// jour), export MP3, GIF ou passage (minutes d'export), progression, fichier à télécharger. Les limites et les refus
// sont ceux du serveur, dits tels quels.
// Sans compte : le lien et le format attendent dans l'onglet (sessionStorage) pendant la connexion ; au retour, l'analyse
// reprend ici. La chouette pixel, posée sur le champ, cligne de temps en temps et bat des ailes quand un lien arrive et
// quand le fichier est prêt. Textes : français, anglais ou espagnol (i18n/accueil.ts).
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../../lib/api.ts";
import { useCalm, useConfig, useMe } from "../../lib/hooks.ts";
import { useLangue } from "../../lib/langue.ts";
import { reconnaitre, type Reconnaissance } from "../../lib/reconnaitre.ts";
import { useResource } from "../../lib/store.ts";
import { useT, type Textes } from "../../i18n/accueil.ts";
import { deleteJob, deriveJob, getInfo, openSource, preview as apercu, waitJob, type Preview, type ToolsJob, type ToolsLimits } from "../../outils/api.ts";
import { choixSource } from "../../outils/choix.ts";
import { exportBody, initialEdit, type Tool } from "../../outils/edit.ts";
import { bytes, duration as duree, PLATFORM_NAME } from "../../outils/format.ts";
import { Icone, Medaille, type NomIcone } from "../../ui/egide/Egide.tsx";
import { ChouettePixel, type Humeur } from "./ChouettePixel.tsx";

export type Format = "mp4" | "mp3" | "gif";
const FORMATS: { id: Format; nom: string; icone: NomIcone }[] = [
  { id: "mp4", nom: "MP4", icone: "video" },
  { id: "mp3", nom: "MP3", icone: "musique" },
  { id: "gif", nom: "GIF", icone: "gif" },
];
/** Lien et format gardés dans l'onglet pendant la connexion (jamais envoyés au serveur avant l'analyse). */
const ATTENTE = "aethryon.accueil.lien";

type Etape =
  | { k: "repos" }
  | { k: "connexion" }
  | { k: "analyse" }
  | { k: "apercu"; p: Preview }
  | { k: "conversion"; p: Preview; phase: "source" | "export"; job: ToolsJob | null }
  | { k: "pret"; p: Preview; job: ToolsJob; source: string }
  | { k: "erreur"; message: string; p: Preview | null };

const message = (e: unknown, t: Textes) => (e instanceof ApiError || e instanceof Error ? e.message : t.erreurDefaut);
/** « 7:16 », « 1:02:05 », « 436 », « 7 min 16 s » ou « 7m16 » → secondes ; null si illisible. */
export function secondes(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/\u00a0/g, " ");
  if (/^\d{1,5}$/.test(s)) return Number(s);
  const hms = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hms) return hms[3] !== undefined ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : Number(hms[1]) * 60 + Number(hms[2]);
  const mots = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|mn|m))?\s*(?:(\d+)\s*(?:s|sec)?)?$/);
  if (mots && (mots[1] || mots[2] || mots[3])) return Number(mots[1] ?? 0) * 3600 + Number(mots[2] ?? 0) * 60 + Number(mots[3] ?? 0);
  return null;
}
/** Secondes → « 7:16 » ou « 1:02:05 », le format que les champs du passage relisent. */
export function horloge(v: number): string {
  const s = Math.max(0, Math.round(v));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

function lireAttente(): { lien: string; format: Format } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(ATTENTE) ?? "null") as { lien?: string; format?: string } | null;
    if (!v?.lien) return null;
    return { lien: v.lien, format: v.format === "mp3" || v.format === "gif" ? v.format : "mp4" };
  } catch { return null; }
}
function garder(lien: string, format: Format) { try { sessionStorage.setItem(ATTENTE, JSON.stringify({ lien, format })); } catch { /* stockage indisponible */ } }
function oublier() { try { sessionStorage.removeItem(ATTENTE); } catch { /* rien */ } }

export function Convertisseur({ entree }: { entree?: ReactNode }) {
  const id = useId();
  const t = useT();
  const langue = useLangue();
  const calm = useCalm();
  const cfg = useConfig();
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const outils = useResource<{ limits: ToolsLimits }>(connecte ? "/api/outils/medias" : null, 60_000);
  const limits = outils.data?.limits ?? null;
  const champ = useRef<HTMLInputElement>(null);
  const [lien, setLien] = useState("");
  const [format, setFormat] = useState<Format>("mp4");
  const [reco, setReco] = useState<Reconnaissance | null>(null);
  const [etape, setEtape] = useState<Etape>({ k: "repos" });
  const [passage, setPassage] = useState<Passage>({ on: false, debut: 0, fin: 0 });
  const [saut, setSaut] = useState(0);
  const [focus, setFocus] = useState(false);
  const arret = useRef<AbortController | null>(null);
  const courant = useRef<string | null>(null);
  const quotidien = cfg.data?.quotas?.daily ?? 10;

  const sauter = () => { if (!calm) setSaut((n) => n + 1); };
  const lire = (v: string) => {
    setLien(v);
    const r = v.trim() ? reconnaitre(v, cfg.data?.platforms) : null;
    if (r?.ok && !reco?.ok) sauter();
    setReco(r);
    if (etape.k === "erreur" || etape.k === "connexion") setEtape({ k: "repos" });
  };

  const analyser = async (l: string, f: Format = format) => {
    setEtape({ k: "analyse" });
    try {
      const p = await apercu(l.trim());
      const d = p.duration ?? 0;
      const gifMax = limits?.gifMaxS ?? 15;
      // Un GIF ne couvre qu'un passage court : proposé d'emblée quand le média dépasse la limite du serveur.
      setPassage({ on: f === "gif" && d > gifMax, debut: 0, fin: f === "gif" ? Math.min(d, gifMax) : d });
      setEtape({ k: "apercu", p });
    } catch (e) {
      setEtape({ k: "erreur", message: message(e, t), p: null });
    }
  };

  // Retour de la connexion : le lien gardé dans l'onglet revient dans le champ, et l'analyse reprend.
  const repris = useRef(false);
  useEffect(() => {
    if (repris.current || me.loading) return;
    const a = lireAttente();
    if (!a) return;
    repris.current = true;
    setLien(a.lien); setFormat(a.format); setReco(reconnaitre(a.lien, cfg.data?.platforms));
    if (connecte) { oublier(); void analyser(a.lien, a.format); }
  }, [me.loading, connecte]); // eslint-disable-line react-hooks/exhaustive-deps

  // « Nouvelle conversion » (panneau) : tout revient au repos, le champ prend la main.
  useEffect(() => {
    const neuf = () => { reinitialiser(); window.setTimeout(() => champ.current?.focus(), 60); };
    window.addEventListener("aethryon:nouvelle-conversion", neuf);
    return () => window.removeEventListener("aethryon:nouvelle-conversion", neuf);
  });
  useEffect(() => () => arret.current?.abort(), []);

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    const r = lien.trim() ? reconnaitre(lien, cfg.data?.platforms) : null;
    setReco(r ?? { ok: false, message: t.collerDabord });
    if (!r?.ok) { champ.current?.focus(); return; }
    if (!r.r.dansTools) { setEtape({ k: "erreur", message: t.pasDansSite(r.r.libelle), p: null }); return; }
    if (!connecte) { garder(lien.trim(), format); setEtape({ k: "connexion" }); return; }
    await analyser(lien);
  };

  const bornes = (p: Preview): { debut: number; fin: number } | string => {
    const d = p.duration ?? 0;
    if (!passage.on) return { debut: 0, fin: d };
    const a = passage.debut, b = passage.fin;
    if (b <= a) return t.errOrdre;
    if (d && b > d + 0.5) return t.errDuree(horloge(d));
    if (format === "gif" && limits?.gifMaxS && b - a > limits.gifMaxS) return t.errGif(limits.gifMaxS);
    return { debut: a, fin: Math.min(b, d || b) };
  };

  const convertir = async (p: Preview) => {
    const b = bornes(p);
    if (typeof b === "string") return;
    const ctrl = new AbortController();
    arret.current = ctrl;
    setEtape({ k: "conversion", p, phase: "source", job: null });
    const suivre = (j: ToolsJob) => setEtape((x) => (x.k === "conversion" ? { ...x, job: j } : x));
    try {
      const entree0 = p.entries?.[0];
      let job = await openSource({ url: lien.trim(), ...choixSource(entree0 ? ({ ...p, ...entree0 } as Preview) : p), ...(entree0 ? { index: entree0.index ?? 1 } : {}) });
      courant.current = job.id;
      suivre(job);
      job = await waitJob(job.id, suivre, ctrl.signal);
      if (job.status === "error") throw new Error(job.message ?? job.error ?? t.sourceKo);
      const source = job.id;
      if (format !== "mp4" || passage.on) {
        // Comme l'éditeur (useStudio) : les caractéristiques du média, sinon demandées au serveur.
        const info = job.media ?? await getInfo(job.id);
        const outil: Tool = format === "mp3" ? "audio" : format === "gif" ? "gif" : "couper";
        const reglage = { ...initialEdit(info, limits), ...(passage.on ? { start: b.debut, end: b.fin } : {}) };
        let d = await deriveJob(job.id, exportBody(outil, reglage, info));
        courant.current = d.id;
        setEtape({ k: "conversion", p, phase: "export", job: d });
        d = await waitJob(d.id, suivre, ctrl.signal);
        if (d.status === "error") throw new Error(d.message ?? d.error ?? t.fichierKo);
        job = d;
      }
      courant.current = null;
      setEtape({ k: "pret", p, job, source });
      sauter();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setEtape({ k: "erreur", message: message(e, t), p });
    }
  };

  const annuler = (p: Preview) => {
    arret.current?.abort();
    if (courant.current) void deleteJob(courant.current).catch(() => undefined);
    courant.current = null;
    setEtape({ k: "apercu", p });
  };
  function reinitialiser() {
    arret.current?.abort();
    courant.current = null;
    setLien(""); setReco(null); setEtape({ k: "repos" });
  }

  const occupe = etape.k === "analyse" || etape.k === "conversion";
  const reste = connecte ? me.data?.today.remaining : undefined;
  const aide = reco && !reco.ok ? (lien.trim() ? (t.refus ?? reco.message) : t.collerDabord)
    : reco?.ok ? (reco.r.dansTools ? t.reconnu(langue === "fr" ? reco.r.libelle : "", reco.r.nom) : t.ailleurs(reco.r.libelle))
    : typeof reste === "number" ? (reste > 0 ? t.reste(reste) : t.epuise)
    : t.quota(quotidien);
  // La chouette dit ce qui se passe vraiment : elle regarde le champ, reconnaît le lien (ou pas), réfléchit pendant
  // l'analyse, se concentre pendant la conversion, se réjouit du fichier prêt, s'attriste d'une erreur.
  const humeur: Humeur = etape.k === "pret" ? "joie" : etape.k === "erreur" ? "triste" : etape.k === "conversion" ? "concentree"
    : etape.k === "analyse" ? "reflechit" : etape.k === "connexion" ? "clin" : etape.k === "apercu" ? "contente"
    : reco && !reco.ok && lien.trim() ? "perplexe" : reco?.ok ? "contente" : focus || lien ? "curieuse" : "neutre";
  const fondu = calm ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.12 } } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 0.8, 0.26, 1] as const } }, exit: { opacity: 0, y: -4, transition: { duration: 0.16 } } };

  return (
    <div className="ac-centre" data-etape={etape.k}>
      {entree}
      <form className="ac-champ" onSubmit={envoyer} action="/commencer" method="get" noValidate data-hero-champ="" data-etat={reco ? (reco.ok ? "ok" : "refus") : undefined}>
        <ChouettePixel saut={saut} humeur={humeur} taille={60} />
        <label htmlFor={`${id}-lien`} className="eg-vh">{t.libelleChamp}</label>
        <Icone nom="lien" taille="s" className="ac-champ-icone" />
        <input ref={champ} id={`${id}-lien`} type="url" inputMode="url" autoComplete="off" spellCheck={false} enterKeyHint="go"
          placeholder={t.placeholder} value={lien} onChange={(e) => lire(e.target.value)} disabled={occupe}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          aria-describedby={`${id}-aide`} aria-invalid={reco && !reco.ok ? true : undefined} />
        <button type="submit" className="ac-convertir" disabled={occupe} aria-label={t.action[format]} data-accueil-convertir="">
          <span className="ac-convertir-long">{t.action[format]}</span><span className="ac-convertir-court" aria-hidden="true">{t.convertirCourt}</span>
          <Icone nom="droite" taille="s" />
        </button>
      </form>
      <div className="ac-formats" role="group" aria-label={t.formatGroupe}>
        {FORMATS.map((f) => (
          <button key={f.id} type="button" className="ac-format" aria-pressed={format === f.id} aria-label={`${f.nom}, ${t.formats[f.id]}`} disabled={occupe} onClick={() => setFormat(f.id)} data-format={f.id}>
            <Icone nom={f.icone} taille="s" /><b>{f.nom}</b>
          </button>
        ))}
      </div>
      <p id={`${id}-aide`} className="ac-aide" data-etat={reco ? (reco.ok ? "ok" : "refus") : "repos"} role={reco && !reco.ok ? "alert" : undefined}>{aide}</p>

      <div className="ac-suite" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {etape.k === "connexion" && (
            <motion.div key="connexion" className="ac-carte" data-carte="connexion" {...fondu}>
              <p className="ac-carte-titre">{t.connexionTitre}</p>
              <p className="ac-carte-texte">{t.connexionTexte(quotidien)}</p>
              <div className="ac-actions">
                <Link to="/connexion?suite=%2F" className="ac-bouton" data-accueil-connexion=""><Icone nom="compte" taille="s" />{t.seConnecter}</Link>
                <Link to="/commencer?suite=%2F" className="ac-bouton ac-bouton--second" data-accueil-commencer="">{t.creerCompte}</Link>
              </div>
            </motion.div>
          )}
          {etape.k === "analyse" && (
            <motion.div key="analyse" className="ac-carte ac-carte--attente" data-carte="analyse" role="status" {...fondu}>
              <span className="ac-veille" aria-hidden="true" /><p className="ac-carte-texte">{t.analyse}</p>
            </motion.div>
          )}
          {(etape.k === "apercu" || etape.k === "conversion" || etape.k === "pret" || (etape.k === "erreur" && etape.p)) && (
            <motion.div key="media" className="ac-carte" data-carte={etape.k} {...fondu}>
              <Media p={(etape as { p: Preview }).p} t={t} />
              {etape.k === "apercu" && (
                <ChoixPassage p={etape.p} format={format} passage={passage} setPassage={setPassage} t={t} gifMax={limits?.gifMaxS ?? null}
                  erreur={(() => { const b = bornes(etape.p); return typeof b === "string" ? b : null; })()} />
              )}
              {etape.k === "apercu" && (
                <div className="ac-actions">
                  <button type="button" className="ac-bouton" onClick={() => void convertir(etape.p)} data-accueil-lancer=""><Icone nom="convertir" taille="s" />{t.action[format]}</button>
                  <button type="button" className="ac-lien" onClick={reinitialiser}>{t.changerLien}</button>
                </div>
              )}
              {etape.k === "apercu" && <p className="ac-note">{t.note(format !== "mp4" || passage.on)}</p>}
              {etape.k === "conversion" && <Progression etape={etape} t={t} onAnnuler={() => annuler(etape.p)} />}
              {etape.k === "pret" && <Resultat job={etape.job} source={etape.source} t={t} langue={langue} onAutre={() => { reinitialiser(); window.setTimeout(() => champ.current?.focus(), 60); }} />}
              {etape.k === "erreur" && <Echec message={etape.message} t={t} onReessayer={() => void convertir(etape.p!)} onAutre={reinitialiser} />}
            </motion.div>
          )}
          {etape.k === "erreur" && !etape.p && (
            <motion.div key="echec" className="ac-carte" data-carte="erreur" {...fondu}>
              <Echec message={etape.message} t={t} onReessayer={() => void analyser(lien)} onAutre={reinitialiser} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Media({ p, t }: { p: Preview; t: Textes }) {
  const plateforme = p.platform ? (PLATFORM_NAME[p.platform] ?? p.platform) : null;
  const meta = [plateforme, p.duration ? duree(p.duration) : null, p.uploader].filter(Boolean).join(" · ");
  return (
    <div className="ac-media" data-media="">
      {p.thumbnail ? <img className="ac-vignette" src={p.thumbnail} alt="" decoding="async" /> : <span className="ac-vignette ac-vignette--vide" aria-hidden="true" />}
      <div className="ac-media-texte">
        <p className="ac-media-titre">{p.title ?? t.sansTitre}</p>
        {meta && <p className="ac-media-meta">{meta}</p>}
        {p.mediaCount > 1 && <p className="ac-media-meta">{t.premierDe(p.mediaCount)}</p>}
      </div>
    </div>
  );
}

type Passage = { on: boolean; debut: number; fin: number };

/** Un temps modifiable (« 1:05 », « 65 », « 1 min 5 s ») : relu à chaque frappe, remis au propre en quittant le champ. */
function Temps({ libelle, valeur, onValeur, invalide, decrit }: { libelle: string; valeur: number; onValeur: (s: number) => void; invalide: boolean; decrit?: string }) {
  const id = useId();
  const [texte, setTexte] = useState(horloge(valeur));
  const [illisible, setIllisible] = useState(false);
  useEffect(() => { setTexte(horloge(valeur)); setIllisible(false); }, [valeur]);
  return (
    <label className="ac-temps" htmlFor={id} data-invalide={invalide || illisible ? "" : undefined}>
      <span>{libelle}</span>
      <input id={id} inputMode="numeric" className="tabular" value={texte} aria-invalid={invalide || illisible ? true : undefined} aria-describedby={decrit}
        onChange={(e) => { setTexte(e.target.value); const v = secondes(e.target.value); setIllisible(v === null); if (v !== null) onValeur(v); }}
        onBlur={() => { if (secondes(texte) !== null) setTexte(horloge(valeur)); }} />
    </label>
  );
}

function ChoixPassage({ p, format, passage, setPassage, erreur, t, gifMax }: {
  p: Preview; format: Format; passage: Passage; setPassage: (f: (v: Passage) => Passage) => void; erreur: string | null; t: Textes; gifMax: number | null;
}) {
  const id = useId();
  const d = Math.max(1, Math.round(p.duration ?? 0));
  const N = 56;
  const tout = format === "gif" ? t.depuisDebut : t.toutMedia;
  return (
    <fieldset className="ac-passage" data-passage={passage.on ? "on" : "off"}>
      <legend className="eg-vh">{t.recuperes}</legend>
      <div className="ac-choix" role="radiogroup" aria-label={t.recuperes}>
        <button type="button" role="radio" aria-checked={!passage.on} className="ac-format" onClick={() => setPassage((v) => ({ ...v, on: false }))}>
          <Icone nom="film" taille="s" /><span>{tout}</span>{p.duration ? <span className="ac-choix-duree tabular">{horloge(p.duration)}</span> : null}
        </button>
        <button type="button" role="radio" aria-checked={passage.on} className="ac-format" onClick={() => setPassage((v) => ({ ...v, on: true }))} data-passage-choix="">
          <Icone nom="ciseaux" taille="s" /><span>{t.unPassage}</span>
        </button>
      </div>
      {passage.on && (
        <div className="ac-frise" data-frise="">
          {/* La frise : un point par tranche du média, en or dans le passage ; deux poignées (curseurs natifs, clavier compris). */}
          <div className="ac-frise-piste">
            <div className="ac-frise-points" aria-hidden="true">
              {Array.from({ length: N }, (_, i) => { const c = ((i + 0.5) / N) * d; return <span key={i} data-on={c >= passage.debut && c <= passage.fin ? "" : undefined} />; })}
            </div>
            <input type="range" min={0} max={d} step={1} value={Math.min(passage.debut, d)} aria-label={t.debut} aria-valuetext={horloge(passage.debut)}
              onChange={(e) => { const v = Number(e.target.value); setPassage((x) => ({ ...x, debut: Math.min(v, x.fin - 1) })); }} />
            <input type="range" min={0} max={d} step={1} value={Math.min(passage.fin, d)} aria-label={t.fin} aria-valuetext={horloge(passage.fin)}
              onChange={(e) => { const v = Number(e.target.value); setPassage((x) => ({ ...x, fin: Math.max(v, x.debut + 1) })); }} />
          </div>
          <div className="ac-frise-temps">
            <Temps libelle={t.debut} valeur={passage.debut} invalide={!!erreur} decrit={erreur ? `${id}-e` : undefined} onValeur={(v) => setPassage((x) => ({ ...x, debut: v }))} />
            <span className="ac-frise-duree tabular" aria-live="polite">{horloge(Math.max(0, passage.fin - passage.debut))}{format === "gif" && gifMax ? <span className="ac-frise-max"> / {gifMax}{"\u00a0"}s max</span> : null}</span>
            <Temps libelle={t.fin} valeur={passage.fin} invalide={!!erreur} decrit={erreur ? `${id}-e` : undefined} onValeur={(v) => setPassage((x) => ({ ...x, fin: v }))} />
          </div>
        </div>
      )}
      {passage.on && erreur && <p id={`${id}-e`} className="ac-erreur" role="alert">{erreur}</p>}
    </fieldset>
  );
}

function Progression({ etape, onAnnuler, t }: { etape: Extract<Etape, { k: "conversion" }>; onAnnuler: () => void; t: Textes }) {
  const j = etape.job;
  const v = Math.max(0, Math.min(1, (j?.progress ?? 0) / 100));
  const libelle = (j?.stage && t.etapes[j.stage]) ?? (etape.phase === "source" ? t.recuperation : t.conversion);
  const N = 40, pleins = Math.round(v * N);
  return (
    <div className="ac-progression" data-phase={etape.phase} role="status">
      <div className="ac-progression-ligne"><span>{libelle}</span><span className="tabular">{Math.round(v * 100)}{"\u00a0"}%</span></div>
      {/* Les points s'allument en or, comme la trame des ailes ; le suivant attend. */}
      <div className="ac-points" role="progressbar" aria-label={libelle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
        {Array.from({ length: N }, (_, i) => <span key={i} data-on={i < pleins ? "" : undefined} data-suivant={i === pleins ? "" : undefined} />)}
      </div>
      <p className="ac-note">{etape.phase === "source" ? t.etape1 : t.etape2} {t.garderOuvert}</p>
      <button type="button" className="ac-lien" onClick={onAnnuler}>{t.annuler}</button>
    </div>
  );
}

function Resultat({ job, source, onAutre, t, langue }: { job: ToolsJob; source: string; onAutre: () => void; t: Textes; langue: string }) {
  const fmt = (job.filename?.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "").toUpperCase();
  return (
    <div className="ac-resultat" data-resultat="">
      <Medaille taille={44} sceau frappe className="ac-sceau" />
      <div className="ac-resultat-texte">
        <p className="ac-carte-titre">{t.pret}</p>
        <p className="ac-media-meta">{[job.filename, fmt || null, job.sizeBytes ? bytes(job.sizeBytes) : null].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="ac-actions ac-actions--plein">
        {job.fileUrl ? <a className="ac-bouton" href={job.fileUrl} download data-accueil-telecharger=""><Icone nom="importer" taille="s" />{t.telecharger}</a> : null}
        <Link to={`/outils/studio/${encodeURIComponent(source)}`} className="ac-lien">{t.retoucher}</Link>
        <button type="button" className="ac-lien" onClick={onAutre}>{t.autreLien}</button>
      </div>
      {job.expiresAt && <p className="ac-note">{t.expire(new Date(job.expiresAt).toLocaleTimeString(langue === "en" ? "en-GB" : langue === "es" ? "es-ES" : "fr-FR", { hour: "2-digit", minute: "2-digit" }))}</p>}
    </div>
  );
}

function Echec({ message: m, onReessayer, onAutre, t }: { message: string; onReessayer: () => void; onAutre: () => void; t: Textes }) {
  return (
    <div className="ac-echec" data-echec="">
      <p className="ac-erreur" role="alert"><Icone nom="alerte" taille="s" />{m}</p>
      <div className="ac-actions">
        <button type="button" className="ac-bouton ac-bouton--second" onClick={onReessayer}>{t.reessayer}</button>
        <button type="button" className="ac-lien" onClick={onAutre}>{t.changerLien}</button>
      </div>
    </div>
  );
}
