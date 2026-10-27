// Parcours d'installation guidé, honnête : le site ne peut pas savoir si le raccourci a été ajouté
// à l'iPhone ; seule une première conversion réelle (vue côté serveur) le confirme.
// iPhone : lien iCloud officiel (réglage serveur, lu par useShortcutUrl) mis en avant, fichier signé en
// secours ; sans lien iCloud publié, le fichier signé devient le bouton principal.
// Ordinateur : QR code pour reprendre sur l'iPhone ; jamais de shortcuts:// forcé.
// La chouette : curieuse quand on vise le bouton d'installation, heureuse seulement quand le serveur
// a réellement reçu une première conversion.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useConfig, useDocumentTitle, useMe } from "../lib/hooks.ts";
import { useSiteOrigin } from "../lib/prerender.ts";
import { useResource } from "../lib/store.ts";
import { DUR, EASE } from "../lib/motion.ts";
import { MENU, SHORTCUT_NAME } from "../lib/brand.ts";
import { isShortcutKey } from "../lib/onboarding.ts";
import { ICLOUD_REL, useShortcutUrl } from "../lib/shortcut.ts";
import type { ActivityItem, ApiKey } from "../lib/types.ts";
import { AethryonMascot, type MascotState } from "../ui/brand/AethryonMascot.tsx";
import { ButtonA, ButtonLink } from "../ui/Button.tsx";
import { GoogleG, IconArrowUpRight, IconCheck, IconDownload, IconInfo, IconQr, ShortcutTile } from "../ui/Icon.tsx";
import { Card } from "../ui/bits.tsx";
import { QRCode } from "../ui/QRCode.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { KeysNotice } from "../ui/KeysNotice.tsx";
import { ByDevice, NotAppleTouch } from "../ui/ByDevice.tsx";
import { COPIED_FLAG } from "./Keys.tsx";

type StepState = "done" | "current" | "todo";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
/** Bouton d'installation : une ligne dès 640 px ; en dessous, le texte peut passer à la ligne plutôt que
 *  d'écraser l'icône ou de faire déborder la page. */
const installBtn = "h-auto min-h-14 gap-2.5 whitespace-normal px-4 py-2 text-[15.5px] leading-tight sm:gap-3 sm:whitespace-nowrap sm:px-7 sm:text-[16.5px]";

