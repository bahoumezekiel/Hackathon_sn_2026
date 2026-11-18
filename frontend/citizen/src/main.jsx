import "@fasolink/shared/styles.css";
import "./citizen.css";
import { mountPortal, mountPublic } from "@fasolink/shared/ui";
import { session } from "./api";
import App from "./App";
import Inscription from "./Inscription";
import Telephone from "./Telephone";

const path = window.location.pathname;
if (path.startsWith("/inscription")) {
  // Page publique : un citoyen sans compte s'inscrit avec son IUE
  mountPublic(Inscription);
} else if (path.startsWith("/telephone")) {
  // Démonstration : téléphone simulé d'un usager sans accès au web (SMS de consentement)
  mountPublic(Telephone);
} else {
  mountPortal({
    session,
    role: "citizen",
    roleLabel: "aux citoyens",
    portal: "Espace citoyen",
    App,
  });
}
