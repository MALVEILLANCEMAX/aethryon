// AETHRYON Cloud dans l'espace (/dashboard/cloud) : ADMINISTRATEUR SEULEMENT (le serveur refuse tout autre compte, 403,
// à chaque appel ; ici, un autre compte voit une page absente). Mêmes fonctions que la section Cloud du Desktop, sauf
// l'envoi d'un fichier local : espace utilisé et disponible (jauge réelle), fichiers sauvegardés (vidéo et audio),
// recherche et filtres (appliqués par account), aperçu (lien signé « apercu » de 5 min, lu depuis le domaine du
// fournisseur), téléchargement par le navigateur (lien signé en pièce jointe), « Copier un lien temporaire » (durée
// affichée), suppression confirmée, « Expire dans X jours » et date, statuts, erreurs de synchronisation lisibles.
// Aucune clé du fournisseur n'arrive ici ; les liens signés ne sont jamais gardés (ni stockage, ni journal).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { invalidatePrefix, useResource } from "../lib/store.ts";
import { Button, ButtonLink } from "../ui/Button.tsx";
import { Badge, Skeleton } from "../ui/bits.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconAlert, IconChevron, IconDownload, IconLink, IconPlay, IconRefresh, IconTrash } from "../ui/Icon.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { LoadError, PageHeader, toastError, useRequireUser } from "./common.tsx";
import { dureeLien, erreurCloud, expiration, jaugeCloud, octets, STATUTS, type EtatCloud, type ListeCloud, type ObjetCloud } from "../lib/cloud.ts";

const NB = " ";
const TYPES = [{ value: "", label: "Tous" }, { value: "video", label: "Vidéo" }, { value: "audio", label: "Audio" }] as const;
const FILTRES = [
  { value: "", label: "Tous les fichiers" }, { value: "sauvegarde", label: "Sauvegardés" }, { value: "envois", label: "Envois en cours ou en échec" },
  { value: "echec", label: "Échecs de sauvegarde" }, { value: "expire", label: "Expirés" },
];
const TRIS = [{ value: "recent", label: "Plus récents" }, { value: "expiration", label: "Expiration proche" }, { value: "taille", label: "Plus gros" }, { value: "nom", label: "Nom" }];
const ORIGINES: Record<string, string> = { desktop: "depuis le Desktop", ytapi: "téléchargement AETHRYON", extension: "depuis l'extension", site: "depuis le site" };

/** Page absente pour un compte qui n'est pas administrateur (le serveur refuse de toute façon chaque appel). */
function Absente() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center" data-cloud-absent="">
      <AethryonMascot still state="curious" size={112} />
      <h1 className="font-display mt-4 text-[26px] font-medium">Cette page n'existe pas pour ton compte</h1>
      <p className="mx-auto mt-2 max-w-md text-[15.5px] leading-relaxed text-ink-soft">AETHRYON Cloud est réservé à l'administrateur.</p>
      <ButtonLink to="/dashboard" variant="secondary" className="mt-6">Mon espace</ButtonLink>
    </div>
  );
}

function Jauge({ e }: { e: EtatCloud }) {
  const j = jaugeCloud(e.quota);
  return (
    <section aria-label="Espace AETHRYON Cloud" className="mt-8 rounded-[22px] border border-line bg-pearl/60 p-5 shadow-card sm:p-6" data-niveau={j.niveau}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p><span className="font-display tabular text-[34px] font-medium leading-none">{j.utilise}</span><span className="ml-2 text-[15px] text-ink-soft">utilisés sur {j.max}</span></p>
        <p className="tabular text-[15px] text-ink-soft"><span className="font-semibold text-ink">{j.disponible}</span> disponibles{e.quota.reserve > 0 ? ` · ${octets(e.quota.reserve)} réservés par des envois en cours` : ""}</p>
      </div>
      <div role="meter" aria-label="Espace utilisé" aria-valuemin={0} aria-valuemax={e.quota.max} aria-valuenow={e.quota.utilise} aria-valuetext={j.aria}
        className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-sand/70">
        <span className={`absolute inset-0 origin-left rounded-full transition-transform duration-500 ease-[var(--ease-soft)] motion-reduce:transition-none ${j.niveau === "plein" ? "bg-bad" : "bg-gold"}`} style={{ transform: `scaleX(${j.sauve})` }} />
        <span className="cloud-reserve absolute inset-0 origin-left transition-transform duration-500 ease-[var(--ease-soft)] motion-reduce:transition-none" style={{ transform: `translateX(${j.sauve * 100}%) scaleX(${j.reserve})` }} />
      </div>
      {j.niveau !== "normal" && (
        <p className="mt-3 flex items-center gap-2 text-[14.5px] text-ink" role="note">
          <IconAlert size={16} className={j.niveau === "plein" ? "text-bad" : "text-warn"} />
          {j.niveau === "plein" ? `Cloud plein${NB}: supprime des fichiers pour faire de la place. Rien n'est supprimé avant son expiration.` : `Cloud presque plein${NB}: pense à supprimer les fichiers dont tu n'as plus besoin.`}
        </p>
      )}
      <p className="mt-3 text-[13.5px] text-muted">Chaque fichier est gardé {e.retentionJours}{NB}jours, puis supprimé définitivement (toutes ses versions). Tes copies locales ne sont jamais touchées.</p>
    </section>
  );
}

