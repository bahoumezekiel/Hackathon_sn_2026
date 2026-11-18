<#import "template.ftl" as layout>
<#assign hasError = messagesPerField.existsError("username", "password")>
<@layout.registrationLayout displayMessage=!hasError; section>
  <#if section = "header">
    Connexion
  <#elseif section = "form">
    <p class="fl-lead">${layout.portal.lead}</p>

    <#if realm.password>
      <form id="kc-form-login" class="fl-form" action="${url.loginAction}" method="post" novalidate>
        <#if !usernameHidden??>
          <div class="fl-field">
            <label for="username" class="fl-visually-hidden">${layout.portal.userLabel}</label>
            <div class="fl-control">
              <@layout.icon name="user"/>
              <input id="username" name="username" class="fl-input" type="text" value="${(login.username)!""}"
                     placeholder="${layout.portal.userLabel}"
                     autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus
                     <#if hasError>aria-invalid="true" aria-describedby="login-error"</#if>>
            </div>
          </div>
        </#if>

        <div class="fl-field">
          <label for="password" class="fl-visually-hidden">${msg("password")}</label>
          <div class="fl-control">
            <@layout.icon name="lock"/>
            <input id="password" name="password" class="fl-input fl-input--reveal" type="password"
                   placeholder="${msg("password")}" autocomplete="current-password" required
                   <#if hasError>aria-invalid="true" aria-describedby="login-error"</#if>>
            <button type="button" class="fl-reveal" data-reveal="password" aria-controls="password"
                    aria-pressed="false" aria-label="Afficher le mot de passe">
              <span class="fl-reveal-show"><@layout.icon name="eye"/></span>
              <span class="fl-reveal-hide"><@layout.icon name="eye-off"/></span>
            </button>
          </div>
        </div>

        <#if hasError>
          <p id="login-error" class="fl-error" aria-live="polite">${kcSanitize(messagesPerField.getFirstError("username", "password"))?no_esc}</p>
        </#if>

        <input type="hidden" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>>
        <button type="submit" name="login" class="fl-btn fl-btn--primary fl-btn--block" data-busy-label="Connexion…">
          <@layout.icon name="log-in"/><span>Se connecter</span>
        </button>
      </form>

      <p class="fl-divider"><span>Ou</span></p>
      <button type="button" class="fl-btn fl-btn--secondary fl-btn--block" aria-expanded="false" aria-controls="forgot">
        <@layout.icon name="shield"/><span>Mot de passe oublié ?</span>
      </button>
      <div id="forgot" class="fl-forgot" hidden>
        <p>${layout.portal.forgot}</p>
      </div>
      <#-- Portail citoyen : inscription avec l'IUE (vérifié auprès de l'ONI, puis code SMS) -->
      <#if (client.clientId)! == "portal-citizen" && (client.baseUrl)?has_content>
        <a class="fl-btn fl-btn--secondary fl-btn--block fl-signup" href="${client.baseUrl}/inscription">
          <span>Pas encore de compte ? Créer mon compte avec mon IUE</span>
        </a>
      </#if>
    </#if>
  </#if>
</@layout.registrationLayout>
