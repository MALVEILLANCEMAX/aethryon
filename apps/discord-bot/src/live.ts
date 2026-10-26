// Garde-fous des conversions suivies par le bot (sans discord.js) : une à la fois par personne, plafond global de suivis
// simultanés. Rien n'est conservé : registre en mémoire.

/** Plafond global de conversions suivies en même temps par le bot (le quota du compte reste la vraie limite). */
export const MAX_FOLLOWS = 25;

/** Une conversion suivie à la fois par utilisateur Discord ; identifiants oubliés à la fin du suivi. */
export function createFlights(max = MAX_FOLLOWS) {
  const active = new Set<string>();
  return {
    start(userId: string): "ok" | "in_progress" | "busy" {
      if (active.has(userId)) return "in_progress";
      if (active.size >= max) return "busy";
      active.add(userId);
      return "ok";
    },
    end(userId: string) { active.delete(userId); },
    has: (userId: string) => active.has(userId),
    size: () => active.size,
  };
}
