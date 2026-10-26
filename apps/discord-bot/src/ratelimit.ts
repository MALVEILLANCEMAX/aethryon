// Limite anti-abus par personne, EN MÉMOIRE seulement (rien n'est écrit sur disque) : 5 commandes par 30 s.
// Les identifiants servent uniquement de clé de compteur et sont oubliés à l'expiration de la fenêtre.
export function createRateLimiter(max = 5, windowMs = 30_000, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
    /** Nettoyage périodique : retire les clés sans activité récente. */
    sweep() {
      const t = now();
      for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
    },
    size: () => hits.size,
  };
}
