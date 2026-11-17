<#-- Contexte du portail qui demande la connexion (un client Keycloak par portail) -->
<#assign portals = {
  "portal-agent": {
    "lead": "Accédez à votre espace agent",
    "userLabel": "Identifiant agent",
    "forgot": "Adressez-vous à l'administrateur des comptes de votre service : il réinitialise votre accès après vérification de votre identité."
  },
  "portal-citizen": {
    "lead": "Accédez à votre espace personnel",
    "userLabel": "IUE ou référence d'acte",
    "forgot": "Présentez-vous au guichet d'une administration avec votre IUE ou votre acte d'état civil : un agent réinitialise votre accès sur place."
  },
  "portal-supervision": {
    "lead": "Accédez à l'espace de supervision",
    "userLabel": "Identifiant",
    "forgot": "Contactez l'administrateur de la plateforme FasoLink : la réinitialisation d'un compte de supervision est tracée au journal d'audit."
  }
}>
<#assign portal = portals[(client.clientId)!""]!{
  "lead": "Accédez à votre espace", "userLabel": "Identifiant",
  "forgot": "Contactez l'administrateur de votre service."
}>

<#-- Pictogrammes au trait (Lucide, licence ISC), intégrés pour ne dépendre d'aucune police d'icônes -->
<#macro icon name>
  <svg class="fl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <#switch name>
    <#case "user"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/><#break>
    <#case "lock"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><#break>
    <#case "eye"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/><#break>
    <#case "eye-off"><path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/><path d="m2 2 20 20"/><#break>
    <#case "log-in"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><#break>
    <#case "shield"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/><#break>
    <#case "zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/><#break>
    <#case "handshake"><path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/><#break>
  </#switch>
  </svg>
</#macro>

<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <#list (properties.meta!"")?split(" ") as meta>
    <#if meta?contains("==")><meta name="${meta?split("==")[0]}" content="${meta?split("==")[1]}"></#if>
  </#list>
  <title>Connexion · FasoLink</title>
  <link rel="icon" href="${url.resourcesPath}/img/favicon.png" type="image/png">
  <link rel="preload" href="${url.resourcesPath}/fonts/poppins-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${url.resourcesPath}/fonts/poppins-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${url.resourcesPath}/img/monument-photo.webp" as="image" type="image/webp">
  <#list (properties.styles!"")?split(" ") as style>
    <link rel="stylesheet" href="${url.resourcesPath}/${style}">
  </#list>
  <script type="module" src="${url.resourcesPath}/js/login.js"></script>
  <script type="module">
    import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";
    startSessionPolling("${url.ssoLoginInOtherTabsUrl?no_esc}");
  </script>
</head>

<body class="${properties.kcBodyClass!} ${bodyClass}">
<div class="fl-page">
  <aside class="fl-visual" aria-label="Présentation de FasoLink">
    <div class="fl-photo"></div>
    <svg class="fl-flag" viewBox="0 0 420 280" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
      <path class="fl-flag-red" d="M0 0h360C250 34 128 104 0 196Z"/>
      <path class="fl-flag-gold" d="M0 196C128 104 250 34 360 0h30C268 44 140 122 0 222Z"/>
      <path class="fl-flag-green" d="M0 222C140 122 268 44 390 0h30C292 58 152 150 0 262Z"/>
    </svg>
    <svg class="fl-swoosh" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 18C180 22 360 60 600 120" pathLength="1"/>
    </svg>

    <div class="fl-pitch">
      <p class="fl-headline">Une administration plus proche de vous</p>
      <p class="fl-tagline">Connectez-vous pour accéder à vos services en toute sécurité.</p>
      <ul class="fl-features">
        <li><@icon name="shield"/><span>Sécurité<br>renforcée</span></li>
        <li><@icon name="zap"/><span>Accès<br>rapide</span></li>
        <li><@icon name="handshake"/><span>Service<br>de qualité</span></li>
      </ul>
    </div>
  </aside>

  <main class="fl-main">
    <div class="fl-card">
      <img class="fl-logo" src="${url.resourcesPath}/img/logo.webp" width="560" height="298" alt="FasoLink, réseau numérique des administrations du Burkina Faso">
      <h1 class="fl-title"><#nested "header"></h1>

      <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
        <div class="fl-identity">
          <span>${auth.attemptedUsername}</span>
          <a href="${url.loginRestartFlowUrl}">Changer de compte</a>
        </div>
      </#if>

      <#if displayMessage && message?has_content && (message.type != "warning" || !isAppInitiatedAction??)>
        <div class="fl-alert fl-alert--${message.type}" role="alert">${kcSanitize(message.summary)?no_esc}</div>
      </#if>

      <#nested "form">

      <#if auth?has_content && auth.showTryAnotherWayLink()>
        <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
          <input type="hidden" name="tryAnotherWay" value="on">
          <button type="submit" class="fl-link">${msg("doTryAnotherWay")}</button>
        </form>
      </#if>

      <#if displayInfo><div class="fl-info"><#nested "info"></div></#if>
    </div>
  </main>
</div>
</body>
</html>
</#macro>
