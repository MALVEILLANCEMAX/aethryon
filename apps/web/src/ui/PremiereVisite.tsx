// Première visite (V3.5), dans la coque du site seulement (jamais dans l'éditeur ni le Control Center) :
// 1. la page s'affiche normalement ;
// 2. si aucun choix n'est gardé, le panneau « Un petit cookie ? » monte en bas de l'écran (sans bloquer la page,
//    sans prendre le focus) ;
// 3. une fois ce panneau traité, la fenêtre « Nouveautés » de la version, si elle n'a pas déjà été vue ;
// 4. les deux restent accessibles depuis le pied de page (« Nouveautés », « Préférences de confidentialité »).
// Jamais deux fenêtres à la fois. Chargé à part, une fois la page prête : aucun poids sur l'accueil.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { DUR, EASE, SPRING } from "../lib/motion.ts";
import { FACULTATIFS, NECESSAIRES, abonner, enregistrerChoix, lireChoix, stockageDisponible, surOuverturePreferences } from "../lib/confidentialite.ts";
import { abonnerSons, jouerCookie, prechargerCookie, reglerSons, sonsActifs } from "../lib/sons.ts";
import { annonceAVoir, ANNONCES, marquerVue, surOuvertureNouveautes, type Annonce } from "../lib/nouveautes.ts";
import { Button, ButtonA } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { IconCheck, IconClose } from "./Icon.tsx";
import { OwlMark } from "./brand/OwlMark.tsx";
import { PremiereMark } from "./brand/PremiereMark.tsx";
import { RetroObject, type RetroHandle } from "./retro/RetroObject.tsx";
import "../visite.css";

const NB = " ";

export default function PremiereVisite() {
  const choix = useSyncExternalStore(abonner, lireChoix, () => null);
  const [panneau, setPanneau] = useState(() => !lireChoix() && stockageDisponible());
  const [prefs, setPrefs] = useState(false);
  /** Une ouverture des préférences = un formulaire neuf (clé), sans recopier un état par effet. */
  const [ouvertures, setOuvertures] = useState(0);
  const ouvrirPrefs = useCallback(() => { setOuvertures((n) => n + 1); setPrefs(true); }, []);
  const [annonce, setAnnonce] = useState<Annonce | null>(null);

  // Nouveautés : après le choix de confidentialité (jamais par-dessus le panneau), un instant après.
  const proposerNouveautes = useCallback((delai: number) => {
    const t = window.setTimeout(() => {
      const a = annonceAVoir();
      if (a && !document.querySelector("dialog[open]")) setAnnonce(a);
    }, delai);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (panneau || choix === null) return;
    return proposerNouveautes(1200);
  }, [panneau, choix, proposerNouveautes]);

  useEffect(() => surOuverturePreferences(ouvrirPrefs), [ouvrirPrefs]);
  useEffect(() => surOuvertureNouveautes(() => setAnnonce(ANNONCES[0] ?? null)), []);

  return (
    <>
      <AnimatePresence>
        {panneau && <CookiePanel key="cookie" onDetail={ouvrirPrefs} onDone={() => setPanneau(false)} />}
      </AnimatePresence>
      <Preferences key={ouvertures} open={prefs} onClose={() => setPrefs(false)} onSaved={() => setPanneau(false)} />
      <Nouveautes annonce={annonce} onClose={() => { if (annonce) marquerVue(annonce.id); setAnnonce(null); }} />
    </>
  );
}

