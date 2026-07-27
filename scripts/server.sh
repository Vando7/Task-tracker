#!/usr/bin/env bash
#
# Manage the local dev processes: the Fastify API and the Vite client.
#
# Both run detached with a pidfile and a logfile under .run/, so they survive the
# shell that started them and can be inspected afterwards. `pnpm dev` runs both in
# the foreground and is still the right thing for interactive work — this script is
# for when you want them up in the background, or scripted.
#
#   ./scripts/server.sh start          # both
#   ./scripts/server.sh start api      # just the API
#   ./scripts/server.sh status
#   ./scripts/server.sh logs api       # follow
#   ./scripts/server.sh restart web
#   ./scripts/server.sh stop
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"
mkdir -p "$RUN_DIR"

API_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"

# Colour only when attached to a terminal, so piped output stays clean.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

die() { printf '%s\n' "${RED}error:${RESET} $*" >&2; exit 1; }

# ----------------------------------------------------------------- target config

# Resolved lazily because each target has a different working directory.
target_cwd() {
  case "$1" in
    api) printf '%s\n' "$REPO_ROOT/apps/server" ;;
    web) printf '%s\n' "$REPO_ROOT/apps/web" ;;
  esac
}

target_cmd() {
  case "$1" in
    api) printf '%s\n' "$REPO_ROOT/apps/server/node_modules/.bin/tsx watch --env-file-if-exists=$REPO_ROOT/.env src/index.ts" ;;
    web) printf '%s\n' "$REPO_ROOT/apps/web/node_modules/.bin/vite --port $WEB_PORT" ;;
  esac
}

target_port() {
  case "$1" in
    api) printf '%s\n' "$API_PORT" ;;
    web) printf '%s\n' "$WEB_PORT" ;;
  esac
}

target_label() {
  case "$1" in
    api) printf '%s\n' "API   " ;;
    web) printf '%s\n' "client" ;;
  esac
}

pid_file() { printf '%s\n' "$RUN_DIR/$1.pid"; }
log_file() { printf '%s\n' "$RUN_DIR/$1.log"; }

# Resolve a user-supplied target list into canonical names.
resolve_targets() {
  local requested="${1:-all}"
  case "$requested" in
    all|both|'') printf '%s\n' api web ;;
    api|server|backend) printf '%s\n' api ;;
    web|client|frontend|vite) printf '%s\n' web ;;
    *) die "unknown target '$requested' (expected: api, web, all)" ;;
  esac
}

# ---------------------------------------------------------------------- helpers

# A pidfile can outlive its process (crash, reboot, kill -9), so always confirm
# the pid is actually alive before trusting it.
running_pid() {
  local target="$1" file pid
  file="$(pid_file "$target")"
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  if kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi
  # Stale: clean it up so `start` doesn't refuse forever.
  rm -f "$file"
  return 1
}

port_responding() {
  local port="$1"
  if [ "$port" = "$API_PORT" ]; then
    curl -sf -m 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1
  else
    curl -sf -m 2 -o /dev/null "http://127.0.0.1:$port/" 2>&1
  fi
}

wait_for_port() {
  local port="$1" attempts="${2:-40}" i
  for ((i = 0; i < attempts; i++)); do
    port_responding "$port" && return 0
    sleep 0.5
  done
  return 1
}

# ---------------------------------------------------------------------- actions

start_one() {
  local target="$1" pid cwd cmd port log
  port="$(target_port "$target")"

  if pid="$(running_pid "$target")"; then
    printf '%s already running (pid %s)\n' "${YELLOW}$(target_label "$target")${RESET}" "$pid"
    return 0
  fi

  # Something else on the port is a different problem from "we already started it".
  if port_responding "$port"; then
    die "port $port is already in use by something this script did not start"
  fi

  cwd="$(target_cwd "$target")"
  cmd="$(target_cmd "$target")"
  log="$(log_file "$target")"

  [ -d "$cwd/node_modules" ] || die "dependencies missing — run 'pnpm install' first"

  # Detach into a new session so the process survives this shell, and record the
  # pid from *inside* that session.
  #
  # The obvious `setsid cmd & echo $!` is wrong: setsid forks, so `$!` is a parent
  # that exits immediately, leaving the pidfile pointing at a dead process and
  # `kill -$pid` aimed at the wrong process group. Here the inner shell writes its
  # own `$$` — which is the new session and group leader — and then `exec`s the
  # real command, so that pid *becomes* the process we want to signal.
  #
  # Arguments are passed positionally rather than interpolated into the -c string,
  # so nothing here breaks on a path containing a space.
  local pidpath
  pidpath="$(pid_file "$target")"
  # shellcheck disable=SC2086  # $cmd is a deliberately word-split argv
  ( cd "$cwd" && nohup setsid bash -c 'echo $$ >"$1"; shift; exec "$@"' _ "$pidpath" $cmd \
      >"$log" 2>&1 & )

  # The pidfile is written by the child, so wait for it to appear.
  local i
  for ((i = 0; i < 20; i++)); do
    [ -s "$pidpath" ] && break
    sleep 0.1
  done

  if wait_for_port "$port"; then
    printf '%s started on %s (pid %s)\n' \
      "${GREEN}$(target_label "$target")${RESET}" \
      "http://127.0.0.1:$port" \
      "$(cat "$(pid_file "$target")")"
  else
    printf '%s failed to come up — last lines of %s:\n' "${RED}$(target_label "$target")${RESET}" "$log"
    tail -n 20 "$log" | sed 's/^/    /'
    return 1
  fi
}