function Ligne({ o, busy, onApercu, onTelecharger, onLien, onSupprimer }: { o: ObjetCloud; busy: boolean; onApercu: () => void; onTelecharger: () => void; onLien: () => void; onSupprimer: () => void }) {
  const s = STATUTS[o.statut];
  const exp = expiration(o);
  const pret = o.statut === "sauvegarde";
  const meta = [o.type.split("/")[1]?.replace("x-matroska", "mkv").replace("quicktime", "mov").replace("mpeg", "mp3").toUpperCase(), octets(o.taille), ORIGINES[o.origine]].filter(Boolean).join(" · ");
  const btn = "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand/60 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text disabled:opacity-50";
  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(170px,auto)_176px]" data-objet={o.id} data-statut={o.statut} aria-busy={busy || undefined}>
      <div className="min-w-0">
        <p className="truncate text-[15.5px] font-medium" title={o.nom}>{o.nom}</p>
        <p className="mt-0.5 text-[13.5px] text-muted">{meta}</p>
        {o.statut === "echec" && <p className="mt-1.5 flex gap-2 text-[13.5px] text-ink" role="note"><IconAlert size={16} className="mt-0.5 shrink-0 text-bad" />{erreurCloud(o.erreur, `Erreur de synchronisation (${o.erreur ?? "inconnue"}).`)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end sm:text-right">
        <Badge tone={s.tone}>{s.label}</Badge>
        {exp && <p className={`tabular text-[13.5px] ${exp.proche ? "text-warn" : "text-ink-soft"}`}>{exp.court} <span className="text-muted">· {exp.date}</span></p>}
      </div>
      <div className="-ml-3 flex items-center justify-start sm:ml-0 sm:justify-end" data-actions="">
        {pret && o.apercu && <button type="button" className={btn} aria-label={`Aperçu de «${NB}${o.nom}${NB}»`} title="Aperçu" disabled={busy} onClick={onApercu}><IconPlay size={16} /></button>}
        {pret && <button type="button" className={btn} aria-label={`Télécharger «${NB}${o.nom}${NB}»`} title="Télécharger" disabled={busy} onClick={onTelecharger}><IconDownload size={18} /></button>}
        {pret && <button type="button" className={btn} aria-label={`Copier un lien temporaire vers «${NB}${o.nom}${NB}»`} title="Copier un lien temporaire" disabled={busy} onClick={onLien}><IconLink size={18} /></button>}
        <button type="button" className={btn} aria-label={`Supprimer «${NB}${o.nom}${NB}» du Cloud`} title="Supprimer" disabled={busy || o.statut === "suppression_en_attente"} onClick={onSupprimer}><IconTrash size={18} /></button>
      </div>
    </li>
  );
}

