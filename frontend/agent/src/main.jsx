import "@fasolink/shared/styles.css";
import "./agent.css";
import { mountPortal } from "@fasolink/shared/ui";
import { session } from "./api";
import App from "./App";

mountPortal({
  session,
  role: "agent",
  roleLabel: "aux agents des administrations",
  portal: "Portail administration",
  App,
});
