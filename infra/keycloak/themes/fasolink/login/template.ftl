<#import "footer.ftl" as loginFooter>
<#--
  Gabarit FasoLink : identique au gabarit « base » de Keycloak 26 pour tout ce qui est
  fonctionnel (formulaires, messages, changement d'identifiant, essais d'autres méthodes),
  avec un habillage propre : panneau de marque + carte de connexion.
  Le contenu du panneau dépend du portail qui demande la connexion (client OIDC).
-->
<#assign cid = (client.clientId)!"">
<#if cid == "portal-citizen">
  <#assign portal = "citizen" portalName = "Mes données"
           lead = "Voyez quelle administration a consulté vos données, quand, pourquoi, et ce qui lui a été transmis."
           idHint = "Votre IUE, ou votre référence d'état civil si vous n'avez pas encore d'IUE."
           points = ["Vous n'apportez plus les pièces : les administrations les obtiennent directement.",
                     "Chaque consultation est inscrite dans un journal dont toute modification est détectée.",
                     "Vous pouvez signaler un accès que vous ne reconnaissez pas."]
           demo = "bf1998000123 · ec-fdg-2001-000222">
<#elseif cid == "portal-supervision">
  <#assign portal = "supervision" portalName = "Supervision"
           lead = "État des registres, flux des demandes, intégrité du journal d'audit et alertes citoyennes."
           idHint = "Compte du délégué à la protection des données."
           points = ["Aucune identité de citoyen n'est affichée dans les flux.",
                     "Le journal d'audit est chaîné par SHA-256.",
                     "Les alertes citoyennes arrivent en direct."]
           demo = "superviseur">
<#else>
  <#assign portal = "agent" portalName = "Guichet administration"
           lead = "Vérifiez les conditions d'une démarche sans demander de pièces à l'usager."
           idHint = "Compte d'agent habilité de votre administration."
           points = ["Vous ne recevez que ce que la loi vous autorise à connaître.",
                     "Chaque réponse est une attestation signée et vérifiable.",
                     "Chaque consultation est visible par le citoyen concerné."]
           demo = "agent-a · agent-recrutement · agent-casier · agent-concours · agent-nationalite">
</#if>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" data-portal="${portal}" lang="<#if realm.internationalizationEnabled>${locale.currentLanguageTag}<#else>fr</#if>">

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">
    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${msg("loginTitle",(realm.displayName!''))} · ${portalName}</title>
    <link rel="icon" type="image/svg+xml" href="${url.resourcesPath}/img/favicon.svg" />
    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        { "imports": { "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js" } }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";
        startSessionPolling("${url.ssoLoginInOtherTabsUrl?no_esc}");
    </script>
</head>

<body class="fl-body ${bodyClass}">
<div class="fl-shell">

    <aside class="fl-brand" aria-label="FasoLink">
        <div class="fl-brand__top">
            <span class="fl-logo">
                <svg width="36" height="36" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                    <rect width="32" height="32" rx="8" fill="#0b6e4f"/>
                    <rect y="16" width="32" height="16" fill="#0b5a41" opacity="0.55"/>
                    <path fill="#fcd116" d="M16 6.5l2.6 6.1 6.6.5-5 4.3 1.6 6.4L16 20.4l-5.8 3.4 1.6-6.4-5-4.3 6.6-.5z"/>
                </svg>
                <span class="fl-logo__name">FasoLink</span>
            </span>
            <span class="fl-brand__portal">${portalName}</span>
        </div>
        <div class="fl-brand__body">
            <p class="fl-brand__motto">Les pièces circulent entre administrations, pas les usagers entre guichets.</p>
            <p class="fl-brand__lead">${lead}</p>
            <ul class="fl-brand__points">
                <#list points as p><li>${p}</li></#list>
            </ul>
        </div>
        <p class="fl-brand__foot">Plateforme d'interopérabilité administrative · « Dites-le nous une fois »</p>
    </aside>

    <main class="fl-main">
    <div class="${properties.kcFormCardClass!} fl-card">
        <header class="${properties.kcFormHeaderClass!}">
            <#if realm.internationalizationEnabled && locale.supported?size gt 1>
                <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
                    <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                        <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                            <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                            <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                                <#assign i = 1>
                                <#list locale.supported as l>
                                    <li class="${properties.kcLocaleListItemClass!}" role="none">
                                        <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                                    </li>
                                    <#assign i++>
                                </#list>
                            </ul>
                        </div>
                    </div>
                </div>
            </#if>
            <span class="fl-card__eyebrow">${portalName}</span>
            <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                <h1 id="kc-page-title"><#nested "header"></h1>
                <p class="fl-card__hint">${idHint}</p>
            <#else>
                <#nested "show-username">
                <div id="kc-username" class="${properties.kcFormGroupClass!}">
                    <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">
                        <div class="kc-login-tooltip">
                            <i class="${properties.kcResetFlowIcon!}"></i>
                            <span class="kc-tooltip-text">${msg("restartLoginTooltip")}</span>
                        </div>
                    </a>
                </div>
            </#if>
        </header>

        <div id="kc-content">
            <div id="kc-content-wrapper">
                <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                    <div class="alert-${message.type} ${properties.kcAlertClass!} pf-m-<#if message.type = 'error'>danger<#else>${message.type}</#if>" role="alert">
                        <div class="pf-c-alert__icon">
                            <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}"></span></#if>
                            <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}"></span></#if>
                            <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}"></span></#if>
                            <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}"></span></#if>
                        </div>
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                </#if>

                <#nested "form">

                <#if auth?has_content && auth.showTryAnotherWayLink()>
                    <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                        <div class="${properties.kcFormGroupClass!}">
                            <input type="hidden" name="tryAnotherWay" value="on"/>
                            <a href="#" id="try-another-way"
                               onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                        </div>
                    </form>
                </#if>

                <#nested "socialProviders">

                <#if displayInfo>
                    <div id="kc-info" class="${properties.kcSignUpClass!}">
                        <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                            <#nested "info">
                        </div>
                    </div>
                </#if>
            </div>
        </div>

        <@loginFooter.content/>
    </div>

    <#if (properties.fasolinkDemo!"false") == "true">
        <aside class="fl-demo" aria-label="Comptes de démonstration">
            <b>Démonstration</b> · mot de passe <code>demo</code><br/>
            <span><#list demo?split(" · ") as d><span class="fl-demo__id">${d}</span><#sep> · </#list></span>
        </aside>
    </#if>
    </main>
</div>
</body>
</html>
</#macro>
