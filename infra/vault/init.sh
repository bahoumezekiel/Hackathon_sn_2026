#!/bin/sh
# Configure Vault pour FasoLink : moteur Transit (les clés ne sortent jamais de Vault)
# et jeton à privilèges minimaux pour la passerelle.
set -e

vault secrets enable transit 2>/dev/null || echo "transit déjà activé"

# Chiffrement de l'IUE et des références locales
vault write -f transit/keys/fasolink-pii type=aes256-gcm96 >/dev/null
# Empreintes HMAC pour rechercher sans déchiffrer
vault write -f transit/keys/fasolink-fingerprint type=aes256-gcm96 >/dev/null
# Signature des attestations (EdDSA / JWS)
vault write -f transit/keys/fasolink-attestation type=ed25519 >/dev/null

vault policy write fasolink-gateway - <<'EOF'
path "transit/encrypt/fasolink-pii"                 { capabilities = ["update"] }
path "transit/decrypt/fasolink-pii"                 { capabilities = ["update"] }
path "transit/hmac/fasolink-fingerprint/*"          { capabilities = ["update"] }
path "transit/sign/fasolink-attestation"            { capabilities = ["update"] }
path "transit/keys/fasolink-attestation"            { capabilities = ["read"] }
EOF

vault token create -id="$VAULT_GATEWAY_TOKEN" -policy=fasolink-gateway -period=24h \
  -display-name=fasolink-gateway >/dev/null 2>&1 || echo "jeton passerelle déjà créé"

echo "Vault prêt : transit (pii, fingerprint, attestation) + politique fasolink-gateway"
