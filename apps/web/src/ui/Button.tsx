// Boutons AETHRYON : pilules. Principal obsidienne ; au survol, un reflet champagne le traverse une
// fois (transform seul), la flèche avance de 2 px et le bouton s'élève d'un pixel. Variante « light »
// (ivoire) pour les sections sombres, « night » (contour) en secondaire sur sombre.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../lib/cn.ts";

type Variant = "primary" | "secondary" | "light" | "night" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-[14.5px] gap-2",
  md: "h-12 px-5 text-[15.5px] gap-2.5",
  lg: "h-14 px-7 text-[16.5px] gap-3",
};

const variants: Record<Variant, string> = {
  primary: "bg-obsidian text-ivory shadow-button hover:-translate-y-px hover:bg-[#1c1c1e]",
  secondary: "border border-line-strong bg-ivory/60 text-ink hover:border-beige hover:bg-pearl",
  light: "bg-ivory text-obsidian shadow-[0_10px_30px_-14px_rgb(0_0_0/0.8)] hover:-translate-y-px hover:bg-white",
  night: "border border-white/15 text-ivory hover:border-white/30 hover:bg-white/[0.06]",
  ghost: "border border-line text-ink hover:border-line-strong hover:bg-pearl/70",
  danger: "border border-bad/25 bg-bad-bg text-bad hover:border-bad/45",
  quiet: "text-ink-soft hover:bg-sand/50 hover:text-ink",
};

const base =
  "group relative isolate inline-flex select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-full font-medium tracking-[-0.005em] " +
  "transition-[background-color,border-color,color,translate,box-shadow,scale] duration-200 ease-[var(--ease-soft)] " +
  "active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

function Spinner() {
  return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />;
}

/** Reflet champagne qui traverse le bouton principal au survol (une fois, transform uniquement). */
function Sheen() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
      <span className="absolute inset-y-0 left-0 w-1/2 -translate-x-[120%] skew-x-[-20deg] bg-[linear-gradient(90deg,transparent,rgb(227_205_166/0.28),transparent)] transition-transform duration-700 ease-[var(--ease-soft)] group-hover:translate-x-[260%] motion-reduce:hidden" />
    </span>
  );
}

interface CommonProps {
  variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; trailing?: ReactNode;
  /** Conservé pour compatibilité : le reflet est automatique sur le bouton principal. */
  shimmer?: boolean;
  className?: string; children?: ReactNode;
}

function Inner({ variant, icon, trailing, loading, children }: Pick<CommonProps, "variant" | "icon" | "trailing" | "loading" | "children">) {
  return (
    <>
      {(variant === "primary" || variant === "light") && <Sheen />}
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
      {trailing && <span className="inline-flex transition-transform duration-200 ease-[var(--ease-soft)] group-hover:translate-x-0.5">{trailing}</span>}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, CommonProps & ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ variant = "secondary", size = "md", loading, icon, trailing, shimmer: _s, className, children, disabled, type = "button", onClick, ...rest }, ref) => (
    // Pendant un chargement : aria-disabled + aria-busy, PAS disabled (un bouton désactivé peut perdre le focus
    // clavier) ; le clic est ignoré jusqu'à la fin.
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cn(base, sizes[size], variants[variant], loading && "cursor-progress", className)}
      {...rest}
    >
      <Inner variant={variant} icon={icon} trailing={trailing} loading={loading}>{children}</Inner>
    </button>
  ),
);
Button.displayName = "Button";

export function ButtonLink({ variant = "secondary", size = "md", icon, trailing, shimmer: _s, className, children, ...rest }: CommonProps & LinkProps) {
  return (
    <Link className={cn(base, sizes[size], variants[variant], className)} {...rest}>
      <Inner variant={variant} icon={icon} trailing={trailing}>{children}</Inner>
    </Link>
  );
}

/** Lien externe ou téléchargement avec l'apparence d'un bouton. */
export function ButtonA({ variant = "secondary", size = "md", icon, trailing, shimmer: _s, className, children, ...rest }: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn(base, sizes[size], variants[variant], className)} {...rest}>
      <Inner variant={variant} icon={icon} trailing={trailing}>{children}</Inner>
    </a>
  );
}
