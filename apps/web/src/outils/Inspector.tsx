// Panneau des réglages de l'outil courant (feuille ivoire posée sur la scène) et bloc d'export : format, qualité,
// durée exportée, taille estimée (dite « environ » quand elle n'est pas exacte), action claire. Tous les choix sont de
// vrais contrôles natifs (radio, curseurs, champs) habillés : clavier et lecteurs d'écran inchangés.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../lib/cn.ts";
import { useCalm } from "../lib/hooks.ts";
import { SPRING } from "../lib/motion.ts";
import type { MediaInfo, ToolsLimits } from "./api.ts";
import {
  carriedEdits, compressionQuality, estimateSize, exportProblem, GIF_FPS, GIF_WIDTHS, HEIGHTS, outputDims, outputLength, RATIOS, roundSpeed, selection, semitones,
  SPEED_MAX, SPEED_MIN, SPEED_PRESETS, speedTag, speedText, TARGETS,
  type AudioFormat, type Bitrate, type Container, type Edit, type Pitch, type Quality, type Ratio, type Tool,
} from "./edit.ts";
import { bytes, bytesRange, dims, kbps, parseTime, spanLabel, timecode } from "./format.ts";
import { IconAlert, IconClose, IconDownload } from "../ui/Icon.tsx";
import { clippedShare } from "./audio.ts";
import { IconFlipH, IconFlipV, IconMute, IconRotate, IconVolume } from "./icons.tsx";
import type { Span, Store } from "./live.ts";

/** Choix parmi quelques options : vrai groupe radio (une tabulation, flèches), pastille qui glisse. */
export function Chips<T extends string | number>({ label, options, value, onChange, wrap = true, render }: {
  label: string; options: readonly T[]; value: T; onChange(v: T): void; wrap?: boolean; render?(v: T): ReactNode;
}) {
  const id = useId();
  const calm = useCalm();
  const onKey = (e: React.KeyboardEvent) => {
    const i = options.indexOf(value);
    const go = (k: number) => { e.preventDefault(); onChange(options[(k + options.length) % options.length]!); };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(i - 1);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("chips", wrap && "chips-wrap")} onKeyDown={onKey}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={String(o)} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cn("chip", on && "is-on")} onClick={() => onChange(o)}>
            {on && <motion.span layoutId={`${id}-pill`} className="chip-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
            <span className="relative">{render ? render(o) : String(o)}</span>
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="insp-row">
      <div className="insp-label">{label}{hint && <span className="insp-hint">{hint}</span>}</div>
      {children}
    </div>
  );
}

/**
 * Champ de temps : saisie libre (« 1:23,5 », « 83.5 »), validée à Entrée ou à la sortie du champ. Une saisie en cours
 * n'est jamais écrasée par un changement venu d'ailleurs (poignée, autre champ) ; Échap revient à la valeur actuelle.
 */
function TimeField({ label, value, onCommit, onHere }: { label: string; value: number; onCommit(v: number): boolean; onHere(): void }) {
  // Brouillon seulement pendant une saisie ; sinon le champ montre la valeur reçue, sans état recopié. (Un effet qui
  // recopiait la valeur à chaque changement déclenchait une mise à jour par frappe : sous des flèches très rapides,
  // React 19 atteignait sa limite de 50 mises à jour enchaînées, erreur n° 185, et une frappe était perdue.)
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const id = useId();
  const commit = () => {
    if (draft === null) return;
    const v = parseTime(draft);
    if (v === null || !onCommit(v)) { setBad(true); return; }
    setBad(false);
    setDraft(null);
  };
  const shown = draft ?? timecode(value, 2);
  const invalid = bad && draft !== null;
  return (
    <div className="timefield">
      <label htmlFor={id} className="insp-label">{label}</label>
      <div className={cn("timefield-box", invalid && "is-bad")}>
        <input id={id} className="timefield-input tabular" inputMode="decimal" value={shown} aria-invalid={invalid || undefined}
          onChange={(e) => { setDraft(e.target.value); if (bad) setBad(false); }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape" && draft !== null) { e.preventDefault(); setDraft(null); setBad(false); }
          }} />
        <button type="button" className="timefield-here" onClick={onHere} title="Prendre la position de lecture">Ici</button>
      </div>
    </div>
  );
}

