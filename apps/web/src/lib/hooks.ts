import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useResource } from "./store.ts";
import type { Me, PublicConfig, ServiceStatus } from "./types.ts";
import { detectDevice, type DeviceInfo } from "./device.ts";
import { usePrerender } from "./prerender.ts";

export const useConfig = () => useResource<PublicConfig>("/api/config", 5 * 60_000);
export const useStatus = () => useResource<ServiceStatus>("/api/status", 30_000);
export const useMe = () => useResource<Me>("/api/me", 15_000);

export function useDevice(): DeviceInfo {
  const [d, setD] = useState<DeviceInfo>(() => detectDevice());
  useEffect(() => { setD(detectDevice()); }, []);
  return d;
}

/** Vrai si l'utilisateur demande moins d'animations (système) — pour couper les boucles et l'autoplay. */
export function useCalm(): boolean {
  return useReducedMotion() ?? false;
}

export function useDocumentTitle(title: string) {
  const full = title ? `${title} · AETHRYON` : "AETHRYON · Un lien entre, un fichier sort";
  const prerender = usePrerender();
  if (prerender) prerender.title = full; // pré-rendu : le titre est écrit dans le HTML de la page
  useEffect(() => {
    const prev = document.title;
    document.title = full;
    return () => { document.title = prev; };
  }, [full]);
}
