// Film de lancement AETHRYON 3.5, « Le Passage » (motion design, 38,5 s, 1 080p à 60 i/s ; œuvre du propriétaire).
// Égide v2 : sa propre section, juste sous le héros (la scène y montre le parcours) ;
// cadre posé sur le thème, lecture automatique MUETTE en boucle quand le film est à
// l'écran, bouton « Activer le son ». Jamais de lecture hors de l'écran (page immobile, DESIGN.md §12), jamais de son
// automatique. Mouvement réduit : l'affiche (la carte finale du film) et un bouton de lecture, rien ne part seul.
// Son : voix du propriétaire, musique et effets originaux composés pour le film (livraison/son/LICENCES-SON.md).
import { useEffect, useRef, useState } from "react";
import { useCalm } from "../../lib/hooks.ts";
import { Icone } from "../../ui/egide/Egide.tsx";

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
      {on ? <><path d="M15.5 9a4.5 4.5 0 0 1 0 6" /><path d="M18 6.5a8 8 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  );
}

export function Film() {
  const calm = useCalm();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const userPaused = useRef(false);

  // Lecture muette à l'écran (pas en mouvement réduit), pause hors de l'écran.
  useEffect(() => {
    const v = video.current, el = box.current;
    if (!v || !el || calm) return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      if (e.isIntersecting && e.intersectionRatio >= 0.45 && !userPaused.current) void v.play().catch(() => {});
      else if (!e.isIntersecting || e.intersectionRatio < 0.2) v.pause();
    }, { threshold: [0, 0.2, 0.45, 0.8] });
    io.observe(el);
    return () => io.disconnect();
  }, [calm]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => setMuted(v.muted);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVolume);
    return () => { v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause); v.removeEventListener("volumechange", onVolume); };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) { userPaused.current = false; void v.play().catch(() => {}); }
    else { userPaused.current = true; v.pause(); }
  };
  const sound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted); // tout de suite (volumechange suit, mais le bouton ne doit jamais dire faux un instant)
    if (!v.muted && v.paused) { userPaused.current = false; void v.play().catch(() => {}); }
  };

  return (
    <div ref={box} className="film-frame" data-film="">
      <video
        ref={video}
        className="film-video"
        muted
        loop
        playsInline
        preload="metadata"
        poster="/media/film/aethryon-v35-affiche.webp"
        aria-label="Film de lancement AETHRYON 3.5, 38 secondes : le site, l'extension du navigateur, le raccourci iPhone, le bot Discord et AETHRYON Tools, avec un seul compte."
        width={1920}
        height={1080}
      >
        <source src="/media/film/aethryon-v35-1080.mp4" type="video/mp4" media="(min-width: 768px)" />
        <source src="/media/film/aethryon-v35-720.mp4" type="video/mp4" />
      </video>
      <div className="film-controls">
        <button type="button" onClick={toggle} className="film-btn" aria-label={playing ? "Mettre le film en pause" : "Lire le film"} data-film-play="">
          <Icone nom={playing ? "pause" : "lecture"} />
        </button>
        <button type="button" onClick={sound} className="film-btn film-sound" aria-pressed={!muted} data-film-son="">
          <SoundIcon on={!muted} />
          {muted ? "Activer le son" : "Couper le son"}
        </button>
      </div>
    </div>
  );
}
