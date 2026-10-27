// /inscription : fin de l'inscription par le LIEN de l'e-mail (account, src/signup.ts) — l'autre porte que le code à
// 6 chiffres de /commencer, qui mène à la même étape (app/inscription/Parcours.tsx, ProfileStep). Le jeton arrive après
// le « # » du lien reçu (jamais envoyé au serveur par le navigateur, donc dans aucun journal) ; il est lu une fois puis
// retiré de l'adresse. La page vérifie le lien (adresse visée), puis demande le nom et le mot de passe (même politique
// que le serveur, jauge de solidité) ; le compte est créé et la session ouverte, direction l'espace. Lien expiré ou
// déjà utilisé : on le dit, avec le chemin pour recommencer.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { checkSignupToken, takeHashToken } from "../lib/auth.ts";
import { ApiError } from "../lib/api.ts";
import { useDocumentTitle } from "../lib/hooks.ts";
import { FormNote } from "../ui/Field.tsx";
import { IconAlert } from "../ui/Icon.tsx";
import { Skeleton } from "../ui/bits.tsx";
import { CompteCarte } from "./CompteCarte.tsx";
import { ProfileStep } from "./inscription/Parcours.tsx";

const link = "font-medium text-gold-text underline decoration-gold/50 underline-offset-4 hover:decoration-gold-text";
const NB = " ";

export default function Inscription() {
  useDocumentTitle("Termine ton inscription");
  const [token] = useState(takeHashToken);
  const [email, setEmail] = useState<string | null>(null);
  const [check, setCheck] = useState<"loading" | "ok" | "invalid" | "error">(token ? "loading" : "invalid");

  useEffect(() => {
    if (!token) return;
    let live = true;
    checkSignupToken(token).then(
      (e) => { if (live) { setEmail(e); setCheck("ok"); } },
      (e) => { if (live) setCheck(e instanceof ApiError && e.status === 400 ? "invalid" : "error"); },
    );
    return () => { live = false; };
  }, [token]);

  if (check === "invalid") {
    return (
      <CompteCarte data="inscription-invalide" title="Ce lien n'est plus valable" lead={`Un lien d'inscription sert une seule fois et 30 minutes au plus. Demande un nouveau code${NB}: c'est immédiat.`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/commencer" className="inline-flex h-12 items-center rounded-full bg-sunken px-6 text-[15.5px] font-medium text-fg">Recevoir un nouveau code</Link>
          <Link to="/connexion" className={`${link} inline-flex min-h-11 items-center text-[15px]`}>Se connecter</Link>
        </div>
      </CompteCarte>
    );
  }
  return (
    <CompteCarte data={check === "ok" ? "inscription" : `inscription-${check}`} title="Termine ton inscription">
      {check === "loading" ? (
        <div aria-busy="true" aria-label="Vérification du lien"><Skeleton className="h-12 w-full" /><Skeleton className="mt-4 h-12 w-full" /><Skeleton className="mt-6 h-12 w-40" /></div>
      ) : check === "error" ? (
        <FormNote tone="bad" icon={<IconAlert size={18} />}>Le serveur n'a pas répondu. Recharge la page{NB}: ton lien reste valable 30 minutes.</FormNote>
      ) : (
        <ProfileStep token={token!} email={email ?? ""} titled={false} onExpired={() => setCheck("invalid")} />
      )}
    </CompteCarte>
  );
}
