#!/usr/bin/env bash
set -euo pipefail

# Quick smoke test for PythonAnywhere static deployment protected by Basic Auth.
#
# Required env:
#   PA_SMOKE_USER
#   PA_SMOKE_PASS
#
# Optional env:
#   PA_SMOKE_BASE_URL (default: https://weerowoolf.pythonanywhere.com)

PA_SMOKE_USER="${PA_SMOKE_USER:-}"
PA_SMOKE_PASS="${PA_SMOKE_PASS:-}"
PA_SMOKE_BASE_URL="${PA_SMOKE_BASE_URL:-https://weerowoolf.pythonanywhere.com}"

if [[ -z "$PA_SMOKE_USER" || -z "$PA_SMOKE_PASS" ]]; then
  echo "ERROR: PA_SMOKE_USER and PA_SMOKE_PASS are required."
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

http_code() {
  local url="$1"
  shift || true
  curl -sS -o /dev/null -w '%{http_code}' "$@" "$url"
}

fetch_body() {
  local out="$1"
  local url="$2"
  shift 2 || true
  curl -sS -L "$@" "$url" -o "$out"
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local msg="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: ${msg} (expected ${expected}, got ${actual})"
    exit 1
  fi
  echo "OK: ${msg} -> ${actual}"
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local msg="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "FAIL: ${msg} (pattern not found: ${pattern})"
    exit 1
  fi
  echo "OK: ${msg}"
}

base="${PA_SMOKE_BASE_URL%/}"
root_url="${base}/"
react_url="${base}/react/"
legacy_url="${base}/legacy/index.html"

echo "==> Unauthenticated checks"
assert_eq "$(http_code "$root_url")" "401" "root requires Basic Auth"
assert_eq "$(http_code "$react_url")" "401" "/react requires Basic Auth"

echo "==> Authenticated checks"
auth=(-u "${PA_SMOKE_USER}:${PA_SMOKE_PASS}")
assert_eq "$(http_code "$root_url" "${auth[@]}")" "200" "root opens with auth"
assert_eq "$(http_code "$react_url" "${auth[@]}")" "200" "/react opens with auth"
assert_eq "$(http_code "$legacy_url" "${auth[@]}")" "200" "/legacy/index.html opens with auth"

fetch_body "$tmpdir/react.html" "$react_url" "${auth[@]}"
assert_contains "$tmpdir/react.html" "Генератор ТЗ для госзакупок" "legacy title marker present in /react"
assert_contains "$tmpdir/react.html" "themeSwitcher" "legacy UI marker present in /react"

echo "Smoke OK: PythonAnywhere protected legacy deploy is reachable and /react serves legacy HTML."
