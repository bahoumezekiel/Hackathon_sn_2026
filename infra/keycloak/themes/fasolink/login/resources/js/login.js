// Mot de passe affiché/masqué, procédure « mot de passe oublié », état « en cours » (aucune dépendance).
for (const button of document.querySelectorAll("[data-reveal]")) {
  const input = document.getElementById(button.dataset.reveal);
  button.addEventListener("click", () => {
    const shown = input.type === "text";
    input.type = shown ? "password" : "text";
    button.setAttribute("aria-pressed", String(!shown));
    button.setAttribute("aria-label", shown ? "Afficher le mot de passe" : "Masquer le mot de passe");
    input.focus();
  });
}

for (const button of document.querySelectorAll("[aria-controls='forgot']")) {
  const panel = document.getElementById("forgot");
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
  });
}

for (const form of document.forms) {
  form.addEventListener("submit", () => {
    const submit = form.querySelector("[type=submit]");
    if (!submit) return;
    submit.disabled = true;
    const label = submit.querySelector("span") ?? submit;
    if (submit.dataset.busyLabel) label.textContent = submit.dataset.busyLabel;
  });
}
