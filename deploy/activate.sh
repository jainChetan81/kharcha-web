#!/usr/bin/env bash
# Switch /srv/kharcha-web to an uploaded release; rolls back on failure.
# No Caddy: the app is reachable only through `tailscale serve` (tailnet-only HTTPS).
set -euo pipefail
release=$1
# --app-only (timer path): never install unit files from a fetched commit.
mode=${2:-}
cd /srv/kharcha-web
if ! test -r /etc/kharcha-web/env; then
  echo "MISSING /etc/kharcha-web/env — create it with INGEST_TOKEN before deploying." >&2
  exit 1
fi
old=$(readlink current || true)
config="/srv/kharcha-web/config-$release"
rollback() {
  if test -n "$old"; then
    ln -sfn "$old" restore && mv -Tf restore current
    sudo -n systemctl restart kharcha-web
  else
    # First install failed: nothing good to fall back to.
    rm -f current
    sudo -n systemctl stop kharcha-web || true
  fi
}
trap rollback ERR
if test "$mode" != --app-only; then
  sudo -n install -m 644 "$config/kharcha-web.service" "$config/kharcha-web-autodeploy.service" "$config/kharcha-web-autodeploy.timer" \
    "$config/kharcha-web-job@.service" "$config"/kharcha-web-job-*.timer /etc/systemd/system/
  sudo -n install -d -m 755 /usr/local/lib/kharcha-web
  sudo -n install -m 755 "$config/activate.sh" /usr/local/lib/kharcha-web/activate.sh
  install -m 755 "$config/autodeploy.sh" /srv/kharcha-web/autodeploy.sh
  sudo -n systemctl daemon-reload
  # Public site: own file, imported by the shared Caddyfile (owned by the odisha-travel repo).
  sudo -n install -d -m 755 /etc/caddy/sites.d
  sudo -n install -m 644 "$config/kharcha.caddy" /etc/caddy/sites.d/kharcha.caddy
  sudo -n caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  grep -q 'import sites.d/\*.caddy' /etc/caddy/Caddyfile || echo "WARN: /etc/caddy/Caddyfile lacks 'import sites.d/*.caddy'; public site not served." >&2
fi
if test -n "$old"; then ln -sfn "$old" previous; fi
ln -sfn "releases/$release" next
mv -Tf next current
sudo -n systemctl enable kharcha-web.service
sudo -n systemctl restart kharcha-web.service
curl --fail --silent --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:8790/api/health -o /dev/null
trap - ERR
test "$mode" = --app-only || sudo -n systemctl reload caddy
# Timer starts only after a good activation, so first install never races its own build.
test "$mode" = --app-only || sudo -n systemctl enable --now kharcha-web-autodeploy.timer kharcha-web-job-{prices,detectors,digest}.timer
