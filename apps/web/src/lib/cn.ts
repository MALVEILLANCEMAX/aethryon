import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Concatène des classes Tailwind en résolvant les conflits (la dernière l'emporte). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
