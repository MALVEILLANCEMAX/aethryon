/*! Adapté de « Password strength » d'Arc (https://uiarc.dev/components/password-strength), licence MIT,
 *  Copyright (c) 2026 Elia Kuratli — texte de la licence : web/LICENCES-TIERS.md. */
// Champ de NOUVEAU mot de passe (inscription, changement, réinitialisation, ajout) : quatre segments qui se remplissent
// et changent de ton, le mot de la jauge qui monte ou descend selon le sens, chaque règle cochée d'un trait dessiné,
// l'œil que barre un trait (afficher / masquer), une secousse quand une NOUVELLE erreur arrive.
// Modifications pour AETHRYON : règles = la politique du serveur (lib/password.ts, identique à account) — rien d'autre
// n'est exigé (ni majuscule ni symbole) ; jauge indicative (lib/password.ts, estimateStrength) ; textes en français ;
// annonces aux lecteurs d'écran regroupées (une phrase, 700 ms après la dernière frappe) ; aucun
// `AnimatePresence mode="popLayout"` (il injecte une balise <style>, refusée par la CSP) : les mots sortants et
// entrants sont superposés dans une case de taille fixe ; bouton « afficher » de 44 px ; couleurs et typographie du site.
// Gestionnaires de mots de passe, collage, phrases de passe longues : acceptés tels quels.
// Finition (2026-10-14, d'après le password-strength.tsx transmis) : segments au ressort vif (CELL : rigidité 520,
// amortissement 34, masse 0,45) décalés de 30 ms ; mot de la jauge en fondu croisé (CROSSFADE : 260 / 34 / 0,8) dans une
// case de largeur fixe où tous les mots sont superposés (aucun glissement, aucun saut) ; coche qui grandit en se
// dessinant. Les règles restent celles du serveur (pas de majuscule, chiffre ni symbole imposés).
import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { EASE, SPRING } from "../lib/motion.ts";
import { estimateStrength, PASSWORD_MAX, passwordRules, STRENGTH_LABELS, type PasswordContext } from "../lib/password.ts";
import { RollingText } from "./RollingText.tsx";

export interface PasswordStrengthProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "children"> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Adresse et nom (inscription) : la règle « différent de ton adresse et de ton nom » s'ajoute. */
  context?: PasswordContext;
  /** Erreur du formulaire ou du serveur, liée au champ ; une nouvelle erreur fait secouer le champ une fois. */
  error?: string | null;
  /** Conseil sous les règles (facultatif). */
  tip?: string;
}

const CELL = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const CROSSFADE = { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } as const;

/** L'œil, que barre un trait qui se dessine (au lieu d'échanger deux icônes). */
function EyeMorph({ slashed, calm }: { slashed: boolean; calm: boolean }) {
  const mask = `oeil-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const slash = { pathLength: slashed ? 1 : 0, opacity: slashed ? 1 : 0 };
  const t = calm ? { duration: 0 } : { pathLength: { duration: 0.26, ease: EASE.soft }, opacity: { duration: 0.08 } };
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white" stroke="none" /><motion.path d="M3 3l18 18" stroke="black" strokeWidth={5} initial={false} animate={slash} transition={t} /></mask>
      <g mask={`url(#${mask})`}><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></g>
      <motion.path d="M3 3l18 18" initial={false} animate={slash} transition={t} />
    </svg>
  );
}

/** La pastille d'une règle : le fond grandit sous la coche pendant qu'elle se dessine ; décochée, elle se retire vite. */
function RuleMark({ met, delay, calm }: { met: boolean; delay: number; calm: boolean }) {
  return (
    <span className="pws-mark" aria-hidden="true">
      <motion.span className="pws-mark-fill" initial={false} animate={{ scale: met ? 1 : 0.5, opacity: met ? 1 : 0 }}
        transition={calm ? { duration: 0 } : { scale: { ...SPRING.snappy, delay }, opacity: { duration: met ? 0.16 : 0.08, delay } }} />
      <svg className="pws-tick" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M4.75 8.25 7 10.5l4.25-4.75" initial={false} animate={{ pathLength: met ? 1 : 0, opacity: met ? 1 : 0, scale: met ? 1 : 0.6 }} style={{ originX: "50%", originY: "50%" }}
          transition={calm ? { duration: 0 } : met ? { pathLength: { duration: 0.26, ease: EASE.soft, delay: delay + 0.06 }, opacity: { duration: 0.05, delay: delay + 0.06 } } : { pathLength: { duration: 0.16 }, opacity: { duration: 0.16, delay: 0.06 } }} />
      </svg>
    </span>
  );
}

