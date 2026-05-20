#!/usr/bin/env bash
# serve-all.sh — boot every redesign variant on its own port
#
# Each variant lives in a sibling git worktree of this repo. Worktrees are
# created once (see README at the bottom) and reused. This script is the
# single entry point for starting, stopping, checking, and tailing them.
#
# Layout (sibling directories alongside this repo):
#   ./                              redesign/explore (Cantoral)        :3000
#   ../owt-kb-cassette/             redesign/cassette                  :3001
#   ../owt-kb-pizarra/              redesign/pizarra                   :3002
#   ../owt-kb-concierto/            redesign/concierto                 :3003
#   ../owt-kb-estudio/              redesign/estudio                   :3004
#   ../owt-kb-vitral/               redesign/vitral                    :3005
#   ../owt-kb-domingo/              redesign/domingo                   :3006
#
# Usage:
#   ./scripts/serve-all.sh start          # boot every variant in the background
#   ./scripts/serve-all.sh start <name>   # boot just one
#   ./scripts/serve-all.sh stop           # stop everything we started
#   ./scripts/serve-all.sh stop <name>    # stop just one
#   ./scripts/serve-all.sh status         # who's up?
#   ./scripts/serve-all.sh logs <name>    # tail a variant's log
#   ./scripts/serve-all.sh open           # open every URL in the browser
#
# First-time per worktree, this script will run `npm install` automatically
# if node_modules is missing. Logs go to /tmp/owt-kb-<name>.log, PIDs to
# /tmp/owt-kb-<name>.pid.

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────

# Resolve this repo's root regardless of where the script is invoked from.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"

# variant : worktree-path : port
VARIANTS=(
  "cantoral:$REPO_ROOT:3000"
  "cassette:$PARENT_DIR/owt-kb-cassette:3001"
  "pizarra:$PARENT_DIR/owt-kb-pizarra:3002"
  "concierto:$PARENT_DIR/owt-kb-concierto:3003"
  "estudio:$PARENT_DIR/owt-kb-estudio:3004"
  "vitral:$PARENT_DIR/owt-kb-vitral:3005"
  "domingo:$PARENT_DIR/owt-kb-domingo:3006"
)

# ─── Helpers ────────────────────────────────────────────────────────────────

# Parse a "name:path:port" entry. Sets $name $path $port.
parse_entry() {
  IFS=":" read -r name path port <<<"$1"
}

# Pretty color helpers (no-op if not a TTY).
if [[ -t 1 ]]; then
  c_dim="\033[2m"; c_bold="\033[1m"; c_green="\033[32m"; c_yellow="\033[33m"
  c_red="\033[31m"; c_reset="\033[0m"
else
  c_dim=""; c_bold=""; c_green=""; c_yellow=""; c_red=""; c_reset=""
fi

pid_file() { echo "/tmp/owt-kb-$1.pid"; }
log_file() { echo "/tmp/owt-kb-$1.log"; }