// ---- panneau « Un petit cookie ? » ------------------------------------------------------------------------------
function CookiePanel({ onDetail, onDone }: { onDetail(): void; onDone(): void }) {
  const calm = useCalm();
  const retro = useRef<RetroHandle | null>(null);
  const [miettes, setMiettes] = useState(0);
  const [note, setNote] = useState(false);
  const consent = FACULTATIFS.length > 0;

  /** Choix fait : petit bond du cookie, miettes, son (si activé), puis le panneau descend. */
  const valider = (services: Record<string, boolean>, fete: boolean) => {
    if (note) return;
    if (fete) {
      void jouerCookie();
      retro.current?.bounce();
      setMiettes((n) => n + 1);
    }
    setNote(true);
    enregistrerChoix(services);
    window.setTimeout(onDone, calm ? 120 : fete ? 560 : 160);
  };
  const tout = (v: boolean) => Object.fromEntries(FACULTATIFS.map((f) => [f.id, v]));
  // Son prêt avant le clic (téléchargé et décodé, jamais joué ici) : sur téléphone, il part dans le geste.
  useEffect(() => { prechargerCookie(); }, []);

  return (
    <motion.section
      role="region" aria-labelledby="cookie-titre" className="cookie-panel" data-cookie-panel=""
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, transition: calm ? { duration: DUR.calm } : { ...SPRING.soft, delay: 0.9 } }}
      exit={calm ? { opacity: 0, transition: { duration: DUR.calm } } : { opacity: 0, y: 18, transition: { duration: 0.22, ease: EASE.exit } }}
    >
      <div className="cookie-art" aria-hidden="true">
        <RetroObject kind="cookie" size="xs" handle={(h) => { retro.current = h; }} />
        {miettes > 0 && <span key={miettes} className="cookie-miettes">{Array.from({ length: 7 }, (_, i) => <i key={i} className={`m${i}`} />)}</span>}
      </div>
      <div className="cookie-texte">
        <h2 id="cookie-titre" className="cookie-titre">Un petit cookie{NB}?</h2>
        {consent ? (
          <p>Le site garde l'essentiel pour fonctionner. Les services facultatifs ci-dessous ne démarrent qu'avec ton accord, et tu peux changer d'avis à tout moment.</p>
        ) : (
          <p>AETHRYON ne garde que l'essentiel{NB}: ta connexion et tes réglages, sur cet appareil. Aucune publicité, aucune mesure d'audience, rien d'un autre site.</p>
        )}
      </div>
      <div className="cookie-actions">
        {consent ? (
          <>
            {/* Accepter et refuser : même taille, même poids, côte à côte. */}
            <Button variant="night" size="sm" onClick={() => valider(tout(false), false)} disabled={note} data-cookie="refuser">Tout refuser</Button>
            <Button variant="night" size="sm" onClick={() => valider(tout(true), true)} disabled={note} data-cookie="accepter">Tout accepter</Button>
            <button type="button" className="cookie-lien" onClick={onDetail} data-cookie="personnaliser">Personnaliser</button>
          </>
        ) : (
          <>
            <Button variant="light" size="sm" onClick={() => valider({}, true)} disabled={note} data-cookie="ok"
              icon={note ? <IconCheck size={16} /> : undefined}>{note ? "Noté" : "C'est noté"}</Button>
            <Button variant="night" size="sm" onClick={onDetail} disabled={note} data-cookie="detail">Voir le détail</Button>
          </>
        )}
      </div>
    </motion.section>
  );
}

