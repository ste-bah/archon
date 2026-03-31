#!/bin/bash
# Install Archon autonomous agents (macOS launchd or Linux systemd --user)
# PRD: PRD-ARCHON-CAP-001 | TASK-AUTO-004, TASK-ENH-001, TASK-ENH-002

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${HOME}/.archon/scripts"
PLATFORM="$(uname)"

# Derive project root (two levels up from scripts/archon/)
ARCHON_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Verify prerequisites
if [ ! -f "${HOME}/.archon-env" ]; then
    echo "ERROR: Credentials file not found: ~/.archon-env" >&2
    echo "Create it with RC_URL, RC_TOKEN, RC_USER_ID variables and chmod 600" >&2
    exit 1
fi

# Create directories
mkdir -p "${HOME}/.archon/logs" "${HOME}/.archon/budget" "$DEPLOY_DIR/lib"
chmod 700 "${HOME}/.archon/logs" "${HOME}/.archon/budget"

# Deploy scripts to home directory (avoids volume access restrictions)
cp "${SCRIPT_DIR}/rc-prefilter.sh" "$DEPLOY_DIR/"
cp "${SCRIPT_DIR}/archon-runner.sh" "$DEPLOY_DIR/"
cp "${SCRIPT_DIR}/leann-drain.sh" "$DEPLOY_DIR/" 2>/dev/null || true
cp "${SCRIPT_DIR}/lib/logging.sh" "$DEPLOY_DIR/lib/"
cp "${SCRIPT_DIR}/system-prompt.md" "$DEPLOY_DIR/"
chmod +x "$DEPLOY_DIR/rc-prefilter.sh" "$DEPLOY_DIR/archon-runner.sh" "$DEPLOY_DIR/leann-drain.sh" 2>/dev/null || true

# Fix PROJECT_ROOT in deployed runner (platform-aware sed)
RUNNER="$DEPLOY_DIR/archon-runner.sh"
if [[ "$PLATFORM" == "Darwin" ]]; then
    sed -i '' 's|PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"|PROJECT_ROOT="${ARCHON_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." \&\& pwd)}"|' "$RUNNER" 2>/dev/null || true
else
    sed -i 's|PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"|PROJECT_ROOT="${ARCHON_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." \&\& pwd)}"|' "$RUNNER" 2>/dev/null || true
fi

echo "Scripts deployed to $DEPLOY_DIR"

# ── macOS ─────────────────────────────────────────────────────────────────────
if [[ "$PLATFORM" == "Darwin" ]]; then
    LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
    mkdir -p "$LAUNCH_AGENTS_DIR"

    AGENTS=(
        "com.archon.rc-prefilter:RocketChat polling (2-min)"
        "com.archon.learn:Learning (4-hour)"
        "com.archon.consolidate:Memory consolidation (daily 3am)"
        "com.archon.outreach:Outreach alerts (daily 9am)"
        "com.archon.leann-drain:LEANN index drain (15-min)"
    )

    for entry in "${AGENTS[@]}"; do
        IFS=':' read -r label desc <<< "$entry"
        PLIST_SRC="${SCRIPT_DIR}/${label}.plist"
        PLIST_DST="${LAUNCH_AGENTS_DIR}/${label}.plist"

        if [ ! -f "$PLIST_SRC" ]; then
            echo "SKIP: ${label} (plist not found)"
            continue
        fi

        launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
        cp "$PLIST_SRC" "$PLIST_DST"
        launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
        echo "  OK: ${desc}"
    done

# ── Linux ─────────────────────────────────────────────────────────────────────
else
    SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
    mkdir -p "$SYSTEMD_USER_DIR"

    UNITS=(
        "archon-rc-prefilter:RocketChat polling (2-min)"
        "archon-learn:Learning (4-hour)"
        "archon-consolidate:Memory consolidation (daily 3am)"
        "archon-outreach:Outreach alerts (daily 9am)"
        "archon-leann-drain:LEANN index drain (15-min)"
    )

    for entry in "${UNITS[@]}"; do
        IFS=':' read -r unit desc <<< "$entry"
        SVC_SRC="${SCRIPT_DIR}/${unit}.service"
        TMR_SRC="${SCRIPT_DIR}/${unit}.timer"

        if [ ! -f "$SVC_SRC" ] || [ ! -f "$TMR_SRC" ]; then
            echo "SKIP: ${unit} (unit files not found)"
            continue
        fi

        # Stop existing timer if running
        systemctl --user stop "${unit}.timer" 2>/dev/null || true
        systemctl --user disable "${unit}.timer" 2>/dev/null || true

        # Copy and substitute placeholders
        sed \
            -e "s|__ARCHON_HOME__|${HOME}|g" \
            -e "s|__ARCHON_ROOT__|${ARCHON_ROOT}|g" \
            "$SVC_SRC" > "${SYSTEMD_USER_DIR}/${unit}.service"

        cp "$TMR_SRC" "${SYSTEMD_USER_DIR}/${unit}.timer"

        echo "  OK: ${desc}"
    done

    systemctl --user daemon-reload

    # Enable and start all timers
    for entry in "${UNITS[@]}"; do
        IFS=':' read -r unit _ <<< "$entry"
        if [ -f "${SYSTEMD_USER_DIR}/${unit}.timer" ]; then
            systemctl --user enable --now "${unit}.timer"
        fi
    done

    # Ensure services persist after logout
    if ! loginctl show-user "$(whoami)" 2>/dev/null | grep -q "Linger=yes"; then
        echo ""
        echo "NOTE: To keep timers running when you log out, run:"
        echo "  loginctl enable-linger $(whoami)"
    fi
fi

echo ""
echo "Archon autonomous system installed"
echo "Check status: bash ${SCRIPT_DIR}/status.sh"
echo "View logs: tail -f ~/.archon/logs/"
