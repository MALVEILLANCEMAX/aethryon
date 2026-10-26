// AETHRYON Music dans l'espace (/dashboard/musique) : TOUT compte connecté (aucun filtre de rôle ; seul le Cloud est
// réservé à l'administrateur). Coller un lien → fiche (pochette, titre, artistes, album, durée, état, restrictions) ;
// actions RÉELLES seulement (lib/musique.ts) : ouvrir la page officielle, lecteur officiel, aperçu de 30 s avec
// « Ouvrir dans Apple Music », import d'une source qui l'autorise (progression du serveur, annulation), puis
// téléchargement du fichier par le navigateur (60 min) ; historique de l'espace. Le navigateur ne parle qu'à account
// (/api/music/*), qui relaie à AETHRYON Music. Page chargée en entier : sa CSP autorise les pochettes, les aperçus et
// les lecteurs officiels (nginx/security-headers-musique.conf), rien d'autre.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { useResource } from "../lib/store.ts";
import { corpsImport, detecter, duree, erreurMusique, ETAPES, fraction, plan, type Choix, type EntreeHistorique, type Fiche, type ImportVue } from "../lib/musique.ts";
import { Button } from "../ui/Button.tsx";
import { Badge, Skeleton } from "../ui/bits.tsx";
import { IconAlert, IconArrowUpRight, IconDownload, IconInfo, IconLink, IconMusic, IconPlay } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { LoadError, PageHeader, useRequireUser } from "./common.tsx";

const NB = " ";
const TERMINES = new Set(["termine", "echec", "annule"]);
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Pochette({ url, titre, taille }: { url: string | null | undefined; titre: string; taille: number }) {
  const [ko, setKo] = useState(false);
  if (url && !ko) return <img src={url} alt="" width={taille} height={taille} onError={() => setKo(true)} className="shrink-0 rounded-[14px] object-cover shadow-card ring-1 ring-line musique-poch" style={{ width: taille, height: taille }} />;
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-[14px] bg-obsidian font-display text-ivory/80 ring-1 ring-line" style={{ width: taille, height: taille, fontSize: Math.max(14, taille * 0.34) }}>
      {(titre.trim()[0] ?? "♪").toUpperCase()}
    </span>
  );
}