// ---- préférences de confidentialité (pied de page) ---------------------------------------------------------------
function Preferences({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(): void }) {
  const sons = useSyncExternalStore(abonnerSons, sonsActifs, () => true);
  const [services, setServices] = useState<Record<string, boolean>>(() => ({ ...(lireChoix()?.services ?? {}) }));
  const enregistrer = () => {
    enregistrerChoix(services);
    onSaved();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Préférences de confidentialité" className="prefs"
      description="Ce que le site garde sur cet appareil, et tes choix. Rien ne part vers un autre site."
      footer={<Button variant="primary" onClick={enregistrer} data-prefs="enregistrer">{FACULTATIFS.length ? "Enregistrer mes choix" : "C'est noté"}</Button>}>
      <section aria-labelledby="prefs-necessaire">
        <h3 id="prefs-necessaire" className="prefs-titre">Nécessaire au site</h3>
        <ul className="prefs-liste">
          {NECESSAIRES.map((n) => (
            <li key={n.titre}>
              <p className="prefs-nom">{n.titre}<span className="prefs-meta">{n.ou} · {n.duree}</span></p>
              <p className="prefs-pourquoi">{n.pourquoi}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="prefs-facultatif" className="mt-6">
        <h3 id="prefs-facultatif" className="prefs-titre">Services facultatifs</h3>
        {FACULTATIFS.length === 0 ? (
          <p className="prefs-pourquoi">Aucun{NB}: pas de publicité, pas de mesure d'audience, aucune ressource d'un autre site. Il n'y a donc rien à accepter ni à refuser.</p>
        ) : (
          <ul className="prefs-liste">
            {FACULTATIFS.map((f) => (
              <li key={f.id}>
                <Interrupteur id={`prefs-${f.id}`} label={f.titre} on={services[f.id] === true} onChange={(v) => setServices((s) => ({ ...s, [f.id]: v }))} />
                <p className="prefs-pourquoi">{f.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Sons : un réglage à part, jamais mêlé au consentement. */}
      <section aria-labelledby="prefs-sons" className="mt-6">
        <h3 id="prefs-sons" className="prefs-titre">Sons de l'interface</h3>
        <Interrupteur id="prefs-sons-actifs" label="Petits sons de validation" on={sons} onChange={(v) => reglerSons(v)} />
        <p className="prefs-pourquoi">Un son court, seulement après un geste de ta part (par exemple ce panneau). Jamais à l'arrivée sur une page.</p>
      </section>
    </Dialog>
  );
}

function Interrupteur({ id, label, on, onChange }: { id: string; label: string; on: boolean; onChange(v: boolean): void }) {
  return (
    <div className="prefs-switch">
      <label htmlFor={id} className="prefs-nom">{label}</label>
      <button id={id} type="button" role="switch" aria-checked={on} className={cn("switch", on && "is-on")} onClick={() => onChange(!on)} data-switch={id}>
        <span className="switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---- fenêtre « Nouveautés » ----------------------------------------------------------------------------------------
function Nouveautes({ annonce, onClose }: { annonce: Annonce | null; onClose(): void }) {
  const calm = useCalm();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const open = !!annonce;
  useEffect(() => {
    const d = ref.current;
    if (d && open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    }
  }, [open]);
  const closed = () => {
    const d = ref.current;
    if (d?.open && !open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  };
  const a = annonce;
  return (
    <dialog ref={ref} aria-labelledby="nouveautes-titre" className="nouveautes" data-nouveautes=""
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <AnimatePresence onExitComplete={closed}>
        {open && a && (
          <motion.div key={a.id} className="nouveautes-panneau"
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0, transition: { duration: DUR.calm } } : { opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.exit, ease: EASE.exit } }}
            transition={calm ? { duration: DUR.calm } : SPRING.soft}>
            <button type="button" className="nouveautes-fermer" onClick={onClose} aria-label="Fermer"><IconClose size={18} /></button>
            {a.visuel === "premiere"
              ? <PremiereMark size={60} className="nouveautes-chouette" />
              : <OwlMark size={52} surface="dark" blink className="nouveautes-chouette" />}
            <p className="nouveautes-version">{a.surtitre ?? `Nouvelle version · ${a.version}`}</p>
            <h2 id="nouveautes-titre" className="nouveautes-titre">{a.titre}</h2>
            <p className="nouveautes-accroche">{a.accroche}</p>
            <ul className="nouveautes-points">
              {a.points.map((p, i) => (
                <motion.li key={p.titre} initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: calm ? { duration: 0 } : { duration: DUR.component, ease: EASE.soft, delay: 0.12 + i * 0.06 } }}>
                  <span className="nouveautes-puce" aria-hidden="true" />
                  <span><strong>{p.titre}</strong>{NB}: {p.texte}</span>
                </motion.li>
              ))}
            </ul>
            {a.note && <p className="nouveautes-note">{a.note}</p>}
            <div className="nouveautes-actions">
              {a.telechargement
                ? <ButtonA variant="light" href={a.telechargement.href} download onClick={onClose} data-nouveautes-telecharger="">{a.telechargement.label}</ButtonA>
                : <Button variant="light" onClick={() => { onClose(); navigate(a.lien.to); }} data-nouveautes-decouvrir="">{a.lien.label}</Button>}
              <Button variant="night" onClick={onClose}>Plus tard</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
}
