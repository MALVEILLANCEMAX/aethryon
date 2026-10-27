// La scène du héros (Égide v2, démonstration validée par le propriétaire) : le VRAI parcours d'AETHRYON en cinq étapes,
// lien → format → passage → réception du seul passage → fichier prêt (ou clip dans le chutier de Premiere Pro).
// Deux usages, jamais confondus :
//  - l'EXEMPLE (données fictives, marquées « Démonstration ») : récit automatique UNE fois au chargement si le mouvement
//    est complet, interrompu au premier geste dans la scène, rejouable ; cliquable à toute étape ;
//  - TON lien : reconnu SUR L'APPAREIL (aucune requête, mêmes règles que le service : lib/probe.ts pour YouTube, TikTok
//    et X, catalogue des plateformes pour les autres) ; formats réellement ouverts, raisons des fermés ; puis l'action
//    réelle (compte gratuit ou espace). Rien n'est converti ici : la scène ne promet que ce que le service fait.
// Mouvement réduit : pas de récit, aucun déplacement ; le plateau a une hauteur fixe (aucun saut de page). Le récit attend
// que la scène soit à l'écran et s'arrête si elle en sort.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { useConfig, useMe } from "../../lib/hooks.ts";
import { probeLink } from "../../lib/probe.ts";
import { etatAffiche, ETATS, FORMATS as FORMATS_CATALOGUE, NOM_FORMAT, plateformeDuLienCatalogue, raisonFormat, raisonPlateforme, type Plateforme } from "../../lib/catalogue.ts";
import { Fil, Icone, Medaille, Noeud, Veille, type NomIcone } from "../../ui/egide/Egide.tsx";
import { Frise, type FriseApi } from "./Frise.tsx";
import { debit, dureeLisible, mo, nomFichier, tc } from "./format.ts";

const STATIONS = [["lien", "Lien"], ["format", "Format"], ["passage", "Passage"], ["reception", "Réception"], ["pret", "Prêt"]] as const;
const EXEMPLE = { titre: "La nuit des chouettes", plateforme: "YouTube", url: "https://youtu.be/exemple-demo", duree: 252, poidsSource: 61, definition: "1920 × 1080" };
type Fmt = "MP4" | "MP3" | "GIF";
const FMT: Record<Fmt, { nom: string; ext: string; icone: NomIcone; precision: string; sortie: number }> = {
  MP4: { nom: "Vidéo MP4", ext: "mp4", icone: "video", precision: "H.264", sortie: 0.205 },
  MP3: { nom: "Son MP3", ext: "mp3", icone: "son", precision: "192 kbit/s", sortie: 0.024 },
  GIF: { nom: "GIF", ext: "gif", icone: "gif", precision: "30 s au plus", sortie: 0.31 },
};
const SERVICE = [["analyse", "Analyse du lien"], ["reception", "Réception du passage"], ["decoupe", "Découpe précise"], ["encodage", "Encodage"]] as const;
const PASSAGE_EXEMPLE: [number, number] = [62.5, 92.5];

