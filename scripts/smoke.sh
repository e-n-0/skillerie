#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/skillerie-smoke.XXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT

export HOME="$work_dir/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"
export CODEX_HOME="$HOME/.codex"
export OMO_CODING_AGENT_DIR="$HOME/.omo/agent"
export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
export SKILLERIE_BACKUP_DIR="$HOME/.Trash/skillerie"
export npm_config_cache="$HOME/.npm"
export npm_config_userconfig="$HOME/.npmrc"
export npm_config_globalconfig="$HOME/.config/npm/npmrc"
prefix="$work_dir/prefix"
mkdir -p "$HOME" "$prefix"

tarball="$work_dir/$(cd "$repo_dir" && npm pack --pack-destination "$work_dir" --silent)"
entries="$(tar -tzf "$tarball")"
for required in \
  dist/cli.js \
  schema/skillerie.schema.json \
  LICENSE README.md; do
  if ! grep -Fxq "package/$required" <<< "$entries"; then
    printf 'Missing package file: %s\n' "$required" >&2
    exit 1
  fi
done

npm install --global --prefix "$prefix" --no-audit --no-fund "$tarball"
export PATH="$prefix/bin:$PATH"
cd "$work_dir"

skillerie init demo --harness opencode --harness codex --harness omo --harness pi
skillerie validate --repo demo
skillerie sync --repo demo
# A check reports drift until the temporary harness homes have been installed.
skillerie install --repo demo
skillerie install --repo demo --check

printf 'SMOKE PASS\n'
