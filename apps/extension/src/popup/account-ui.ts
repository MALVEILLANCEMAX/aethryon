// Connexion, déconnexion et notice sur les données : mêmes contrôles dans le popup, la page de réglages et la
// page d'accueil. La connexion passe par le service worker (chrome.identity.launchWebAuthFlow, PKCE) : ici,
// seulement l'attente honnête (« une fenêtre s'ouvre ») et la cause d'un échec, telle que le service worker
// l'a établie (fenêtre fermée, réseau, service pas encore déployé ou indisponible, refus, compte suspendu,
// trop d'extensions liées…), avec l'action utile quand il y en a une.
// La déconnexion demande une confirmation en ligne ; le focus va à l'option sans conséquence.
import { KEYS_URL } from "../shared/config.ts";
import type { WelcomeSection } from "../shared/messages.ts";
import type { AccountView, JobError } from "../shared/types.ts";
import { send } from "./bg.ts";
import { NB } from "./text.ts";
import { button, fill, h, icon, setBusy, siteLink } from "./ui.ts";

/** Ouvre la page d'accueil de l'extension (notice sur les données, connexion) dans un onglet. */
export function openWelcome(section?: WelcomeSection): Promise<unknown> {
  return send<unknown>(section ? { type: "welcome.open", section } : { type: "welcome.open" }, 5_000);
}

/** Action proposée sous un message d'échec de connexion (ou rien). */
function errorAction(e: JobError): HTMLElement | null {
  if (e.code === "too_many_extensions") return siteLink(`Ouvrir «${NB}Mes jetons${NB}»`, KEYS_URL, { className: "btn btn-secondary btn-sm", icon: "external" });
  if (e.code === "consent_required") {
    const b = button("Lire la notice", { variant: "secondary", size: "sm", action: "open-notice" });
    b.addEventListener("click", () => void openWelcome("donnees"));
    return b;
  }
  return null;
}

export function loginControl(opts: {
  onSuccess: () => void | Promise<void>; onError?: (e: JobError) => void; size?: "md" | "lg"; block?: boolean; describedBy?: string;
  /** Notice pas encore acceptée : bouton désactivé, raison écrite et lien vers la notice. */
  locked?: boolean;
}): HTMLElement {
  const status = h("p", { class: "login-status", role: "status" });
  const error = h("p", { class: "form-error", role: "alert" });
  const actions = h("div", { class: "login-actions" });
  const lockedId = "login-locked";
  const describedBy = [opts.describedBy, opts.locked ? lockedId : null].filter(Boolean).join(" ") || undefined;
  const btn = button("Se connecter à AETHRYON", { variant: "primary", size: opts.size ?? "lg", block: opts.block, action: "login", describedBy });
  btn.disabled = !!opts.locked;
  btn.addEventListener("click", async () => {
    if (btn.getAttribute("aria-busy") === "true" || btn.disabled) return;
    error.textContent = "";
    actions.replaceChildren();
    setBusy(btn, true, "Connexion en cours…");
    status.textContent = `Une fenêtre AETHRYON s'ouvre${NB}: connecte-toi, puis autorise l'extension.`;
    // Pas de délai : l'utilisateur prend le temps qu'il faut dans la fenêtre de connexion.
    const res = await send<unknown>({ type: "auth.login" });
    if (res.ok) {
      status.textContent = "Connecté.";
      await opts.onSuccess();
      return;
    }
    setBusy(btn, false);
    status.textContent = "";
    error.textContent = res.error.message;
    const action = errorAction(res.error);
    if (action) actions.append(action);
    opts.onError?.(res.error);
  });
  const locked = opts.locked
    ? h("p", { class: "hint", id: lockedId }, icon("lock", 15), h("span", null, `Accepte d'abord la notice sur les données${NB}: c'est elle qui permet la connexion.`))
    : null;
  return h("div", { class: "login" }, btn, locked, status, error, actions);
}

/**
 * Notice sur les données pas encore acceptée (premier lancement, ou notice modifiée) : rien ne part vers un
 * serveur tant que l'utilisateur ne l'a pas lue et acceptée sur la page d'accueil.
 */
export function consentGate(opts: { compact?: boolean } = {}): HTMLElement {
  const read = button("Lire la notice et accepter", { variant: "primary", size: opts.compact ? "md" : "lg", block: !opts.compact, icon: "shield", action: "open-notice" });
  const status = h("p", { class: "login-status", role: "status" });
  read.addEventListener("click", async () => {
    setBusy(read, true, "Ouverture…");
    const r = await send<{ opened?: boolean }>({ type: "welcome.open", section: "donnees" }, 5_000);
    setBusy(read, false);
    status.textContent = r.ok ? "La notice s'ouvre dans un nouvel onglet." : r.error.message;
  });
  return h("div", { class: "gate" }, read, status);
}

export function logoutControl(onSuccess: () => void | Promise<void>): HTMLElement {
  const area = h("div", { class: "logout" });

  const showButton = (focus: boolean) => {
    const b = button("Se déconnecter", { variant: "quiet", size: "sm", icon: "logout", action: "logout" });
    b.addEventListener("click", ask);
    fill(area, b);
    if (focus) b.focus();
  };

  function ask(): void {
    const error = h("p", { class: "form-error", role: "alert" });
    const yes = button("Se déconnecter", { variant: "danger", size: "sm", action: "logout-confirm" });
    const no = button("Annuler", { variant: "secondary", size: "sm", action: "logout-cancel" });
    const box = h("div", { class: "confirm", role: "group", "aria-labelledby": "logout-q", "aria-describedby": "logout-d" },
      h("p", { id: "logout-q", class: "confirm-q" }, `Se déconnecter de ce navigateur${NB}?`),
      h("p", { id: "logout-d", class: "hint" }, "L'accès de l'extension à ton compte sera révoqué et la liste des téléchargements effacée. Tu pourras te reconnecter à tout moment."),
      h("div", { class: "confirm-actions" }, yes, no),
      error);
    no.addEventListener("click", () => showButton(true));
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && yes.getAttribute("aria-busy") !== "true") {
        e.preventDefault();
        e.stopPropagation();
        showButton(true);
      }
    });
    yes.addEventListener("click", async () => {
      if (yes.getAttribute("aria-busy") === "true") return;
      error.textContent = "";
      setBusy(yes, true, "Déconnexion…");
      no.disabled = true;
      const res = await send<unknown>({ type: "auth.logout" }, 20_000);
      if (res.ok) {
        await onSuccess();
        return;
      }
      setBusy(yes, false);
      no.disabled = false;
      error.textContent = res.error.message;
    });
    fill(area, box);
    no.focus(); // l'option sans conséquence reçoit le focus
  }

  showButton(false);
  return area;
}

/** Identité du compte : initiale, nom, adresse (données affichées telles quelles). */
export function identity(a: AccountView): HTMLElement {
  const name = a.name?.trim();
  const email = a.email?.trim();
  const display = name || email || "Compte AETHRYON";
  const initial = (/[\p{L}\p{N}]/u.exec(display)?.[0] ?? "A").toLocaleUpperCase("fr-FR");
  return h("div", { class: "identity" },
    h("span", { class: "avatar", "aria-hidden": "true" }, initial),
    h("div", { class: "identity-text" },
      h("p", { class: "identity-name", dir: "auto", "data-raw": "" }, display),
      name && email ? h("p", { class: "identity-email", "data-raw": "" }, email) : null));
}
