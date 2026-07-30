#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

deployment_dir=/home/jomertz/services/mertz-markdown-sync
site_name=sync.markdown.mysolon.gr

install -m 0644 "$deployment_dir/deploy/nginx-sync.conf" "/etc/nginx/sites-available/$site_name"
ln -sfn "/etc/nginx/sites-available/$site_name" "/etc/nginx/sites-enabled/$site_name"

nginx -t
systemctl reload nginx

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  -d "$site_name"

nginx -t
systemctl reload nginx

echo "Nginx and TLS are ready for $site_name"
