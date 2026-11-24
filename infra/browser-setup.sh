#!/usr/bin/env bash
# Headless Chromium for scripts/browser-proof.mjs on a Debian container without root:
# downloads Playwright's Chromium and the shared libraries it needs into infra/.cache (no apt install).
set -euo pipefail
cd "$(dirname "$0")/.."
npx playwright-core install chromium-headless-shell
D=infra/.cache/chromium-libs
mkdir -p "$D/apt/state/lists/partial" "$D/apt/cache/archives/partial" "$D/debs" "$D/root"
APT="-o Dir::State=$PWD/$D/apt/state -o Dir::Cache=$PWD/$D/apt/cache -o Dir::State::status=/var/lib/dpkg/status"
apt-get $APT update >/dev/null
(cd "$D/debs" && apt-get $APT download libnspr4 libnss3 libatk1.0-0t64 libdbus-1-3 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2t64 libatspi2.0-0t64 libdrm2 libxi6 >/dev/null)
for f in "$D"/debs/*.deb; do dpkg -x "$f" "$D/root"; done
echo "done; browser-proof.mjs picks up $D automatically"
