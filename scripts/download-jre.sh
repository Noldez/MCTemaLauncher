#!/usr/bin/env bash
# Fetch Temurin JRE 21 (linux x64) into assets/jre-linux for AppImage builds.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="assets/jre-linux"
URL="https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse"

if [ -x "$DEST/bin/java" ]; then
  echo "JRE already present at $DEST"
  exit 0
fi

rm -rf "$DEST" jre-linux.tar.gz
echo "Downloading Temurin JRE 21 (linux x64)..."
curl -sfL "$URL" -o jre-linux.tar.gz
mkdir -p "$DEST"
tar -xzf jre-linux.tar.gz -C "$DEST" --strip-components=1
rm jre-linux.tar.gz
"$DEST/bin/java" -version
echo "JRE ready at $DEST"