is_running() {
  local pid_path
  pid_path="$(pid_file "$1")"
  [[ -f "$pid_path" ]] || return 1
  local pid
  pid="$(cat "$pid_path" 2>/dev/null || echo "")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# ─── Commands ───────────────────────────────────────────────────────────────

start_one() {
  parse_entry "$1"
  if [[ ! -d "$path" ]]; then
    printf "${c_yellow}%-10s${c_reset} ${c_dim}skip${c_reset}  no worktree at %s\n" "$name" "$path"
    return 0
  fi
  if is_running "$name"; then
    printf "${c_green}%-10s${c_reset} ${c_dim}up${c_reset}    pid=%s port=%s\n" \
      "$name" "$(cat "$(pid_file "$name")")" "$port"
    return 0
  fi
  if [[ ! -d "$path/node_modules" ]]; then
    printf "${c_yellow}%-10s${c_reset} install (first run, ~30s)…\n" "$name"
    (cd "$path" && npm install --silent --no-audit --no-fund) >>"$(log_file "$name")" 2>&1
  fi
  # Variants are git worktrees and don't get .env.local from the parent
  # automatically. Link it on first run so Sanity env vars resolve.
  if [[ "$path" != "$REPO_ROOT" && ! -e "$path/.env.local" && -f "$REPO_ROOT/.env.local" ]]; then
    ln -s "$REPO_ROOT/.env.local" "$path/.env.local"
    printf "${c_dim}%-10s linked .env.local${c_reset}\n" "$name"
  fi
  # Boot dev server detached, port-pinned, logging to a per-variant file.
  # NEXTAUTH_URL must match the actual origin or NextAuth throws a
  # Configuration error; override it per port so each variant works.
  (
    cd "$path"
    NEXTAUTH_URL="http://localhost:$port" \
    nohup npm run dev -- -p "$port" >>"$(log_file "$name")" 2>&1 &
    echo $! >"$(pid_file "$name")"
  )
  printf "${c_green}%-10s${c_reset} started pid=%s port=%s log=%s\n" \
    "$name" "$(cat "$(pid_file "$name")")" "$port" "$(log_file "$name")"
}

stop_one() {
  parse_entry "$1"
  if ! is_running "$name"; then
    printf "${c_dim}%-10s already down${c_reset}\n" "$name"
    rm -f "$(pid_file "$name")"
    return 0
  fi
  local pid
  pid="$(cat "$(pid_file "$name")")"
  # next dev spawns child processes; kill the whole group.
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 0.2
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$(pid_file "$name")"
  printf "${c_red}%-10s${c_reset} stopped\n" "$name"
}

status_one() {
  parse_entry "$1"
  if [[ ! -d "$path" ]]; then
    printf "${c_dim}%-10s missing${c_reset} (no worktree)\n" "$name"
    return 0
  fi
  if is_running "$name"; then
    printf "${c_green}%-10s up${c_reset}      pid=%s  port=%s  ${c_dim}%s${c_reset}\n" \
      "$name" "$(cat "$(pid_file "$name")")" "$port" "http://localhost:$port"
  else
    printf "${c_dim}%-10s down${c_reset}    port=%s\n" "$name" "$port"
  fi
}

find_entry() {
  for entry in "${VARIANTS[@]}"; do
    parse_entry "$entry"
    if [[ "$name" == "$1" ]]; then
      echo "$entry"
      return 0
    fi
  done
  echo "${c_red}unknown variant: $1${c_reset}" >&2
  echo "known: cantoral, cassette, pizarra, concierto, estudio, vitral, domingo" >&2
  return 1
}

# ─── Dispatch ───────────────────────────────────────────────────────────────

cmd="${1:-status}"
arg="${2:-}"

case "$cmd" in
  start)
    if [[ -n "$arg" ]]; then
      entry="$(find_entry "$arg")"
      start_one "$entry"
    else
      for entry in "${VARIANTS[@]}"; do start_one "$entry"; done
    fi
    ;;
  stop)
    if [[ -n "$arg" ]]; then
      entry="$(find_entry "$arg")"
      stop_one "$entry"
    else
      for entry in "${VARIANTS[@]}"; do stop_one "$entry"; done
    fi
    ;;
  status|ps)
    for entry in "${VARIANTS[@]}"; do status_one "$entry"; done
    ;;
  logs|tail)
    [[ -z "$arg" ]] && { echo "usage: $0 logs <name>"; exit 2; }
    find_entry "$arg" >/dev/null  # validate
    echo "${c_dim}tailing $(log_file "$arg") — Ctrl+C to stop${c_reset}"
    touch "$(log_file "$arg")"
    tail -F "$(log_file "$arg")"
    ;;
  open)
    if ! command -v open >/dev/null 2>&1; then
      echo "open(1) not found (macOS only)" >&2; exit 2
    fi
    for entry in "${VARIANTS[@]}"; do
      parse_entry "$entry"
      [[ -d "$path" ]] && open "http://localhost:$port"
    done
    ;;
  help|-h|--help|"")
    sed -n '2,30p' "$0"
    ;;
  *)
    echo "${c_red}unknown command: $cmd${c_reset}" >&2
    echo "try: start | stop | status | logs <name> | open" >&2
    exit 2
    ;;
esac
