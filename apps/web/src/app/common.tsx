// Éléments communs aux pages de l'espace personnel.
import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { useMe } from "../lib/hooks.ts";
import { Button } from "../ui/Button.tsx";
import { IconAlert } from "../ui/Icon.tsx";
import type { useToast } from "../ui/Toasts.tsx";

export function PageHeader({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="page-title">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-[16.5px] leading-relaxed text-ink-soft">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

/** Données illisibles (réseau, serveur) : ce qui manque, que rien n'est perdu, et un bouton pour réessayer. */
export function LoadError({ children, onRetry, className }: { children: ReactNode; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between", className)} data-erreur="">
      <p className="flex gap-2.5 text-[15.5px] leading-relaxed text-ink-soft">
        <IconAlert size={18} className="mt-1 shrink-0 text-bad" />
        <span>{children}</span>
      </p>
      <Button variant="secondary" size="sm" className="h-11 shrink-0" onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

/** Session obligatoire : sans session, redirection vers /connexion (retour prévu ensuite). */
export function useRequireUser() {
  const me = useMe();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (me.error?.status === 401) navigate(`/connexion?suite=${encodeURIComponent(pathname)}`, { replace: true });
  }, [me.error, navigate, pathname]);
  return me;
}

/** Erreur d'API → notification (les erreurs réseau et serveur ont un message générique). */
export function toastError(toast: ReturnType<typeof useToast>, e: unknown, fallbackTitle = "Action impossible") {
  if (e instanceof ApiError) {
    if (e.isServer) toast.show("error", "Connexion impossible", "Réessaie ou consulte l'état du service.");
    else toast.show("error", fallbackTitle, e.message);
  } else {
    toast.show("error", "Connexion impossible", "Réessaie ou consulte l'état du service.");
  }
}
