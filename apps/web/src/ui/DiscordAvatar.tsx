// Image de profil du compte Discord lié, servie par le site lui-même (account, GET /api/discord/avatar : relais du CDN
// de Discord, session obligatoire) : la politique de sécurité n'autorise aucune image d'un autre domaine. `version`
// (fin de l'empreinte de l'image) change quand l'image change sur Discord, ce qui contourne le cache du navigateur.
// Si l'image ne vient pas (réseau, compte délié entre-temps), l'initiale prend sa place : jamais d'image cassée.
import { useState } from "react";
import { cn } from "../lib/cn.ts";

export function DiscordAvatar({ version, name, size, className }: { version: string | null | undefined; name: string; size: number; className?: string }) {
  const src = `/api/discord/avatar?v=${encodeURIComponent(version ?? "defaut")}`;
  const [failed, setFailed] = useState<string | null>(null);
  const initial = (name.trim().slice(0, 1) || "?").toUpperCase();
  return (
    <span className={cn("dc-avatar", className)} data-discord-avatar="" aria-hidden>
      {failed === src
        ? <span className="dc-avatar-initial">{initial}</span>
        : <img src={src} alt="" width={size} height={size} decoding="async" onError={() => setFailed(src)} />}
    </span>
  );
}