export function PasswordStrength({ id, label, value, onValueChange, context, error, tip, className, ...props }: PasswordStrengthProps) {
  const calm = useCalm();
  const [shown, setShown] = useState(false);
  const strength = estimateStrength(value, context);
  const rules = passwordRules(value, context);
  const metIds = rules.filter((r) => r.met).map((r) => r.id).join(" ");

  // Sens du mot (monte si la jauge progresse) et règles qui viennent de changer (vague décalée de leurs coches).
  const [track, setTrack] = useState({ level: strength.level, direction: 1, met: metIds, previousMet: metIds, previousLevel: strength.level });
  if (track.level !== strength.level || track.met !== metIds) {
    setTrack({ level: strength.level, direction: strength.level >= track.level ? 1 : -1, met: metIds, previousMet: track.met, previousLevel: track.level });
  }
  const before = new Set(track.previousMet.split(" ").filter(Boolean));
  const changed = rules.filter((r) => r.met !== before.has(r.id)).map((r) => r.id);

  // Secousse : une seule fois par NOUVELLE erreur (ressort lâché de côté, comme un champ refusé sur un téléphone).
  const shake = useMotionValue(0);
  const shaking = useRef<AnimationPlaybackControls | null>(null);
  const lastError = useRef(error);
  useEffect(() => {
    const prev = lastError.current;
    lastError.current = error;
    if (!error || error === prev || calm) return;
    shaking.current?.stop();
    shaking.current = animate(shake, 0, { type: "spring", velocity: -240, stiffness: 900, damping: 15, restDelta: 0.1 });
  }, [error, calm, shake]);

  // Lecteurs d'écran : une phrase, 700 ms après la dernière frappe (pas à chaque caractère).
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!value) { setAnnounce(""); return; }
    const t = window.setTimeout(() => {
      const missing = rules.filter((r) => !r.met).map((r) => r.label.toLowerCase());
      setAnnounce(`Solidité : ${strength.label}.${missing.length ? ` Reste à faire : ${missing.join(", ")}.` : " Toutes les règles sont respectées."}`);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, strength.label, metIds]);

  const rulesId = `${id}-regles`;
  const errorId = `${id}-erreur`;
  return (
    <div className={cn("pws", className)} data-level={strength.level} data-mot-de-passe="">
      <label className="pws-label" htmlFor={id}>{label}</label>
      <motion.div className="pws-shell" style={{ x: shake }}>
        <input id={id} type={shown ? "text" : "password"} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={PASSWORD_MAX}
          {...props} value={value} onChange={(e) => onValueChange(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={[error ? errorId : null, rulesId].filter(Boolean).join(" ")} className="pws-input" />
        <button type="button" className="pws-reveal" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-controls={id} aria-label="Afficher le mot de passe">
          <EyeMorph slashed={shown} calm={calm} />
        </button>
      </motion.div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p key="erreur" id={errorId} role="alert" className="pws-error"
            initial={calm ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={calm ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={calm ? { duration: 0.1 } : { height: SPRING.soft, opacity: { duration: 0.16 } }}>
            <span className="pws-error-text">{error}</span>
          </motion.p>
        )}
      </AnimatePresence>
      <div className="pws-meter-row">
        <div className="pws-meter" role="meter" aria-label="Solidité du mot de passe" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.level} aria-valuetext={strength.level ? strength.label : "Aucun mot de passe"}>
          {[0, 1, 2, 3].map((i) => {
            const on = i < strength.level;
            // Collé d'un coup : remplissage de gauche à droite ; effacé : vidage de droite à gauche.
            const wave = on ? i - track.previousLevel : track.previousLevel - 1 - i;
            return (
              <span key={i} className="pws-segment">
                <motion.span className="pws-fill" initial={false} animate={{ x: on ? "0%" : "-101%" }}
                  transition={calm ? { duration: 0 } : { ...CELL, delay: Math.max(0, wave) * 0.03 }} />
              </span>
            );
          })}
        </div>
        <span className="pws-word" aria-hidden="true">
          {STRENGTH_LABELS.map((w) => (
            <motion.span key={w} className="pws-word-text" data-actif={w === strength.label || undefined} initial={false}
              animate={{ opacity: strength.level > 0 && w === strength.label ? 1 : 0 }} transition={calm ? { duration: 0 } : CROSSFADE}>
              {w}
            </motion.span>
          ))}
        </span>
      </div>
      <ul id={rulesId} className="pws-rules" aria-label="Règles du mot de passe">
        {rules.map((r) => {
          const order = changed.indexOf(r.id);
          return (
            <li key={r.id} className="pws-rule" data-met={r.met || undefined} data-regle={r.id}>
              <RuleMark met={r.met} delay={order > 0 ? order * 0.05 : 0} calm={calm} />
              <span className="pws-rule-label">{r.label}<span className="sr-only">{r.met ? " : respectée" : " : pas encore"}</span></span>
              {r.id === "length" && value && r.remaining > 0 && (
                <span className="pws-remaining" aria-hidden="true">encore <RollingText value={String(r.remaining)} /></span>
              )}
            </li>
          );
        })}
      </ul>
      {tip && <p className="pws-tip">{tip}</p>}
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
    </div>
  );
}
