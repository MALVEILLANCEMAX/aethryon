// Jetons API : création (vraie requête serveur), affichage unique du secret, liste, renommage,
// révocation, régénération, vérification. Le secret ne vit que dans l'état React de ce panneau :
// jamais dans localStorage, l'URL, les journaux ou les outils d'analyse ; effacé à la fermeture.
// Les clés de l'extension navigateur (type « extension », docs/EXTENSION.md §7) sont listées à part,
// dans « Extensions connectées » : appareil, date de liaison, dernière utilisation, expiration,
// révocation confirmée. Elles ne comptent pas dans le plafond des jetons du raccourci.
// Les clés du panneau AETHRYON pour Premiere Pro (type « premiere », connectées par la page d'accord
// /premiere/connecter) ont leur propre section, de même forme, affichée SEULEMENT si le compte en a déjà une :
// aucune mention nouvelle de Premiere pour les autres comptes (la case Premiere reste « En développement »).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { fmtDate, fmtRelative } from "../lib/format.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { invalidate, useResource } from "../lib/store.ts";
import type { ApiKey, CreatedKey } from "../lib/types.ts";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { Button, ButtonLink } from "../ui/Button.tsx";
import { CopyField } from "../ui/CopyField.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconAlert, IconCheck, IconChevron, IconDownload, IconKey, IconLink, IconLock, IconRefresh } from "../ui/Icon.tsx";
import { Badge, Card, Skeleton, TextInput } from "../ui/bits.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { KeysNotice } from "../ui/KeysNotice.tsx";
import { LoadError, PageHeader, toastError } from "./common.tsx";
import { EXTENSION_AVAILABLE } from "../lib/extension.ts";

const STATUS = { active: { tone: "ok", label: "Actif" }, revoked: { tone: "bad", label: "Révoqué" }, expired: { tone: "warn", label: "Expiré" } } as const;
/** Extensions : une liaison (féminin). */
const EXT_STATUS = { active: { tone: "ok", label: "Connectée" }, revoked: { tone: "bad", label: "Révoquée" }, expired: { tone: "warn", label: "Expirée" } } as const;
/** Au plus 3 extensions connectées par compte (contrôlé par le serveur). */
const MAX_EXTENSIONS = 3;
/** Au plus 3 ordinateurs connectés à AETHRYON pour Premiere Pro (contrôlé par le serveur). */
const MAX_PREMIERE = 3;
/** Au plus 3 ordinateurs reliés à AETHRYON Desktop (contrôlé par le serveur). */
const MAX_DESKTOP = 3;
const deviceOf = (k: ApiKey) => k.deviceLabel || k.name.replace(/^(Extension Chrome|Premiere Pro|AETHRYON Desktop) · /, "") || "Appareil inconnu";

/** Textes d'une section d'appareils connectés (extension navigateur ou Premiere Pro). */
interface DeviceTexts { id: string; title: string; lead: string; unit: string; empty: string; srRevoke: string }
const EXTENSION_TEXTS: DeviceTexts = {
  id: "ext-list", title: "Extensions connectées", unit: "appareils", srRevoke: "l'extension sur",
  lead: `${EXTENSION_AVAILABLE ? "L'extension pour Chrome, Edge et Brave" : "L'extension pour Chrome (en développement)"} partage ton compte et ton quota. ${MAX_EXTENSIONS} appareils au plus ; chaque liaison expire après 30 jours.`,
  empty: "Aucune extension connectée. Connecte l'extension à ton compte : l'appareil apparaîtra ici.",
};
const PREMIERE_TEXTS: DeviceTexts = {
  id: "premiere-list", title: "AETHRYON pour Premiere Pro", unit: "ordinateurs", srRevoke: "Premiere Pro sur",
  lead: `Le panneau AETHRYON de Premiere Pro partage ton compte et ton quota. ${MAX_PREMIERE} ordinateurs au plus ; chaque connexion expire après 30 jours.`,
  empty: "Aucun ordinateur connecté.",
};
const DESKTOP_TEXTS: DeviceTexts = {
  id: "desktop-list", title: "AETHRYON Desktop", unit: "ordinateurs", srRevoke: "AETHRYON Desktop sur",
  lead: `Les ordinateurs reliés à ton compte depuis AETHRYON Desktop (Paramètres › Compte). La liaison ouvre ton compte et, pour l'administrateur, AETHRYON Cloud ; pas les conversions. ${MAX_DESKTOP} ordinateurs au plus ; chaque liaison expire après 30 jours.`,
  empty: "Aucun ordinateur relié.",
};

