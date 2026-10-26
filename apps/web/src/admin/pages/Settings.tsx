// Paramètres du service (ytc_setting) : seuls les champs modifiés sont envoyés (PUT partiel). Le serveur
// valide chaque champ ; ses erreurs s'affichent sous le champ concerné et en tête du formulaire.
// Le lien iCloud saisi ici est la SEULE source du bouton « Installer dans Raccourcis » du site.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { invalidate } from "../../lib/store.ts";
import { Button } from "../../ui/Button.tsx";
import { Skeleton } from "../../ui/bits.tsx";
import { IconAlert, IconArrowUpRight } from "../../ui/Icon.tsx";
import { useToast } from "../../ui/Toasts.tsx";
import { adminMutate, useAdmin } from "../data.ts";
import { fmtFull, fmtNum, fmtRelative } from "../format.ts";
import type { Settings as Data } from "../types.ts";
import { AdminPage, ConfirmDialog, ErrorState, Panel, Switch, TextField, linkCls } from "../ui.tsx";

const ICLOUD_RE = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/;
type Field = "dailyLimit" | "maxActive" | "conversionsPaused" | "signupsOpen" | "maintenanceMessage" | "platforms" | "shortcutUrl";
interface Form {
  dailyLimit: string; maxActive: string; conversionsPaused: boolean; signupsOpen: boolean; maintenanceMessage: string;
  platforms: { youtube: boolean; tiktok: boolean; twitter: boolean }; shortcutUrl: string;
}
const PLATFORMS = [["youtube", "YouTube"], ["tiktok", "TikTok"], ["twitter", "X (Twitter)"]] as const;

const toForm = (d: Data): Form => ({
  dailyLimit: String(d.dailyLimit), maxActive: String(d.maxActive), conversionsPaused: d.conversionsPaused, signupsOpen: d.signupsOpen,
  maintenanceMessage: d.maintenanceMessage ?? "", platforms: { ...d.platforms }, shortcutUrl: d.shortcutUrl ?? "",
});

/** Champ en cause d'une erreur de validation du serveur ({ field } ou { fields }, sinon déduit du code). */
function serverFieldErrors(e: ApiError): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const d = e.data ?? {};
  const CODES: Record<string, Field> = {
    invalid_limit: "dailyLimit", invalid_daily_limit: "dailyLimit", invalid_message: "maintenanceMessage",
    invalid_max_active: "maxActive", invalid_platforms: "platforms", invalid_shortcut_url: "shortcutUrl",
  };
  const guess = (raw: string): Field | null => {
    if (CODES[raw]) return CODES[raw]!;
    const c = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (c.includes("shortcut") || c.includes("icloud")) return "shortcutUrl";
    if (c.includes("maintenance")) return "maintenanceMessage";
    if (c.includes("daily")) return "dailyLimit";
    if (c.includes("maxactive")) return "maxActive";
    if (c.includes("platform") || c.includes("youtube") || c.includes("tiktok") || c.includes("twitter")) return "platforms";
    if (c.includes("paused")) return "conversionsPaused";
    if (c.includes("signup")) return "signupsOpen";
    return null;
  };
  if (d.fields && typeof d.fields === "object") {
    for (const [k, v] of Object.entries(d.fields as Record<string, unknown>)) {
      const f = guess(k);
      if (f) out[f] = typeof v === "string" ? v : e.message;
    }
  }
  const single = typeof d.field === "string" ? guess(d.field) : guess(e.code);
  if (single && !out[single]) out[single] = e.message;
  return out;
}

