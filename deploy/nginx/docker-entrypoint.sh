#!/bin/sh
set -eu

: "${DOMAIN:?DOMAIN env var is required}"

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_FILE="${CERT_DIR}/fullchain.pem"
KEY_FILE="${CERT_DIR}/privkey.pem"

TEMPLATE_HTTP="/etc/nginx/templates/default.http.conf.template"
TEMPLATE_HTTPS="/etc/nginx/templates/default.https.conf.template"
OUTPUT="/etc/nginx/conf.d/default.conf"

if [ -f "${CERT_FILE}" ] && [ -f "${KEY_FILE}" ]; then
  envsubst '${DOMAIN}' < "${TEMPLATE_HTTPS}" > "${OUTPUT}"
else
  envsubst '${DOMAIN}' < "${TEMPLATE_HTTP}" > "${OUTPUT}"
fi

exec "$@"
