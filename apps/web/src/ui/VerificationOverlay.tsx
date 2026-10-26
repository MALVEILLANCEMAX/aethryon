// Vérification de sécurité AETHRYON (lib/verification.ts). Obsidienne, ivoire, or patiné ; la chouette EXISTANTE
// (OwlMark, tête maître du propriétaire) : entrée douce, clignement, halo doré pendant la preuve, yeux allumés
// SEULEMENT quand le serveur a confirmé la vérification (phase « success », posée par lib/verification.ts sur
// l'en-tête X-Aethryon-Verification). L'animation ne décide de rien et ne retarde rien : l'action a déjà repris.
// <dialog> natif : focus piégé, fond inerte, Échap = fermer (sauf pendant la preuve, qui ne dure que le calcul).
// Mouvement réduit : ni halo qui respire, ni déplacement ; seulement des fondus.
import { useEffect, useRef, useState } from "react";
import { OwlMark } from "./brand/OwlMark.tsx";
import { verifyDone, verifyStore, type VerifyState } from "../lib/verification.ts";
import "./verification.css";

const TEXT: Record<VerifyState["phase"], { title: string; line: string; action?: string; close?: string }> = {
  verifying: { title: "Vérification de sécurité", line: "Vérification de votre navigateur…" },
  success: { title: "Vérification de sécurité", line: "Vérification terminée." },
  failed: { title: "Vérification interrompue", line: "La vérification n'a pas abouti. Tu peux réessayer.", action: "Réessayer", close: "Annuler" },
  expired: { title: "Vérification expirée", line: "Le délai de vérification est dépassé. Recommence, cela ne prend qu'un instant.", action: "Recommencer", close: "Annuler" },
  unavailable: { title: "Vérification indisponible", line: "La vérification de sécurité ne répond pas pour le moment. Réessaie dans un instant.", action: "Réessayer", close: "Annuler" },
  blocked: { title: "Action suspendue", line: "Trop de tentatives refusées\u00a0: cette action est suspendue quelques minutes.", close: "Fermer" },
};
/** Affichage de la réussite (yeux allumés) avant la sortie : l'action, elle, a déjà repris. */
const SUCCESS_HOLD_MS = 560;
const EXIT_MS = 180;

export default function VerificationOverlay({ state }: { state: VerifyState }) {
  const ref = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const t = TEXT[state.phase];
  const waiting = state.phase === "verifying";
  const line = waiting && state.slow ? "Un instant, notre gardienne veille." : state.phase === "blocked" && state.message ? state.message : t.line;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Réussite confirmée : les yeux s'allument, puis le voile s'efface et la page reprend la main.
  useEffect(() => {
    if (state.phase !== "success") return;
    const a = window.setTimeout(() => setLeaving(true), SUCCESS_HOLD_MS);
    const b = window.setTimeout(() => { ref.current?.close(); verifyDone(state.id); }, SUCCESS_HOLD_MS + EXIT_MS);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [state.phase, state.id]);

  // Erreur : le focus va sur l'action proposée (clavier, lecteur d'écran).
  useEffect(() => { if (t.action || t.close) primary.current?.focus(); }, [state.phase, t.action, t.close]);

  const answer = (retry: boolean) => verifyStore.answer(retry);

  return (
    <dialog
      ref={ref}
      className="verif"
      data-phase={state.phase}
      data-leaving={leaving || undefined}
      aria-labelledby="verif-title"
      aria-describedby="verif-line"
      onCancel={(e) => { e.preventDefault(); if (!waiting && state.phase !== "success") answer(false); }}
    >
      <div className="verif-card">
        <div className="verif-owl" aria-hidden="true">
          <span className="verif-halo" />
          <OwlMark size={96} surface="dark" pad={4} wink={1} blink={waiting} className="verif-mark" />
        </div>
        <p className="verif-eyebrow">AETHRYON</p>
        <h2 id="verif-title" className="verif-title">{t.title}</h2>
        <p id="verif-line" className="verif-line" role="status" aria-live="polite">{line}</p>
        <div className="verif-track" aria-hidden="true" data-hidden={!waiting && state.phase !== "success" ? "" : undefined}>
          <span className="verif-bar" style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, state.progress / 100))})` }} />
        </div>
        {(t.action || t.close) && (
          <div className="verif-actions">
            {t.action && <button ref={primary} type="button" className="verif-btn verif-btn--gold" onClick={() => answer(true)}>{t.action}</button>}
            {t.close && <button ref={t.action ? undefined : primary} type="button" className="verif-btn" onClick={() => answer(false)}>{t.close}</button>}
          </div>
        )}
        <p className="verif-note">Protection auto-hébergée, sans pistage : un court calcul fait par ton navigateur, vérifié par nos serveurs.</p>
      </div>
    </dialog>
  );
}