function Extensions({ items, loading, onRevoke, texts = EXTENSION_TEXTS, max = MAX_EXTENSIONS }: { items: ApiKey[]; loading: boolean; onRevoke: (k: ApiKey) => void; texts?: DeviceTexts; max?: number }) {
  const active = items.filter((k) => k.status === "active").length;
  const sorted = [...items].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
  return (
    <section aria-labelledby={texts.id} className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id={texts.id} className="font-display text-titre-s">{texts.title}</h2>
        {!loading && <p className="tabular text-ui text-ink-soft">{active} sur {max} {texts.unit}</p>}
      </div>
      <p className="mt-1.5 max-w-2xl text-ui leading-relaxed text-ink-soft">{texts.lead}</p>
      <div className="mt-4 overflow-hidden rounded-panel border border-line shadow-card">
        {loading ? (
          <Skeleton className="h-20 rounded-none" />
        ) : sorted.length === 0 ? (
          <p className="bg-pearl/60 p-6 text-ui text-ink-soft">{texts.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {sorted.map((k) => (
                <motion.li key={k.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-pearl/60">
                  <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <span aria-hidden className="hidden size-10 shrink-0 place-items-center rounded-full border border-gold/50 bg-ivory text-gold-text sm:grid"><IconLink size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <p className="min-w-0 break-words text-corps font-medium">{deviceOf(k)}</p>
                        <Badge tone={EXT_STATUS[k.status].tone}>{EXT_STATUS[k.status].label}</Badge>
                      </div>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-note text-ink-soft">
                        <span>Liée le {fmtDate(k.createdAt)}</span>
                        <span>Utilisée {fmtRelative(k.lastUsedAt)}</span>
                        {k.expiresAt && <span>{k.status === "expired" ? "Expirée" : "Expire"} le {fmtDate(k.expiresAt)}</span>}
                        {k.revokedAt && <span>Révoquée le {fmtDate(k.revokedAt)}</span>}
                      </p>
                    </div>
                    {k.status === "active" && (
                      <Button size="sm" variant="danger" className="h-11 self-start sm:self-auto" onClick={() => onRevoke(k)}>
                        Révoquer<span className="sr-only"> {texts.srRevoke} {deviceOf(k)}</span>
                      </Button>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

/** Mémoire de session (onglet) : le jeton a été copié pendant cette visite (jamais le jeton lui-même). */
export const COPIED_FLAG = "ytc-jeton-copie";
const markCopied = () => { try { sessionStorage.setItem(COPIED_FLAG, "1"); } catch { /* stockage indisponible */ } };

function Reveal({ created, onClose }: { created: CreatedKey; onClose: () => void }) {
  const toast = useToast();
  const [ack, setAck] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 12, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
      <div className="relative overflow-hidden rounded-panel border border-gold/60 bg-ivory shadow-raised">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-gold),transparent)]" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            {/* réaction à une vraie réponse du serveur : le jeton vient d'être créé */}
            <AethryonMascot state="success" size={84} className="-my-2 shrink-0" />
            <div>
              <h2 className="font-display text-titre-m leading-tight">Ton jeton « {created.key.name} » est prêt</h2>
              <p className="mt-1.5 text-ui leading-relaxed text-ink-soft">Copie-le maintenant : il ne sera <strong className="font-semibold text-ink">plus jamais affiché</strong>. Le serveur n'en garde qu'une empreinte.</p>
            </div>
          </div>
          <CopyField
            className="mt-6"
            label="Ton jeton personnel"
            value={created.secret}
            onCopied={() => { markCopied(); toast.show("success", "Jeton copié", "Colle-le dans la configuration du raccourci."); }}
          />
          <ul className="mt-5 list-disc space-y-1.5 pl-5 text-ui text-ink-soft marker:text-gold">
            <li>Colle-le dans l'app Raccourcis quand elle te le demande, à l'installation.</li>
            <li>Ne l'envoie à personne. En cas de doute, régénère-le : l'ancien cessera de fonctionner.</li>
          </ul>
          <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-ui">
            <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); if (e.target.checked) markCopied(); }} className="check" />
            J'ai copié mon jeton
          </label>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {ack ? (
              <ButtonLink to="/installer" variant="primary" icon={<IconDownload size={18} />} onClick={onClose}>Installer le raccourci</ButtonLink>
            ) : (
              <Button variant="primary" icon={<IconDownload size={18} />} disabled>Installer le raccourci</Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={!ack}>Terminé</Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function Keys() {
  useDocumentTitle("Mes jetons");
  const toast = useToast();
  const me = useMe();
  const cfg = useConfig();
  const keys = useResource<{ keys: ApiKey[] }>("/api/keys", 10_000);
  const [name, setName] = useState("Mon iPhone");
  const [expires, setExpires] = useState<"" | "30" | "90" | "365">("");
  const [phase, setPhase] = useState<"idle" | "busy" | "error">("idle");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [renamed, setRenamed] = useState<{ id: string; name: string } | null>(null);
  const renamedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(renamedTimer.current), []);
  const [confirm, setConfirm] = useState<{ kind: "revoke" | "rotate" | "revoke-extension" | "revoke-premiere" | "revoke-desktop"; key: ApiKey } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [checkValue, setCheckValue] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = keys.data?.keys ?? [];
  // Jetons du raccourci (section inchangée) et extensions connectées (section à part).
  const list = all.filter((k) => k.kind === "shortcut"); // les clés « discord » (15 min) ne sont jamais des jetons gérés ici
  const extensions = all.filter((k) => k.kind === "extension");
  const premiere = all.filter((k) => k.kind === "premiere"); // section affichée seulement si le compte en a
  const desktop = all.filter((k) => k.kind === "desktop"); // idem
  const active = list.filter((k) => k.status === "active");
  const max = me.data?.keys.max ?? 2;
  const full = active.length >= max;
  const refresh = () => invalidate("/api/keys", "/api/me");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhase("busy");
    try {
      const out = await api<CreatedKey>("/api/keys", { method: "POST", body: { name, expiresInDays: expires ? Number(expires) : null } });
      setCreated(out);
      setPhase("idle");
      toast.show("success", "Jeton créé", "Ta clé API est prête. Pense à la conserver.");
      refresh();
    } catch (err) {
      setPhase("error");
      toastError(toast, err, "Création impossible");
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, key } = confirm;
    setBusy(true);
    try {
      if (kind === "revoke") {
        await api(`/api/keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
        toast.show("success", "Jeton révoqué", "Ce jeton ne peut plus accéder à l'API.");
      } else if (kind === "revoke-extension") {
        await api(`/api/keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
        toast.show("success", "Extension déconnectée", `L'extension sur « ${deviceOf(key)} » ne peut plus utiliser ton compte.`);
      } else if (kind === "revoke-desktop") {
        await api(`/api/keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
        toast.show("success", "AETHRYON Desktop déconnecté", `AETHRYON Desktop sur « ${deviceOf(key)} » ne peut plus accéder à ton compte ni au Cloud.`);
      } else if (kind === "revoke-premiere") {
        await api(`/api/keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
        toast.show("success", "Premiere Pro déconnecté", `Premiere Pro sur « ${deviceOf(key)} » ne peut plus utiliser ton compte.`);
      } else {
        const out = await api<CreatedKey>(`/api/keys/${encodeURIComponent(key.id)}/rotate`, { method: "POST" });
        setCreated(out);
        toast.show("success", "Jeton créé", "Ta clé API est prête. Pense à la conserver.");
      }
      refresh();
      setConfirm(null);
    } catch (err) {
      toastError(toast, err, kind === "rotate" ? "Régénération impossible" : "Révocation impossible");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    try {
      const { id, name } = renaming;
      await api(`/api/keys/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
      setRenaming(null);
      refresh();
      // Confirmation SUR PLACE (principe « Inline edit ») : coche « Renommé » à côté du nom, une annonce polie, et
      // le focus revient au bouton « Renommer » de ce jeton (le champ d'édition a disparu).
      setRenamed({ id, name: name.trim() });
      window.clearTimeout(renamedTimer.current);
      renamedTimer.current = window.setTimeout(() => setRenamed(null), 3000);
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-rename="${CSS.escape(id)}"]`)?.focus(), 60);
    } catch (err) { toastError(toast, err, "Renommage impossible"); }
  };

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckResult(null);
    try {
      const r = await api<{ valid: boolean; status: string; name?: string }>("/api/keys/check", { method: "POST", body: { secret: checkValue.trim() } });
      setCheckValue("");
      // « Actif » ne suffit pas : on dit aussi si le service de conversion accepte réellement les jetons.
      if (r.valid) setCheckResult(cfg.data?.keysActive
        ? `Ce jeton est actif (« ${r.name} ») : le service de conversion l'accepte.`
        : `Ce jeton est actif sur ton compte (« ${r.name} »), mais le service de conversion n'accepte pas encore les jetons personnels.`);
      else {
        setCheckResult(r.status === "revoked" ? "Ce jeton a été révoqué." : r.status === "expired" ? "Ce jeton a expiré." : "Ce jeton n'est pas reconnu sur ton compte.");
        toast.show("error", "Jeton invalide", "Génère une nouvelle clé depuis ton espace personnel.");
      }
    } catch (err) { toastError(toast, err, "Vérification impossible"); }
  };

  return (
    <div>
      <PageHeader title="Mes jetons" lead="Le raccourci iPhone et l'extension reliés à ton compte." />
      <KeysNotice className="mt-6" />

      <div className="mt-8">
        <AnimatePresence mode="wait">
          {created ? (
            <Reveal key="reveal" created={created} onClose={() => setCreated(null)} />
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card as="section" className="p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full border border-gold/50 bg-ivory text-gold-text"><IconKey size={19} /></span>
                  <h2 className="font-display text-titre-s">Nouveau jeton pour le raccourci</h2>
                </div>
                {full ? (
                  <p className="mt-5 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-4 text-ui text-warn">
                    <IconAlert size={18} className="mt-0.5 shrink-0" />
                    Tu as déjà {max} jetons actifs, le maximum. Révoque-en un ci-dessous pour en créer un nouveau, ou régénère celui de ton iPhone.
                  </p>
                ) : (
                  <form onSubmit={create} className="mt-5 grid gap-4 sm:grid-cols-[1fr_200px] lg:grid-cols-[1fr_200px_auto] lg:items-start">
                    <TextInput label="Nom du jeton" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required hint="Pour reconnaître l'appareil, par exemple « Mon iPhone »." />
                    <div>
                      <label htmlFor="expiry" className="text-sm font-medium text-ink-soft">Validité</label>
                      <span className="select-wrap mt-2">
                        <select id="expiry" value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)} className="select-field">
                          <option value="">Sans expiration</option>
                          <option value="30">30 jours</option>
                          <option value="90">90 jours</option>
                          <option value="365">1 an</option>
                        </select>
                        <IconChevron size={16} className="select-chevron" aria-hidden />
                      </span>
                    </div>
                    <Button type="submit" variant="primary" loading={phase === "busy"} className="lg:mt-7">
                      {phase === "busy" ? "Génération…" : phase === "error" ? "Réessayer" : "Générer mon jeton"}
                    </Button>
                  </form>
                )}
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section aria-labelledby="keys-list" className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="keys-list" className="font-display text-titre-s">Jetons du compte</h2>
          <p role="status" className="sr-only">{renamed ? `Jeton renommé : ${renamed.name}.` : ""}</p>
          {keys.data && list.length > 0 && <p className="tabular text-ui text-ink-soft" data-actifs={active.length}>{active.length} actif{active.length > 1 ? "s" : ""} sur {max} au plus</p>}
        </div>
        <div className="mt-4 overflow-hidden rounded-panel border border-line shadow-card">
          {keys.loading && !keys.data ? (
            <div className="divide-y divide-line bg-pearl/60" aria-busy="true" aria-label="Chargement des jetons">
              {[0, 1].map((i) => (
                <div key={i} className="p-5"><Skeleton className="h-5 w-40" /><Skeleton className="mt-2.5 h-4 w-2/3" /></div>
              ))}
            </div>
          ) : keys.error && !keys.data ? (
            <LoadError className="bg-pearl/60 p-5 sm:p-6" onRetry={() => void keys.reload()}>
              Tes jetons n'ont pas pu être chargés : le serveur n'a pas répondu. Ils ne sont pas touchés.
            </LoadError>
          ) : list.length === 0 ? (
            <div className="flex items-start gap-4 bg-pearl/60 p-5 sm:p-6" data-vide="">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-line-strong bg-ivory text-ink-soft"><IconKey size={18} /></span>
              <div>
                <p className="text-corps font-medium">Aucun jeton pour l'instant</p>
                <p className="mt-1 text-ui leading-relaxed text-ink-soft">Ton premier jeton relie le raccourci de ton iPhone à ton compte. Crée-le ci-dessus : il ne s'affichera qu'une fois.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {list.map((k) => (
                  <motion.li key={k.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={k.status === "active" ? "bg-pearl/60" : "bg-ivory/60"} data-jeton={k.status}>
                    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        {renaming?.id === k.id ? (
                          <form onSubmit={(e) => { e.preventDefault(); void saveRename(); }} className="flex flex-wrap gap-2">
                            <label className="sr-only" htmlFor={`rn-${k.id}`}>Nouveau nom</label>
                            <input id={`rn-${k.id}`} autoFocus maxLength={40} value={renaming.name} onChange={(e) => setRenaming({ id: k.id, name: e.target.value })} className="h-11 min-w-0 flex-1 rounded-card border border-field bg-white px-3 text-corps" />
                            <Button type="submit" size="sm" variant="primary" className="h-11">Enregistrer</Button>
                            <Button size="sm" variant="quiet" className="h-11" onClick={() => setRenaming(null)}>Annuler</Button>
                          </form>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2.5">
                            <p className={cn("min-w-0 break-words text-corps font-medium", k.status !== "active" && "text-ink-soft")}>{k.name}</p>
                            <Badge tone={STATUS[k.status].tone}>{STATUS[k.status].label}</Badge>
                            {renamed?.id === k.id && <span aria-hidden className="inline-flex items-center gap-1 text-note font-medium text-ok"><IconCheck size={14} />Renommé</span>}
                          </div>
                        )}
                        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-note text-ink-soft">
                          <span className="font-mono text-ink">{k.start}••••••••</span>
                          <span>Créé le {fmtDate(k.createdAt)}</span>
                          <span>{k.lastUsedAt ? `Utilisé ${fmtRelative(k.lastUsedAt)}` : "Jamais utilisé"}</span>
                          {k.expiresAt && <span>{k.status === "expired" ? "Expiré" : "Expire"} le {fmtDate(k.expiresAt)}</span>}
                          {k.revokedAt && <span>Révoqué le {fmtDate(k.revokedAt)}</span>}
                        </p>
                      </div>
                      {k.status === "active" && renaming?.id !== k.id && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="quiet" className="h-11" data-rename={k.id} onClick={() => setRenaming({ id: k.id, name: k.name })}>Renommer</Button>
                          <Button size="sm" variant="ghost" className="h-11" icon={<IconRefresh size={16} />} onClick={() => setConfirm({ kind: "rotate", key: k })}>Régénérer</Button>
                          <Button size="sm" variant="danger" className="h-11" onClick={() => setConfirm({ kind: "revoke", key: k })}>Révoquer</Button>
                        </div>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </section>

      <Extensions items={extensions} loading={keys.loading && !keys.data} onRevoke={(k) => setConfirm({ kind: "revoke-extension", key: k })} />
      {premiere.length > 0 && (
        <Extensions items={premiere} loading={false} texts={PREMIERE_TEXTS} max={MAX_PREMIERE} onRevoke={(k) => setConfirm({ kind: "revoke-premiere", key: k })} />
      )}
      {desktop.length > 0 && (
        <Extensions items={desktop} loading={false} texts={DESKTOP_TEXTS} max={MAX_DESKTOP} onRevoke={(k) => setConfirm({ kind: "revoke-desktop", key: k })} />
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        {/* Sécurité : jamais cachée (affichage unique, ce qui est conservé, révocation). */}
        <section aria-labelledby="keys-securite" data-securite="">
          <h2 id="keys-securite" className="flex items-center gap-2.5 font-display text-titre-s"><IconLock size={19} className="shrink-0 text-gold-text" />Sécurité de tes jetons</h2>
          <ul className="mt-4 space-y-3 text-ui leading-relaxed text-ink-soft">
            <li className="border-t border-line pt-3"><span className="font-medium text-ink">Affiché une seule fois.</span> Le serveur n'en garde qu'une empreinte : personne ne peut le relire, pas même l'administrateur.</li>
            <li className="border-t border-line pt-3"><span className="font-medium text-ink">Conservé :</span> son nom, son début ({"ytc_"}…) et ses dates.</li>
            <li className="border-t border-line pt-3"><span className="font-medium text-ink">Révocable.</span> Refusé dès la requête suivante ; régénérer révoque l'ancien.</li>
          </ul>
          <Link to="/confidentialite" className="mt-2 inline-flex min-h-11 items-center text-ui text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text">Tout ce que le service conserve</Link>
        </section>

        <Card as="section" className="self-start p-6 sm:p-7">
          <h2 className="font-display text-titre-s">Vérifier un jeton</h2>
          <p className="mt-1.5 text-ui text-ink-soft">Encore actif ? Colle-le ici : il n'est ni affiché ni gardé.</p>
          <form onSubmit={check} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="check" className="sr-only">Jeton à vérifier</label>
            <input id="check" type="password" autoComplete="off" spellCheck={false} placeholder="ytc_…" value={checkValue} onChange={(e) => setCheckValue(e.target.value)} className="h-12 min-w-0 rounded-card border border-field bg-surface px-3.5 font-mono text-ui placeholder:text-muted sm:flex-1" />
            <Button type="submit" variant="secondary" disabled={checkValue.trim().length < 10}>Vérifier</Button>
          </form>
          <p className="mt-3 min-h-[22px] text-ui" aria-live="polite">{checkResult}</p>
        </Card>
      </div>

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "revoke-desktop"
          ? `Déconnecter AETHRYON Desktop sur « ${deviceOf(confirm.key)} » ?`
          : confirm?.kind === "revoke-premiere"
          ? `Révoquer Premiere Pro sur « ${deviceOf(confirm.key)} » ?`
          : confirm?.kind === "revoke-extension"
          ? `Révoquer l'extension sur « ${deviceOf(confirm.key)} » ?`
          : confirm?.kind === "revoke" ? `Révoquer « ${confirm?.key.name} » ?` : `Régénérer « ${confirm?.key.name ?? ""} » ?`}
        description={confirm?.kind === "revoke-desktop"
          ? "AETHRYON Desktop sur cet ordinateur perd l'accès à ton compte tout de suite (et au Cloud). Ses médias locaux et tes fichiers du Cloud restent en place. Pour le relier de nouveau : Paramètres › Compte, dans le Desktop."
          : confirm?.kind === "revoke-premiere"
          ? "Premiere Pro sur cet ordinateur sera déconnecté de ton compte tout de suite : il ne pourra plus convertir. Pour le reconnecter, relance la connexion depuis le panneau AETHRYON de Premiere Pro."
          : confirm?.kind === "revoke-extension"
          ? "L'extension de cet appareil sera déconnectée de ton compte tout de suite : elle ne pourra plus convertir. Pour la reconnecter, il faudra l'autoriser à nouveau depuis l'extension."
          : confirm?.kind === "revoke"
            ? "Le raccourci qui utilise ce jeton ne pourra plus convertir. Cette action est définitive."
            : "Un nouveau jeton sera créé et l'actuel cessera immédiatement de fonctionner. Il faudra coller le nouveau dans le raccourci."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Annuler</Button>
            <Button variant={confirm?.kind === "rotate" ? "primary" : "danger"} loading={busy} onClick={doConfirm}>
              {confirm?.kind === "rotate" ? "Régénérer" : "Révoquer"}
            </Button>
          </>
        }
      />
    </div>
  );
}
