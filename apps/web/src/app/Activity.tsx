// Activité : uniquement les données réellement enregistrées (sans lien ni titre de vidéo). Un seul
// historique pour le compte, quel que soit l'accès qui a lancé la conversion. États soignés : chargement
// (lignes fantômes), erreur (réessayer, rien n'est perdu), vide (prochaine action selon les jetons réels).
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { fmtDateTime } from "../lib/format.ts";
import { useDocumentTitle, useMe } from "../lib/hooks.ts";
import { quotaView } from "../lib/onboarding.ts";
import { useResource } from "../lib/store.ts";
import type { ActivityItem, Today } from "../lib/types.ts";
import { ButtonLink } from "../ui/Button.tsx";
import { Badge, Skeleton } from "../ui/bits.tsx";
import { AethryonMascot } from "../ui/brand/AethryonMascot.tsx";
import { IconDownload, IconKey } from "../ui/Icon.tsx";
import { LoadError, PageHeader } from "./common.tsx";

const STATE: Record<string, { tone: "ok" | "warn" | "bad" | "gold" | "neutral"; label: string }> = {
  reserved: { tone: "gold", label: "Demandée" },
  running: { tone: "gold", label: "En cours" },
  done: { tone: "ok", label: "Terminée" },
  error: { tone: "bad", label: "Échec" },
  cancelled: { tone: "neutral", label: "Annulée" },
  refunded: { tone: "neutral", label: "Non démarrée" },
};
const PLATFORM: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", x: "X", twitter: "X", fichier: "Fichier importé" };
const LIMIT = 50;
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";

/** Aucune conversion : la prochaine action dépend des jetons RÉELS du compte. */
function Empty({ hasActiveKey }: { hasActiveKey: boolean | null }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center sm:px-10" data-vide="">
      <AethryonMascot still state="idle" size={112} />
      <h2 className="font-display mt-4 text-titre-s">Aucune conversion pour l’instant</h2>
      <p className="mx-auto mt-2 max-w-md text-ui leading-relaxed text-ink-soft">
        Chaque conversion s'inscrira ici avec sa date, son format, sa plateforme et son état, quel que soit l'accès utilisé. Aujourd'hui, elles partent du raccourci iPhone.
      </p>
      {hasActiveKey === false && (
        <ButtonLink to="/dashboard/cles" variant="primary" className="mt-6" icon={<IconKey size={18} />}>Créer mon jeton</ButtonLink>
      )}
      {hasActiveKey && (
        <div className="mt-6 flex flex-col items-center gap-x-5 gap-y-1 sm:flex-row">
          <ButtonLink to="/installer" variant="primary" icon={<IconDownload size={18} />}>Installer le raccourci</ButtonLink>
          <Link to="/dashboard" className={`${link} inline-flex min-h-11 items-center text-ui`}>Reprendre le guide</Link>
        </div>
      )}
    </div>
  );
}

export default function Activity() {
  useDocumentTitle("Activité");
  const me = useMe();
  const res = useResource<{ items: ActivityItem[]; today: Today }>(`/api/activity?limit=${LIMIT}`, 10_000);
  const items = res.data?.items ?? [];
  const q = res.data ? quotaView(res.data.today) : null;
  return (
    <div>
      <PageHeader title="Activité" lead="Format, état et date de tes conversions. Ni lien ni titre n'est enregistré.">
        {/* Place réservée pendant le chargement : la liste ne descend pas quand le quota arrive (aucun décalage). */}
        <p className="tabular min-h-[1.5em] text-ui text-ink-soft" data-quota-jour={q ? "" : undefined}>
          {q
            ? <>Aujourd'hui : <span className="font-medium text-ink">{q.used}</span>{q.unlimited ? ", sans limite" : ` sur ${q.limit}`}</>
            : <Skeleton className="inline-block h-4 w-36 align-middle" />}
        </p>
      </PageHeader>
      <div className="mt-8 overflow-hidden rounded-panel border border-line bg-pearl/60 shadow-card">
        {res.loading && !res.data ? (
          <div className="divide-y divide-line" aria-busy="true" aria-label="Chargement de l'activité">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-6 px-5 py-4">
                <Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-12" /><Skeleton className="ml-auto h-6 w-24 rounded-full" />
              </div>
            ))}
          </div>
        ) : res.error && !res.data ? (
          <LoadError className="p-5 sm:p-6" onRetry={() => void res.reload()}>
            Ton activité n'a pas pu être chargée : le serveur n'a pas répondu. Rien n'est perdu.
          </LoadError>
        ) : items.length === 0 ? (
          <Empty hasActiveKey={me.data ? me.data.keys.active > 0 : null} />
        ) : (
          <table className="w-full text-left text-ui">
            <caption className="sr-only">Conversions récentes</caption>
            <thead className="border-b border-line text-note text-ink-soft">
              <tr><th scope="col" className="px-5 py-3 font-medium">Date</th><th scope="col" className="px-5 py-3 font-medium">Format</th><th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell">Source</th><th scope="col" className="px-5 py-3 font-medium">État</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {items.map((i) => (
                  <motion.tr key={i.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <td className="tabular px-5 py-4">{fmtDateTime(i.createdAt)}</td>
                    <td className="px-5 py-4 font-medium uppercase">{i.fmt}</td>
                    <td className="hidden px-5 py-4 text-ink-soft sm:table-cell">{i.platform ? PLATFORM[i.platform] ?? i.platform : "—"}{i.source === "outils" && <span className="ml-1.5 text-muted">· Tools</span>}</td>
                    <td className="px-5 py-4">
                      <Badge tone={STATE[i.state]?.tone ?? "neutral"}>{STATE[i.state]?.label ?? i.state}</Badge>
                      {i.errorMessage && <p className="mt-1.5 text-note text-ink-soft">{i.errorMessage}</p>}
                      {/* Code stable (docs/ERREURS.md) : à citer en signalant un problème. */}
                      {i.state === "error" && i.errorCode && <p className="mt-1 text-note text-muted wrap-anywhere">Code : <code className="select-all font-mono">{i.errorCode}</code></p>}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
      {items.length > 0 && (
        <p className="mt-3 text-note leading-relaxed text-muted">
          {items.length >= LIMIT ? `Les ${LIMIT} conversions les plus récentes sont affichées. ` : ""}
          Les durées de conservation sont détaillées dans <Link to="/confidentialite" className={link}>Confidentialité</Link>.
        </p>
      )}
    </div>
  );
}