function Step({ n, state, title, children }: { n: number; state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="relative pb-11 pl-14 last:pb-0">
      {/* fil de progression : or jusqu'à l'étape en cours */}
      <span aria-hidden className={cn("absolute bottom-0 left-[17px] top-10 w-px transition-colors duration-500 [li:last-child_&]:hidden", state === "done" ? "bg-gold" : "bg-line")} />
      <span
        className={cn(
          "absolute left-0 top-0 grid size-9 place-items-center rounded-full border text-[14px] font-semibold transition-[background-color,border-color,color] duration-300 [font-variant-numeric:lining-nums]",
          state === "done" ? "border-gold bg-gold text-on-accent" : state === "current" ? "border-thread bg-surface text-fg" : "border-line-strong bg-ivory text-muted",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={state === "done" ? "c" : "n"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: DUR.micro }}>
            {state === "done" ? <IconCheck size={17} strokeWidth={2.2} /> : n}
          </motion.span>
        </AnimatePresence>
      </span>
      <h2 className={cn("pt-1 text-[19px] font-semibold tracking-[-0.01em]", state === "todo" && "text-muted")}>
        {title}
        <span className="sr-only">{state === "done" ? " (fait)" : state === "current" ? " (étape en cours)" : " (à faire)"}</span>
      </h2>
      <div className={cn("mt-2 text-[15.5px] leading-relaxed", state === "todo" ? "text-muted" : "text-ink-soft")}>{children}</div>
    </li>
  );
}

export default function Installer() {
  useDocumentTitle("Installer");
  const toast = useToast();
  const cfg = useConfig();
  const me = useMe();
  const signedIn = !!me.data && !me.error;
  const keys = useResource<{ keys: ApiKey[] }>(signedIn ? "/api/keys" : null, 10_000);
  const activity = useResource<{ items: ActivityItem[] }>(signedIn ? "/api/activity?limit=20" : null, 10_000);
  const [copied, setCopied] = useState(false);
  const [alreadyCopied, setAlreadyCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [aiming, setAiming] = useState(false);

  useEffect(() => { try { setCopied(sessionStorage.getItem(COPIED_FLAG) === "1"); } catch { /* indisponible */ } }, []);

  // Jetons du raccourci seulement : une clé d'extension navigateur ne remplace pas le jeton de l'iPhone.
  const activeKeys = (keys.data?.keys ?? []).filter((k) => k.status === "active" && isShortcutKey(k));
  const hasKey = activeKeys.length > 0;
  const newestKey = activeKeys.reduce<string | null>((acc, k) => (!acc || k.createdAt > acc ? k.createdAt : acc), null);
  const firstConversion = useMemo(
    () => (activity.data?.items ?? []).find((i) => newestKey && i.createdAt >= newestKey && i.state !== "refunded"),
    [activity.data, newestKey],
  );
  const shortcut = useShortcutUrl();
  const icloud = shortcut.icloudUrl;
  const fallback = shortcut.fallbackDownload;
  const origin = useSiteOrigin();

  const s1: StepState = signedIn ? "done" : "current";
  const s2: StepState = !signedIn ? "todo" : hasKey ? "done" : "current";
  const s3: StepState = !hasKey ? "todo" : copied || alreadyCopied ? "done" : "current";
  const s4: StepState = s3 !== "done" ? "todo" : opened ? "done" : "current";
  const s5: StepState = s4 !== "done" ? "todo" : firstConversion ? "done" : "current";
  const steps = [s1, s2, s3, s4, s5];
  const currentStep = steps.includes("current") ? steps.indexOf("current") + 1 : 5;
  const owl: MascotState = firstConversion ? "success" : aiming ? "curious" : "idle";
  const aim = { onPointerEnter: () => setAiming(true), onPointerLeave: () => setAiming(false), onFocus: () => setAiming(true), onBlur: () => setAiming(false) };

  const onInstall = () => {
    setOpened(true);
    toast.show("info", "Installation", "L'app Raccourcis va te demander de confirmer l'ajout.");
  };

  return (
    <div className="container-site pb-24 pt-28 sm:pt-36">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div>
          <p className="text-[14px] font-medium text-gold-text [font-variant-numeric:lining-nums]">Étape {currentStep} sur 5</p>
          <h1 className="page-title mt-3">Installer le raccourci iPhone</h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-soft">Cinq étapes, une seule fois.</p>
          <KeysNotice className="mt-6 max-w-xl" />

          <ol className="mt-12">
            <Step n={1} state={s1} title="Compte connecté">
              {signedIn ? (
                <p>Connecté en tant que <span className="text-ink">{me.data!.user.email}</span>.</p>
              ) : (
                <>
                  <p>Ton compte AETHRYON sert à créer ton jeton personnel : avec Google ou avec ton adresse e-mail.</p>
                  {cfg.data && !cfg.data.googleEnabled && !cfg.data.emailEnabled ? (
                    <p className="mt-4 flex gap-2.5 rounded-[16px] border border-warn/20 bg-warn-bg p-3.5 text-[14.5px] text-warn">
                      <IconInfo size={18} className="mt-0.5 shrink-0" />
                      La connexion Google n'est pas encore disponible : la création de jetons ouvrira dès son activation. Tu peux déjà télécharger le raccourci à l'étape 4.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                      <Link to="/connexion?suite=%2Finstaller" className="inline-flex h-12 items-center gap-3 rounded-full border border-[#747775] bg-[#fff] px-5 text-[15.5px] font-medium text-[#1f1f1f] shadow-card transition-[translate,box-shadow] hover:-translate-y-px hover:shadow-raised" data-installer-connexion="">{!cfg.data || cfg.data.googleEnabled ? <><GoogleG size={18} />Se connecter</> : "Se connecter"}</Link>
                      <Link to="/commencer" className="inline-flex min-h-11 items-center text-[15px] text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">Créer un compte</Link>
                    </div>
                  )}
                </>
              )}
            </Step>
            <Step n={2} state={s2} title="Jeton créé">
              {hasKey ? (
                <p>{activeKeys.length === 1 ? `Jeton actif : « ${activeKeys[0]!.name} ».` : `${activeKeys.length} jetons actifs.`} Si tu n'as plus sa valeur, régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link>.</p>
              ) : (
                <>
                  <p>Le jeton relie le raccourci à ton compte. Il s'affiche une seule fois : garde-le jusqu'à l'étape 4.</p>
                  {signedIn && <ButtonLink to="/dashboard/cles" variant="primary" className="mt-4">Créer mon jeton</ButtonLink>}
                </>
              )}
            </Step>
            <Step n={3} state={s3} title="Jeton copié">
              {copied ? (
                <p>Copié pendant cette visite : il est dans ton presse-papiers.</p>
              ) : (
                <>
                  <p>Copie ton jeton juste avant l'étape suivante : à l'installation, Raccourcis te demande « Colle ton jeton ».</p>
                  {hasKey && (
                    <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
                      <input type="checkbox" checked={alreadyCopied} onChange={(e) => setAlreadyCopied(e.target.checked)} className="check" />
                      Je l'ai déjà copié (ou je l'ai sous la main)
                    </label>
                  )}
                </>
              )}
            </Step>
            <Step n={4} state={s4} title="Ouvrir dans Raccourcis">
              <ByDevice
                desktop={<p>Cette étape se fait sur l'iPhone : scanne le QR code avec l'appareil photo, connecte-toi, et reprends ce parcours là-bas.</p>}
                touch={<>
                  {icloud ? (
                    <p>Le lien iCloud officiel ouvre directement l'app Raccourcis : touche « Ajouter le raccourci », puis colle ton jeton quand il est demandé.</p>
                  ) : shortcut.loading ? null : (
                    <p>Le lien iCloud officiel n'est pas encore publié : en attendant, le fichier signé se télécharge. Ouvre-le ensuite depuis les téléchargements de Safari (ou Fichiers › Téléchargements) pour l'ajouter à Raccourcis, puis colle ton jeton.</p>
                  )}
                  <div className={cn("mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3", icloud && "rounded-[22px] border border-gold/45 bg-pearl/70 p-2 shadow-card sm:p-3.5")} {...aim}>
                    {icloud ? (
                      <>
                        <ButtonA href={icloud} rel={ICLOUD_REL} variant="primary" size="lg" className={installBtn} onClick={onInstall} icon={<ShortcutTile size={22} className="shrink-0" />} trailing={<IconArrowUpRight size={17} className="hidden sm:block" />}>Installer dans Raccourcis</ButtonA>
                        <ButtonA href={fallback} download="AETHRYON.shortcut" variant="ghost" className="h-auto min-h-12 whitespace-normal px-4 py-2 leading-tight sm:whitespace-nowrap sm:px-5" icon={<IconDownload size={18} className="shrink-0" />}>Télécharger le fichier signé</ButtonA>
                      </>
                    ) : (
                      <ButtonA href={fallback} download="AETHRYON.shortcut" variant="primary" size="lg" className={installBtn} onClick={onInstall} icon={<IconDownload size={18} className="shrink-0" />}>Installer dans Raccourcis</ButtonA>
                    )}
                  </div>
                  {icloud && (
                    <p className="mt-3 text-[14px] text-muted">Le fichier signé sert de secours si le lien iCloud ne s'ouvre pas : ouvre-le ensuite depuis les téléchargements de Safari (ou Fichiers › Téléchargements).</p>
                  )}
                  <NotAppleTouch>
                    <p className="mt-3 flex gap-2 text-[14px] text-warn"><IconInfo size={16} className="mt-0.5 shrink-0" />Ce raccourci nécessite un iPhone avec l'app Raccourcis d'Apple.</p>
                  </NotAppleTouch>
                </>}
              />
              <p className="mt-3 text-[14px] text-muted">Dans l'app Raccourcis, il s'appelle « {SHORTCUT_NAME} ».</p>
            </Step>
            <Step n={5} state={s5} title="Confirmer et tester">
              <p>
                Touche « Ajouter le raccourci », colle ton jeton, puis partage une vidéo vers « {SHORTCUT_NAME} ».
                <span className="text-ink"> {MENU.mp4}</span> va dans Photos, <span className="text-ink">{MENU.mp3}</span> dans Fichiers.
              </p>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="check" />
                J'ai ajouté le raccourci
              </label>
              {firstConversion ? (
                <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }} className="mt-3 flex items-center gap-2 text-[15px] font-medium text-ok"><IconCheck size={18} />Première conversion reçue par le serveur : tout fonctionne.</motion.p>
              ) : confirmed ? (
                <p className="mt-3 text-[14.5px]">Lance une première conversion : elle apparaîtra ici et dans ton <Link to="/dashboard/activite" className={link}>activité</Link>.</p>
              ) : null}
            </Step>
          </ol>
        </div>

        <aside className="mt-14 lg:mt-0">
          <div className="space-y-4 lg:sticky lg:top-28">
            <div className="relative mx-auto hidden w-fit lg:block">
              <AethryonMascot state={owl} size={240} look={-1} className="relative w-full" />
            </div>
            <p className="sr-only" role="status">{firstConversion ? "Première conversion reçue." : ""}</p>
            <ByDevice desktop={
              <Card className="p-6">
                <div className="flex items-center gap-2.5 text-ink"><IconQr size={20} /><h2 className="text-[17px] font-semibold">Continuer sur l'iPhone</h2></div>
                <div className="mt-5 flex justify-center rounded-[18px] border border-line bg-[#fff] p-4">
                  <QRCode value={`${origin}/installer`} size={196} label="QR code pour ouvrir cette page sur l'iPhone" />
                </div>
                <p className="mt-4 text-[14.5px] text-ink-soft">Vise le code avec l'appareil photo de l'iPhone, puis touche le lien. Jeton perdu ? Régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link>.</p>
              </Card>
            } />
            <Card className="p-6">
              <h2 className="text-[17px] font-semibold">Version {shortcut.version ?? "—"}</h2>
              <p className="mt-2 text-[14.5px] text-ink-soft">Conçu pour iOS 27. {icloud ? "Publié par lien iCloud officiel ; le fichier de secours est signé, comme iOS l'exige depuis iOS 15." : "Le fichier de secours est signé, comme iOS l'exige depuis iOS 15."}</p>
              <Link to="/aide" className={cn(link, "mt-3 inline-flex min-h-11 items-center text-[14.5px]")}>Un problème ? Aide et diagnostic</Link>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
