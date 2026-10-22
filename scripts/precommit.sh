#!/bin/sh
set -eu

npm run lint
npm test

if [ -n "${SKILLERIE_DENYLIST_SCANNER:-}" ]; then
  "$SKILLERIE_DENYLIST_SCANNER" "$PWD"
fi
