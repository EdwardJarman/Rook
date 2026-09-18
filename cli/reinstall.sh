#!/usr/bin/env sh
# Rook CLI reinstall (macOS/Linux): removes the installed copy, then
# installs fresh. Your sign-in is kept (config dir untouched).
#
#   From a checkout:   ./cli/reinstall.sh
#   From anywhere:     curl -fsSL https://raw.githubusercontent.com/EdwardJarman/Rook/main/cli/reinstall.sh | sh
set -eu

BIN_DIR="${ROOK_BIN_DIR:-$HOME/.local/bin}"
REPO="https://github.com/EdwardJarman/Rook.git"
REF="${ROOK_REF:-main}"

for name in rook rook.cjs rook.exe; do
  if [ -f "$BIN_DIR/$name" ]; then
    rm -f "$BIN_DIR/$name"
    echo "rook reinstall: removed $BIN_DIR/$name"
  fi
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/install.sh" ]; then
  echo "rook reinstall: installing from this checkout..."
  sh "$SCRIPT_DIR/install.sh"
else
  echo "rook reinstall: fetching the installer..."
  TMP="$(mktemp -d)/rook-reinstall.sh"
  curl -fsSL "https://raw.githubusercontent.com/EdwardJarman/Rook/$REF/cli/install.sh" -o "$TMP"
  sh "$TMP"
  rm -f "$TMP"
fi
