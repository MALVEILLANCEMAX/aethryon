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
import type { MascotState } from "../ui/brand/AethryonMascot.tsx";
import { TuileProduit } from "../ui/brand/TuileProduit.tsx";
import { ButtonA, ButtonLink } from "../ui/Button.tsx";
import { GoogleG, IconArrowUpRight, IconCheck, IconDownload, IconInfo, ShortcutTile } from "../ui/Icon.tsx";
import { Etiquette, Icone, type NomIcone } from "../ui/egide/Egide.tsx";
import { Frontispice } from "../ui/passage/Passage.tsx";
import { TelephoneInstall } from "./installer/Telephone.tsx";
import { QRCode } from "../ui/QRCode.tsx";
import { useToast } from "../ui/Toasts.tsx";
import { KeysNotice } from "../ui/KeysNotice.tsx";
import { ByDevice, NotAppleTouch } from "../ui/ByDevice.tsx";
import { COPIED_FLAG } from "./Keys.tsx";

type StepState = "done" | "current" | "todo";
const link = "text-gold-text underline decoration-gold/50 underline-offset-4 transition-colors hover:decoration-gold-text";
/** Bouton d'installation : une ligne dès 640 px ; en dessous, le texte peut passer à la ligne plutôt que
 *  d'écraser l'icône ou de faire déborder la page. */
const installBtn = "h-auto min-h-14 gap-2.5 whitespace-normal px-4 py-2 text-ui leading-tight sm:gap-3 sm:whitespace-nowrap sm:px-7 sm:text-corps";

/** « Le Passage » (pages) : chaque étape est un nœud du fil d'or ; l'icône dit l'étape, la coche la valide, le fil se
 *  remplit jusqu'à l'étape en cours (passage.css, .rail). L'étape en cours est une plaque ; les autres, une ligne. */
