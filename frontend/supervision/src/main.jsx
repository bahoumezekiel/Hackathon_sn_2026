import "@fasolink/shared/styles.css";
import "./supervision.css";
import { mountPortal } from "@fasolink/shared/ui";
import { session } from "./api";
import App from "./App";

mountPortal({
  session,
  role: "supervisor",
  roleLabel: "à la supervision et au délégué à la protection des données",
  portal: "Supervision",
  App,
});