/** Mouvement « complet » : pas de demande du système (sauf choix explicite d'un thème personnel), intensité complète ou douce. */
function mouvementComplet(): boolean {
  const h = document.documentElement;
  const m = h.getAttribute("data-eg-motion") ?? "complete";
  if (m === "reduite" || m === "aucune") return false;
  const explicite = h.getAttribute("data-eg-motion-explicite") === "1";
  return explicite || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reconnu = { nom: string; libelle: string; plateforme: Plateforme | null };
type Etat =
  | { mode: "vide" }
  | { mode: "lecture" }
  | { mode: "refus"; message: string; nom?: string }
  | { mode: "reconnu"; r: Reconnu }
  | { mode: "exemple"; etape: 1 | 2 | 3 | 4 };

/** Ton lien, reconnu sur l'appareil : règles précises du service pour les trois plateformes historiques, catalogue
 *  pour les autres (une plateforme n'est acceptée que si elle est EN LIGNE). */
function reconnaitre(texte: string, coupees?: Partial<Record<"youtube" | "tiktok" | "twitter", boolean>>): { ok: true; r: Reconnu } | { ok: false; message: string; nom?: string } {
  const pf = plateformeDuLienCatalogue(texte);
  const p = probeLink(texte);
  if (p.state === "ok") {
    if (pf && etatAffiche(pf, coupees) === "temp") return { ok: false, message: raisonPlateforme(pf, "temp"), nom: pf.nom };
    return { ok: true, r: { nom: pf?.nom ?? "", libelle: p.label, plateforme: pf } };
  }
  if (pf && !["youtube", "tiktok", "twitter"].includes(pf.id) && etatAffiche(pf, coupees) === "en-ligne") {
    return { ok: true, r: { nom: pf.nom, libelle: `Lien ${pf.nom} reconnu`, plateforme: pf } };
  }
  if (pf && !["youtube", "tiktok", "twitter"].includes(pf.id)) {
    const e = etatAffiche(pf, coupees);
    return { ok: false, message: `${ETATS[e].libelle} : ${raisonPlateforme(pf, e)}`, nom: pf.nom };
  }
  return { ok: false, message: p.state === "refus" ? p.message : "Ce texte n'est pas un lien." };
}

export function Scene() {
  const id = useId();
  const cfg = useConfig();
  const me = useMe();
  const connecte = !!me.data && !me.error;
  const coupees = cfg.data?.platforms;
  const champ = useRef<HTMLInputElement>(null);
  const scene = useRef<HTMLElement>(null);
  const frise = useRef<FriseApi>(null);
  const [valeur, setValeur] = useState("");
  const [etat, setEtat] = useState<Etat>({ mode: "vide" });
  const [fmt, setFmt] = useState<Fmt>("MP4");
  const [dest, setDest] = useState<"Dossier" | "Premiere">("Dossier");
  const [extrait, setExtrait] = useState<[number, number] | null>(null);
  const [max, setMax] = useState(0);
  const [recit, setRecit] = useState(false);
  const [reception, setReception] = useState({ p: 0, recu: 0 });
  const [reduit, setReduit] = useState(true);
  const jeton = useRef<{ stop: boolean } | null>(null);
  const minuterie = useRef<number | null>(null);
  /** Génération : chaque geste en ouvre une nouvelle ; une suite asynchrone d'une génération passée ne touche plus rien. */
  const generation = useRef(0);

  const etape = etat.mode === "exemple" ? etat.etape : 0;
  const puceLive = valeur.trim() ? plateformeDuLienCatalogue(valeur) : null;

  const arreterRecit = useCallback(() => {
    if (jeton.current) { jeton.current.stop = true; jeton.current = null; setRecit(false); generation.current++; }
  }, []);
  const arreterReception = () => { if (minuterie.current != null) { clearInterval(minuterie.current); minuterie.current = null; } };

  const lancerReception = useCallback((ex: [number, number] | null) => {
    arreterReception();
    const dur = ex ? ex[1] - ex[0] : EXEMPLE.duree;
    const total = ex ? Math.min(EXEMPLE.poidsSource, (dur + 2) * 0.242) : EXEMPLE.poidsSource;
    const t0 = performance.now(), duree = mouvementComplet() ? 3200 : 1200, g = generation.current;
    const pas = () => {
      if (g !== generation.current) { arreterReception(); return; }
      const x = Math.min(1, (performance.now() - t0) / duree);
      setReception({ p: x, recu: total * Math.min(1, Math.max(0, (x - 0.08) / 0.7)) });
      if (x >= 1) { arreterReception(); window.setTimeout(() => { if (g !== generation.current) return; setEtat({ mode: "exemple", etape: 4 }); setMax(4); }, 260); }
    };
    pas();
    minuterie.current = window.setInterval(pas, 200);
  }, []);

  const aller = useCallback((i: number) => {
    if (i === 0) { arreterReception(); setEtat({ mode: "vide" }); return; }
    if (etat.mode !== "exemple" && i > 0) return;
    if (i === 3) { setEtat({ mode: "exemple", etape: 3 }); setMax((m) => Math.max(m, 3)); setReception({ p: 0, recu: 0 }); lancerReception(extrait); return; }
    if (i === 4 && max < 4) return;
    arreterReception();
    setEtat({ mode: "exemple", etape: i as 1 | 2 | 4 });
  }, [etat.mode, extrait, lancerReception, max]);

  /** L'exemple : lecture du lien (veille), puis l'étape « Format ». */
  const lireExemple = useCallback(async (rapide = false) => {
    arreterReception();
    const g = generation.current;
    setEtat({ mode: "lecture" });
    if (!rapide) await attendre(900);
    if (g !== generation.current) return;
    setEtat({ mode: "exemple", etape: 1 });
    setMax((m) => Math.max(m, 1));
  }, []);

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    arreterRecit();
    generation.current++;
    const t = valeur.trim();
    if (etat.mode === "exemple" && t === EXEMPLE.url) { aller(3); return; }
    if (!t) { champ.current?.focus(); return; }
    if (t === EXEMPLE.url) { void lireExemple(); return; }
    arreterReception();
    const r = reconnaitre(t, coupees);
    setExtrait(null); setMax(0);
    setEtat(r.ok ? { mode: "reconnu", r: r.r } : { mode: "refus", message: r.message, nom: r.nom });
  };

  const essayerExemple = () => {
    arreterRecit();
    generation.current++;
    setValeur(EXEMPLE.url);
    setExtrait(null); setMax(0);
    void lireExemple();
  };
  const recommencer = () => {
    arreterRecit(); arreterReception(); generation.current++;
    setValeur(""); setExtrait(null); setMax(0); setFmt("MP4"); setDest("Dossier");
    setEtat({ mode: "vide" });
    champ.current?.focus();
  };

  /** Le récit : une seule fois au chargement (explication, ≈ 9 s), interrompu au premier geste. */
  const raconter = useCallback(async () => {
    const j = (jeton.current = { stop: false });
    setRecit(true);
    const ok = () => !j.stop;
    setValeur(""); setExtrait(null); setMax(0); setFmt("MP4"); setDest("Dossier"); setEtat({ mode: "vide" });
    await attendre(600); if (!ok()) return;
    for (let k = 1; k <= EXEMPLE.url.length; k++) { setValeur(EXEMPLE.url.slice(0, k)); await attendre(26); if (!ok()) return; }
    await attendre(260); if (!ok()) return;
    await lireExemple(); await attendre(1200); if (!ok()) return;
    setDest("Premiere"); await attendre(1100); if (!ok()) return;
    setEtat({ mode: "exemple", etape: 2 }); setMax(2); await attendre(500); if (!ok()) return;
    await frise.current?.glisser(PASSAGE_EXEMPLE[0], PASSAGE_EXEMPLE[1], 1000);
    setExtrait([...PASSAGE_EXEMPLE]);
    await attendre(1200); if (!ok()) return;
    setEtat({ mode: "exemple", etape: 3 }); setMax(3); setReception({ p: 0, recu: 0 }); lancerReception([...PASSAGE_EXEMPLE]);
    await attendre(3800); if (!ok()) return;
    jeton.current = null; setRecit(false);
  }, [lancerReception, lireExemple]);

  // Démarrage : le récit seulement si le mouvement est complet, la scène visible et l'onglet affiché.
  useEffect(() => {
    const complet = mouvementComplet();
    setReduit(!complet);
    if (!complet || !scene.current) return;
    let fait = false;
    // Démarre quand la scène est à l'écran ; s'arrête dès qu'elle en sort (page immobile hors de l'écran).
    const io = new IntersectionObserver((e) => {
      const x = e[e.length - 1];
      if (!x) return;
      if (fait) { if (x.intersectionRatio < 0.15 && jeton.current) arreterRecit(); return; }
      if (x.intersectionRatio < 0.5 || document.hidden) return;
      fait = true; void raconter();
    }, { threshold: [0, 0.15, 0.5] });
    io.observe(scene.current);
    return () => { io.disconnect(); arreterRecit(); arreterReception(); };
  }, [raconter, arreterRecit]);

  // Un lien autre que celui de l'exemple : l'action est toujours « Essayer » (reconnaissance sur l'appareil, rien n'est converti).
  const libelleAction = etat.mode !== "exemple" || valeur.trim() !== EXEMPLE.url ? "Essayer" : etape >= 3 ? "Convertir à nouveau" : extrait ? "Convertir le passage" : "Convertir";
  const exemple = etat.mode === "exemple";
  const permis = (i: number) => i === 0 || (exemple && (i <= 3 || max >= 4));
  const etatNoeud = (i: number): "ok" | "cours" | "attente" => (i < etape || (i === 4 && etape === 4) ? "ok" : i === etape ? "cours" : "attente");
  const dureePassage = extrait ? extrait[1] - extrait[0] : EXEMPLE.duree;

  return (
    <section ref={scene} className={cn("s-scene", recit && "is-recit")} aria-label="Démonstration interactive" data-probe=""
      onPointerDown={(e) => { if (jeton.current && !(e.target as HTMLElement).closest(".s-rejouer")) arreterRecit(); }}
      onKeyDown={() => arreterRecit()}>
      <ol className="s-rail" aria-label="Étapes">
        {STATIONS.map(([k, l], i) => (
          <li key={k}>
            <button className="s-station" type="button" aria-current={i === etape ? "step" : undefined} aria-disabled={!permis(i)}
              onClick={() => { arreterRecit(); if (permis(i)) aller(i); }}>
              <Noeud etat={etatNoeud(i)} /><span className="s-station-lib">{l}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="s-scene-etape" aria-hidden="true">Étape {etape + 1} sur 5 : {STATIONS[etape][1]}</p>
      <div className="s-scene-fil"><Fil valeur={etape / 4} libelle="Avancement de la démonstration" /></div>

      <form className="eg-etabli s-etabli" autoComplete="off" noValidate onSubmit={soumettre}>
        <span className="eg-etabli-lien"><Icone nom="lien" /></span>
        <label className="eg-vh" htmlFor={`${id}-lien`}>Lien d'une vidéo YouTube, TikTok ou X</label>
        <input ref={champ} id={`${id}-lien`} className="eg-champ-input eg-mono" type="url" inputMode="url" spellCheck={false}
          placeholder="Colle un lien YouTube, TikTok ou X" value={valeur}
          onChange={(e) => { arreterRecit(); setValeur(e.target.value); }} />
        {puceLive && (
          <span className="s-puce-pf" data-etat={etatAffiche(puceLive, coupees)}>
            {puceLive.nom}
            {etatAffiche(puceLive, coupees) !== "en-ligne" && <><i aria-hidden="true" /><span className="eg-vh">, {ETATS[etatAffiche(puceLive, coupees)].libelle.toLowerCase()}</span></>}
          </span>
        )}
        <button className="eg-btn eg-btn--principal s-etabli-go" type="submit">
          <span>{libelleAction}</span><span className="eg-touche" aria-hidden="true">Entrée</span>
        </button>
      </form>

      <div className="s-plateau" aria-live="polite">
        {etat.mode === "vide" && (
          <div className="s-vue s-attente" key="vide">
            <Medaille taille={56} />
            <b>Colle un lien pour commencer</b>
            <span>Ou regarde le parcours complet avec une vidéo d'exemple.</span>
            <button className="eg-btn eg-btn--secondaire" type="button" onClick={essayerExemple}><Icone nom="lecture" taille="s" />Voir l'exemple</button>
          </div>
        )}
        {etat.mode === "lecture" && (
          <div className="s-vue s-attente" key="lecture">
            <Veille libelle="Lecture du lien" />
            <b>Lecture du lien</b>
            <span>Titre, durée, formats disponibles.</span>
          </div>
        )}
        {etat.mode === "refus" && (
          <div className="s-vue" key="refus">
            <div className="s-encart" role="status">
              <span className="s-encart-ico"><Icone nom="info" /></span>
              <div>
                <b>{etat.nom ? `${etat.nom} : pas pour l'instant` : "Lien non pris en charge"}</b>
                <p>{etat.message}</p>
                <a className="eg-btn eg-btn--discret s-encart-lien" href="#plateformes"><Icone nom="liste" taille="s" />Voir les plateformes compatibles</a>
              </div>
            </div>
          </div>
        )}
        {etat.mode === "reconnu" && <VueReconnu r={etat.r} connecte={connecte} onExemple={essayerExemple} />}
        {exemple && etape === 1 && (
          <div className="s-vue" key="format">
            <TeteMedia />
            <div className="eg-tuiles" role="group" aria-label="Format">
              {(Object.keys(FMT) as Fmt[]).map((k) => (
                <button key={k} className="eg-tuile" type="button" aria-pressed={fmt === k} onClick={() => { arreterRecit(); setFmt(k); }}>
                  <span className="eg-tuile-coche"><Icone nom="ok" /></span><Icone nom={FMT[k].icone} /><b>{FMT[k].nom}</b><small>{FMT[k].precision}</small>
                </button>
              ))}
            </div>
            <div className="s-ligne">
              <span className="s-lib">Envoyer vers</span>
              <div className="eg-seg" role="group" aria-label="Destination">
                <button type="button" aria-pressed={dest === "Dossier"} onClick={() => { arreterRecit(); setDest("Dossier"); }}><Icone nom="dossier" taille="s" />Dossier</button>
                <button type="button" aria-pressed={dest === "Premiere"} onClick={() => { arreterRecit(); setDest("Premiere"); }}><Icone nom="chutier" taille="s" />Premiere Pro</button>
              </div>
              <button className="eg-btn eg-btn--discret s-vers-passage" type="button" onClick={() => { arreterRecit(); aller(2); setMax((m) => Math.max(m, 2)); }}>
                <Icone nom="ciseaux" taille="s" />Choisir un passage
              </button>
            </div>
          </div>
        )}
        {exemple && etape === 2 && (
          <div className="s-vue" key="passage">
            <div className="s-passage-tete">
              <b>{EXEMPLE.titre}</b>
              <span className="eg-mono s-lecture">{tc(extrait?.[0] ?? 0, true)} → {tc(extrait?.[1] ?? EXEMPLE.duree, true)}</span>
              <span className="s-dur">{dureeLisible(dureePassage)}</span>
            </div>
            <Frise ref={frise} duree={EXEMPLE.duree} debut={extrait?.[0] ?? 0} fin={extrait?.[1] ?? EXEMPLE.duree} lecture={(extrait?.[0] ?? 0) + 6}
              etiquette="Passage à convertir" reduit={reduit}
              onChange={(a, b) => setExtrait(a <= 0.05 && b >= EXEMPLE.duree - 0.05 ? null : [a, b])} />
            <div className="s-tcs eg-mono"><span>0:00</span><span>{tc(EXEMPLE.duree)}</span></div>
            <div className="s-puces" role="group" aria-label="Durée du passage">
              {([["entiere", "Vidéo entière"], [30, "30 s"], [60, "1 min"], [120, "2 min"]] as const).map(([v, l]) => (
                <button key={l} className="s-puce" type="button"
                  aria-pressed={v === "entiere" ? !extrait : !!extrait && Math.round(extrait[1] - extrait[0]) === v}
                  onClick={() => {
                    arreterRecit();
                    if (v === "entiere") { setExtrait(null); frise.current?.set(0, EXEMPLE.duree); }
                    else { const a = extrait ? extrait[0] : PASSAGE_EXEMPLE[0]; const b = Math.min(EXEMPLE.duree, a + v); setExtrait([a, b]); frise.current?.set(a, b); }
                  }}>{l}</button>
              ))}
            </div>
            <p className="s-note"><Icone nom="info" taille="s" /><span>Seul ce passage est téléchargé : {mo(Math.min(EXEMPLE.poidsSource, (dureePassage + 2) * 0.242))} au lieu de {mo(EXEMPLE.poidsSource)}.</span></p>
          </div>
        )}
        {exemple && etape === 3 && (
          <div className="s-vue s-recep" key="reception">
            <div className="s-recep-tete">
              <Noeud etat="cours" />
              <b>{libelleService(indexService(reception.p), fmt)}</b>
              <span className="eg-mono s-pc">{Math.round(reception.p * 100)} %</span>
            </div>
            <Fil valeur={reception.p} libelle="Progression de la conversion" epais />
            <div className="s-chiffres">
              <span><b className="eg-mono">{mo(reception.recu)}</b> reçus</span>
              <span>sur {mo(EXEMPLE.poidsSource)} de vidéo entière</span>
              <span className="eg-mono s-debit">{indexService(reception.p) === 1 ? debit(2.4 + Math.sin(reception.p * 9) * 0.5) : ""}</span>
            </div>
            <ol className="s-etapes">
              {SERVICE.map(([k, l], i) => (
                <li key={k}><Noeud etat={i < indexService(reception.p) ? "ok" : i === indexService(reception.p) ? "cours" : "attente"} /><span>{k === "encodage" ? libEncodage(fmt) : l}</span></li>
              ))}
            </ol>
          </div>
        )}
        {exemple && etape === 4 && (
          <div className="s-vue s-pret" key="pret">
            <div className="s-fichier">
              <Medaille taille={56} sceau frappe className="s-sceau" />
              <div className="s-fichier-ico"><Icone nom={FMT[fmt].icone} taille="l" /></div>
              <div className="s-fichier-txt">
                <b className="eg-mono">{nomFichier(EXEMPLE.titre, FMT[fmt].ext, extrait)}</b>
                <span>{mo(Math.max(0.4, Math.min(fmt === "GIF" ? 30 : dureePassage, dureePassage) * FMT[fmt].sortie))}, {dureeLisible(dureePassage)}{fmt === "MP4" ? ", H.264" : ""}</span>
              </div>
            </div>
            {dest === "Premiere" ? (
              <>
                <div className="s-chutier" role="img" aria-label="Chutier de Premiere Pro (illustration)">
                  <div className="s-chutier-tete"><Icone nom="chutier" taille="s" />Chutier AETHRYON</div>
                  <div className="s-clip is-nouveau"><Icone nom="video" taille="s" /><span className="eg-mono">{nomFichier(EXEMPLE.titre, FMT[fmt].ext, extrait)}</span><span className="eg-mono">{tc(dureePassage)}</span></div>
                  <div className="s-clip"><Icone nom="video" taille="s" /><span className="eg-mono">maree-basse_1-10_1-40.mp4</span><span className="eg-mono">0:30</span></div>
                </div>
                <p className="s-ok"><Noeud etat="ok" />Le clip est dans le chutier de Premiere Pro.</p>
              </>
            ) : (
              <p className="s-ok"><Noeud etat="ok" />Enregistré dans Téléchargements.</p>
            )}
            <div className="s-actions">
              {connecte
                ? <Link className="eg-btn eg-btn--secondaire" to="/dashboard">Ouvrir mon espace</Link>
                : <Link className="eg-btn eg-btn--secondaire" to="/commencer">Convertir avec un compte gratuit</Link>}
              <button className="eg-btn eg-btn--discret" type="button" onClick={recommencer}><Icone nom="retour" taille="s" />Recommencer avec ton lien</button>
            </div>
          </div>
        )}
      </div>

      <div className="s-scene-pied">
        <span className="s-etiquette-demo"><Icone nom="info" taille="s" />Démonstration : données fictives</span>
        <button className="eg-btn eg-btn--discret s-rejouer" type="button" onClick={() => { arreterRecit(); arreterReception(); void raconter(); }}>
          <Icone nom="retour" taille="s" />Rejouer
        </button>
      </div>
    </section>
  );
}

function indexService(p: number): number { return p < 0.08 ? 0 : p < 0.78 ? 1 : p < 0.88 ? 2 : 3; }
function libelleService(i: number, f: Fmt): string { return i >= 3 ? libEncodage(f) : (SERVICE[i]?.[1] ?? ""); }
function libEncodage(f: Fmt): string { return f === "MP4" ? "Encodage H.264" : f === "MP3" ? "Encodage MP3" : "Encodage GIF"; }

function TeteMedia() {
  return (
    <div className="s-media">
      <div className="s-vignette" aria-hidden="true"><span className="s-vignette-duree eg-mono">{tc(EXEMPLE.duree)}</span></div>
      <div>
        <b className="s-media-titre">{EXEMPLE.titre}</b>
        <span className="s-meta"><span className="s-puce-pf">{EXEMPLE.plateforme}</span><span className="eg-mono">{tc(EXEMPLE.duree)}</span><span className="eg-mono">{EXEMPLE.definition}</span></span>
      </div>
    </div>
  );
}

/** Ton lien est reconnu : formats réellement ouverts pour cette plateforme (catalogue), raisons des autres, action réelle. */
function VueReconnu({ r, connecte, onExemple }: { r: Reconnu; connecte: boolean; onExemple: () => void }) {
  const p = r.plateforme;
  const e = p ? etatAffiche(p) : "en-ligne";
  return (
    <div className="s-vue s-reconnu" key="reconnu">
      <div className="s-reconnu-tete">
        <Noeud etat="ok" />
        <b>{r.libelle}</b>
      </div>
      <p className="s-reconnu-texte">Vérifié sur ton appareil : rien n'est envoyé.</p>
      {p && (
        <ul className="s-fmts" aria-label={`Formats pour ${p.nom}`}>
          {FORMATS_CATALOGUE.map((f) => p.formats_compatibles.includes(f) && e === "en-ligne"
            ? <li key={f} className="s-fmt">{NOM_FORMAT[f]}</li>
            : <li key={f} className="s-fmt is-off" title={raisonFormat(p, f, e)}><s aria-hidden="true">{NOM_FORMAT[f]}</s><span className="eg-vh">{NOM_FORMAT[f]} indisponible : {raisonFormat(p, f, e)}</span></li>)}
        </ul>
      )}
      {p && e === "en-ligne" && !p.formats_compatibles.includes("extrait") && (
        <p className="s-raison"><Icone nom="info" taille="s" /><span>{raisonFormat(p, "extrait", e)}</span></p>
      )}
      {p?.attribution_obligatoire && (
        <p className="s-raison"><Icone nom="droits" taille="s" /><span>Auteur, licence et lien source sont joints au fichier.</span></p>
      )}
      <div className="s-actions">
        {connecte
          ? <Link className="eg-btn eg-btn--secondaire" to="/dashboard">Ouvrir mon espace<Icone nom="chevron" taille="s" /></Link>
          : <Link className="eg-btn eg-btn--secondaire" to="/commencer">Convertir avec un compte gratuit<Icone nom="chevron" taille="s" /></Link>}
        <button className="eg-btn eg-btn--discret" type="button" onClick={onExemple}><Icone nom="lecture" taille="s" />Voir le parcours avec l'exemple</button>
      </div>
    </div>
  );
}