/** Jauge (part d'une limite) : remplissage posé par variable CSS. */
function Meter({ value, over, children }: { value: number; over: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.style.setProperty("--fill", `${Math.min(100, Math.max(0, value * 100))}%`); }, [value]);
  return (
    <div ref={ref} className="meter" data-over={over || undefined}>
      <span className="meter-track" aria-hidden="true"><span className="meter-fill" /></span>
      <span className="tabular">{children}</span>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, format }: { label: string; min: number; max: number; step: number; value: number; onChange(v: number): void; format(v: number): string }) {
  const id = useId();
  return (
    <div className="insp-row">
      <div className="insp-label"><label htmlFor={id}>{label}</label><output htmlFor={id} className="insp-value tabular">{format(value)}</output></div>
      <input id={id} type="range" className="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
    </div>
  );
}

interface Props {
  tool: Tool;
  edit: Edit;
  set(patch: Partial<Edit>): void;
  info: MediaInfo;
  limits: ToolsLimits | null;
  currentTime(): number;
  /** Sélection vivante : les champs de temps suivent les poignées pendant qu'on les tire. */
  live: Store<Span>;
  onSample?(): void;
  sample?: ReactNode;
  /** Crêtes de l'onde (0–255) : risque de saturation d'une amplification. */
  peaks?: readonly number[] | null;
}

/**
 * Début et fin : valeurs validées par React ; pendant un geste (poignée tirée), la valeur vivante est écrite
 * directement dans les champs (aucun rendu), sauf dans un champ en cours de saisie.
 */
function Times({ live, start, end, onStart, onEnd, here }: { live: Store<Span>; start: number; end: number; onStart(v: number): boolean; onEnd(v: number): boolean; here(): number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => live.subscribe(() => {
    const s = live.get();
    const [a, b] = box.current ? [...box.current.querySelectorAll<HTMLInputElement>("input")] : [];
    if (a && document.activeElement !== a) a.value = timecode(s.start, 2);
    if (b && document.activeElement !== b) b.value = timecode(s.end, 2);
  }), [live]);
  return (
    <div ref={box} className="insp-times">
      <TimeField label="Début" value={start} onHere={() => onStart(here())} onCommit={onStart} />
      <TimeField label="Fin" value={end} onHere={() => onEnd(here())} onCommit={onEnd} />
    </div>
  );
}

/** Ce que l'export produira, en étiquettes (format, image, débit, cadence…), sans rien promettre de plus. */
export function outputTags(tool: Tool, e: Edit, info: MediaInfo, out: { w: number; h: number }): string[] {
  const d = out.w && out.h ? dims(out.w, out.h) : null;
  const speed = e.speed !== 1 ? speedTag(e, info.has_audio && tool !== "gif" && (tool === "audio" || !e.mute)) : null;
  if (tool === "audio") {
    const lossless = e.audioFormat === "wav" || e.audioFormat === "flac";
    return [e.audioFormat.toUpperCase(), lossless ? "Sans perte" : e.audioFormat === "ogg" ? null : `${e.bitrate}\u00a0kbit/s`, speed].filter((x): x is string => !!x);
  }
  if (tool === "gif") return ["GIF", d, `${e.gifFps}\u00a0images/s`, "Boucle infinie", speed].filter((x): x is string => !!x);
  if (tool === "compresser") return ["MP4", `${e.targetMb}\u00a0Mo au plus`, e.mute || !info.has_audio ? "Sans le son" : null].filter((x): x is string => !!x);
  return [e.container.toUpperCase(), d, e.quality === "haute" ? "Qualité haute" : e.quality === "legere" ? "Qualité légère" : null, e.mute || !info.has_audio ? "Sans le son" : null, speed]
    .filter((x): x is string => !!x);
}

/** Avant / après de la compression : deux barres à la même échelle (la part gardée, au plus). */
function BeforeAfter({ before, after }: { before: number; after: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.style.setProperty("--after", `${Math.max(2, Math.min(100, (after / Math.max(1, before)) * 100))}%`); }, [before, after]);
  return (
    <div ref={ref} className="ba" role="group" aria-label="Taille avant et après">
      <div className="ba-row"><span>Aujourd'hui</span><span className="ba-bar" aria-hidden="true"><i /></span><b className="tabular">{bytes(before)}</b></div>
      <div className="ba-row"><span>Après</span><span className="ba-bar is-after" aria-hidden="true"><i /></span><b className="tabular">≤{"\u00a0"}{bytes(after)}</b></div>
    </div>
  );
}

