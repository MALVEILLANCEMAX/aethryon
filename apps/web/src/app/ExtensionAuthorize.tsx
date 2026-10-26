// Consentement de l'extension navigateur (docs/EXTENSION.md §3 et §7). Page ouverte par
// chrome.identity.launchWebAuthFlow dans une fenêtre du navigateur, hors de la coque du site (pas de
// menu ni de pied de page : rien ne doit détourner de la décision).
// - Paramètres vérifiés AVANT tout affichage, comme le fera le serveur ; invalides → message clair et
//   AUCUNE redirection.
// - Sans session : /connexion?suite=<cette page> (chemin relatif reconstruit à partir des seuls
//   paramètres vérifiés), retour ici après la connexion Google.
// - « Autoriser » → POST /api/extension/authorize ; « Refuser » → POST /api/extension/deny ; la
//   redirection renvoyée n'est suivie (window.location.replace) que si elle vise exactement l'URI de
//   retour demandée, avec le même state.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { motion } from "motion/react";
import { api, ApiError } from "../lib/api.ts";
import { useDocumentTitle, useMe } from "../lib/hooks.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { invalidate } from "../lib/store.ts";
import { AethryonMascot, type MascotState } from "../ui/brand/AethryonMascot.tsx";
import { BrandLogo } from "../ui/brand/BrandLogo.tsx";
import { Button, ButtonLink } from "../ui/Button.tsx";
import { IconAlert, IconCheck, IconClose, IconLock } from "../ui/Icon.tsx";
import { Skeleton } from "../ui/bits.tsx";

const REDIRECT_RE = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/aethryon$/;
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const PARAMS = ["redirect_uri", "state", "code_challenge", "code_challenge_method", "appareil"] as const;
const DEVICE_MAX = 60;
export const DEFAULT_DEVICE = "Appareil inconnu";

export interface ConsentRequest { redirectUri: string; state: string; challenge: string; device: string }

/** Nom d'appareil affiché : sans caractères de contrôle ni de direction, espaces réduites, 60 caractères au plus. */
export function cleanDevice(raw: string | null): string {
  const s = (raw ?? "").slice(0, 1000).normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(s);
  return (chars.length > DEVICE_MAX ? chars.slice(0, DEVICE_MAX).join("").trimEnd() : s) || DEFAULT_DEVICE;
}

/** Demande de l'extension (query string) vérifiée ; null si elle est invalide ou ambiguë. */
export function parseConsentRequest(search: string): ConsentRequest | null {
  const q = new URLSearchParams(search);
  for (const k of PARAMS) if (q.getAll(k).length > 1) return null;
  const redirectUri = q.get("redirect_uri") ?? "";
  const state = q.get("state") ?? "";
  const challenge = q.get("code_challenge") ?? "";
  if (!REDIRECT_RE.test(redirectUri) || !B64URL_43.test(state) || !B64URL_43.test(challenge) || q.get("code_challenge_method") !== "S256") return null;
  return { redirectUri, state, challenge, device: cleanDevice(q.get("appareil")) };
}

/** Cette page, reconstruite à partir des paramètres vérifiés (retour après la connexion Google). */
export function consentPath(r: ConsentRequest): string {
  return `/extension/autoriser?redirect_uri=${encodeURIComponent(r.redirectUri)}&state=${r.state}` +
    `&code_challenge=${r.challenge}&code_challenge_method=S256&appareil=${encodeURIComponent(r.device)}`;
}

/** Redirection renvoyée par le serveur : seulement vers l'URI de retour demandée, avec le même state. */
export function checkedRedirect(target: unknown, r: ConsentRequest, kind: "code" | "denied"): string | null {
  if (typeof target !== "string") return null;
  let u: URL;
  try { u = new URL(target); } catch { return null; }
  if (`${u.origin}${u.pathname}` !== r.redirectUri || u.hash || u.username || u.password) return null;
  const q = u.searchParams;
  if (q.getAll("state").length !== 1 || q.get("state") !== r.state) return null;
  if (kind === "code") return [...q.keys()].length === 2 && B64URL_43.test(q.get("code") ?? "") ? target : null;
  return [...q.keys()].length === 2 && q.get("error") === "access_denied" ? target : null;
}

type Action = "allow" | "deny";
type Phase =
  | { kind: "ready" }
  | { kind: "busy"; action: Action }
  | { kind: "leaving"; action: Action }
  | { kind: "error"; code: string; message: string };

