#!/usr/bin/env bash
set -euo pipefail

certificate_name="api-conjunto.nordikhat.com"
source_dir="/etc/letsencrypt/live/${certificate_name}"
target_dir="/etc/turnserver/tls"

install -d -o turnserver -g turnserver -m 0750 "${target_dir}"
install -o turnserver -g turnserver -m 0644 "${source_dir}/fullchain.pem" "${target_dir}/fullchain.pem"
install -o turnserver -g turnserver -m 0640 "${source_dir}/privkey.pem" "${target_dir}/privkey.pem"

systemctl try-reload-or-restart coturn.service