/** Deux traitements du son, côte à côte, chacun dit en une ligne : vrai groupe radio (une tabulation, flèches). */
function PitchChoice({ value, speed, labelledBy, onChange }: { value: Pitch; speed: number; labelledBy: string; onChange(v: Pitch): void }) {
  const calm = useCalm();
  const opts: { v: Pitch; title: string; text: string }[] = [
    { v: "keep", title: "Tonalité conservée", text: "Voix intactes" },
    { v: "shift", title: speed < 1 ? "Slowed" : "Sped Up", text: speed < 1 ? "Plus grave, comme un disque" : "Plus aigu, comme un disque" },
  ];
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="pitch-choice"
      onKeyDown={(ev) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
        ev.preventDefault();
        const next: Pitch = value === "keep" ? "shift" : "keep";
        onChange(next);
        (ev.currentTarget.querySelector(`[data-pitch-mode="${next}"]`) as HTMLElement | null)?.focus();
      }}>
      {opts.map((o) => {
        const on = o.v === value;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cn("pitch-opt", on && "is-on")} onClick={() => onChange(o.v)} data-pitch-mode={o.v}>
            {on && <motion.span layoutId={`${labelledBy}-pill`} className="pitch-pill" transition={calm ? { duration: 0 } : SPRING.glide} />}
            <span className="relative pitch-title">{o.title}</span>
            <span className="relative pitch-text">{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Vitesse de l'EXPORT (pas celle de l'aperçu) : curseur au centième de ×0,25 à ×4 (échelle logarithmique : ×0,5 et ×2
 * à égale distance de ×1), vitesses courantes en un clic ; s'il y a du son, son traitement : tonalité conservée, ou
 * Sped Up / Slowed (la tonalité suit la vitesse, comme un disque). L'aperçu joue exactement ce qui sera exporté.
 */
function SpeedControl({ e, set, sound }: { e: Edit; set(patch: Partial<Edit>): void; sound: boolean }) {
  const id = useId();
  const st = semitones(e.speed);
  const shift = e.pitch === "shift";
  return (
    <div className="insp-row speed" data-speed="">
      <div className="insp-label"><label htmlFor={id}>Vitesse</label><output htmlFor={id} className="insp-value tabular" data-speed-value="">{speedText(e.speed)}</output></div>
      <input id={id} type="range" className="range" min={Math.log2(SPEED_MIN)} max={Math.log2(SPEED_MAX)} step={0.005} value={Math.log2(e.speed)}
        onChange={(ev) => set({ speed: roundSpeed(2 ** Number(ev.target.value)) })} aria-valuetext={`Vitesse ${speedText(e.speed)}`} data-speed-range="" />
      <div className="speed-presets" role="group" aria-label="Vitesses courantes">
        {SPEED_PRESETS.map((v) => (
          <button key={v} type="button" className={cn("speed-chip tabular", e.speed === v && "is-on")} aria-pressed={e.speed === v} onClick={() => set({ speed: v })} data-speed-preset={v}>
            {speedText(v)}
          </button>
        ))}
      </div>
      {sound && (
        <div className="pitch" data-pitch="">
          <div className="insp-label" id={`${id}-pitch`}>Hauteur du son</div>
          <PitchChoice value={e.pitch} speed={e.speed} labelledBy={`${id}-pitch`} onChange={(v) => set({ pitch: v })} />
          <p className="insp-note" data-pitch-note="">
            {e.speed === 1 ? (shift ? "Sans effet à ×1 : choisis une vitesse." : "Voix et musique gardent leur hauteur quand la vitesse change.")
              : shift ? `Tempo et tonalité ${e.speed > 1 ? "montent" : "descendent"} ensemble, comme un disque ${e.speed > 1 ? "accéléré" : "ralenti"} : ${st > 0 ? "+" : "−"}${Math.abs(st).toFixed(1).replace(".", ",")} demi-ton${Math.abs(st) >= 2 ? "s" : ""}. L'aperçu le fait déjà entendre.`
              : "Plus vite ou plus lent, mêmes voix : la tonalité est conservée (podcasts, cours, interviews)."}
          </p>
        </div>
      )}
    </div>
  );
}

const RATIO_GLYPH: Record<Ratio, string> = { original: "r-original", "16:9": "r-169", "9:16": "r-916", "1:1": "r-11", "4:5": "r-45", libre: "r-libre" };


const TOOL_TITLES: Record<Tool, string> = { couper: "Couper", recadrer: "Recadrer", audio: "Audio", gif: "GIF", compresser: "Compresser" };
export const ACTION: Record<Tool, string> = { couper: "Exporter la vidéo", recadrer: "Exporter la vidéo", audio: "Exporter le son", gif: "Créer le GIF", compresser: "Compresser" };
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)} dB`;

export function Inspector(p: Props) {
  const { tool, edit: e, set, info } = p;
  const len = outputLength(e);
  const est = estimateSize(tool, e, info);
  const out = outputDims(e, info, tool);
  const rotate = (dir: 1 | -1) => set({ rotate: (((e.rotate + dir * 90) % 360 + 360) % 360) as Edit["rotate"] });
  // Un début placé après la fin emmène la fin (même durée) ; une fin placée avant le début emmène le début.
  const setStart = (v: number) => {
    if (!(v >= 0) || v > info.duration - 0.1) return false;
    const len = e.end - e.start;
    set(v < e.end - 0.1 ? { start: v } : { start: v, end: Math.min(info.duration, v + len) });
    return true;
  };
  const setEnd = (v: number) => {
    if (!(v > 0.1) || v > info.duration + 0.01) return false;
    const end = Math.min(info.duration, v);
    const len = e.end - e.start;
    set(end > e.start + 0.1 ? { end } : { end, start: Math.max(0, end - len) });
    return true;
  };
  const times = <Times live={p.live} start={e.start} end={e.end} onStart={setStart} onEnd={setEnd} here={p.currentTime} />;
  // Le son suit-il l'export ? (pas pour un GIF, ni une vidéo exportée sans le son)
  const sound = info.has_audio && tool !== "gif" && (tool === "audio" || !e.mute);
  const speed = <SpeedControl e={e} set={set} sound={sound} />;
  const videoOut = (
    <>
      <Row label="Format"><Chips label="Format" options={["mp4", "mov", "mkv", "webm"] as Container[]} value={e.container} onChange={(v) => set({ container: v })} render={(v) => String(v).toUpperCase()} /></Row>
      <Row label="Qualité"><Chips label="Qualité" options={["haute", "standard", "legere"] as Quality[]} value={e.quality} onChange={(v) => set({ quality: v })} render={(v) => (v === "legere" ? "Légère" : v === "haute" ? "Haute" : "Standard")} /></Row>
      <Row label="Hauteur" hint={dims(out.w, out.h)}>
        <Chips label="Hauteur de l'image" options={["src", ...HEIGHTS.filter((h) => h < (info.height ?? 0))] as (string | number)[]} value={e.height ?? "src"}
          onChange={(v) => set({ height: v === "src" ? null : Number(v) })} render={(v) => (v === "src" ? "Originale" : `${v}p`)} />
      </Row>
      <div className="insp-switches">
        <button type="button" className={cn("toggle", e.mute && "is-on")} aria-pressed={e.mute} onClick={() => set({ mute: !e.mute })} disabled={!info.has_audio}>
          {e.mute || !info.has_audio ? <IconMute size={17} /> : <IconVolume size={17} />}{!info.has_audio ? "Fichier sans son" : e.mute ? "Sans le son" : "Avec le son"}
        </button>
      </div>
    </>
  );

  let body: ReactNode = null;
  if (tool === "couper") {
    body = <>{times}{speed}{videoOut}</>;
  } else if (tool === "recadrer") {
    body = (
      <>
        <Row label="Format de l'image" hint={dims(out.w, out.h)}>
          <Chips label="Format de l'image" options={RATIOS.map((r) => r.id)} value={e.ratio} onChange={(v: Ratio) => set({ ratio: v })}
            render={(v) => <span className="ratio-chip"><span className={cn("ratio-glyph", RATIO_GLYPH[v])} aria-hidden="true" />{RATIOS.find((r) => r.id === v)!.label}</span>} />
        </Row>
        <Row label="Orientation">
          <div className="insp-tools">
            <button type="button" className="tool-btn" onClick={() => rotate(-1)} aria-label="Tourner d'un quart de tour à gauche"><IconRotate size={18} className="-scale-x-100" /></button>
            <button type="button" className="tool-btn" onClick={() => rotate(1)} aria-label="Tourner d'un quart de tour à droite"><IconRotate size={18} /></button>
            <button type="button" className={cn("tool-btn", e.flipH && "is-on")} aria-pressed={e.flipH} onClick={() => set({ flipH: !e.flipH })} aria-label="Miroir horizontal"><IconFlipH size={18} /></button>
            <button type="button" className={cn("tool-btn", e.flipV && "is-on")} aria-pressed={e.flipV} onClick={() => set({ flipV: !e.flipV })} aria-label="Miroir vertical"><IconFlipV size={18} /></button>
            <span className="insp-hint tabular">{e.rotate ? `${e.rotate}°` : "0°"}</span>
          </div>
        </Row>
        {e.crop && <button type="button" className="link-btn" onClick={() => set({ crop: null, ratio: "original" })}>Retirer le recadrage</button>}
        {videoOut}
      </>
    );
  } else if (tool === "audio") {
    const clipped = p.peaks?.length && e.volumeDb > 0
      ? clippedShare(p.peaks, info.duration, { start: e.start, end: e.end, speed: e.speed, volumeDb: e.volumeDb, fadeIn: e.fadeIn, fadeOut: e.fadeOut }) : 0;
    body = (
      <>
        {times}
        <Slider label="Volume" min={-30} max={20} step={1} value={e.volumeDb} onChange={(v) => set({ volumeDb: v })} format={signed} />
        {clipped > 0.002 && (
          <p className="insp-warn" role="status"><IconAlert size={16} />
            <span>À {signed(e.volumeDb)}, les passages les plus forts dépassent le niveau maximal et risquent de saturer. Baisse un peu le volume pour un son propre.</span>
          </p>
        )}
        <Slider label="Fondu au début" min={0} max={10} step={0.5} value={e.fadeIn} onChange={(v) => set({ fadeIn: v })} format={(v) => (v ? `${String(v).replace(".", ",")} s` : "aucun")} />
        <Slider label="Fondu à la fin" min={0} max={10} step={0.5} value={e.fadeOut} onChange={(v) => set({ fadeOut: v })} format={(v) => (v ? `${String(v).replace(".", ",")} s` : "aucun")} />
        {speed}
        <Row label="Format"><Chips label="Format du son" options={["mp3", "m4a", "wav", "ogg", "flac"] as AudioFormat[]} value={e.audioFormat} onChange={(v) => set({ audioFormat: v })} render={(v) => String(v).toUpperCase()} /></Row>
        {(e.audioFormat === "mp3" || e.audioFormat === "m4a") && (
          <Row label="Débit"><Chips label="Débit" options={[128, 192, 256, 320] as Bitrate[]} value={e.bitrate} onChange={(v) => set({ bitrate: v })} render={(v) => `${v} k`} /></Row>
        )}
      </>
    );
  } else if (tool === "gif") {
    const max = p.limits?.gifMaxS ?? 30;
    const frames = Math.round(len * e.gifFps);
    body = (
      <>
        {times}
        <Meter value={len / max} over={len > max}>{spanLabel(len)} sur {max}&nbsp;s au plus · {frames} images</Meter>
        <Row label="Durée rapide">
          <div className="insp-tools">
            {[3, 5, 10].map((s) => (
              <button key={s} type="button" className="tool-btn tool-btn-text" onClick={() => set({ end: Math.min(info.duration, e.start + s * e.speed) })}>{s}&nbsp;s</button>
            ))}
          </div>
        </Row>
        {est?.range && est.range[1] > 10 * 1024 * 1024 && (
          <p className="insp-note">Un GIF de vraie vidéo peut dépasser 10&nbsp;Mo, la limite d'envoi de Discord sans abonnement&nbsp;: réduis la largeur, les images par seconde ou la durée.</p>
        )}
        <Row label="Largeur" hint={dims(out.w, out.h)}><Chips label="Largeur du GIF" options={GIF_WIDTHS} value={e.gifWidth as (typeof GIF_WIDTHS)[number]} onChange={(v) => set({ gifWidth: v })} render={(v) => `${v} px`} /></Row>
        <Row label="Images par seconde"><Chips label="Images par seconde" options={GIF_FPS} value={e.gifFps as (typeof GIF_FPS)[number]} onChange={(v) => set({ gifFps: v })} /></Row>
        {speed}
      </>
    );
  } else {
    const q = compressionQuality(e, info);
    const share = info.duration ? selection(e) / info.duration : 1;
    const before = info.size_bytes * share;
    body = (
      <>
        <dl className="facts">
          <div><dt>Fichier d'origine</dt><dd className="tabular">{bytes(info.size_bytes)}</dd></div>
          <div><dt>Image</dt><dd className="tabular">{dims(info.width, info.height)}</dd></div>
          <div><dt>Débit</dt><dd className="tabular">{kbps(info.bit_rate)}</dd></div>
        </dl>
        {times}
        <Row label="Taille visée">
          <Chips label="Taille visée" options={TARGETS} value={e.targetMb as (typeof TARGETS)[number]} onChange={(v) => set({ targetMb: v })} render={(v) => `${v} Mo`} />
        </Row>
        {e.targetMb === 10 && <p className="insp-note">10&nbsp;Mo&nbsp;: la limite d'envoi de Discord sans abonnement.</p>}
        {before > 0 && est && <BeforeAfter before={before} after={Math.min(before, est.bytes)} />}
        {q ? (
          <div className="quality" data-level={q.label}>
            <span className="quality-dot" aria-hidden="true" />
            <span><b>Qualité {q.label.toLowerCase()}</b> · {q.side}p, {q.videoKbps}&nbsp;kbit/s pour l'image</span>
          </div>
        ) : <p className="insp-note">Trop long pour cette taille&nbsp;: choisis plus grand.</p>}
        {before > 0 && est && before > est.bytes && <p className="insp-note tabular">Environ {Math.round((1 - est.bytes / before) * 100)}&nbsp;% de moins que le passage d'origine.</p>}
        {p.onSample && <button type="button" className="link-btn" onClick={p.onSample} disabled={!q}>Voir un échantillon réel de 2&nbsp;s</button>}
        {p.sample}
      </>
    );
  }

  return (
    <section className="insp" aria-labelledby="insp-title" data-inspector={tool}>
      <h2 id="insp-title" className="insp-title">{TOOL_TITLES[tool]}</h2>
      <div className="insp-body">{body}</div>
    </section>
  );
}

/**
 * Pied du panneau : ce que l'export produira (format, durée, taille), retouches venues d'autres outils, problème
 * bloquant, et le bouton d'export. Séparé des réglages (qui défilent au-dessus) : il ne les recouvre jamais.
 */
export function ExportFoot(p: {
  tool: Tool; edit: Edit; set(patch: Partial<Edit>): void; info: MediaInfo; limits: ToolsLimits | null;
  disabledReason?: string | null; exporting: boolean; onExport(): void; button(props: { className: string; children: ReactNode; disabled: boolean; onClick(): void }): ReactNode;
}) {
  const { tool, edit: e, info } = p;
  const len = outputLength(e);
  const est = estimateSize(tool, e, info);
  const out = outputDims(e, info, tool);
  const problem = p.disabledReason ?? exportProblem(tool, e, info, p.limits);
  const carried = carriedEdits(tool, e, info);
  return (
    <div className="insp-export" data-export-panel="">
      {carried.length > 0 && (
        <div className="insp-carried">
          <span className="insp-carried-label" id="insp-carried">Aussi appliqué</span>
          <ul className="insp-carried-list" aria-labelledby="insp-carried">
            {carried.map((c) => (
              <li key={c.id} className="carried">
                <span>{c.label}</span>
                <button type="button" className="carried-x" onClick={() => p.set(c.clear)} aria-label={`Retirer : ${c.label}`}><IconClose size={13} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="insp-sumline">
        <ul className="out-tags tabular" aria-label="Fichier exporté">
          {outputTags(tool, e, info, out).map((t) => <li key={t}>{t}</li>)}
        </ul>
        <dl className="insp-sum tabular">
          <div><dt>Durée exportée</dt><dd>{spanLabel(len)}</dd></div>
          <div><dt>{est?.exact ? "Taille" : "Taille estimée"}</dt><dd>{!est ? "—" : est.range ? bytesRange(est.range[0], est.range[1]) : `${est.exact ? "" : tool === "compresser" ? "≤ " : "≈ "}${bytes(est.bytes)}`}</dd></div>
        </dl>
      </div>
      {problem && <p className="insp-problem" role="status">{problem}</p>}
      {p.button({
        className: "export-btn",
        disabled: !!problem,
        onClick: () => { if (!p.exporting) p.onExport(); },
        children: (
          <>
            <span className="export-btn-sheen" aria-hidden="true" />
            <IconDownload size={19} className="relative" />
            <span className="relative">{p.exporting ? "Envoi…" : ACTION[tool]}</span>
          </>
        ),
      })}
    </div>
  );
}
