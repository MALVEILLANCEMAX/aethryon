#!/usr/bin/env bash
# Construit le compilateur Cherri depuis un commit figé, dans un conteneur Go jetable
# (--rm, aucun label, aucun port). Résultat : shortcut/.bin/cherri (binaire statique).
#
# Pourquoi un commit et pas la release v2.3.0 (mai 2026) : les correctifs des questions
# d'importation (c8a6c6c « index omis avec une seule action » = issue #201, 007e879 « index
# d'action inexact ») sont postérieurs à v2.3.0. Sans eux, la question du jeton peut être
# ignorée en silence par Raccourcis.
#
# Patchs appliqués (tools/cherri-patches/*.patch), minimaux et documentés :
#   0001 : toujours écrire WFItemType (0 = Texte) dans les dictionnaires et menus, comme un
#          export réel de Raccourcis ; Cherri l'omettait (omitempty), même défaut que l'issue #201.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CHERRI_REPO="https://github.com/electrikmilk/cherri.git"
CHERRI_COMMIT="a66db15b7f247f3121726c2a2b72becfeef3d96b"   # main du 2026-10-01
GO_IMAGE="golang:1.24-alpine@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191"
SRC="$HERE/.cache/cherri-src"
BIN="$HERE/.bin/cherri"

PATCHES=("$HERE"/tools/cherri-patches/*.patch)
STAMP="$CHERRI_COMMIT $(cat "${PATCHES[@]}" | sha256sum | cut -c1-16)"
if [[ -x "$BIN" && -f "$BIN.commit" && "$(cat "$BIN.commit")" == "$STAMP" ]]; then
    echo "Cherri déjà construit ($CHERRI_COMMIT) : $BIN"
    exit 0
fi

mkdir -p "$HERE/.cache" "$HERE/.bin"
if [[ ! -d "$SRC/.git" ]]; then
    git clone --quiet "$CHERRI_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet --force --detach "$CHERRI_COMMIT"
git -C "$SRC" clean --quiet -fdx
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$CHERRI_COMMIT" ]] || { echo "commit inattendu"; exit 1; }
for patch in "${PATCHES[@]}"; do
    git -C "$SRC" apply --whitespace=nowarn "$patch"
    echo "patch appliqué : $(basename "$patch")"
done

docker run --rm -v "$SRC:/src" -w /src \
    -e CGO_ENABLED=0 -e GOFLAGS=-trimpath -e GOCACHE=/tmp/gocache -e GOMODCACHE=/tmp/gomod \
    "$GO_IMAGE" go build -ldflags "-s -w" -o /src/cherri.bin .

install -m 0755 "$SRC/cherri.bin" "$BIN"
rm -f "$SRC/cherri.bin"
echo "$STAMP" > "$BIN.commit"
sha256sum "$BIN" | tee "$BIN.sha256"
"$BIN" --version 2>/dev/null || true
