#!/usr/bin/env bash
# Switch /srv/kharcha-web to an uploaded release; rolls back on failure.
# No Caddy: the app is reachable only through `tailscale serve` (tailnet-only HTTPS).
set -euo pipefail
release=$1
# --app-only (timer path): never install unit files from a fetched commit.
mode=${2:-}
cd /srv/kharcha-web
if ! sudo test -f /etc/kharcha-web/env; then
  echo "MISSING /etc/kharcha-web/env — create it with INGEST_TOKEN before deploying." >&2
  exit 1
fi
old=$(readlink current || true)
config="/srv/kharcha-web/config-$release"
rollback() {
  if test -n "$old"; then ln -sfn "$old" restore && mv -Tf restore current; fi
  if test -f current/server/index.mjs; then sudo systemctl restart kharcha-web; else sudo systemctl stop kharcha-web || true; fi
}
trap rollback ERR
if test "$mode" != --app-only; then
  sudo install -m 644 "$config/kharcha-web.service" "$config/kharcha-web-autodeploy.service" "$config/kharcha-web-autodeploy.timer" /etc/systemd/system/
  sudo install -d -m 755 /usr/local/lib/kharcha-web
  sudo install -m 755 "$config/activate.sh" /usr/local/lib/kharcha-web/activate.sh
  install -m 755 "$config/autodeploy.sh" /srv/kharcha-web/autodeploy.sh
  sudo systemctl daemon-reload
  sudo systemctl enable --now kharcha-web-autodeploy.timer
fi
if test -n "$old"; then ln -sfn "$old" previous; fi
ln -sfn "releases/$release" next
mv -Tf next current
sudo systemctl enable kharcha-web.service
sudo systemctl restart kharcha-web.service
curl --fail --silent --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:8790/ -o /dev/null
trap - ERR
