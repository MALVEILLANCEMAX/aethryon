// Sons de l'interface (V3.5) : un réglage À PART, jamais lié au consentement, gardé sur cet appareil (activés par
// défaut ; un interrupteur dans les préférences de confidentialité). Aucun son n'est joué sans un geste explicite
// (clic, touche) ; jamais à l'arrivée sur une page. Le navigateur refuse ou le fichier tarde : silence, rien n'est
// bloqué ni retardé.
//
// Son du cookie : le son fourni par le propriétaire (/media/sons/cookie.wav, 1,99 s, WAV 32 bits 48 kHz, 756 Ko, gardé
// tel quel). Pour la lecture, le MÊME son encodé en MP3 à 192 kbit/s (/media/sons/cookie.mp3, 48 Ko, fait par
// web/scripts/sons.sh) : le WAV mettait souvent plus que le délai permis à arriver sur un téléphone, et le son était
// alors abandonné. Il est téléchargé et décodé dès que le panneau s'affiche (aucune lecture), puis joué tout de suite,
// dans le geste, au clic sur « C'est noté ». Volume : le fichier est très doux (crête à -21 dB) ; la crête est amenée à
// -6 dB à la lecture (gain calculé sur le son décodé, borné), sans toucher au fichier.
// iPhone : en mode silencieux (interrupteur latéral), Safari coupe ces sons comme ceux du système : c'est voulu.

const KEY = "aethryon:sons";
const URL_COOKIE = "/media/sons/cookie.mp3";
/** Au-delà, le son arriverait trop tard après le geste : on y renonce. */
const ATTENTE_MAX_MS = 900;
/** Crête visée à la lecture (-6 dB) et gain maximal. */
const CRETE = 0.5;
const GAIN_MAX = 6;

const listeners = new Set<() => void>();

export function sonsActifs(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function reglerSons(actifs: boolean): void {
  try {
    if (actifs) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "off");
  } catch {
    /* stockage refusé : réglage pour cette page */
  }
  for (const f of listeners) f();
}

export function abonnerSons(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

let ctx: AudioContext | null = null;
let pret: Promise<{ tampon: AudioBuffer; gain: number } | null> | null = null;
let son: { tampon: AudioBuffer; gain: number } | null = null;

type AC = typeof AudioContext;
type OAC = typeof OfflineAudioContext;
const contexteAudio = (): AC | undefined => window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
const contexteHorsLigne = (): OAC | undefined => window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OAC }).webkitOfflineAudioContext;

/** Gain qui amène la crête du son à CRETE (jamais au-delà de GAIN_MAX, jamais en dessous de 1). */
function gainPour(tampon: AudioBuffer): number {
  let crete = 0;
  for (let c = 0; c < tampon.numberOfChannels; c++) {
    const d = tampon.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]!); if (v > crete) crete = v; }
  }
  return crete > 0 ? Math.min(GAIN_MAX, Math.max(1, CRETE / crete)) : 1;
}

/** Prépare le son : téléchargement et décodage hors ligne (aucun contexte audio réel, aucune lecture). */
export function prechargerCookie(): void {
  if (pret || !sonsActifs()) return;
  pret = fetch(URL_COOKIE, { credentials: "omit" })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then(async (data) => {
      if (!data) return null;
      const OC = contexteHorsLigne();
      // Décodage par un contexte hors ligne : possible avant tout geste, sans démarrer de sortie audio.
      const tampon = OC ? await new OC(2, 1, 48_000).decodeAudioData(data) : null;
      if (!tampon) return null;
      son = { tampon, gain: gainPour(tampon) };
      return son;
    })
    .catch(() => null);
}

function lancer(c: AudioContext, s: { tampon: AudioBuffer; gain: number }): void {
  const src = c.createBufferSource();
  src.buffer = s.tampon;
  const g = c.createGain();
  g.gain.value = s.gain;
  src.connect(g).connect(c.destination);
  src.start();
}

/** Joue le son du cookie, si les sons sont activés : appelé DANS le gestionnaire du clic (règles d'autoplay). */
export async function jouerCookie(): Promise<void> {
  if (!sonsActifs()) return;
  try {
    const Ctor = contexteAudio();
    if (!Ctor) return;
    ctx ??= new Ctor();
    // Reprise dans le geste (Safari, Chrome) ; si le son est déjà décodé, il part aussi dans le geste.
    if (ctx.state === "suspended") void ctx.resume();
    if (son) { lancer(ctx, son); return; }
    prechargerCookie();
    const debut = performance.now();
    const s = await Promise.race([pret, new Promise<null>((r) => setTimeout(() => r(null), ATTENTE_MAX_MS))]);
    if (!s || performance.now() - debut > ATTENTE_MAX_MS) return;
    if (ctx.state === "suspended") await ctx.resume();
    lancer(ctx, s);
  } catch {
    /* lecture refusée par le navigateur : silence */
  }
}
