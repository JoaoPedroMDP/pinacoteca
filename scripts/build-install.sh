#!/usr/bin/env bash
# Valida, empacota e instala globalmente a versao local mais recente do CLI
# pinacoteca. Ver openspec/changes/build-install-script/design.md.
set -eu -o pipefail

cd "$(dirname "$0")/.."

npm run check

PACKAGE_FILE="$(npm pack | tail -n 1)"
trap 'rm -f "$PACKAGE_FILE"' EXIT

npm install -g "$PACKAGE_FILE"