function Step({ n, state, title, icone, children }: { n: number; state: StepState; title: string; icone: NomIcone; children?: ReactNode }) {
  return (
    <li className="rail-pas" data-etat={state}>
      <span className="rail-noeud" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={state === "done" ? "c" : "i"} className="rail-noeud-ico" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: DUR.micro }}>
            {state === "done" ? <Icone nom="ok" /> : <Icone nom={icone} duo={state === "current"} />}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="rail-trait" aria-hidden="true" />
      <div className="rail-corps">
        <h2 className="rail-titre">
          <span className="rail-n" aria-hidden="true">{n}</span>{title}
          <span className="sr-only">{state === "done" ? " (fait)" : state === "current" ? " (étape en cours)" : " (à faire)"}</span>
        </h2>
        {children && <div className="rail-texte">{children}</div>}
      </div>
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
      <Frontispice
        embleme={<TuileProduit produit="iphone" size={72} />}
        titre="Installer le raccourci iPhone"
        ligne="Cinq étapes, une seule fois."
        aside={
          <div className="ins-progres">
            <p className="ins-etape">Étape {currentStep} sur 5</p>
            <span className="ins-points" aria-hidden="true">{steps.map((st, i) => <i key={i} data-etat={st} />)}</span>
          </div>
        }
      />
      <KeysNotice className="mt-6 max-w-xl" />

      <div className="ins-grille">
        <ol className="rail">
          <Step n={1} state={s1} title="Compte connecté" icone="profil">
            {signedIn ? (
              <p>Connecté en tant que <span className="text-ink">{me.data!.user.email}</span>.</p>
            ) : (
              <>
                <p>Il sert à créer ton jeton personnel, avec Google ou ton adresse e-mail.</p>
                {cfg.data && !cfg.data.googleEnabled && !cfg.data.emailEnabled ? (
                  <p className="mt-4 flex gap-2.5 rounded-card border border-warn/20 bg-warn-bg p-3.5 text-ui text-warn">
                    <IconInfo size={18} className="mt-0.5 shrink-0" />
                    La connexion Google n'est pas encore disponible : la création de jetons ouvrira dès son activation. Tu peux déjà télécharger le raccourci à l'étape 4.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <Link to="/connexion?suite=%2Finstaller" className="inline-flex h-12 items-center gap-3 rounded-full border border-[#747775] bg-[#fff] px-5 text-ui font-medium text-[#1f1f1f] shadow-card transition-[translate,box-shadow] hover:-translate-y-px hover:shadow-raised" data-installer-connexion="">{!cfg.data || cfg.data.googleEnabled ? <><GoogleG size={18} />Se connecter</> : "Se connecter"}</Link>
                    <Link to="/commencer" className="inline-flex min-h-11 items-center text-ui text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text">Créer un compte</Link>
                  </div>
                )}
              </>
            )}
          </Step>
          <Step n={2} state={s2} title="Jeton créé" icone="cle">
            {hasKey ? (
              <p>{activeKeys.length === 1 ? `Jeton actif : « ${activeKeys[0]!.name} ».` : `${activeKeys.length} jetons actifs.`} Si tu n'as plus sa valeur, régénère-le dans <Link to="/dashboard/cles" className={link}>Mes jetons</Link>.</p>
            ) : (
              <>
                <p>Il relie le raccourci à ton compte et ne s'affiche qu'une fois : garde-le jusqu'à l'étape 4.</p>
                {signedIn && <ButtonLink to="/dashboard/cles" variant="primary" className="mt-4">Créer mon jeton</ButtonLink>}
              </>
            )}
          </Step>
          <Step n={3} state={s3} title="Jeton copié" icone="copier">
            {copied ? (
              <p>Copié pendant cette visite : il est dans ton presse-papiers.</p>
            ) : (
              <>
                <p>Copie-le juste avant l'étape 4 : Raccourcis te demandera « Colle ton jeton ».</p>
                {hasKey && (
                  <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-ui text-ink">
                    <input type="checkbox" checked={alreadyCopied} onChange={(e) => setAlreadyCopied(e.target.checked)} className="check" />
                    Je l'ai déjà copié (ou je l'ai sous la main)
                  </label>
                )}
              </>
            )}
          </Step>
          <Step n={4} state={s4} title="Ouvrir dans Raccourcis" icone="ouvrir">
            <ByDevice
              desktop={<p>Elle se fait sur l'iPhone : scanne le QR code avec l'appareil photo, connecte-toi, et reprends ce parcours là-bas.</p>}
              touch={<>
                {icloud ? (
                  <p>Le lien iCloud officiel ouvre l'app Raccourcis : touche « Ajouter le raccourci », puis colle ton jeton.</p>
                ) : shortcut.loading ? null : (
                  <p>Le lien iCloud officiel n'est pas encore publié : en attendant, le fichier signé se télécharge. Ouvre-le ensuite depuis les téléchargements de Safari (ou Fichiers › Téléchargements) pour l'ajouter à Raccourcis, puis colle ton jeton.</p>
                )}
                <div className={cn("mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3", icloud && "ins-installer")} {...aim}>
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
                  <p className="mt-3 text-ui text-muted">En secours, le fichier signé : ouvre-le depuis les téléchargements de Safari (ou Fichiers › Téléchargements).</p>
                )}
                <NotAppleTouch>
                  <p className="mt-3 flex gap-2 text-ui text-warn"><IconInfo size={16} className="mt-0.5 shrink-0" />Ce raccourci nécessite un iPhone avec l'app Raccourcis d'Apple.</p>
                </NotAppleTouch>
              </>}
            />
            <p className="mt-3 text-ui text-muted">Dans l'app Raccourcis, il s'appelle « {SHORTCUT_NAME} ».</p>
          </Step>
          <Step n={5} state={s5} title="Confirmer et tester" icone="lecture">
            <p>
              Touche « Ajouter le raccourci », colle ton jeton, puis partage une vidéo vers « {SHORTCUT_NAME} » :
              <span className="text-ink"> {MENU.mp4}</span> va dans Photos, <span className="text-ink">{MENU.mp3}</span> dans Fichiers.
            </p>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-ui text-ink">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="check" />
              J'ai ajouté le raccourci
            </label>
            {firstConversion ? (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.component, ease: EASE.soft }} className="mt-3 flex items-center gap-2 text-ui font-medium text-ok"><IconCheck size={18} />Première conversion reçue par le serveur : tout fonctionne.</motion.p>
            ) : confirmed ? (
              <p className="mt-3 text-ui">Lance une première conversion : elle apparaîtra ici et dans ton <Link to="/dashboard/activite" className={link}>activité</Link>.</p>
            ) : null}
          </Step>
        </ol>

        <aside className="ins-aside">
          <div className="ins-aside-colle">
            <div className="hidden lg:block"><TelephoneInstall etape={firstConversion ? 5 : currentStep} chouette={owl} /></div>
            <p className="sr-only" role="status">{firstConversion ? "Première conversion reçue." : ""}</p>
            <ByDevice desktop={
              <div className="ins-qr">
                <div className="ins-qr-code">
                  <QRCode value={`${origin}/installer`} size={116} label="QR code pour ouvrir cette page sur l'iPhone" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-ui font-semibold text-ink">Continuer sur l'iPhone</h2>
                  <p className="mt-1.5 text-note leading-relaxed text-ink-soft">Vise le code avec l'appareil photo de l'iPhone, puis touche le lien.</p>
                </div>
              </div>
            } />
            <p className="ins-version">
              <Etiquette>Version {shortcut.version ?? "—"}</Etiquette>
              <span>Conçu pour iOS 27. {icloud ? "Lien iCloud officiel ; fichier de secours signé, comme iOS l'exige depuis iOS 15." : "Fichier signé, comme iOS l'exige depuis iOS 15."}</span>
              <Link to="/aide" className={cn(link, "inline-flex min-h-11 items-center")}>Un problème ? Aide et diagnostic</Link>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
