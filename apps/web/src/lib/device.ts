// Détection prudente des capacités (jamais pour bloquer un navigateur, seulement pour adapter le parcours).
export interface DeviceInfo { appleTouch: boolean; touch: boolean; desktop: boolean }

export function detectDevice(): DeviceInfo {
  if (typeof window === "undefined") return { appleTouch: false, touch: false, desktop: true };
  const appleTouch = typeof CSS !== "undefined" && CSS.supports("-webkit-touch-callout", "none");
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia("(pointer: coarse)").matches;
  const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !appleTouch;
  return { appleTouch, touch, desktop };
}
