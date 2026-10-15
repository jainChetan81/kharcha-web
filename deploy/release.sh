#!/usr/bin/env bash
# Manual first install / unit-file updates from the Mac. Timer handles routine deploys.
set -euo pipefail
cd "$(dirname "$0")/.."
test -z "$(git status --porcelain)" || { echo 'Commit intended source changes before deploying.' >&2; exit 1; }
npm run build
release=$(git rev-parse --short=12 HEAD)
target=chetan@vps.bullhead-mine.ts.net
ssh_key="$HOME/.ssh/id_ed25519_hostinger"
ssh -i "$ssh_key" "$target" "sudo install -d -o chetan -g chetan /srv/kharcha-web/releases && test ! -e /srv/kharcha-web/releases/$release && mkdir -p /srv/kharcha-web/releases/$release /srv/kharcha-web/config-$release"
rsync -az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e "ssh -i $ssh_key" .output/ "$target:/srv/kharcha-web/releases/$release/"
rsync -az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e "ssh -i $ssh_key" deploy/ "$target:/srv/kharcha-web/config-$release/"
ssh -i "$ssh_key" "$target" bash "/srv/kharcha-web/config-$release/activate.sh" "$release"
echo "Deployed $release"
