#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/test-osc-notify.sh [options]

Options:
  --delay <seconds>        Delay before sending OSC sequence (default: 2)
  --title <title>          Notification title (default: "openmux notify test")
  --body <body>            Notification body (default: "Focus test notification")
  --osc <9|777>            OSC code to emit (default: 9)
  --wait-for-focus-out     Wait for focus-out before sending (default)
  --no-focus-wait          Send after delay without waiting for focus-out
  --focus-timeout <secs>   Timeout waiting for focus-out (default: 10, 0 = no timeout)
  --backend <auto|bash|python>
                           Focus wait backend (default: auto)
  --debug-input            Log raw focus input bytes while waiting
  --help, -h               Show this help message

Notes:
  - Semicolons separate title/body in the OSC payload.
  - OSC 777 uses the openmux notify prefix: OSC 777;notify;title;body
  - Focus tracking is enabled while waiting and disabled on exit.
USAGE
}

delay="2"
title="openmux notify test"
body="Focus test notification"
osc="9"
wait_for_focus_out="1"
focus_timeout="10"
backend="auto"
debug_input="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delay)
      delay="${2:-}"
      shift 2
      ;;
    --title)
      title="${2:-}"
      shift 2
      ;;
    --body)
      body="${2:-}"
      shift 2
      ;;
    --osc)
      osc="${2:-}"
      shift 2
      ;;
    --wait-for-focus-out)
      wait_for_focus_out="1"
      shift
      ;;
    --no-focus-wait)
      wait_for_focus_out="0"
      shift
      ;;
    --focus-timeout)
      focus_timeout="${2:-}"
      shift 2
      ;;
    --backend)
      backend="${2:-}"
      shift 2
      ;;
    --debug-input)
      debug_input="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
 done

if [[ -z "$delay" ]]; then
  echo "Error: --delay requires a value." >&2
  exit 1
fi

if ! [[ "$delay" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Error: delay must be a number of seconds." >&2
  exit 1
fi

if [[ -z "$body" ]]; then
  echo "Error: --body must be non-empty." >&2
  exit 1
fi

case "$osc" in
  9|777)
    ;;
  *)
    echo "Error: --osc must be 9 or 777." >&2
    exit 1
    ;;
esac

if [[ "$wait_for_focus_out" == "1" ]]; then
  if ! [[ "$focus_timeout" =~ ^[0-9]+$ ]]; then
    echo "Error: focus timeout must be an integer number of seconds." >&2
    exit 1
  fi
fi

case "$backend" in
  auto|bash|python)
    ;;
  *)
    echo "Error: --backend must be auto, bash, or python." >&2
    exit 1
    ;;
esac

payload="${title};${body}"

FOCUS_IN=$'\033[I'
FOCUS_OUT=$'\033[O'
FOCUS_TRACKING_ENABLE=$'\033[?1004h'
FOCUS_TRACKING_DISABLE=$'\033[?1004l'
TTY_PATH="/dev/tty"

stty_state=""

after_wait_message() {
  if [[ "$wait_for_focus_out" == "1" ]]; then
    echo "Focus out received; sending OSC ${osc} in ${delay}s..." >&2
  else
    echo "Sending OSC ${osc} in ${delay}s..." >&2
  fi
}

cleanup() {
  if [[ -n "$stty_state" ]]; then
    stty "$stty_state" < "$TTY_PATH"
  fi
  if [[ -w "$TTY_PATH" ]]; then
    printf '%s' "$FOCUS_TRACKING_DISABLE" > "$TTY_PATH"
  else
    printf '%s' "$FOCUS_TRACKING_DISABLE"
  fi
}

use_python_backend() {
  if [[ "$backend" == "python" ]]; then
    return 0
  fi
  if [[ "$backend" == "bash" ]]; then
    return 1
  fi
  command -v python3 >/dev/null 2>&1
}

wait_for_focus_out_bash() {
  local start
  local buffer

  exec {tty_fd}< "$TTY_PATH"
  echo "Waiting for focus out (switch panes or defocus terminal)..." >&2
  start=$(date +%s)
  buffer=""

  while true; do
    if read -rsn1 -t 0.1 -u "$tty_fd" ch; then
      if [[ "$debug_input" == "1" ]]; then
        printf 'input byte: 0x%02x\n' "'${ch}" >&2
      fi
      buffer="${buffer}${ch}"
      buffer="${buffer: -3}"
      if [[ "$buffer" == *"$FOCUS_OUT" ]]; then
        return 0
      fi
    fi

    if [[ "$focus_timeout" != "0" ]]; then
      local now
      now=$(date +%s)
      if (( now - start >= focus_timeout )); then
        echo "Timed out waiting for focus out." >&2
        return 1
      fi
    fi
  done
}

wait_for_focus_out_python() {
  python3 - "$focus_timeout" "$debug_input" "$TTY_PATH" <<'PY'
import os
import select
import sys
import time

try:
  timeout = int(sys.argv[1])
except (IndexError, ValueError):
  timeout = 10

debug = len(sys.argv) > 2 and sys.argv[2] == "1"
tty_path = sys.argv[3] if len(sys.argv) > 3 else "/dev/tty"

fd = os.open(tty_path, os.O_RDONLY | os.O_NONBLOCK)
start = time.time()
buf = b""

try:
  while True:
    if timeout != 0 and time.time() - start >= timeout:
      print("Timed out waiting for focus out.", file=sys.stderr)
      sys.exit(1)

    rlist, _, _ = select.select([fd], [], [], 0.1)
    if not rlist:
      continue

    data = os.read(fd, 64)
    if not data:
      continue

    if debug:
      print("input bytes:", data.hex(), file=sys.stderr)

    buf = (buf + data)[-3:]
    if buf.endswith(b"\x1b[O"):
      sys.exit(0)
finally:
  os.close(fd)
PY
}

trap cleanup EXIT INT TERM

if [[ "$wait_for_focus_out" == "1" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Error: stdin is not a TTY; cannot wait for focus events." >&2
    exit 1
  fi

  if [[ -w "$TTY_PATH" ]]; then
    printf '%s' "$FOCUS_TRACKING_ENABLE" > "$TTY_PATH"
  else
    printf '%s' "$FOCUS_TRACKING_ENABLE"
  fi

  stty_state=$(stty -g < "$TTY_PATH")
  stty raw -echo < "$TTY_PATH"

  if use_python_backend; then
    wait_for_focus_out_python
  else
    wait_for_focus_out_bash
  fi

  after_wait_message
else
  after_wait_message
fi

sleep "$delay"

if [[ "$osc" == "9" ]]; then
  if [[ -w "$TTY_PATH" ]]; then
    printf '\033]9;%s\007' "$payload" > "$TTY_PATH"
  else
    printf '\033]9;%s\007' "$payload"
  fi
else
  if [[ -w "$TTY_PATH" ]]; then
    printf '\033]777;notify;%s\007' "$payload" > "$TTY_PATH"
  else
    printf '\033]777;notify;%s\007' "$payload"
  fi
fi
