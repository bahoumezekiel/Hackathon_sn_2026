import "@fasolink/shared/styles.css";
import "./citizen.css";
import { mountPortal } from "@fasolink/shared/ui";
import { session } from "./api";
import App from "./App";

mountPortal({
  session,
  role: "citizen",
  roleLabel: "aux citoyens",
  portal: "Espace citoyen",
  App,
});