stop_one() {
  local target="$1" pid
  if ! pid="$(running_pid "$target")"; then
    printf '%s not running\n' "${DIM}$(target_label "$target")${RESET}"
    rm -f "$(pid_file "$target")"
    return 0
  fi

  # The pid is the process group leader (setsid), so negate it to take down
  # tsx/vite and any child they spawned. Otherwise watchers leak.
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  local i
  for ((i = 0; i < 20; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done

  if kill -0 "$pid" 2>/dev/null; then
    printf '%s did not stop, sending KILL\n' "${YELLOW}$(target_label "$target")${RESET}"
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$(pid_file "$target")"
  printf '%s stopped\n' "${GREEN}$(target_label "$target")${RESET}"
}

status_one() {
  local target="$1" pid port state
  port="$(target_port "$target")"

  if pid="$(running_pid "$target")"; then
    if port_responding "$port"; then
      state="${GREEN}running${RESET}  pid $pid  http://127.0.0.1:$port"
    else
      # Alive but not answering: usually still booting, or wedged.
      state="${YELLOW}starting${RESET} pid $pid  (port $port not answering yet)"
    fi
  elif port_responding "$port"; then
    state="${YELLOW}foreign${RESET}  something else is serving port $port"
  else
    state="${DIM}stopped${RESET}"
  fi

  printf '  %s  %s\n' "$(target_label "$target")" "$state"
}

cmd_start()   { local t; for t in $(resolve_targets "${1:-all}"); do start_one "$t"; done; }
cmd_stop()    { local t; for t in $(resolve_targets "${1:-all}"); do stop_one  "$t"; done; }
cmd_status()  {
  printf '%sTask Tracker%s\n' "$BOLD" "$RESET"
  local t; for t in $(resolve_targets "${1:-all}"); do status_one "$t"; done
}
cmd_restart() { cmd_stop "${1:-all}"; cmd_start "${1:-all}"; }

cmd_logs() {
  local target log
  target="$(resolve_targets "${1:-api}" | head -n1)"
  log="$(log_file "$target")"
  [ -f "$log" ] || die "no log yet for '$target' — start it first"
  printf '%s(following %s — Ctrl-C to stop)%s\n' "$DIM" "$log" "$RESET"
  tail -n 40 -f "$log"
}

cmd_health() {
  local body
  if body="$(curl -sf -m 5 "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null)"; then
    printf '%shealthy%s %s\n' "$GREEN" "$RESET" "$body"
  else
    printf '%sunhealthy%s API is not answering on port %s\n' "$RED" "$RESET" "$API_PORT"
    return 1
  fi
}

usage() {
  cat <<EOF
${BOLD}Task Tracker — dev process manager${RESET}

  ./scripts/server.sh <command> [target]

${BOLD}Commands${RESET}
  start [target]     start detached, wait until it answers
  stop [target]      graceful TERM, then KILL if it refuses
  restart [target]   stop then start
  status [target]    what is up, and on which port
  logs [target]      follow the log (default: api)
  health             hit the API health endpoint

${BOLD}Targets${RESET}
  api                the Fastify API      (port ${API_PORT})
  web                the Vite client      (port ${WEB_PORT})
  all                both (default)

Logs and pidfiles live in .run/ and are gitignored.
For interactive work, 'pnpm dev' runs both in the foreground instead.
EOF
}

case "${1:-status}" in
  start)   cmd_start   "${2:-all}" ;;
  stop)    cmd_stop    "${2:-all}" ;;
  restart) cmd_restart "${2:-all}" ;;
  status)  cmd_status  "${2:-all}" ;;
  logs)    cmd_logs    "${2:-api}" ;;
  health)  cmd_health ;;
  -h|--help|help) usage ;;
  *) usage; die "unknown command '${1}'" ;;
esac
