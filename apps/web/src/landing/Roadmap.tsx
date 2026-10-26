// Nouveautés (revue produit du 2026-10-15) : une bande compacte au lieu d'une section entière — ce qui vient de SORTIR
// (Tools, extension, bot Discord : lu sur les réglages de construction, jamais affirmé à la main) et ce qui est PRÉVU,
// sans date promise. Le journal des versions du raccourci est dans l'aide (/aide#versions), lien en tête de bande.
import { Link } from "react-router";
import { motion } from "motion/react";
import { inView, reveal, revealGroup } from "../lib/motion.ts";
import { Badge } from "../ui/bits.tsx";
import { EXTENSION_AVAILABLE } from "../lib/extension.ts";
import { DISCORD_CONVERTS, DISCORD_PUBLIC } from "../lib/discord.ts";

/** Ce qui arrive, avec un statut honnête : « En développement » = du code existe et se teste, pas encore
 *  publié ; « Prévu » = décidé, pas encore commencé. Aucune date promise. */
const PLANNED: { id: string; title: string; body: string; status: "En développement" | "Prévu" }[] = [
  // Publiée (EXTENSION_DOWNLOAD=1) : elle n'est plus « à venir », elle a sa page (/extension).
  ...(EXTENSION_AVAILABLE ? [] : [{ id: "extension", title: "Extension navigateur", body: "Un bouton AETHRYON sous les vidéos, sur ordinateur.", status: "En développement" as const }]),
  // Public (DISCORD_PHASE media, media-auto) : il passe dans « Sorti récemment ».
  ...(DISCORD_PUBLIC ? [] : [{ id: "discord", title: "Bot Discord", body: "/convert dans ton serveur, avec ton quota.", status: "En développement" as const }]),
  // Liaison ouverte (DISCORD_PHASE conversion, media…) : elle existe dans l'espace (/dashboard/discord), elle n'est plus « à venir ».
  ...(DISCORD_CONVERTS ? [] : [{ id: "comptes", title: "Comptes connectés", body: "Relier ton compte Discord à ton compte AETHRYON.", status: "En développement" as const }]),
];

/** Ce qui vient de sortir, avec son statut réel. */
const RELEASED: { id: string; title: string; body: string; status: string }[] = [
  // Pas la phrase de la bande Tools (« Quatre façons ») : ici, ce qui est nouveau.
  { id: "tools", title: "AETHRYON Tools", body: "Retouche en ligne de tes fichiers et de tes conversions, sans rien installer.", status: "Disponible · bêta" },
  ...(DISCORD_PUBLIC ? [{ id: "discord", title: "Bot Discord", body: "/convert, /clip, /gif et ta bibliothèque, sur tes serveurs ou en message privé, avec ton compte.", status: "Disponible" }] : []),
  ...(EXTENSION_AVAILABLE ? [{ id: "extension", title: "Extension navigateur", body: "Vidéo, son, extrait, GIF ou image depuis la page de la vidéo, dans Chrome, Edge et Brave.", status: "Disponible" }] : []),
  // AETHRYON pour Premiere Pro : disponible depuis le 2026-10-18 (décision du propriétaire) ; nom en texte (docs/MARQUES.md).
  { id: "premiere", title: "AETHRYON pour Premiere Pro", body: "L'extension pour Premiere Pro et son installateur Windows : colle un lien, prévisualise la vidéo, importe-la dans le chutier de ton choix.", status: "Disponible" },
];

export function Roadmap() {
  const items = [...RELEASED.map((it) => ({ ...it, kind: "data-released" as const })), ...PLANNED.map((it) => ({ ...it, kind: "data-planned" as const }))];
  return (
    <section id="feuille-de-route" aria-labelledby="roadmap-title" className="scroll-mt-24 border-y border-line bg-pearl py-14 sm:py-16">
      <div className="container-site">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="roadmap-title" className="font-display text-[clamp(1.7rem,1.35rem+1.2vw,2.3rem)] font-medium">Nouveautés</h2>
          <Link to="/aide#versions" className="inline-flex min-h-11 items-center text-[14.5px] text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">Versions du raccourci iPhone</Link>
        </div>
        <motion.ul {...inView("nouveautes")} variants={revealGroup} className="mt-6 grid gap-3 md:grid-cols-3" data-roadmap="">
          {items.map((it) => (
            <motion.li key={it.id} variants={reveal} {...{ [it.kind]: it.id }} className="rounded-[20px] border border-line bg-ivory/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[16.5px] font-semibold tracking-[-0.01em] text-ink">{it.title}</h3>
                <Badge tone={it.kind === "data-released" ? "ok" : it.status === "Prévu" ? "neutral" : "warn"}>{it.status}</Badge>
              </div>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{it.body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
