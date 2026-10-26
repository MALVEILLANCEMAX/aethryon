// Zone principale du héros : « colle un lien ». Reconnaissance locale (lib/probe.ts, aucune requête) : le repère de
// la plateforme s'allume, le parcours animé montre ce que deviendra le lien, puis l'invitation à commencer. Au repos
// (champ vide, sans focus, mouvement normal), le champ tape lui-même des exemples fictifs et signale la plateforme.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { cn } from "../../lib/cn.ts";
import { useCalm, useMe } from "../../lib/hooks.ts";
import { DUR, EASE } from "../../lib/motion.ts";
import { probeLink, PROBE_EXAMPLES, type Probe } from "../../lib/probe.ts";
import type { PlatformId } from "../../lib/brand.ts";
import { PlatformMark } from "../../ui/brand/PlatformMark.tsx";
import { ButtonLink } from "../../ui/Button.tsx";
import { IconAlert, IconArrowRight } from "../../ui/Icon.tsx";
import { Pipeline, usePipeline } from "./Pipeline.tsx";

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

/** Démonstration au repos : deux tours des exemples au plus, puis l'invite fixe reste (une page immobile ne calcule plus
 *  rien) ; seulement quand le champ est à l'écran et l'onglet visible. */
const GHOST_EXAMPLES_MAX = 2 * PROBE_EXAMPLES.length;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Texte tapé lettre à lettre, plateforme signalée, puis effacé. Le texte vit ICI : chaque lettre ne redessine que ce
 *  petit élément (contenu dans sa boîte, visuel-v2.css), jamais tout le héros ; le parent n'apprend que les deux
 *  changements qui le concernent (texte affiché ou non, plateforme). */
function GhostDemo({ active, onShown, onPlatform }: { active: boolean; onShown: (shown: boolean) => void; onPlatform: (p: PlatformId | null) => void }) {
  const [text, setText] = useState("");
  const played = useRef(0); // exemples montrés jusqu'au bout, tous passages confondus
  useEffect(() => {
    const clear = () => { setText(""); onShown(false); onPlatform(null); };
    if (!active || played.current >= GHOST_EXAMPLES_MAX) { clear(); return; }
    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => { if (!cancelled) fn(); }, ms));
    const play = () => {
      if (played.current >= GHOST_EXAMPLES_MAX) { clear(); return; }
      const ex = PROBE_EXAMPLES[played.current % PROBE_EXAMPLES.length]!;
      let t = 500;
      for (let k = 1; k <= ex.text.length; k++) {
        const s = ex.text.slice(0, k);
        later(t, () => { setText(s); if (k === 1) onShown(true); });
        t += 38;
      }
      later(t + 120, () => onPlatform(ex.platform));
      later(t + 2300, () => { played.current++; clear(); });
      later(t + 2700, play);
    };
    play();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [active, onShown, onPlatform]);
  return text ? <span className="probe-ghost" aria-hidden="true">{text}<span className="probe-caret" /></span> : null;
}

