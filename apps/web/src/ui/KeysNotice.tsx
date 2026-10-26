// Avertissement honnête : tant que le service de conversion n'accepte pas encore les jetons
// personnels (USER_KEYS_ACTIVE côté serveur), on le dit clairement.
import { useConfig } from "../lib/hooks.ts";
import { IconInfo } from "./Icon.tsx";
import { cn } from "../lib/cn.ts";

export function KeysNotice({ className }: { className?: string }) {
  const cfg = useConfig();
  if (!cfg.data || cfg.data.keysActive) return null;
  return (
    <p role="note" className={cn("flex gap-2.5 rounded-[16px] border border-warn/20 bg-warn-bg p-4 text-[15px] leading-relaxed text-warn", className)}>
      <IconInfo size={18} className="mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">Jetons personnels : bientôt actifs.</strong> Tu peux déjà créer ton jeton, mais le service
        de conversion ne l'accepte pas encore. Il le fera dès l'activation, annoncée ici ; d'ici là, une conversion avec ce jeton sera refusée.
      </span>
    </p>
  );
}
