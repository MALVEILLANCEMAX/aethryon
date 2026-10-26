// ANCIENNE administration (/admin), identique à la page en production avant le Control Center.
// Incluse seulement dans les builds sans Control Center (VITE_CONTROL_CENTER=0, voir routes.tsx) : le site
// public garde ainsi une page qui fonctionne avec l'API account en production, tant que le Control Center
// (nouvelle API d'administration, migration 003) n'est pas validé et déployé. À supprimer ensuite.
import { useState } from "react";
import { api } from "../lib/api.ts";
import { fmtDate, fmtRelative } from "../lib/format.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { invalidate, useResource } from "../lib/store.ts";
import { Button, ButtonLink } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { NumberTicker } from "../ui/NumberTicker.tsx";
import { Badge, Card, Skeleton } from "../ui/bits.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { toastError, useRequireUser } from "./common.tsx";

interface AdminOverview {
  users: number; activeKeys: number; conversionsToday: number; conversionsPaused: boolean; signupsOpen: boolean; dailyLimit: number;
}
interface AdminUser {
  id: string; email: string; name: string; status: string; role: string; createdAt: string | null; lastLoginAt: string | null; todayUsed: number;
}

export default function AdminLegacy() {
  useDocumentTitle("Administration");
  const me = useRequireUser();
  const toast = useToast();
  const isAdmin = me.data?.user.role === "admin";
  const ov = useResource<AdminOverview>(isAdmin ? "/api/admin/overview" : null, 10_000);
  const [q, setQ] = useState("");
  const users = useResource<{ users: AdminUser[] }>(isAdmin ? `/api/admin/users?q=${encodeURIComponent(q)}` : null, 10_000);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [limit, setLimit] = useState("");

  if (me.data && !isAdmin) {
    return (
      <div className="container-site pb-24 pt-36">
        <h1 className="page-title">Accès réservé</h1>
        <p className="mt-2 text-ink-soft">Cette page est réservée à l'administrateur du service.</p>
        <ButtonLink to="/dashboard" variant="secondary" className="mt-6">Retour à mon espace</ButtonLink>
      </div>
    );
  }
  const save = async (body: Record<string, unknown>, label: string) => {
    try {
      await api("/api/admin/settings", { method: "POST", body });
      toast.show("success", label);
      invalidate("/api/admin/overview", "/api/status", "/api/config");
    } catch (e) { toastError(toast, e, "Réglage impossible"); }
  };
  const setStatus = async () => {
    if (!target) return;
    const next = target.status === "suspended" ? "active" : "suspended";
    try {
      await api(`/api/admin/users/${encodeURIComponent(target.id)}/status`, { method: "POST", body: { status: next } });
      toast.show("success", next === "suspended" ? "Compte suspendu" : "Compte réactivé");
      setTarget(null);
      invalidate(`/api/admin/users?q=${encodeURIComponent(q)}`, "/api/admin/overview");
    } catch (e) { toastError(toast, e, "Action impossible"); }
  };
  const o = ov.data;
  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <h1 className="page-title">Administration</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Utilisateurs", o?.users], ["Jetons actifs", o?.activeKeys], ["Conversions aujourd'hui", o?.conversionsToday], ["Limite quotidienne", o?.dailyLimit]].map(([l, v]) => (
          <Card key={String(l)} className="p-5">
            <p className="text-[14px] text-ink-soft">{l}</p>
            {v === undefined ? <Skeleton className="mt-3 h-9 w-16" /> : <p className="mt-2 text-[34px] font-semibold tabular-nums"><NumberTicker value={Number(v)} /></p>}
          </Card>
        ))}
      </div>

      <Card as="section" className="mt-6 p-6">
        <h2 className="font-display text-[23px] font-medium">Réglages</h2>
        {o ? (
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end">
            <Button variant={o.conversionsPaused ? "primary" : "danger"} onClick={() => save({ conversionsPaused: !o.conversionsPaused }, o.conversionsPaused ? "Conversions reprises" : "Conversions suspendues")}>
              {o.conversionsPaused ? "Reprendre les conversions" : "Suspendre les conversions"}
            </Button>
            <Button variant="secondary" onClick={() => save({ signupsOpen: !o.signupsOpen }, o.signupsOpen ? "Inscriptions fermées" : "Inscriptions ouvertes")}>
              {o.signupsOpen ? "Fermer les inscriptions" : "Ouvrir les inscriptions"}
            </Button>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(limit); if (Number.isInteger(n) && n >= 0) void save({ dailyLimit: n }, "Limite mise à jour"); }}>
              <div>
                <label htmlFor="limit" className="text-sm text-ink-soft">Limite par jour</label>
                <input id="limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={String(o.dailyLimit)} className="mt-2 h-12 w-28 rounded-[12px] border border-field bg-white/70 px-3 text-[16px]" />
              </div>
              <Button type="submit" variant="secondary">Appliquer</Button>
            </form>
          </div>
        ) : <Skeleton className="mt-4 h-12 w-80" />}
      </Card>

      <section className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-display text-[23px] font-medium">Utilisateurs</h2>
          <div>
            <label htmlFor="search" className="sr-only">Rechercher un utilisateur</label>
            <input id="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (e-mail, nom)" className="h-11 w-full rounded-[12px] border border-field bg-white/70 px-3.5 text-[15px] sm:w-72" />
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-line bg-pearl/60">
          <table className="w-full min-w-[640px] text-left text-[14.5px]">
            <thead className="border-b border-line text-[13px] text-ink-soft"><tr><th className="px-4 py-3 font-medium">Utilisateur</th><th className="px-4 py-3 font-medium">Inscrit</th><th className="px-4 py-3 font-medium">Dernière connexion</th><th className="px-4 py-3 font-medium">Aujourd'hui</th><th className="px-4 py-3 font-medium">État</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {(users.data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-medium">{u.name}</p><p className="text-ink-soft">{u.email}</p></td>
                  <td className="px-4 py-3 text-ink-soft">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-ink-soft">{fmtRelative(u.lastLoginAt)}</td>
                  <td className="px-4 py-3 tabular-nums">{u.todayUsed}</td>
                  <td className="px-4 py-3">{u.status === "suspended" ? <Badge tone="bad">Suspendu</Badge> : <Badge tone="ok">Actif</Badge>}{u.role === "admin" && <Badge tone="gold" className="ml-2">Admin</Badge>}</td>
                  <td className="px-4 py-3 text-right">{u.id !== me.data?.user.id && <Button size="sm" variant={u.status === "suspended" ? "secondary" : "danger"} className="h-11" onClick={() => setTarget(u)}>{u.status === "suspended" ? "Réactiver" : "Suspendre"}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.status === "suspended" ? `Réactiver ${target?.email} ?` : `Suspendre ${target?.email ?? ""} ?`}
        description={target?.status === "suspended" ? "Le compte pourra de nouveau se connecter et convertir." : "Ses sessions seront fermées et ses jetons refusés tant que le compte reste suspendu."}
        footer={<><Button variant="ghost" onClick={() => setTarget(null)}>Annuler</Button><Button variant={target?.status === "suspended" ? "primary" : "danger"} onClick={setStatus}>{target?.status === "suspended" ? "Réactiver" : "Suspendre"}</Button></>}
      />
    </div>
  );
}
