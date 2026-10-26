// Les façons d'utiliser AETHRYON, et le lien direct vers l'une d'elles (/?solution=<id>, ancien lien
// « #solutions » compris). Le rendu statique écrit une variante de l'accueil par valeur (entry-static.tsx,
// HOME_VARIANTS ; nginx la sert selon le paramètre) : la surface visée y est marquée (data-panel) et, dans le
// navigateur, l'accueil défile jusqu'à elle. Valeur exacte, sensible à la casse ; sinon le raccourci iPhone.
export type SolutionId = "ios" | "extension" | "discord" | "web";
export const SOLUTION_IDS: readonly SolutionId[] = ["ios", "extension", "discord", "web"];
export const DEFAULT_SOLUTION: SolutionId = "ios";
export const isSolution = (v: string | null): v is SolutionId => !!v && (SOLUTION_IDS as readonly string[]).includes(v);