export default function Cloud() {
  useDocumentTitle("Cloud");
  const me = useRequireUser();
  const toast = useToast();
  const admin = me.data?.user.role === "admin";
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [type, setType] = useState<"" | "video" | "audio">("");
  const [statut, setStatut] = useState("");
  const [tri, setTri] = useState("recent");
  const [busy, setBusy] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ o: ObjetCloud; url: string; expireLe: string } | null>(null);
  const [aSupprimer, setASupprimer] = useState<ObjetCloud | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQd(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const qs = useMemo(() => new URLSearchParams({ ...(qd ? { q: qd } : {}), ...(statut ? { statut } : {}), ...(type ? { type } : {}), tri, taillePage: "100" }).toString(), [qd, statut, type, tri]);
  const etat = useResource<EtatCloud>(admin ? "/api/cloud/etat" : null, 30_000);
  const liste = useResource<ListeCloud>(admin ? `/api/cloud/objets?${qs}` : null, 15_000);

  if (!me.data) return <div className="py-8" aria-busy="true"><Skeleton className="h-10 w-48" /><Skeleton className="mt-8 h-32 w-full rounded-[22px]" /></div>;
  if (!admin) return <Absente />;
  const ferme = etat.error instanceof ApiError && etat.error.status === 404;
  const interdit = etat.error instanceof ApiError && etat.error.status === 403;
  if (interdit) return <Absente />;

  const recharger = () => invalidatePrefix("/api/cloud/");
  const lien = async (o: ObjetCloud, usage: "telecharger" | "apercu") => api<{ url: string; expireLe: string }>(`/api/cloud/objets/${encodeURIComponent(o.id)}/lien`, { method: "POST", body: { usage } });
  const agir = async (o: ObjetCloud, f: () => Promise<void>) => {
    setBusy(o.id);
    try { await f(); } catch (e) {
      if (e instanceof ApiError && !e.isServer) toast.show("error", "Action impossible", erreurCloud(e.code, e.message));
      else toastError(toast, e);
    } finally { setBusy(null); }
  };
  const telecharger = (o: ObjetCloud) => agir(o, async () => {
    const l = await lien(o, "telecharger");
    // Navigation vers le domaine du fournisseur : pièce jointe, le navigateur télécharge ; rien n'est gardé ici.
    const a = document.createElement("a");
    a.href = l.url;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.show("info", "Téléchargement lancé", `«${NB}${o.nom}${NB}» : le lien reste valable ${dureeLien(l.expireLe)}.`);
  });
  const copier = (o: ObjetCloud) => agir(o, async () => {
    const l = await lien(o, "telecharger");
    try {
      await navigator.clipboard.writeText(l.url);
      toast.show("success", "Lien temporaire copié", `Valable ${dureeLien(l.expireLe)}. Toute personne qui a ce lien peut télécharger le fichier jusqu'à son échéance.`);
    } catch { toast.show("error", "Copie impossible", "Le presse-papiers est indisponible."); }
  });
  const voir = (o: ObjetCloud) => agir(o, async () => { const l = await lien(o, "apercu"); setApercu({ o, url: l.url, expireLe: l.expireLe }); });
  const supprimer = (o: ObjetCloud) => agir(o, async () => {
    const r = await api<{ objet: ObjetCloud }>(`/api/cloud/objets/${encodeURIComponent(o.id)}/supprimer`, { method: "POST", body: {} });
    setASupprimer(null);
    toast.show("success", r.objet.statut === "suppression_en_attente" ? "Suppression en cours" : "Supprimé du Cloud", r.objet.statut === "suppression_en_attente" ? "L'accès est déjà révoqué ; le stockage confirmera la suppression." : `«${NB}${o.nom}${NB}» : toutes ses versions sont effacées.`);
    recharger();
  });

  const items = liste.data?.items ?? [];
  const filtre = qd !== "" || statut !== "" || type !== "";
  return (
    <div>
      <PageHeader title="Cloud" lead={`Sauvegarde temporaire de tes téléchargements${NB}: ${etat.data?.retentionJours ?? 30}${NB}jours, réservée à l'administrateur.`}>
        <Button variant="secondary" size="sm" className="h-11" icon={<IconRefresh size={16} />} onClick={recharger}>Actualiser</Button>
      </PageHeader>

      {ferme ? (
        <div className="mt-8 rounded-[22px] border border-line bg-pearl/60 p-6 text-[15.5px] leading-relaxed text-ink-soft" data-cloud-ferme="">
          AETHRYON Cloud n'est pas activé sur ce serveur pour le moment. Rien n'a été envoyé ni gardé.
        </div>
      ) : etat.data ? <Jauge e={etat.data} /> : etat.error ? (
        <LoadError className="mt-8" onRetry={() => void etat.reload()}>L'état du Cloud n'a pas pu être lu. Rien n'est perdu.</LoadError>
      ) : <Skeleton className="mt-8 h-36 w-full rounded-[22px]" />}

      {!ferme && (
        <>
          <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <label className="relative min-w-[220px] flex-1">
                <span className="sr-only">Rechercher dans le Cloud</span>
                <input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans le Cloud"
                  className="h-12 w-full rounded-[14px] border border-field bg-white/70 px-4 text-[16px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-text" />
              </label>
              <SegmentedControl label="Type de fichier" value={type} onChange={(v) => setType(v as "" | "video" | "audio")} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:flex">
              <label className="sr-only" htmlFor="cloud-statut">Statut des fichiers</label>
              <span className="select-wrap lg:w-[230px]">
                <select id="cloud-statut" className="select-field" value={statut} onChange={(e) => setStatut(e.target.value)}>{FILTRES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
                <IconChevron size={16} className="select-chevron" aria-hidden />
              </span>
              <label className="sr-only" htmlFor="cloud-tri">Trier les fichiers</label>
              <span className="select-wrap lg:w-[180px]">
                <select id="cloud-tri" className="select-field" value={tri} onChange={(e) => setTri(e.target.value)}>{TRIS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                <IconChevron size={16} className="select-chevron" aria-hidden />
              </span>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-[22px] border border-line bg-pearl/60 shadow-card">
            {liste.loading && !liste.data ? (
              <div className="divide-y divide-line" aria-busy="true" aria-label="Chargement du Cloud">
                {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-6 px-5 py-5"><Skeleton className="h-4 w-56" /><Skeleton className="ml-auto h-6 w-24 rounded-full" /></div>)}
              </div>
            ) : liste.error && !liste.data ? (
              <LoadError className="p-5 sm:p-6" onRetry={() => void liste.reload()}>La liste du Cloud n'a pas pu être chargée. Rien n'est perdu.</LoadError>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center" data-vide="">
                {!filtre && <AethryonMascot still state="idle" size={112} />}
                <h2 className="font-display mt-4 text-[22px] font-medium">{filtre ? "Aucun fichier ne correspond" : "Ton Cloud est vide"}</h2>
                {!filtre && <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink-soft">Les téléchargements de l'administrateur et les envois depuis AETHRYON Desktop arrivent ici, puis disparaissent d'eux-mêmes après 30{NB}jours.</p>}
                {filtre && <Button variant="secondary" className="mt-5" onClick={() => { setQ(""); setStatut(""); setType(""); }}>Effacer les filtres</Button>}
              </div>
            ) : (
              <ul className="divide-y divide-line" aria-label="Fichiers du Cloud">
                {items.map((o) => <Ligne key={o.id} o={o} busy={busy === o.id} onApercu={() => void voir(o)} onTelecharger={() => void telecharger(o)} onLien={() => void copier(o)} onSupprimer={() => setASupprimer(o)} />)}
              </ul>
            )}
          </div>
          {liste.data && liste.data.total > items.length && <p className="mt-3 text-[13.5px] text-muted">{items.length} fichiers affichés sur {liste.data.total}{NB}: précise la recherche.</p>}
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">Pour envoyer un fichier de ton ordinateur, utilise AETHRYON Desktop (<Link to="/installer" className="text-gold-text underline decoration-gold/50 underline-offset-4">installer</Link>).</p>
        </>
      )}

      <Dialog open={!!apercu} onClose={() => setApercu(null)} title={apercu?.o.nom ?? "Aperçu"} wide
        footer={<Button variant="primary" onClick={() => setApercu(null)}>Fermer</Button>}>
        {apercu && (
          <div className="cloud-apercu">
            {apercu.o.type.startsWith("video/") ? <video controls preload="metadata" src={apercu.url} aria-label={`Aperçu de ${apercu.o.nom}`} className="max-h-[56vh] w-full rounded-[16px] bg-obsidian" />
              : apercu.o.type.startsWith("audio/") ? <audio controls preload="metadata" src={apercu.url} aria-label={`Aperçu de ${apercu.o.nom}`} className="w-full" />
              : <img src={apercu.url} alt={`Aperçu de ${apercu.o.nom}`} className="max-h-[56vh] rounded-[16px]" />}
            <p className="mt-3 text-[13.5px] text-muted">Lecture depuis le Cloud par un lien signé, valable {dureeLien(apercu.expireLe)}.</p>
          </div>
        )}
      </Dialog>

      <Dialog open={!!aSupprimer} onClose={() => setASupprimer(null)} title={aSupprimer ? `Supprimer «${NB}${aSupprimer.nom}${NB}» du Cloud${NB}?` : "Supprimer"}
        description="Le fichier est supprimé définitivement du Cloud, avec toutes ses versions, et libère sa place. Les liens temporaires déjà copiés cessent de fonctionner. Tes copies locales ne sont jamais touchées."
        footer={<>
          <Button variant="secondary" onClick={() => setASupprimer(null)}>Annuler</Button>
          <Button variant="danger" loading={!!aSupprimer && busy === aSupprimer.id} icon={<IconTrash size={16} />} onClick={() => aSupprimer && void supprimer(aSupprimer)}>Supprimer</Button>
        </>}>
        {null}
      </Dialog>
    </div>
  );
}
