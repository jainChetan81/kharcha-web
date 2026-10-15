#!/usr/bin/env bash
# Timer job on the VPS: build and activate origin/main when it changes.
# Private repo: clone/fetch use the chetan user's gh credential helper.
set -euo pipefail
root=/srv/kharcha-web
src=/var/cache/kharcha-web/src
exec 9>/var/cache/kharcha-web/lock
flock -n 9 || exit 0
if test ! -d "$src/.git"; then
  git clone -q --filter=blob:none https://github.com/jainChetan81/kharcha-web.git "$src"
fi
cd "$src"
git fetch -q origin main
head=$(git rev-parse origin/main)
release=${head:0:12}
test -e "$root/releases/$release" && exit 0
# A commit that failed once is not retried every tick; the next merge gets a fresh try.
failed=/var/cache/kharcha-web/failed
test "$(cat "$failed" 2>/dev/null)" = "$head" && exit 0
echo "$head" >"$failed"
git reset -q --hard "$head"
git clean -qfdx
npm ci --no-audit --no-fund --loglevel=error
npm run build >/dev/null
rm -rf "$root/.staging"
mkdir -p "$root/.staging/config"
cp -a .output "$root/.staging/release"
cp deploy/* "$root/.staging/config/"
mv "$root/.staging/config" "$root/config-$release"
mv "$root/.staging/release" "$root/releases/$release"
rmdir "$root/.staging"
bash /usr/local/lib/kharcha-web/activate.sh "$release" --app-only
cd "$root"
keep=$(printf '%s\n' "$(basename "$(readlink current)")" "$(basename "$(readlink previous)")"; ls -t releases | head -3)
for dir in releases/* config-*; do
  name=$(basename "$dir"); name=${name#config-}
  grep -qx "$name" <<<"$keep" || rm -rf "$dir"
done
rm -f "$failed"
echo "Deployed $release"