export default function Settings() {
  const toast = useToast();
  const r = useAdmin<Data>("/settings", 30_000);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState<{ body: Record<string, unknown>; lines: ReactNode[]; danger: boolean } | null>(null);
  const base = r.data;
  useEffect(() => { if (base) setForm(toForm(base)); }, [base]);

  const changes = useMemo(() => {
    if (!base || !form) return {} as Record<string, unknown>;
    const b = toForm(base);
    const c: Record<string, unknown> = {};
    if (form.dailyLimit.trim() !== b.dailyLimit) c.dailyLimit = form.dailyLimit.trim();
    if (form.maxActive.trim() !== b.maxActive) c.maxActive = form.maxActive.trim();
    if (form.conversionsPaused !== b.conversionsPaused) c.conversionsPaused = form.conversionsPaused;
    if (form.signupsOpen !== b.signupsOpen) c.signupsOpen = form.signupsOpen;
    if (form.maintenanceMessage.trim() !== b.maintenanceMessage.trim()) c.maintenanceMessage = form.maintenanceMessage.trim();
    if (PLATFORMS.some(([k]) => form.platforms[k] !== b.platforms[k])) c.platforms = { ...form.platforms };
    if (form.shortcutUrl.trim() !== b.shortcutUrl) c.shortcutUrl = form.shortcutUrl.trim();
    return c;
  }, [base, form]);
  const dirty = Object.keys(changes).length > 0;

  if (!base || !form) {
    return (
      <AdminPage eyebrow="Configuration" title="Paramètres">
        {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : <div aria-busy="true" className="space-y-5"><span className="sr-only" role="status">Chargement…</span><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div>}
      </AdminPage>
    );
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const errs: Partial<Record<Field, string>> = {};
    const body: Record<string, unknown> = {};
    const lines: ReactNode[] = [];
    if ("dailyLimit" in changes) {
      const n = /^\d+$/.test(form.dailyLimit.trim()) ? Number(form.dailyLimit) : NaN;
      if (!(n >= 0 && n <= 10_000)) errs.dailyLimit = "Nombre entier de 0 à 10 000.";
      else { body.dailyLimit = n; lines.push(<>Limite quotidienne globale : {fmtNum(base.dailyLimit)} → <b className="font-semibold text-ink">{fmtNum(n)}</b> par compte.</>); }
    }
    if ("maxActive" in changes) {
      const n = /^\d+$/.test(form.maxActive.trim()) ? Number(form.maxActive) : NaN;
      if (!(n >= 1 && n <= base.techMaxActive)) errs.maxActive = `Nombre entier de 1 à ${base.techMaxActive} (plafond technique).`;
      else { body.maxActive = n; lines.push(<>Conversions simultanées par compte : {fmtNum(base.maxActive)} → <b className="font-semibold text-ink">{fmtNum(n)}</b>.</>); }
    }
    if ("conversionsPaused" in changes) {
      body.conversionsPaused = form.conversionsPaused;
      lines.push(form.conversionsPaused
        ? <><b className="font-semibold text-bad">Conversions suspendues :</b> toute nouvelle demande est refusée (« Service temporairement indisponible ») jusqu'à la reprise.</>
        : <><b className="font-semibold text-ink">Conversions reprises :</b> les nouvelles demandes sont de nouveau acceptées.</>);
    }
    if ("signupsOpen" in changes) {
      body.signupsOpen = form.signupsOpen;
      lines.push(form.signupsOpen ? <>Inscriptions <b className="font-semibold text-ink">ouvertes</b> : toute adresse vérifiée (compte Google, ou lien reçu par e-mail) peut créer un compte.</> : <>Inscriptions <b className="font-semibold text-ink">fermées</b> : aucun nouveau compte ; les comptes existants ne changent pas.</>);
    }
    if ("maintenanceMessage" in changes) {
      const m = form.maintenanceMessage.trim();
      if (m.length > 280) errs.maintenanceMessage = "280 caractères au plus.";
      else { body.maintenanceMessage = m; lines.push(m ? <>Message de maintenance affiché : « {m} »</> : <>Message de maintenance retiré.</>); }
    }
    if ("platforms" in changes) {
      body.platforms = { ...form.platforms };
      for (const [k, label] of PLATFORMS) {
        if (form.platforms[k] !== base.platforms[k]) lines.push(form.platforms[k] ? <>{label} : <b className="font-semibold text-ink">activée</b>.</> : <>{label} : <b className="font-semibold text-bad">désactivée</b>, ses liens sont refusés (« plateforme désactivée »).</>);
      }
    }
    if ("shortcutUrl" in changes) {
      const u = form.shortcutUrl.trim();
      if (u && !ICLOUD_RE.test(u)) errs.shortcutUrl = "Forme attendue : https://www.icloud.com/shortcuts/ suivi de 32 caractères hexadécimaux (minuscules).";
      else { body.shortcutUrl = u || null; lines.push(u ? <>Lien iCloud du raccourci : le bouton « Installer dans Raccourcis » du site pointera vers ce lien.</> : <>Lien iCloud remis à la valeur par défaut du serveur (ICLOUD_SHORTCUT_URL) ; si elle est vide, le site proposera le fichier signé.</>); }
    }
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const danger = body.conversionsPaused === true || body.signupsOpen === false || PLATFORMS.some(([k]) => base.platforms[k] && !form.platforms[k]);
    setConfirm({ body, lines, danger });
  };

  const save = async () => {
    if (!confirm) return;
    try {
      await adminMutate("PUT", "/settings", confirm.body, ["/settings", "/quotas", "/overview", "/system"]);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setErrors(serverFieldErrors(e));
        setServerError(e);
        setConfirm(null);
        return;
      }
      throw e;
    }
    invalidate("/api/config", "/api/status");
    toast.show("success", "Paramètres enregistrés");
    await r.reload();
  };

  const urlOk = ICLOUD_RE.test(form.shortcutUrl.trim());
  return (
    <AdminPage
      eyebrow="Configuration"
      title="Paramètres"
      lead={base.updatedAt ? <>Dernière modification le {fmtFull(base.updatedAt)} ({fmtRelative(base.updatedAt)}){base.updatedBy ? <> par <span className="text-ink">{base.updatedBy}</span></> : null}.</> : "Valeurs par défaut du serveur : aucune modification enregistrée."}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {serverError && (
          <div role="alert" className="flex gap-3 rounded-[16px] border border-bad/20 bg-bad-bg/70 p-4 text-bad">
            <IconAlert size={20} className="shrink-0" />
            <div><p className="text-[15px] font-semibold">Le serveur a refusé l'enregistrement</p><p className="mt-0.5 text-[14px]">{serverError.message} <span className="font-mono text-[12.5px] opacity-80">({serverError.code})</span></p></div>
          </div>
        )}

        <Panel title="Service" description="S'applique immédiatement à toutes les nouvelles demandes.">
          <div className="space-y-5">
            <Switch label="Suspendre les conversions" checked={form.conversionsPaused} onChange={(v) => set("conversionsPaused", v)} description={form.conversionsPaused ? "Les conversions sont suspendues : les iPhone reçoivent « Service temporairement indisponible »." : "Les conversions sont acceptées."} />
            {errors.conversionsPaused && <p className="text-[13px] text-bad">{errors.conversionsPaused}</p>}
            <div>
              <label htmlFor="maintenance" className="mb-1 block text-[13.5px] font-medium text-ink-soft">Message de maintenance</label>
              <textarea
                id="maintenance"
                rows={3}
                value={form.maintenanceMessage}
                onChange={(e) => set("maintenanceMessage", e.target.value)}
                aria-invalid={errors.maintenanceMessage ? true : undefined}
                aria-describedby="maintenance-hint"
                className="w-full rounded-[12px] border border-field bg-white/75 px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-muted focus:border-gold-text focus:bg-white focus:outline-none focus-visible:outline-2 focus-visible:outline-gold-text"
                placeholder="Ex. : maintenance ce soir de 22 h à 22 h 30."
              />
              <p id="maintenance-hint" className={errors.maintenanceMessage ? "mt-1.5 text-[13px] text-bad" : "tabular mt-1.5 text-[13px] text-muted"}>
                {errors.maintenanceMessage ?? <>Affiché dans l'état du service (site et aide). {form.maintenanceMessage.trim().length} / 280 caractères.</>}
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Comptes et quotas globaux" description={`Les limites techniques (dont ${base.techMaxActive} jobs actifs par compte) ne sont jamais levées.`}>
          <div className="space-y-5">
            <Switch label="Inscriptions ouvertes" checked={form.signupsOpen} onChange={(v) => set("signupsOpen", v)} description="Fermées : aucun nouveau compte ; les comptes existants se connectent normalement." />
            {errors.signupsOpen && <p className="text-[13px] text-bad">{errors.signupsOpen}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Conversions par jour et par compte" inputMode="numeric" value={form.dailyLimit} onChange={(e) => set("dailyLimit", e.target.value)} error={errors.dailyLimit} hint="0 à 10 000 · remise à zéro à minuit (Paris)" />
              <TextField label="Conversions simultanées par compte" inputMode="numeric" value={form.maxActive} onChange={(e) => set("maxActive", e.target.value)} error={errors.maxActive} hint={`1 à ${base.techMaxActive} (plafond technique)`} />
            </div>
          </div>
        </Panel>

        <Panel title="Plateformes" description="Une plateforme désactivée refuse ses liens avec le code « platform_disabled ».">
          <div className="space-y-4">
            {PLATFORMS.map(([k, label]) => (
              <Switch key={k} label={label} checked={form.platforms[k]} onChange={(v) => set("platforms", { ...form.platforms, [k]: v })} description={form.platforms[k] ? "Liens acceptés." : "Liens refusés."} />
            ))}
            {errors.platforms && <p className="text-[13px] text-bad">{errors.platforms}</p>}
          </div>
        </Panel>

        <Panel title="Raccourci iCloud" description="Lien officiel du raccourci AETHRYON : seule source du bouton « Installer dans Raccourcis » du site, de l'aide et de la FAQ.">
          <TextField
            label="Lien iCloud du raccourci"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={form.shortcutUrl}
            onChange={(e) => set("shortcutUrl", e.target.value)}
            error={errors.shortcutUrl}
            hint="https://www.icloud.com/shortcuts/ suivi de 32 caractères hexadécimaux. Vide : retour au lien par défaut du serveur (ICLOUD_SHORTCUT_URL)."
            inputClassName="font-mono text-[14px]"
          />
          {urlOk && (
            <a href={form.shortcutUrl.trim()} target="_blank" rel="noopener noreferrer" className={`${linkCls} mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px]`}>
              Vérifier ce lien sur iCloud<IconArrowUpRight size={15} /><span className="sr-only">(nouvel onglet)</span>
            </a>
          )}
        </Panel>

        <div className={cn("z-10 -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-t border-line bg-ivory/95 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10", dirty && "sticky bottom-0 shadow-[0_-12px_24px_-20px_rgb(52_40_22/0.35)]")}>
          <p className="w-full text-[13px] text-muted sm:w-auto sm:flex-1" aria-live="polite">{dirty ? `${Object.keys(changes).length} modification${Object.keys(changes).length > 1 ? "s" : ""} non enregistrée${Object.keys(changes).length > 1 ? "s" : ""}.` : "Aucune modification."}</p>
          <Button size="sm" variant="ghost" className="h-11" disabled={!dirty} onClick={() => { setForm(toForm(base)); setErrors({}); setServerError(null); }}>Annuler<span className="hidden sm:inline"> les modifications</span></Button>
          <Button size="sm" type="submit" variant="primary" className="h-11" disabled={!dirty}>Enregistrer</Button>
        </div>
      </form>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Enregistrer ces paramètres ?"
        tone={confirm?.danger ? "danger" : "primary"}
        confirmLabel="Enregistrer"
        consequence={<>Effet immédiat pour tous les utilisateurs :<ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-gold">{confirm?.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></>}
        onConfirm={save}
      />
    </AdminPage>
  );
}
