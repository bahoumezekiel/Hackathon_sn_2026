import "@fasolink/shared/styles.css";
import "./supervision.css";
import { mountPortal } from "@fasolink/shared/ui";
import { session } from "./api";
import App from "./App";

mountPortal({
  session,
  role: ["supervisor", "platform_admin"],
  roleLabel: "à la supervision, au délégué à la protection des données et à l'administrateur de la plateforme",
  portal: "Supervision",
  App,
});
