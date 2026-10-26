// Miniatures générées DANS le panneau : <video> + <canvas> (CEP 12 lit le MP4 H.264/AAC), une à la fois, au cadrage
// 16:9 (bandes noires comprises, jamais de recadrage), puis gardées en cache sur le disque (JPEG) et en mémoire.
// Les fichiers d'AETHRYON Desktop ont déjà leur miniature (index.json) : on la reprend telle quelle.
// Le cache est indexé par identifiant + date de modification : un fichier remplacé régénère sa miniature.

export interface Mesure {
  duree: number | null;
  largeur: number | null;
  hauteur: number | null;
}

export interface ResultatMiniature extends Mesure {
  /** data:image/jpeg;base64,… (null si l'image n'a pas pu être lue). */
  dataUrl: string | null;
}

const L = 320;
const H = 180;

/** Dessine une source (vidéo ou image) au cadrage 16:9 avec bandes noires. */
function dessiner(source: CanvasImageSource, lSource: number, hSource: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx || !lSource || !hSource) return null;
  ctx.fillStyle = "#0f0f10";
  ctx.fillRect(0, 0, L, H);
  const echelle = Math.min(L / lSource, H / hSource);
  const l = lSource * echelle;
  const h = hSource * echelle;
  ctx.drawImage(source, (L - l) / 2, (H - h) / 2, l, h);
  try {
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    // Canvas « teinté » (origine file:// refusée sans --allow-file-access-from-files) : pas de miniature.
    return null;
  }
}

export function miniatureVideo(url: string, delaiMs = 9000): Promise<ResultatMiniature> {
  return new Promise((resoudre) => {
    const v = document.createElement("video");
    let fini = false;
    const finir = (r: ResultatMiniature) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        /* libération du décodeur */
      }
      resoudre(r);
    };
    const minuteur = setTimeout(() => finir({ dataUrl: null, duree: isFinite(v.duration) ? v.duration : null, largeur: v.videoWidth || null, hauteur: v.videoHeight || null }), delaiMs);
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.addEventListener("loadedmetadata", () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      // Une image représentative : 10 % de la durée, entre 0,5 s et 8 s (évite le noir d'ouverture).
      v.currentTime = Math.min(8, Math.max(Math.min(0.5, d / 2), d * 0.1));
    });
    v.addEventListener("seeked", () => {
      finir({ dataUrl: v.videoWidth ? dessiner(v, v.videoWidth, v.videoHeight) : null, duree: isFinite(v.duration) ? v.duration : null, largeur: v.videoWidth || null, hauteur: v.videoHeight || null });
    });
    v.addEventListener("error", () => finir({ dataUrl: null, duree: null, largeur: null, hauteur: null }));
    v.src = url;
  });
}

export function miniatureImage(url: string, delaiMs = 6000): Promise<ResultatMiniature> {
  return new Promise((resoudre) => {
    const img = new Image();
    const minuteur = setTimeout(() => resoudre({ dataUrl: null, duree: null, largeur: null, hauteur: null }), delaiMs);
    img.onload = () => {
      clearTimeout(minuteur);
      resoudre({ dataUrl: dessiner(img, img.naturalWidth, img.naturalHeight), duree: null, largeur: img.naturalWidth || null, hauteur: img.naturalHeight || null });
    };
    img.onerror = () => {
      clearTimeout(minuteur);
      resoudre({ dataUrl: null, duree: null, largeur: null, hauteur: null });
    };
    img.src = url;
  });
}

/** Mesure seulement (durée d'un son) sans décoder d'image. */
export function mesurerAudio(url: string, delaiMs = 6000): Promise<Mesure> {
  return new Promise((resoudre) => {
    const a = document.createElement("audio");
    const minuteur = setTimeout(() => resoudre({ duree: null, largeur: null, hauteur: null }), delaiMs);
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", () => {
      clearTimeout(minuteur);
      resoudre({ duree: isFinite(a.duration) ? a.duration : null, largeur: null, hauteur: null });
      a.removeAttribute("src");
    });
    a.addEventListener("error", () => {
      clearTimeout(minuteur);
      resoudre({ duree: null, largeur: null, hauteur: null });
    });
    a.src = url;
  });
}

/** File d'attente : un seul décodage à la fois, le plus récent demandé d'abord (ce qui est à l'écran). */
export function creerFileMiniatures(traiter: (id: string) => Promise<void>) {
  const attente: string[] = [];
  const vus = new Set<string>();
  let actif = false;
  let enPause = false;
  async function suivant() {
    if (actif || enPause) return;
    const id = attente.pop();
    if (!id) return;
    actif = true;
    try {
      await traiter(id);
    } catch {
      /* une miniature ratée n'arrête pas la file */
    } finally {
      actif = false;
      setTimeout(suivant, 30);
    }
  }
  return {
    demander(id: string) {
      if (vus.has(id)) return;
      vus.add(id);
      attente.push(id);
      void suivant();
    },
    oublier(id: string) {
      vus.delete(id);
    },
    pause(oui: boolean) {
      enPause = oui;
      if (!oui) void suivant();
    },
  };
}
