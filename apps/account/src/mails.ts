// E-mails de compte (inscription par code ou par lien, compte déjà existant, mot de passe oublié), aux couleurs
// d'AETHRYON : fond ivoire, carte claire, chouette officielle (tête maître, brand/master) jointe EN LIGNE (cid:) — notre
// HTML ne charge aucune image distante —, Georgia pour les titres (police système proche de Playfair), code à 6 chiffres
// en grand sur obsidienne, bouton « à l'épreuve d'Outlook » (tableau), version texte.
// Relais Brevo (vérifié sur de vrais envois le 2026-10-14) : il AJOUTE au HTML deux images de mesure d'ouverture et
// remplace les liens par des redirections de suivi de clics (la version texte n'est pas touchée) ; son suivi ne se
// coupe pas message par message (réglage du compte Brevo, sur demande). D'où : aucun texte invisible (aperçu masqué
// retiré : règle SpamAssassin FONT_INVIS_MSGID, -2,5 points sur mail-tester), aucun lien dont le texte est une adresse
// (le domaine affiché différerait de la redirection), le lien de secours écrit en clair, jamais en lien.
// Compatibilité : tableaux de mise en page, styles en ligne, bgcolor en attribut, aucune feuille externe, aucun
// dégradé ni effet propre aux navigateurs ; « color-scheme: light » pour les clients en mode sombre.
// Les jetons des liens sont placés APRÈS le « # » : un fragment n'est jamais envoyé au serveur, il n'apparaît donc dans
// aucun journal (nginx, account) ; la page le lit puis le retire de l'adresse. Le code n'est jamais journalisé.
// Envoi en arrière-plan : la réponse HTTP ne dépend jamais de l'envoi (même durée qu'un compte existe ou non) ; un
// échec est journalisé sans adresse ni jeton.
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import { Limiter } from "./http.ts";
import type { Attachment, InlineImage, Mail, Mailer } from "./mailer.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const NB = " ";

/** La chouette officielle (PNG transparent de 112 px, rendu de web/public/brand/aethryon/icons/owl-head.svg). */
let OWL: InlineImage | null = null;
function owl(): InlineImage | null {
  if (OWL) return OWL;
  try {
    OWL = { cid: "chouette@aethryon", filename: "aethryon.png", contentType: "image/png", content: readFileSync(new URL("./assets/owl-112.png", import.meta.url)) };
  } catch {
    OWL = null; // image absente (tests sans copie des fichiers) : l'en-tête garde le logotype seul
  }
  return OWL;
}

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";

interface Layout {
  title: string;
  intro: string;
  /** Code à 6 chiffres, affiché en grand. */
  code?: { value: string; note: string };
  button?: { href: string; label: string; lead?: string; note: string };
  /** Encadré apparent (bordure dorée), avant le bouton : une date limite, une information à ne pas manquer. */
  box?: { title: string; text: string };
  /** Paragraphe après le bouton (HTML déjà échappé). */
  after?: string;
  security: string;
  site: string;
}