const NETWORK = "Connexion impossible. Vérifie ta connexion et réessaie.";
const SERVER = "Le serveur AETHRYON ne répond pas pour le moment : réessaie dans un instant.";
const BAD_REDIRECT = "Réponse inattendue du serveur : aucune redirection n'a été faite. Ferme cette fenêtre, puis relance la connexion depuis l'extension.";

/** Cadre commun : logo, carte centrée, entrée douce (repris par la page d'accord de Premiere Pro). */
export function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <main id="contenu" className="relative min-h-dvh overflow-hidden bg-ivory text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_0%,rgb(233_224_208/0.65),transparent_70%)]" />
      <div className="container-site relative flex min-h-dvh flex-col items-center justify-center py-8 sm:py-14">
        <BrandLogo size="md" className="mb-7" />
        <motion.section
          aria-label={label}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.reveal, ease: EASE.soft }}
          className="w-full max-w-[540px] rounded-[30px] border border-line bg-pearl/70 p-6 shadow-raised sm:p-9"
        >
          {children}
        </motion.section>
      </div>
    </main>
  );
}

function Invalid() {
  return (
    <Frame label="Demande d'autorisation invalide">
      <div className="flex flex-col items-center text-center">
        <AethryonMascot still state="curious" size={112} />
        <h1 className="font-display mt-4 text-[28px] font-medium leading-tight">Demande d'autorisation invalide</h1>
        <p className="mt-3 text-[15.5px] leading-relaxed text-ink-soft">
          Ce lien ne vient pas de l'extension AETHRYON, ou il est incomplet. Aucune autorisation n'a été donnée.
          Ferme cette fenêtre, puis relance la connexion depuis l'extension.
        </p>
        <ButtonLink to="/" variant="secondary" className="mt-7">Retour à l'accueil</ButtonLink>
      </div>
    </Frame>
  );
}

export function Loading() {
  return (
    <Frame label="Vérification de ta session">
      <div aria-busy="true">
        <span role="status" className="sr-only">Vérification de ta session…</span>
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 shrink-0 rounded-full" />
          <Skeleton className="h-16 flex-1" />
        </div>
        <Skeleton className="mt-6 h-20" />
        <Skeleton className="mt-6 h-40" />
      </div>
    </Frame>
  );
}

