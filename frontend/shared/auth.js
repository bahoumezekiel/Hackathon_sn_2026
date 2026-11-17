import Keycloak from "keycloak-js";

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || "http://localhost:8080";

/** Session Keycloak d'un portail : client public, Authorization Code + PKCE (S256).
 *  Les jetons restent en mémoire (jamais dans le stockage du navigateur). */
export function createSession(clientId) {
  const keycloak = new Keycloak({ url: KEYCLOAK_URL, realm: "fasolink", clientId });
  keycloak.onTokenExpired = () => keycloak.updateToken(30).catch(() => keycloak.login());

  return {
    init: () => keycloak.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false }),

    /** Jeton valable au moins 30 s ; sinon renvoie vers la connexion. */
    async token() {
      try {
        await keycloak.updateToken(30);
      } catch {
        await keycloak.login();
        throw new Error("Session expirée : reconnexion nécessaire.");
      }
      return keycloak.token;
    },

    hasRole: (role) => keycloak.hasRealmRole(role),

    user() {
      const t = keycloak.tokenParsed ?? {};
      const name = [t.given_name, t.family_name].filter(Boolean).join(" ");
      return { username: t.preferred_username, name: name || t.preferred_username, claims: t };
    },

    login: () => keycloak.login(),
    logout: () => keycloak.logout({ redirectUri: window.location.origin }),
    switchAccount: () => keycloak.login({ prompt: "login" }),
  };
}
