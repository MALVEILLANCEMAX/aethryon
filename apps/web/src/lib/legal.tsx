// Informations légales d'AETHRYON : UNE seule source pour les Conditions d'utilisation (/conditions), la page
// Confidentialité, les CGV (/cgv), les mentions légales (/mentions-legales) et la politique de remboursement
// (/remboursement) — textes dans src/legal/*.md, champs {{cle}} remplis ici. Rien n'est inventé : tant qu'un champ vaut
// null, les pages l'affichent « À compléter » (attribut data-legal-missing) et scripts/check-dist.mjs REFUSE la
// construction, sauf pour un aperçu explicite (ALLOW_LEGAL_PLACEHOLDERS=1, jamais en production).
// Rempli : ce qui est vérifié au registre officiel (recherche-entreprises.api.gouv.fr, 2026-10-16 : EI, SIREN, SIRET)
// et fourni par le propriétaire. À fournir ou confirmer PAR LE PROPRIÉTAIRE seulement : adresse (siège), e-mail,
// téléphone, immatriculation (RCS ou RNE, selon l'activité déclarée), régime de TVA, médiateur (après adhésion),
// hébergeur (d'après son contrat), date de publication.
import { cn } from "./cn.ts";

interface LegalField {
  label: string;
  /** Ce qu'il faut fournir (affiché seulement dans l'aperçu, à côté du champ manquant). */
  hint: string;
  value: string | null;
}

export const LEGAL = {
  editeur: { label: "Éditeur du service", hint: "nom et statut de l'entreprise", value: null },
  directeur: { label: "Directeur de la publication", hint: "personne responsable du contenu publié", value: null },
  statut: { label: "Statut de l'éditeur", hint: "entrepreneur individuel, société…", value: null },
  siren: { label: "Identification", hint: "SIREN et SIRET", value: null },
  immatriculation: { label: "Immatriculation", hint: "« RCS <ville> <numéro> » (activité commerciale) ou « Immatriculé au Registre national des entreprises (RNE) sous le numéro <numéro> », selon l'activité déclarée", value: null },
  adresse: { label: "Adresse de l'éditeur", hint: "adresse du siège de l'éditeur", value: null },
  contact: { label: "Contact", hint: "adresse e-mail pour les questions, les réclamations, l'exercice des droits et les signalements", value: null },
  telephone: { label: "Téléphone", hint: "numéro de téléphone du service client", value: null },
  tva: { label: "TVA", hint: "« TVA non applicable, article 293 B du code général des impôts » (franchise, à confirmer par le propriétaire)", value: null },
  mediateur: { label: "Médiateur de la consommation", hint: "nom, adresse postale et site du médiateur, après l'adhésion", value: null },
  hebergeur: { label: "Hébergeur", hint: "nom, adresse et téléphone de l'hébergeur du site, d'après le contrat du serveur", value: null },
  droit: { label: "Droit applicable", hint: "droit applicable", value: "le droit français" },
  dateEffet: { label: "Date d'entrée en vigueur", hint: "fixée au moment de la publication", value: null },
} satisfies Record<string, LegalField>;

/** Version des CGV (src/legal/cgv.md) : affichée, acceptée dans le récapitulatif et enregistrée par le serveur avec la
 *  commande (account/src/facturation.ts, CGV_VERSION : même valeur, vérifiée par un essai). */
export const CGV_VERSION = "1.1";

export type LegalKey = keyof typeof LEGAL;

/** Aperçu (construction avec ALLOW_LEGAL_PLACEHOLDERS=1) : les champs manquants s'affichent « À compléter ». */
export const LEGAL_DRAFT = import.meta.env.VITE_LEGAL_DRAFT === "1";
/** Toutes les informations légales sont fournies par le propriétaire. */
export const LEGAL_COMPLETE = Object.values(LEGAL as Record<string, LegalField>).every((f) => !!f.value);
/** Pages et mentions légales publiées : informations complètes (production), ou aperçu explicite. Sinon, rien de
 *  juridique incomplet n'est affiché : /conditions annonce sa publication prochaine, la Confidentialité omet
 *  l'identité de l'éditeur, et aucun lien ne mène aux Conditions. */
export const LEGAL_PUBLISHED = LEGAL_COMPLETE || LEGAL_DRAFT;

export const isLegalKey = (k: string): k is LegalKey => Object.prototype.hasOwnProperty.call(LEGAL, k);
/** Valeur d'un champ, ou le repère texte « À compléter : … » (version texte des CGV : refusée par le serveur). */
export const legalText = (k: LegalKey) => (LEGAL[k] as LegalField).value ?? `À compléter : ${(LEGAL[k] as LegalField).label.toLowerCase()}`;

/** Valeur légale, ou, si elle manque, un repère « À compléter » bien visible (refusé à la construction). */
export function Legal({ k, className }: { k: LegalKey; className?: string }) {
  const f: LegalField = LEGAL[k];
  if (f.value) return <span className={className}>{f.value}</span>;
  return (
    <mark data-legal-missing={k} title={f.hint}
      className={cn("rounded-[6px] bg-[#f3e3c4] px-1.5 py-0.5 font-medium text-[#6b4a14] ring-1 ring-inset ring-[#d4af7c]", className)}>
      À compléter : {f.label.toLowerCase()}
    </mark>
  );
}