function SuiviImport({ imp, onAnnuler }: { imp: ImportVue; onAnnuler: () => void }) {
  const f = fraction(imp);
  const actif = !TERMINES.has(imp.etat);
  return (
    <li className="rounded-[18px] border border-line bg-pearl/60 p-4" data-import-etat={imp.etat}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[15.5px] font-medium text-ink">{imp.titre ?? "Import"}</p>
        <p className="tabular text-[14px] text-ink-soft" aria-live="polite">{ETAPES[imp.etat]}{actif && f != null ? ` · ${Math.floor(f * 100)}${NB}%` : ""}</p>
      </div>
      {actif && (
        <div role="progressbar" aria-label={`${imp.titre ?? "Import"} : ${ETAPES[imp.etat]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f != null ? Math.floor(f * 100) : undefined}
          className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-sand/70">
          {f != null ? <span className="absolute inset-0 origin-left rounded-full bg-gold transition-transform duration-300 ease-[var(--ease-soft)] motion-reduce:transition-none" style={{ transform: `scaleX(${f})` }} />
            : <span className="musique-attente absolute inset-0" />}
        </div>
      )}
      {imp.etat === "echec" && <p className="mt-2 flex gap-2 text-[14.5px] text-ink"><IconAlert size={16} className="mt-0.5 shrink-0 text-bad" />{imp.erreur?.detail ?? "L'import n'a pas abouti."}</p>}
      {imp.etat === "termine" && imp.fichier && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={imp.fichier.url} download className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-[15px] font-medium text-ivory transition-colors hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text">
            <IconDownload size={17} />Télécharger le fichier
          </a>
          <p className="text-[14px] text-ink-soft">{[imp.licence?.nom, imp.cloud ? `Cloud${NB}: ${imp.cloud.libelle}` : null, imp.disponibleJusquA ? `disponible jusqu'à ${new Date(imp.disponibleJusquA).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : null].filter(Boolean).join(" · ")}</p>
        </div>
      )}
      {actif && <div className="mt-3"><Button size="sm" variant="ghost" onClick={onAnnuler}>Annuler</Button></div>}
    </li>
  );
}

function FicheVue({ fiche, onImporter }: { fiche: Fiche; onImporter: (corps: Record<string, unknown>[]) => Promise<void> }) {
  const p = useMemo(() => plan(fiche), [fiche]);
  const tout = p.importer?.choix ?? [];
  const [choix, setChoix] = useState<Set<string>>(() => new Set(tout.slice(0, 1).map((c) => c.cle)));
  const [attest, setAttest] = useState(false);
  const [officiel, setOfficiel] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const selection: Choix[] = tout.filter((c) => choix.has(c.cle));
  const corps = (tout.length ? selection : [null]).map((c) => corpsImport(p, c, attest)).filter((x): x is Record<string, unknown> => !!x);
  const pistes = fiche.pistes ?? [];
  return (
    <article className="musique-fiche mt-8 rounded-[26px] border border-line bg-pearl/60 p-5 shadow-card sm:p-7" aria-label={`Fiche${NB}: ${fiche.titre ?? fiche.url}`}>
      <div className="flex flex-col gap-6 sm:flex-row">
        <Pochette url={fiche.pochette} titre={fiche.titre ?? p.plateforme} taille={168} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink-soft"><span>{p.plateforme}</span><Badge tone={p.etat.tone}>{p.etat.libelle}</Badge></div>
          <h2 className="font-display mt-2 text-[28px] font-medium leading-tight text-ink">{fiche.titre ?? "Titre non communiqué"}</h2>
          <p className="mt-1 text-[16.5px] text-ink">{fiche.artistes.join(", ") || (p.catalogue ? "Artiste non communiqué par le service" : "Auteur non communiqué")}</p>
          <p className="mt-1 text-[14.5px] text-muted">{[fiche.album, fiche.dureeS ? duree(fiche.dureeS) : null, pistes.length ? `${fiche.pistesTotal ?? pistes.length}${NB}titres` : null, fiche.date?.slice(0, 4)].filter(Boolean).join(" · ") || NB}</p>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-soft">{p.etat.texte}</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {p.importer && (
              <Button variant="primary" loading={envoi} disabled={!corps.length || envoi} icon={<IconDownload size={17} />}
                onClick={async () => { setEnvoi(true); try { await onImporter(corps); } finally { setEnvoi(false); } }}>
                {corps.length > 1 ? `Importer ${corps.length}${NB}fichiers` : "Importer"}
              </Button>
            )}
            {p.lecteurOfficiel && <Button variant="secondary" icon={<IconPlay size={16} />} aria-expanded={officiel} onClick={() => setOfficiel((v) => !v)}>{officiel ? "Masquer le lecteur officiel" : "Lecteur officiel"}</Button>}
            {p.ouvrir && <a href={p.ouvrir.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[15px] font-medium text-ink transition-colors hover:bg-sand/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text">{p.ouvrir.libelle}<IconArrowUpRight size={16} /></a>}
          </div>
          {p.importer?.attestationRequise && (
            <label className="mt-4 flex max-w-xl gap-3 rounded-[14px] bg-warn-bg p-3 text-[14.5px] leading-relaxed text-ink">
              <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 size-4 accent-[var(--color-gold-text)]" />
              <span>{p.importer.attestation ?? "Je déclare avoir le droit de télécharger ce fichier."}</span>
            </label>
          )}
        </div>
      </div>
      {p.apercu && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] bg-sand/40 p-4">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-gold-text">Aperçu de 30{NB}s</span>
          <audio controls preload="none" src={p.apercu.url} className="h-10 min-w-0 flex-1" aria-label={`Aperçu de 30${NB}s de «${NB}${fiche.titre ?? ""}${NB}»`} />
          <a href={p.apercu.lien.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong px-4 text-[14.5px] font-medium text-ink hover:bg-sand/50">{p.apercu.lien.libelle}<IconArrowUpRight size={15} /></a>
          {p.apercu.mention && <p className="basis-full text-[13.5px] text-muted">{p.apercu.mention}</p>}
        </div>
      )}
      {p.ecouter && <div className="mt-6"><audio controls preload="none" src={p.ecouter.url} className="w-full" aria-label={`Écouter «${NB}${fiche.titre ?? ""}${NB}»`} /></div>}
      {officiel && p.lecteurOfficiel && (
        <div className="mt-6">
          <iframe title={`Lecteur officiel ${p.plateforme}`} src={p.lecteurOfficiel.url} height={p.lecteurOfficiel.hauteur} loading="lazy" className="block w-full rounded-[18px] border-0 bg-obsidian" allow="encrypted-media" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
          {p.lecteurOfficiel.note && <p className="mt-2 text-[13.5px] text-muted">{p.lecteurOfficiel.note}</p>}
        </div>
      )}
      {(fiche.licence || fiche.attribution || fiche.restrictions?.length || fiche.manque?.length || fiche.avertissements?.length) ? (
        <div role="note" className="mt-6 space-y-1.5 rounded-[18px] border border-line p-4 text-[14.5px] leading-relaxed text-ink-soft">
          {fiche.licence && <p><b className="font-semibold text-ink">Licence{NB}:</b> {fiche.licence.nom}{fiche.licence.url ? <> — <a href={fiche.licence.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">texte de la licence</a></> : null}</p>}
          {fiche.attribution && <p><b className="font-semibold text-ink">Attribution{NB}:</b> {fiche.attribution}</p>}
          {[...(fiche.restrictions ?? []), ...(fiche.manque ?? []), ...(fiche.avertissements ?? [])].map((r, i) => <p key={i} className="flex gap-2"><IconInfo size={16} className="mt-1 shrink-0" />{r}</p>)}
        </div>
      ) : null}
      {pistes.length > 0 && (
        <div className="mt-6">
          <p className="text-[14px] font-semibold text-ink-soft">{tout.length ? "Choisis les fichiers à importer" : "Titres"}</p>
          <ol className="mt-2 divide-y divide-line">
            {pistes.map((x, i) => {
              const c = tout[i];
              return (
                <li key={i} className="flex min-h-12 items-center gap-3 py-2 text-[15px]">
                  {c ? <input type="checkbox" className="size-4 accent-[var(--color-gold-text)]" checked={choix.has(c.cle)} aria-label={`Importer «${NB}${x.titre}${NB}»`}
                    onChange={() => setChoix((s) => { const n = new Set(s); if (n.has(c.cle)) n.delete(c.cle); else n.add(c.cle); return n; })} />
                    : <span className="tabular w-6 text-right text-[14px] text-muted">{x.numero ?? i + 1}</span>}
                  <span className="min-w-0 flex-1"><span className="block truncate text-ink">{x.titre}</span><span className="block truncate text-[13.5px] text-muted">{x.artistes.join(", ")}</span></span>
                  <span className="tabular text-[14px] text-muted">{duree(x.dureeS)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </article>
  );
}

export default function Musique() {
  useDocumentTitle("Musique");
  useRequireUser();
  const toast = useToast();
  const hist = useResource<{ entrees: EntreeHistorique[] }>("/api/music/historique", 5_000);
  const [url, setUrl] = useState("");
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportVue[]>([]);
  const det = detecter(url);
  const ferme = hist.error instanceof ApiError && hist.error.code === "music_closed";

  // Suivi des imports en cours : relecture toutes les 1,5 s tant qu'il en reste un actif (progression du serveur).
  const actifs = imports.filter((i) => !TERMINES.has(i.etat)).map((i) => i.id).join(",");
  const minuterie = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!actifs) return;
    minuterie.current = window.setInterval(async () => {
      for (const id of actifs.split(",")) {
        try {
          const r = await api<{ import: ImportVue }>(`/api/music/imports/${encodeURIComponent(id)}`);
          setImports((l) => l.map((x) => (x.id === id ? r.import : x)));
          if (TERMINES.has(r.import.etat)) void hist.reload();
        } catch { /* nouvel essai au tour suivant */ }
      }
    }, 1500);
    return () => window.clearInterval(minuterie.current);
  }, [actifs]);

  const analyser = async () => {
    const d = detecter(url);
    if (d?.refuse) { setErreur(d.refuse); setFiche(null); return; }
    setAnalyse(true); setErreur(null);
    try {
      const r = await api<{ fiche: Fiche }>("/api/music/analyser", { method: "POST", body: { url: url.trim() } });
      setFiche(r.fiche);
      void hist.reload();
    } catch (e) {
      setFiche(null);
      setErreur(e instanceof ApiError ? erreurMusique(e.code, (e.data?.detail as string) ?? e.message) : "Connexion impossible.");
    } finally { setAnalyse(false); }
  };

  const importer = async (corps: Record<string, unknown>[]) => {
    for (const c of corps) {
      try {
        const r = await api<{ import: ImportVue }>("/api/music/imports", { method: "POST", body: c });
        setImports((l) => [r.import, ...l]);
      } catch (e) {
        toast.show("error", "Import non lancé", e instanceof ApiError ? erreurMusique(e.code, (e.data?.detail as string) ?? e.message) : "Connexion impossible.");
        return;
      }
    }
    toast.show("info", corps.length > 1 ? `${corps.length}${NB}imports lancés` : "Import lancé", "Le serveur relit la source et vérifie le fichier.");
    void hist.reload();
  };

  const annuler = async (id: string) => {
    try { const r = await api<{ import: ImportVue }>(`/api/music/imports/${encodeURIComponent(id)}/annuler`, { method: "POST", body: {} }); setImports((l) => l.map((x) => (x.id === id ? r.import : x))); }
    catch (e) { toast.show("error", "Annulation impossible", e instanceof ApiError ? e.message : "Connexion impossible."); }
  };

  return (
    <div data-musique="">
      <PageHeader title="Musique" lead={`Colle un lien Spotify, Apple${NB}Music, SoundCloud, Deezer, Internet Archive, un flux de podcast ou un fichier audio${NB}: AETHRYON dit clairement ce qui est permis.`} />
      {ferme ? (
        <div className="mt-8 flex flex-col items-center rounded-[22px] border border-line bg-pearl/60 px-6 py-10 text-center" data-musique-ferme="">
          <AethryonMascot still state="curious" size={96} />
          <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-ink-soft">AETHRYON Music n'est pas encore ouvert sur ce serveur. Rien n'a été envoyé.</p>
        </div>
      ) : (
        <>
          <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void analyser(); }}>
            <label className="relative flex min-w-0 flex-1 items-center">
              <span className="sr-only">Lien d'un morceau, d'un album, d'une playlist ou d'un fichier audio</span>
              <IconLink size={18} className="pointer-events-none absolute left-4 text-muted" />
              <input type="url" inputMode="url" spellCheck={false} autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
                className="h-13 w-full rounded-[16px] border border-field bg-white/70 pl-11 pr-36 text-[16px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text" />
              {det && <span className={`absolute right-3 rounded-full px-3 py-1 text-[13px] font-semibold ${det.refuse ? "bg-bad-bg text-bad" : "bg-gold/15 text-gold-text"}`}>{det.nom}</span>}
            </label>
            <Button type="submit" variant="primary" className="h-13" loading={analyse} disabled={!url.trim() || analyse}>Analyser</Button>
          </form>
          {analyse && <div role="progressbar" aria-label="Analyse du lien en cours" className="musique-comete mt-3 h-0.5 overflow-hidden rounded-full bg-sand/70" />}
          {erreur && <p role="alert" className="mt-4 flex gap-2.5 text-[15.5px] text-ink"><IconAlert size={18} className="mt-0.5 shrink-0 text-bad" />{erreur}</p>}
          {imports.length > 0 && <ul className="mt-8 space-y-3" aria-label="Imports">{imports.map((i) => <SuiviImport key={i.id} imp={i} onAnnuler={() => void annuler(i.id)} />)}</ul>}
          {fiche && <FicheVue key={fiche.url} fiche={fiche} onImporter={importer} />}
          <section className="mt-12" aria-labelledby="musique-hist">
            <h2 id="musique-hist" className="font-display text-[22px] font-medium">Historique</h2>
            <p className="mt-1 text-[14.5px] text-muted">Liens analysés et imports lancés depuis le site ou AETHRYON Desktop (200 au plus).</p>
            {hist.data ? (
              hist.data.entrees.length ? (
                <ul className="mt-4 divide-y divide-line rounded-[20px] border border-line bg-pearl/50">
                  {hist.data.entrees.map((h, i) => (
                    <li key={`${h.creeLe}${i}`} className="flex items-center gap-3 px-4 py-3">
                      <Pochette url={h.pochette} titre={h.titre ?? h.url} taille={40} />
                      <div className="min-w-0 flex-1">
                        <button type="button" className="block max-w-full truncate text-left text-[15px] text-ink hover:underline" onClick={() => { setUrl(h.url); setFiche(null); }}>{h.titre ?? h.url}</button>
                        <p className="truncate text-[13.5px] text-muted">{[h.action === "import" ? `Import · ${ETAPES[h.etat as ImportVue["etat"]] ?? h.etat}` : "Lien analysé", h.origine === "desktop" ? "depuis AETHRYON Desktop" : null, quand(h.majLe)].filter(Boolean).join(" · ")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 flex items-center gap-4 rounded-[20px] border border-line bg-pearl/50 p-5 text-[15px] text-ink-soft"><IconMusic size={20} className="text-gold-text" />Rien pour l'instant.</div>
              )
            ) : hist.error ? <LoadError className="mt-4" onRetry={() => void hist.reload()}>L'historique n'a pas pu être lu.</LoadError> : <Skeleton className="mt-4 h-24 w-full rounded-[20px]" />}
          </section>
        </>
      )}
    </div>
  );
}