export function LinkProbe({ onPlatform }: { onPlatform: (p: PlatformId | null) => void }) {
  const calm = useCalm();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [fmt, setFmt] = useState<"mp4" | "mp3">("mp4");
  const [result, setResult] = useState<Probe>({ state: "vide" });
  const form = useRef<HTMLFormElement>(null);
  const inView = useInView(form, { amount: 0.25 });
  const pageVisible = useDocumentVisible();
  const [ghostShown, setGhostShown] = useState(false);
  const [ghostPlatform, setGhostPlatform] = useState<PlatformId | null>(null);
  const onGhostShown = useCallback((v: boolean) => setGhostShown(v), []);
  const onGhostPlatform = useCallback((p: PlatformId | null) => setGhostPlatform(p), []);
  const ghostActive = !calm && !focused && !value && inView && pageVisible;
  const live = probeLink(value);
  const platform = value ? (live.state === "ok" ? live.platform : null) : ghostPlatform;
  const step = usePipeline(result.state === "ok", false, result.state === "ok" ? `${result.platform}-${fmt}-${value}` : null);

  useEffect(() => { onPlatform(platform); }, [platform, onPlatform]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) { input.current?.focus(); return; }
    setResult(probeLink(value));
  };
  const state = result.state === "ok" ? "ok" : result.state === "refus" ? "refus" : value && live.state === "ok" ? "ok" : undefined;

  return (
    <form ref={form} className="probe" data-state={state} onSubmit={submit} noValidate data-probe="">
      <div className="probe-field">
        <span className="probe-mark" aria-hidden="true">{platform ? <PlatformMark id={platform} size={18} tone={state === "ok" ? "light" : "dark"} /> : <LinkIcon />}</span>
        <label htmlFor={`${id}-lien`} className="sr-only">Lien d'une vidéo YouTube, TikTok ou X</label>
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            id={`${id}-lien`}
            className="probe-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={ghostShown && !value ? "" : "Colle un lien YouTube, TikTok ou X"}
            onChange={(e) => { setValue(e.target.value); if (result.state !== "vide") setResult({ state: "vide" }); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <GhostDemo active={ghostActive} onShown={onGhostShown} onPlatform={onGhostPlatform} />
        </div>
        <div className="hidden shrink-0 rounded-full border border-[rgb(250_248_243/0.1)] p-0.5 sm:flex" role="radiogroup" aria-label="Format">
          {(["mp4", "mp3"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={fmt === f} onClick={() => setFmt(f)}
              className={cn("h-11 rounded-full px-3.5 text-[13px] font-semibold tracking-[0.04em] transition-colors", fmt === f ? "bg-ivory text-obsidian" : "text-mist hover:text-ivory")}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <button type="submit" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[15px] bg-gold px-4 text-[15px] font-semibold text-obsidian shadow-button transition-[translate,background-color] duration-200 hover:-translate-y-px hover:bg-gold-light sm:px-5">
          Essayer <IconArrowRight size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2.5 text-[12.5px] text-mist">
        <span>Vérifié sur ton appareil · rien n'est envoyé</span>
        <div className="flex rounded-full border border-[rgb(250_248_243/0.1)] p-0.5 sm:hidden" role="radiogroup" aria-label="Format">
          {(["mp4", "mp3"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={fmt === f} onClick={() => setFmt(f)}
              className={cn("h-11 rounded-full px-3.5 text-[12.5px] font-semibold tracking-[0.04em]", fmt === f ? "bg-ivory text-obsidian" : "text-mist")}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div aria-live="polite" className="probe-result">
        <AnimatePresence initial={false} mode="wait">
          {result.state === "ok" && (
            <motion.div key="ok" initial={calm ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }}>
              <div className="mt-2 grid gap-5 rounded-[19px] border border-[rgb(250_248_243/0.08)] bg-[rgb(15_15_16/0.6)] p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ivory">{result.label}</p>
                  <Pipeline platform={result.platform} fmt={fmt} step={step} size="sm" className="mt-4 justify-start" />
                </div>
                {signedIn
                  ? <ButtonLink to="/dashboard" variant="light" className="w-full sm:w-auto" trailing={<IconArrowRight size={16} />}>Ouvrir mon espace</ButtonLink>
                  : <ButtonLink to="/commencer" variant="light" className="w-full sm:w-auto" trailing={<IconArrowRight size={16} />}>Convertir avec un compte gratuit</ButtonLink>}
              </div>
            </motion.div>
          )}
          {result.state === "refus" && (
            <motion.p key="refus" role="alert" initial={calm ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.micro }}
              className="mt-2 flex items-start gap-2.5 rounded-[16px] border border-[rgb(227_120_100/0.3)] bg-[rgb(163_55_43/0.14)] px-4 py-3 text-[14px] text-[#f1c7bd]">
              <IconAlert size={17} className="mt-0.5 shrink-0" />
              {result.message}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
