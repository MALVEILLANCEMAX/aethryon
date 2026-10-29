// Boutons AETHRYON, Égide v2 : les classes du socle (.eg-btn). Principal (l'or, une fois par vue : l'action de la page),
// secondaire (bord de contrôle), discret ; « danger » pour les actions destructives. Appui scale(.97), survol en
// couleur seulement (pointeur fin), aucun reflet animé. Les anciennes variantes restent des alias : « light » (ancien
// principal sur sombre) = principal, « night » et « ghost » = secondaire, « quiet » = discret.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../lib/cn.ts";

type Variant = "primary" | "secondary" | "light" | "night" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  sm: "min-h-10 px-4 text-ui gap-2",
  md: "min-h-11 px-5 text-ui gap-2.5",
  lg: "min-h-13 px-6 text-corps gap-3",
};

const variants: Record<Variant, string> = {
  primary: "eg-btn--principal",
  light: "eg-btn--principal",
  secondary: "eg-btn--secondaire",
  night: "eg-btn--secondaire",
  ghost: "eg-btn--secondaire",
  danger: "eg-btn--secondaire egw-btn-danger",
  quiet: "eg-btn--discret",
};

const base = "eg-btn group relative isolate select-none whitespace-nowrap";

function Spinner() {
  return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />;
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
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
      {trailing && <span className="inline-flex">{trailing}</span>}
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