function html(l: Layout, withOwl: boolean): string {
  const host = esc(l.site.replace(/^https?:\/\//, ""));
  const code = l.code
    ? `<tr><td align="center" style="padding:6px 0 4px">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0f0f10" style="background:#0f0f10;border-radius:18px;padding:18px 26px 18px 34px">` +
      `<span style="font-family:${SANS};font-size:36px;line-height:40px;font-weight:600;letter-spacing:10px;color:#e3cda6">${esc(l.code.value)}</span>` +
      `</td></tr></table></td></tr>` +
      `<tr><td align="center" style="padding:14px 0 0;font-family:${SANS};font-size:14px;line-height:21px;color:#6b6459">${esc(l.code.note)}</td></tr>`
    : "";
  const button = l.button
    ? (l.code ? `<tr><td style="padding:26px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;border-top:1px solid #e2d8c9"></td></tr></table></td></tr>` : "") +
      (l.button.lead ? `<tr><td align="center" style="padding:22px 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:#4a463f">${esc(l.button.lead)}</td></tr>` : "") +
      `<tr><td align="center" style="padding:${l.button.lead ? 14 : 26}px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="center" bgcolor="#141413" style="background:#141413;border-radius:999px">` +
      `<a href="${esc(l.button.href)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:#faf8f3;text-decoration:none;border-radius:999px">${esc(l.button.label)}</a>` +
      `</td></tr></table></td></tr>` +
      `<tr><td align="center" style="padding:16px 4px 0;font-family:${SANS};font-size:12.5px;line-height:19px;color:#6b6459">${esc(l.button.note)}<br>` +
      `<span style="word-break:break-all;color:#4a463f">${esc(l.button.href)}</span></td></tr>`
    : "";
  const after = l.after ? `<tr><td align="center" style="padding:20px 0 0;font-family:${SANS};font-size:14.5px;line-height:22px;color:#4a463f">${l.after}</td></tr>` : "";
  const box = l.box
    ? `<tr><td style="padding:2px 0 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td bgcolor="#fff8ea" style="background:#fff8ea;border:2px solid #b8925a;border-radius:16px;padding:16px 18px">` +
      `<div style="font-family:${SANS};font-size:15px;line-height:22px;font-weight:700;color:#141413">${esc(l.box.title)}</div>` +
      `<div style="padding-top:6px;font-family:${SANS};font-size:14.5px;line-height:22px;color:#2e2b26">${esc(l.box.text)}</div>` +
      `</td></tr></table></td></tr>`
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(l.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4efe7" bgcolor="#f4efe7">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4efe7" style="background:#f4efe7"><tr><td align="center" style="padding:36px 14px 40px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">` +
    // En-tête : chouette officielle + logotype.
    `<tr><td align="center" style="padding:0 0 22px">` +
    (withOwl ? `<img src="cid:chouette@aethryon" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none">` : "") +
    `<div style="padding-top:${withOwl ? 12 : 0}px;font-family:${SERIF};font-size:13px;line-height:16px;letter-spacing:5px;color:#7a5f38">AETHRYON</div></td></tr>` +
    // Carte.
    `<tr><td bgcolor="#faf8f3" style="background:#faf8f3;border:1px solid #e2d8c9;border-radius:26px;padding:38px 30px 34px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td align="center" style="font-family:${SERIF};font-size:29px;line-height:35px;font-weight:normal;color:#141413">${esc(l.title)}</td></tr>` +
    `<tr><td align="center" style="padding:14px 6px 24px;font-family:${SANS};font-size:16px;line-height:25px;color:#4a463f">${esc(l.intro)}</td></tr>` +
    code + box + button + after +
    `</table></td></tr>` +
    // Pied : sécurité, site.
    `<tr><td align="center" style="padding:24px 20px 0;font-family:${SANS};font-size:12.5px;line-height:19px;color:#6b6459">${esc(l.security)}</td></tr>` +
    `<tr><td align="center" style="padding:16px 20px 0;font-family:${SANS};font-size:12.5px;line-height:19px;color:#7a5f38">` +
    `AETHRYON${NB}· ${host}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

/** Code lisible dans la version texte : « 482 913 ». */
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export class AccountMails {
  private cfg: Config;
  private mailer: Mailer | null;
  /** Plafond global (MAIL_DAILY_MAX, 150 par défaut) : le relais est partagé avec d'autres services du propriétaire. */
  private daily: Limiter;
  constructor(cfg: Config, mailer: Mailer | null) {
    this.cfg = cfg; this.mailer = mailer;
    this.daily = new Limiter(cfg.mail?.dailyMax ?? 150, 24 * 3_600_000);
  }

  get enabled(): boolean { return this.mailer !== null; }

  private send(kind: string, to: string, subject: string, text: string, layout: Layout, attachments?: Attachment[]): void {
    if (!this.mailer) return;
    // Au-delà du plafond : rien ne part (la réponse HTTP, elle, ne change pas) ; journalisé pour l'administrateur.
    if (!this.daily.take("tous")) { log("warn", "mail daily cap", { kind }); return; }
    const image = owl();
    const m: Mail = { to, subject, text, html: html(layout, !!image), ...(image ? { inline: [image] } : {}), ...(attachments?.length ? { attachments } : {}) };
    void this.mailer.send(m).then(
      () => log("info", "mail sent", { kind }),
      (e: unknown) => log("warn", "mail failed", { kind, err: e instanceof Error ? e.message : "?" }),
    );
  }

  /** Inscription : le code à 6 chiffres (10 min) à saisir sur la page, et le lien de secours (30 min). */
  signup(to: string, token: string, code: string): void {
    const site = this.cfg.publicUrl;
    const url = `${site}/inscription#${token}`;
    this.send("signup", to, `${code} est ton code AETHRYON`,
      `Bonjour,\n\nTon code de vérification AETHRYON : ${spaced(code)}\n\nSaisis-le sur la page d'inscription. Il expire dans 10 minutes et ne sert qu'une fois.\n\n` +
      `Tu préfères un lien ? Ouvre celui-ci (valable 30 minutes) :\n${url}\n\n` +
      `Sécurité : AETHRYON ne te demandera jamais ce code par message ou par téléphone. Tu n'as rien demandé ? Ignore cet e-mail : sans ce code ni ce lien, aucun compte n'est créé.\n\nAETHRYON · ${site}\n`,
      {
        title: "Ton code de vérification",
        intro: "Saisis-le sur la page d'inscription d'AETHRYON pour créer ton compte.",
        code: { value: code, note: "Il expire dans 10 minutes et ne sert qu'une fois." },
        button: { href: url, label: "Créer mon compte", lead: "Tu préfères un lien ?", note: "Lien valable 30 minutes. Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: "AETHRYON ne te demandera jamais ce code par message ou par téléphone. Tu n'as rien demandé ? Ignore cet e-mail : sans ce code ni ce lien, aucun compte n'est créé.",
        site,
      });
  }

  /** Une demande d'inscription pour une adresse qui a DÉJÀ un compte : on le dit à son propriétaire, à lui seul. */
  existing(to: string, ways: { google: boolean; password: boolean }): void {
    const site = this.cfg.publicUrl;
    const how = ways.password && ways.google ? "avec Google ou avec ton mot de passe"
      : ways.password ? "avec ton adresse e-mail et ton mot de passe" : "avec Google";
    const forgot = `Mot de passe oublié${ways.password ? "" : " (ou pour en ajouter un)"}${NB}?`;
    this.send("existing", to, "Tu as déjà un compte AETHRYON",
      `Bonjour,\n\nQuelqu'un, sans doute toi, a demandé à créer un compte AETHRYON avec cette adresse. Un compte existe déjà : connecte-toi ${how} :\n${site}/connexion\n\n` +
      `${forgot} ${site}/mot-de-passe\n\nCe n'était pas toi ? Ignore cet e-mail : rien n'a changé.\n\nAETHRYON · ${site}\n`,
      {
        title: "Tu as déjà un compte",
        intro: `Quelqu'un, sans doute toi, a demandé à créer un compte avec cette adresse. Il existe déjà : connecte-toi ${how}.`,
        button: { href: `${site}/connexion`, label: "Me connecter", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        after: `${esc(forgot)} <a href="${esc(site)}/mot-de-passe" style="color:#7a5f38;text-decoration:underline">Recevoir un lien</a>`,
        security: "Ce n'était pas toi ? Ignore cet e-mail : rien n'a changé sur ton compte.",
        site,
      });
  }

  /** Lien de nouveau mot de passe (Better Auth, jeton d'une heure, usage unique). */
  resetPassword(to: string, token: string): void {
    const site = this.cfg.publicUrl;
    const url = `${site}/mot-de-passe/nouveau#${token}`;
    this.send("reset", to, "Ton nouveau mot de passe AETHRYON",
      `Bonjour,\n\nPour choisir un nouveau mot de passe pour ton compte AETHRYON, ouvre ce lien (valable une heure, une seule fois) :\n${url}\n\n` +
      `Tes autres sessions seront fermées. Tu n'as rien demandé ? Ignore cet e-mail : ton mot de passe actuel reste valable.\n\nAETHRYON · ${site}\n`,
      {
        title: "Nouveau mot de passe",
        intro: "Ouvre ce lien pour choisir un nouveau mot de passe. Tes autres sessions seront fermées.",
        button: { href: url, label: "Choisir mon mot de passe", note: "Lien valable une heure, une seule fois. Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: "Tu n'as rien demandé ? Ignore cet e-mail : ton mot de passe actuel reste valable.",
        site,
      });
  }

  /** Confirmation du contrat sur support durable (L221-13) : toutes les informations de L221-5 — vendeur (identité,
   *  adresse, e-mail, téléphone), offre, prix et mention de TVA, référence, renouvellement ou non, délai de rétractation
   *  et formulaire type (annexe de R221-1), médiateur — et le TEXTE DES CGV EN PIÈCE JOINTE (un lien n'est pas un
   *  support durable). Envoyée une fois, après la preuve de paiement. */
  billingConfirmation(to: string, v: { plan: string; contract: "annuel" | "vie"; amount: string; reference: string; at: string; renewal: string | null;
    /** Annuel : prix de chaque renouvellement (catalogue) ; il diffère du montant payé quand un code promo a servi. */
    renewalAmount?: string | null;
    /** À vie : prix de l'offre, quand le montant payé est plus bas (code promo). */
    listAmount?: string | null;
    withdrawalUntil: string; seller: { name: string; address: string; email: string; phone: string; mediator: string } | null; vat: string;
    terms: { version: string; attachment: Attachment } | null }): void {
    const site = this.cfg.publicUrl;
    const seller = v.seller ? `${v.seller.name}, ${v.seller.address}, ${v.seller.email}, ${v.seller.phone}` : "[identité du vendeur à compléter avant toute vente réelle]";
    const formTo = v.seller ? `${v.seller.name}, ${v.seller.address}, ${v.seller.email}` : seller;
    const price = `${v.amount} (${v.vat})`;
    // Montant PAYÉ (remise comprise) ; avec un code promo, le prix du renouvellement (ou de l'offre) est dit à côté.
    const discounted = v.contract === "annuel" ? !!v.renewalAmount && v.renewalAmount !== v.amount : !!v.listAmount && v.listAmount !== v.amount;
    const renewalAt = v.renewal ? ` (prochain renouvellement : ${v.renewal})` : "";
    const terms = v.contract === "annuel"
      ? (discounted
        ? `Abonnement annuel : ${price} payés pour la première année, code promo compris, puis ${v.renewalAmount} (${v.vat}) par an, renouvelé automatiquement chaque année à la même date${renewalAt}.`
        : `Abonnement annuel de ${price}, renouvelé automatiquement chaque année à la même date${renewalAt}.`) +
        " Résiliable à tout moment en ligne depuis ton espace : il reste actif jusqu'à la fin de l'année payée. Nous te rappellerons la date de reconduction par e-mail, un à trois mois avant."
      : `Paiement unique de ${price}${discounted ? `, code promo compris (prix de l'offre : ${v.listAmount})` : ""}, sans abonnement ni renouvellement. L'offre Premium à vie donne les limites affichées sur la page des offres pour la durée de vie du service ; elle ne comprend ni stockage, ni trafic, ni calcul illimités, ni les fonctions futures.`;
    const cgv = v.terms
      ? `Conditions générales de vente : version ${v.terms.version}, jointes à cet e-mail (fichier ${v.terms.attachment.filename}). Elles décrivent aussi la garantie légale de conformité (article 10), le service client et la médiation (article 15).`
      : `Conditions générales de vente : ${site}/cgv`;
    const contact = v.seller
      ? `Service client : ${v.seller.email}, ${v.seller.phone}.\nMédiateur de la consommation (gratuit, après une réclamation écrite restée sans solution) : ${v.seller.mediator}.`
      : "";
    const form = "Formulaire de rétractation (à compléter et renvoyer uniquement si tu veux te rétracter du contrat) :\n" +
      `À l'attention de ${formTo} :\n` +
      "Je/nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la prestation de services ci-dessous :\n" +
      `${v.plan} (référence ${v.reference})\nCommandé le : ${v.at}\nNom du (des) consommateur(s) :\nAdresse du (des) consommateur(s) :\n` +
      "Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :\nDate :\n(*) Rayez la mention inutile.";
    this.send("billing-confirmation", to, `Confirmation : AETHRYON ${v.plan}`,
      `Bonjour,\n\nMerci. Voici la confirmation de ton contrat AETHRYON ${v.plan}, conclu le ${v.at} (référence ${v.reference}).\n\n${terms}\n\n` +
      `Rétractation : tu peux te rétracter sans motif jusqu'au ${v.withdrawalUntil}, en ligne (Espace › Abonnement › « Renoncer au contrat ici ») ou avec le formulaire ci-dessous. Le prix payé t'est alors remboursé en totalité.\n` +
      `${site}/dashboard/abonnement\n\n${cgv}\n\n${contact ? `${contact}\n\n` : ""}${form}\n\nVendeur : ${seller}\n\nAETHRYON · ${site}\n`,
      {
        title: `${v.plan} : c'est confirmé`,
        intro: `Contrat conclu le ${v.at}, référence ${v.reference}. ${terms}`,
        box: { title: `Rétractation possible jusqu'au ${v.withdrawalUntil}`, text: "En ligne depuis ton espace (« Renoncer au contrat ici »), ou avec le formulaire type reproduit dans la version texte de cet e-mail et dans les CGV. Le prix payé t'est remboursé en totalité." },
        button: { href: `${site}/dashboard/abonnement`, label: "Voir mon offre", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        after: esc(`${cgv}${contact ? ` ${contact.replace("\n", " ")}` : ""}`),
        security: `Garde cet e-mail et ses pièces jointes : ils confirment ton contrat. Vendeur : ${seller}.`,
        site,
      }, v.terms ? [v.terms.attachment] : undefined);
  }

  /** Rappel de reconduction (Code de la consommation L215-1) : e-mail dédié, un à trois mois avant l'échéance, avec la
   *  date limite pour refuser la reconduction dans un encadré apparent. */
  billingRenewalNotice(to: string, v: { renewal: string; deadline: string; amount: string; reference: string; vat: string }): void {
    const site = this.cfg.publicUrl;
    this.send("billing-renewal-notice", to, `Ton abonnement AETHRYON Premium se renouvelle le ${v.renewal}`,
      `Bonjour,\n\nTon abonnement AETHRYON Premium (référence ${v.reference}) sera reconduit automatiquement le ${v.renewal}, pour un an, au prix de ${v.amount} (${v.vat}).\n\n` +
      `>>> Tu peux refuser cette reconduction jusqu'au ${v.deadline} inclus : Espace › Abonnement › « Résilier ». Rien d'autre à faire. <<<\n\n` +
      `Si tu ne fais rien, l'abonnement continue et le prélèvement a lieu à cette date. Tu peux aussi résilier plus tard : il restera actif jusqu'à la fin de l'année payée.\n\n` +
      `${site}/dashboard/abonnement\n\nAETHRYON · ${site}\n`,
      {
        title: "Ton abonnement se renouvelle bientôt",
        intro: `AETHRYON Premium sera reconduit automatiquement le ${v.renewal}, pour un an, au prix de ${v.amount} (${v.vat}).`,
        box: { title: `Refuser la reconduction : jusqu'au ${v.deadline} inclus`, text: "Espace › Abonnement › « Résilier ». Sans action de ta part, l'abonnement continue." },
        button: { href: `${site}/dashboard/abonnement`, label: "Gérer mon abonnement", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: `Référence du contrat : ${v.reference}. Cet e-mail est envoyé une fois par an, avant chaque reconduction.`,
        site,
      });
  }

  /** Accusé de résiliation (Code de la consommation L215-1-1, D215-3) : date de fin et effets, sur support durable. */
  billingTermination(to: string, v: { plan: string; endsAt: string; at: string; reference: string }): void {
    const site = this.cfg.publicUrl;
    this.send("billing-termination", to, "Résiliation de ton abonnement AETHRYON enregistrée",
      `Bonjour,\n\nNous avons bien reçu, le ${v.at}, la notification de résiliation de ton abonnement AETHRYON ${v.plan} (référence ${v.reference}).\n\n` +
      `Effet : aucun nouveau prélèvement. Ton offre ${v.plan} reste active jusqu'au ${v.endsAt}, fin de la période déjà payée ; ton compte passe ensuite sur l'offre Gratuite, avec ses limites.\n\n` +
      `Tu peux reprendre l'abonnement avant cette date depuis ton espace :\n${site}/dashboard/abonnement\n\nAETHRYON · ${site}\n`,
      {
        title: "Résiliation enregistrée",
        intro: `Notification reçue le ${v.at}. Aucun nouveau prélèvement : ton offre ${v.plan} reste active jusqu'au ${v.endsAt}, puis ton compte passe sur l'offre Gratuite.`,
        button: { href: `${site}/dashboard/abonnement`, label: "Voir mon abonnement", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: `Garde cet e-mail : il atteste de ta résiliation et de sa date. Référence : ${v.reference}.`,
        site,
      });
  }

  /** Accusé de rétractation (L221-21, D221-5) : CONTENU de la déclaration (nom, contrat et sa référence, date de
   *  conclusion), date et heure de son envoi, montant remboursé, sur support durable. */
  billingWithdrawal(to: string, v: { plan: string; at: string; refund: string; name: string; reference: string; concluded: string }): void {
    const site = this.cfg.publicUrl;
    const declaration = `${v.name} (compte ${to}) se rétracte du contrat AETHRYON ${v.plan}, référence ${v.reference}, conclu le ${v.concluded}.`;
    this.send("billing-withdrawal", to, `Rétractation de ton offre AETHRYON ${v.plan} enregistrée`,
      `Bonjour,\n\nNous avons bien reçu, le ${v.at}, ta déclaration de rétractation, envoyée depuis ton espace :\n« ${declaration} »\n\n` +
      `Le contrat est arrêté immédiatement et ton compte repasse sur l'offre Gratuite. Remboursement : ${v.refund}, sur le moyen de paiement utilisé, sous 14 jours au plus.\n\n` +
      `Cet accusé de réception t'est envoyé à ${to}.\n\nAETHRYON · ${site}\n`,
      {
        title: "Rétractation enregistrée",
        intro: `Reçue le ${v.at} : « ${declaration} » Le contrat est arrêté et ton compte repasse sur l'offre Gratuite. Remboursement : ${v.refund}, sous 14 jours au plus.`,
        button: { href: `${site}/dashboard/abonnement`, label: "Voir mon offre", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: `Garde cet e-mail : il atteste de ta rétractation, de son contenu, de sa date et de son heure. Référence : ${v.reference}.`,
        site,
      });
  }

  /** Commande refusée après paiement : adresse de facturation hors de France métropolitaine (offres réservées à ses
   *  résidents, CGV 1.2 et 4.2). Remboursement intégral, aucun droit ouvert. */
  billingForeignRefund(to: string, v: { plan: string; amount: string; at: string; reference: string; free?: boolean }): void {
    const site = this.cfg.publicUrl;
    // Commande sans paiement (code promo de 100 %) : rien n'a été prélevé, rien à rembourser.
    const money = v.free ? "Rien n'a été prélevé (code promo de 100 %) : il n'y a rien à rembourser." : `Remboursement intégral : ${v.amount}, sur le moyen de paiement utilisé (le délai d'apparition dépend de ta banque).`;
    this.send("billing-foreign-refund", to, v.free ? `Ta commande AETHRYON ${v.plan} est annulée` : `Ta commande AETHRYON ${v.plan} est annulée et remboursée`,
      `Bonjour,\n\nTa commande AETHRYON ${v.plan} du ${v.at} (référence ${v.reference}) a été annulée : les offres payantes sont réservées aux résidents de France métropolitaine, et l'adresse de facturation indiquée est hors de France.\n\n` +
      `${money} Aucun prélèvement ne suivra. Ton compte reste sur l'offre Gratuite.\n\nAETHRYON · ${site}\n`,
      {
        title: v.free ? "Commande annulée" : "Commande annulée et remboursée",
        intro: `Ta commande ${v.plan} du ${v.at} a été annulée : les offres payantes sont réservées aux résidents de France métropolitaine. ${v.free ? "Rien n'a été prélevé." : `Remboursement intégral : ${v.amount}.`}`,
        button: { href: `${site}/dashboard/abonnement`, label: "Voir mon compte", note: "Bouton inactif ? Copie cette adresse dans ton navigateur :" },
        security: `Référence : ${v.reference}. Aucun prélèvement ne suivra.`,
        site,
      });
  }
}

/** Pour l'aperçu des modèles (scripts/apercu-mails.ts) : le HTML exact, sans envoi. */
export const previewHtml = (l: Layout) => html(l, true);
export type { Layout as MailLayout };
