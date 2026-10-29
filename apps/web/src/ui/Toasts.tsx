// Notifications de l'interface (toasts). Uniquement pour de vrais événements, après confirmation du
// serveur. aria-live poli pour l'information et le succès, assertif pour les erreurs. Les toasts
// identiques sont regroupés (compteur), 3 au plus sont visibles ; survol ou focus = pause ; Échap ferme.
// Mobile : en haut sous la zone sûre (jamais sur les boutons du bas) ; bureau : en bas à droite.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./Icon.tsx";

export type ToastKind = "success" | "info" | "error";
interface Toast { id: number; kind: ToastKind; title: string; message?: string; count: number; duration: number }
interface Ctx { show: (kind: ToastKind, title: string, message?: string, opts?: { duration?: number }) => void; dismiss: (id: number) => void }

const ToastCtx = createContext<Ctx | null>(null);
const DURATION: Record<ToastKind, number> = { success: 4000, info: 6000, error: 9000 };

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast hors de ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<Ctx["show"]>((kind, title, message, opts) => {
    setToasts((list) => {
      const same = list.find((t) => t.kind === kind && t.title === title && t.message === message);
      if (same) return list.map((t) => (t === same ? { ...t, count: t.count + 1, id: nextId.current++ } : t));
      const toast: Toast = { id: nextId.current++, kind, title, message, count: 1, duration: opts?.duration ?? DURATION[kind] };
      return [...list, toast].slice(-3);
    });
  }, []);
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToasts((t) => t.slice(0, -1));
    };
    if (toasts.length) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toasts.length]);

  const polite = toasts.filter((t) => t.kind !== "error");
  const assertive = toasts.filter((t) => t.kind === "error");
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-3",
          "top-[max(12px,env(safe-area-inset-top))] sm:top-auto sm:bottom-6 sm:right-6 sm:left-auto sm:items-end sm:px-0",
        )}
      >
        <div aria-live="polite" role="status" className="contents">
          <AnimatePresence initial={false}>{polite.map((t) => <ToastCard key={t.id} toast={t} onDone={dismiss} />)}</AnimatePresence>
        </div>
        <div aria-live="assertive" role="alert" className="contents">
          <AnimatePresence initial={false}>{assertive.map((t) => <ToastCard key={t.id} toast={t} onDone={dismiss} />)}</AnimatePresence>
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

const ICON = { success: IconCheck, info: IconInfo, error: IconAlert } as const;
const TONE = {
  success: "text-on-accent bg-gold ring-gold/40",
  info: "text-gold-text bg-gold/15 ring-gold/35",
  error: "text-bad bg-bad-bg ring-bad/25",
} as const;

function ToastCard({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const [held, setPaused] = useState(false);
  // Onglet masqué : le délai s'arrête aussi (la notification attend qu'on revienne pour être lue).
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const paused = held || hidden;
  const remaining = useRef(toast.duration);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (paused) {
      remaining.current -= Date.now() - startedAt.current;
      return;
    }
    startedAt.current = Date.now();
    const t = window.setTimeout(() => onDone(toast.id), Math.max(800, remaining.current));
    return () => window.clearTimeout(t);
  }, [paused, toast.id, onDone]);
  const Icon = ICON[toast.kind];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-card border border-line bg-ivory/[0.97] p-3.5 pr-2 shadow-float"
    >
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ring-1", TONE[toast.kind])}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-ui font-semibold leading-snug text-ink">
          {toast.title}
          {toast.count > 1 && <span className="ml-2 rounded-full bg-sand px-1.5 py-0.5 text-xs font-medium text-ink-soft">×{toast.count}</span>}
        </p>
        {toast.message && <p className="mt-0.5 text-sm leading-snug text-ink-soft">{toast.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDone(toast.id)}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-sand/60 hover:text-ink"
        aria-label="Fermer la notification"
      >
        <IconClose size={16} />
      </button>
    </motion.div>
  );
}
