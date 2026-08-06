#!/usr/bin/env bash
# RegesCore for LM Studio - installer (macOS / Linux)
#
# Brand and engineering by davidio.dev
# https://davidio.dev
#
#   ./install.sh              install both plugins into LM Studio
#   ./install.sh --dev        run them in development mode instead (live reload)
#   ./install.sh --uninstall  print removal instructions
#
# LM Studio does not discover plugins by scanning a folder. A plugin becomes
# visible only when the app is told about it through its local API, which is
# what `lms dev --install` does. Copying files into extensions/plugins does
# nothing on its own.
#
# Requirements:
#   - LM Studio must be RUNNING. The command talks to its local server.
#   - `lms` must be on PATH. LM Studio ships it; if it is missing, enable the
#     CLI from LM Studio's Developer settings, or run `lms bootstrap` from
#     LM Studio's install folder.

set -euo pipefail

PLUGINS=("regescore" "regescore-gateway")
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="install"
LMS_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --lms) LMS_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

find_lmstudio_home() {
  local pointer="$HOME/.lmstudio-home-pointer"
  if [[ -f "$pointer" ]]; then
    tr -d '[:space:]' < "$pointer"
    return
  fi
  if [[ -d "$HOME/.cache/lm-studio" ]]; then
    echo "$HOME/.cache/lm-studio"
    return
  fi
  echo "$HOME/.lmstudio"
}

resolve_lms() {
  if [[ -n "$LMS_OVERRIDE" ]]; then
    echo "$LMS_OVERRIDE"
    return
  fi
  if command -v lms >/dev/null 2>&1; then
    command -v lms
    return
  fi
  # Search LM Studio's home rather than hard-coding a path: the layout has
  # changed between releases.
  local home
  home="$(find_lmstudio_home)"
  if [[ -d "$home" ]]; then
    find "$home" -maxdepth 4 -type f -name lms -perm -u+x 2>/dev/null | head -n 1
  fi
}

if [[ "$MODE" == "uninstall" ]]; then
  cat <<'EOF'

LM Studio has no command-line uninstall for plugins.
Remove them in the app: open the Integrations panel, click the three dots next
to "regescore" or "regescore-gateway", and choose the removal option. Then
restart LM Studio.
EOF
  exit 0
fi

LMS="$(resolve_lms || true)"
if [[ -z "${LMS:-}" ]]; then
  cat >&2 <<'EOF'

error: could not find the 'lms' command.

Open LM Studio, go to the Developer tab, and enable the command-line tool.
Alternatively run 'lms bootstrap' from LM Studio's installation folder, then
open a new terminal and re-run this script. You can also pass it directly:
    ./install.sh --lms /path/to/lms
EOF
  exit 1
fi

echo
echo "RegesCore for LM Studio - davidio.dev"
echo "  lms      : $LMS"
echo "  source   : $SOURCE_DIR"
echo "  mode     : $MODE"
echo
echo "LM Studio must be running: these commands talk to its local server."
echo

for plugin in "${PLUGINS[@]}"; do
  dir="$SOURCE_DIR/$plugin"
  if [[ ! -f "$dir/manifest.json" ]]; then
    echo "error: $dir/manifest.json not found" >&2
    exit 1
  fi

  echo "-> $plugin"
  if [[ ! -d "$dir/node_modules" ]]; then
    if command -v npm >/dev/null 2>&1; then
      echo "   installing dependencies..."
      (cd "$dir" && npm install --silent --no-audit --no-fund --omit=dev)
    else
      echo "   npm not on PATH; lms will install dependencies itself"
    fi
  fi

  if [[ "$MODE" == "dev" ]]; then
    # lms dev is a foreground watcher: it holds the registration open and
    # rebuilds on change. Backgrounded here so both plugins can run.
    echo "   starting dev server in the background..."
    (cd "$dir" && "$LMS" dev &)
  else
    echo "   installing into LM Studio..."
    (cd "$dir" && "$LMS" dev --install --yes)
  fi
done

TEMPLATE="$SOURCE_DIR/regescore/templates/regescore_fable5.jinja"
echo
if [[ "$MODE" == "dev" ]]; then
  echo "Dev servers running in the background. The plugins stay registered while"
  echo "those processes live. Kill them to unregister."
else
  echo "Installed. Open the Integrations panel in LM Studio:"
  echo "  - 'regescore' appears in the plugin list; enable it."
  echo "  - 'regescore-gateway' appears in the MODEL dropdown, not the plugin"
  echo "    list, because it registers a generator."
fi
cat <<EOF

Chat template (manual - plugins cannot set it):
  My Models > your model > Prompt Template, paste:
  $TEMPLATE

For the Claude Code 400s, also set:
  export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
  export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1

RegesCore // Fable 5 - davidio.dev
EOF