export default function ExtensionAuthorize() {
  useDocumentTitle("Autoriser l'extension");
  const location = useLocation();
  const navigate = useNavigate();
  const req = useMemo(() => parseConsentRequest(location.search), [location.search]);
  const me = useMe();
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });

  const toLogin = useMemo(() => (req ? `/connexion?suite=${encodeURIComponent(consentPath(req))}` : null), [req]);
  useEffect(() => {
    if (toLogin && me.error?.status === 401) navigate(toLogin, { replace: true });
  }, [toLogin, me.error, navigate]);

  if (!req) return <Invalid />;
  if (!me.data || me.error?.status === 401) {
    if (me.error && me.error.status !== 401) {
      return (
        <Frame label="Session impossible à vérifier">
          <div role="alert" className="flex gap-3 text-[15.5px] leading-relaxed text-bad">
            <IconAlert size={20} className="mt-0.5 shrink-0" />
            <p>{me.error.isServer ? SERVER : me.error.message}</p>
          </div>
          <Button variant="primary" className="mt-6 w-full sm:w-auto" onClick={() => void me.reload()}>Réessayer</Button>
        </Frame>
      );
    }
    return <Loading />;
  }

  const user = me.data.user;
  const limit = (me.data.today as { limit: number | null }).limit;
  const busy = phase.kind === "busy" || phase.kind === "leaving";
  const owl: MascotState = phase.kind === "busy" ? "processing" : phase.kind === "leaving" ? (phase.action === "allow" ? "success" : "idle") : phase.kind === "error" ? "error" : "idle";

  const decide = async (action: Action) => {
    if (busy) return;
    setPhase({ kind: "busy", action });
    try {
      const body = action === "allow"
        ? { redirect_uri: req.redirectUri, state: req.state, code_challenge: req.challenge, code_challenge_method: "S256", appareil: req.device }
        : { redirect_uri: req.redirectUri, state: req.state };
      const r = await api<{ redirect?: unknown }>(action === "allow" ? "/api/extension/authorize" : "/api/extension/deny", { method: "POST", body });
      const target = checkedRedirect(r?.redirect, req, action === "allow" ? "code" : "denied");
      if (!target) {
        setPhase({ kind: "error", code: "bad_redirect", message: BAD_REDIRECT });
        return;
      }
      setPhase({ kind: "leaving", action });
      window.location.replace(target);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Session expirée entre-temps : la ressource /api/me est rechargée (401) → connexion, puis retour ici.
        invalidate("/api/me");
        return;
      }
      if (e instanceof ApiError) setPhase({ kind: "error", code: e.code, message: e.isServer ? SERVER : e.message });
      else setPhase({ kind: "error", code: "network", message: NETWORK });
    }
  };

  return (
    <Frame label="Autorisation de l'extension AETHRYON">
      <div className="flex items-center gap-4 sm:gap-5">
        <AethryonMascot state={owl} size={92} className="-my-2 shrink-0" />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.16em] text-gold-text">Extension navigateur</p>
          <h1 className="font-display mt-1.5 text-[26px] font-medium leading-[1.15] tracking-[-0.01em] sm:text-[30px]">
            Autoriser l'extension AETHRYON sur cet appareil ?
          </h1>
        </div>
      </div>

      <dl className="mt-6 divide-y divide-line rounded-[18px] border border-line bg-ivory text-[15px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
          <dt className="text-ink-soft">Appareil</dt>
          <dd className="min-w-0 break-words font-medium">{req.device}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
          <dt className="text-ink-soft">Compte</dt>
          <dd className="min-w-0 break-all font-medium">{user.email}</dd>
        </div>
      </dl>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6">
        <section aria-labelledby="peut">
          <h2 id="peut" className="text-[14.5px] font-semibold">Elle pourra</h2>
          <ul className="mt-2.5 space-y-2.5 text-[14.5px] leading-snug text-ink-soft">
            <li className="flex gap-2.5"><IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />Convertir des vidéos avec ton compte</li>
            <li className="flex gap-2.5">
              <IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />
              <span>Utiliser le même quota que le raccourci{typeof limit === "number" ? ` (${limit} conversion${limit > 1 ? "s" : ""} par jour)` : ""}</span>
            </li>
            <li className="flex gap-2.5"><IconCheck size={18} aria-hidden className="mt-px shrink-0 text-ok" />Voir ton quota et ton historique récent de conversions</li>
          </ul>
        </section>
        <section aria-labelledby="peut-pas">
          <h2 id="peut-pas" className="text-[14.5px] font-semibold">Elle n'aura aucun accès</h2>
          <ul className="mt-2.5 space-y-2.5 text-[14.5px] leading-snug text-ink-soft">
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />À tes cookies</li>
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />À ton historique de navigation</li>
            <li className="flex gap-2.5"><IconClose size={18} aria-hidden className="mt-px shrink-0 text-bad" />À ton compte Google</li>
          </ul>
        </section>
      </div>

      <p className="mt-6 flex gap-2.5 border-t border-line pt-5 text-[14px] leading-relaxed text-ink-soft">
        <IconLock size={18} aria-hidden className="mt-0.5 shrink-0 text-gold-text" />
        <span>Tu peux révoquer cet accès à tout moment dans «&nbsp;Mes jetons&nbsp;», depuis ton espace personnel.</span>
      </p>

      {phase.kind === "error" && (
        <div role="alert" className="mt-5 flex gap-2.5 rounded-[16px] border border-bad/20 bg-bad-bg p-3.5 text-[14.5px] leading-relaxed text-bad">
          <IconAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <div>
            <p>{phase.message}</p>
            {phase.code === "too_many_extensions" && (
              <Link to="/dashboard/cles" target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex min-h-11 items-center font-medium underline decoration-bad/40 underline-offset-4 hover:decoration-bad">
                Ouvrir «&nbsp;Mes jetons&nbsp;» dans un nouvel onglet
              </Link>
            )}
          </div>
        </div>
      )}

      {/* S1 (docs/PLAN-EXTENSION.md §3) : une page de consentement ouverte sans action de ta part est suspecte. */}
      <p className="mt-6 text-[14px] leading-relaxed text-ink-soft" data-consent-rappel="">
        Autorise seulement si tu viens de cliquer sur «&nbsp;Se connecter&nbsp;» dans l'extension AETHRYON. Sinon, refuse.
      </p>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={busy} loading={phase.kind === "busy" && phase.action === "deny"} onClick={() => void decide("deny")}>
          Refuser
        </Button>
        <Button variant="primary" disabled={busy} loading={phase.kind === "busy" && phase.action === "allow"} onClick={() => void decide("allow")}>
          Autoriser
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-4 min-h-[21px] text-center text-[14px] text-ink-soft sm:text-right">
        {phase.kind === "busy" ? (phase.action === "allow" ? "Autorisation en cours…" : "Refus en cours…") : null}
        {phase.kind === "leaving" ? (phase.action === "allow" ? "Accès autorisé : retour à l'extension…" : "Accès refusé : retour à l'extension…") : null}
      </p>
    </Frame>
  );
}
