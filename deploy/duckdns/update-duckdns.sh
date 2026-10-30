#!/usr/bin/env bash
set -euo pipefail

: "${DUCKDNS_DOMAIN:?Set DUCKDNS_DOMAIN without .duckdns.org}"
: "${DUCKDNS_TOKEN:?Set DUCKDNS_TOKEN from DuckDNS}"

curl --fail --silent --show-error \
  "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="
printf '\n'
