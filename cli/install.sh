#!/bin/sh
# Rook CLI — one-script install.
#
#   From a checkout:   ./cli/install.sh
#   From anywhere:     curl -fsSL https://raw.githubusercontent.com/EdwardJarman/Rook/main/cli/install.sh | bash
#
# Builds the self-contained bundle (deps included) and drops a single
# `rook` executable into ~/.local/bin. Then: rook login
set -eu

REPO="https://github.com/EdwardJarman/Rook.git"
REF="${ROOK_REF:-main}"
BIN_DIR="${ROOK_BIN_DIR:-$HOME/.local/bin}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "rook install: missing '$1' — please install it first." >&2
    exit 1
  }
}

need node
need npm
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" || {
  echo "rook install: node >= 20 required (found $(node --version))." >&2
  exit 1
}

WORK=""
cleanup() {
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT INT TERM

if [ -f "./cli/package.json" ] && [ -d "./cli/src" ]; then
  SRC="./cli"
else
  need git
  WORK="$(mktemp -d)/rook-cli-install"
  echo "rook install: fetching installer sources..."
  git clone --quiet --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$WORK"
  git -C "$WORK" sparse-checkout set cli
  SRC="$WORK/cli"
fi

if [ ! -f "$SRC/package.json" ]; then
  echo "rook install: Rook CLI sources not found (branch $REF has no cli/ yet)." >&2
  echo "Push the Rook repo first, or run this script from a Rook checkout." >&2
  exit 1
fi

echo "rook install: building..."
npm --prefix "$SRC" ci --no-audit --no-fund || npm --prefix "$SRC" install --no-audit --no-fund
npm --prefix "$SRC" run build

mkdir -p "$BIN_DIR"
cp "$SRC/dist/rook.cjs" "$BIN_DIR/rook"
chmod +x "$BIN_DIR/rook"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "rook install: add $BIN_DIR to your PATH (e.g. export PATH=\"\$HOME/.local/bin:\$PATH\"), then open a new shell." ;;
esac

if "$BIN_DIR/rook" version >/dev/null 2>&1; then
  echo "rook install: done — rook $($BIN_DIR/rook version) at $BIN_DIR/rook"
  echo "Next: rook login"
else
  echo "rook install: build ok, but $BIN_DIR/rook did not run — check node is on your PATH." >&2
  exit 1
fi
