// Page inconnue dans le Control Center.
import { ButtonLink } from "../../ui/Button.tsx";
import { AdminPage, EmptyState } from "../ui.tsx";

export default function AdminNotFound() {
  return (
    <AdminPage title="Page introuvable">
      <EmptyState title="Cette page n'existe pas dans le Control Center">
        <p>Vérifie l'adresse, ou reviens à la vue d'ensemble.</p>
        <ButtonLink to="/admin" variant="primary" className="mt-4">Vue d'ensemble</ButtonLink>
      </EmptyState>
    </AdminPage>
  );
}
