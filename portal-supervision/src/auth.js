import Keycloak from "keycloak-js";

// Client public « portal-supervision » : Authorization Code + PKCE
export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || "http://localhost:8080",
  realm: "fasolink",
  clientId: "portal-supervision",
});

export async function initAuth() {
  await keycloak.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false });
  setInterval(() => keycloak.updateToken(60).catch(() => keycloak.login()), 30_000);
}

export const hasRole = (role) => (keycloak.tokenParsed?.realm_access?.roles || []).includes(role);
export const username = () => keycloak.tokenParsed?.preferred_username;
export const logout = () => keycloak.logout({ redirectUri: window.location.origin });
export const switchAccount = () => keycloak.login({ prompt: "login" });
