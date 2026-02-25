#!/usr/bin/env bash
set -euo pipefail

# Deploy static tz_generator assets to PythonAnywhere using official API.
#
# Required env:
#   PA_USERNAME      - PythonAnywhere username
#   PA_API_TOKEN     - API token from Account -> API Token
#
# Optional env:
#   PA_HOST          - www.pythonanywhere.com (default) or eu.pythonanywhere.com
#   PA_DOMAIN        - target domain; defaults to <username>.pythonanywhere.com
#                      or <username>.eu.pythonanywhere.com for EU host
#   PA_PYTHON_VERSION- python312 (default) used only on webapp creation
#   PA_SITE_PATH     - /home/<username>/tz_generator_site (default)

PA_USERNAME="${PA_USERNAME:-}"
PA_API_TOKEN="${PA_API_TOKEN:-}"
PA_HOST="${PA_HOST:-www.pythonanywhere.com}"
PA_PYTHON_VERSION="${PA_PYTHON_VERSION:-python312}"
PA_REACT_MODE="${PA_REACT_MODE:-react}"

if [[ -z "$PA_USERNAME" || -z "$PA_API_TOKEN" ]]; then
  echo "ERROR: PA_USERNAME and PA_API_TOKEN are required."
  exit 1
fi

if [[ "$PA_HOST" == eu.pythonanywhere.com ]]; then
  PA_DOMAIN="${PA_DOMAIN:-${PA_USERNAME}.eu.pythonanywhere.com}"
else
  PA_DOMAIN="${PA_DOMAIN:-${PA_USERNAME}.pythonanywhere.com}"
fi

PA_SITE_PATH="${PA_SITE_PATH:-/home/${PA_USERNAME}/tz_generator_site}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FILES_TO_UPLOAD=(
  "index.html"
  "legacy/index.html"
  "docx.min.js"
  "html2pdf.bundle.min.js"
)
REACT_DIST_DIR="${PROJECT_ROOT}/frontend-react/dist"

for rel in "${FILES_TO_UPLOAD[@]}"; do
  if [[ ! -f "${PROJECT_ROOT}/${rel}" ]]; then
    echo "ERROR: Missing file ${PROJECT_ROOT}/${rel}"
    exit 1
  fi
done

BASE_URL="https://${PA_HOST}/api/v0/user/${PA_USERNAME}"
AUTH_HEADER="Authorization: Token ${PA_API_TOKEN}"

request() {
  local method="$1"
  local url="$2"
  shift 2
  local response
  response="$(curl -sS -w $'\n%{http_code}' -X "$method" -H "$AUTH_HEADER" "$@" "$url")"
  local status="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  printf '%s\n' "$status"
  printf '%s' "$body"
}

API_STATUS=""
API_BODY=""
call_request() {
  local raw
  raw="$(request "$@")"
  API_STATUS="${raw%%$'\n'*}"
  if [[ "$raw" == *$'\n'* ]]; then
    API_BODY="${raw#*$'\n'}"
  else
    API_BODY=""
  fi
}

assert_status() {
  local status="$1"
  local expected_csv="$2"
  local body="$3"
  IFS=',' read -r -a expected <<< "$expected_csv"
  for code in "${expected[@]}"; do
    if [[ "$status" == "$code" ]]; then
      return 0
    fi
  done
  echo "ERROR: HTTP ${status}, expected ${expected_csv}"
  if [[ -n "$body" ]]; then
    echo "Response body:"
    echo "$body"
  fi
  exit 1
}

urlencode() {
  python3 - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=''))
PY
}

echo "==> Checking webapp list for ${PA_DOMAIN}"
call_request GET "${BASE_URL}/webapps/"
list_status="$API_STATUS"
list_body="$API_BODY"
assert_status "$list_status" "200" "$list_body"

webapp_exists="$(
  PA_JSON="$list_body" python3 - "$PA_DOMAIN" <<'PY'
import json, os, sys
domain = sys.argv[1]
text = os.environ.get("PA_JSON", "").strip()
if not text:
    print("0")
    raise SystemExit
data = json.loads(text)
if isinstance(data, dict):
    items = data.get("webapps", [])
elif isinstance(data, list):
    items = data
else:
    items = []
for item in items:
    if isinstance(item, dict) and item.get("domain_name") == domain:
        print("1")
        break
else:
    print("0")
PY
)"

if [[ "$webapp_exists" != "1" ]]; then
  echo "==> Creating webapp ${PA_DOMAIN} (${PA_PYTHON_VERSION})"
  call_request POST "${BASE_URL}/webapps/" \
    --data-urlencode "domain_name=${PA_DOMAIN}" \
    --data-urlencode "python_version=${PA_PYTHON_VERSION}"
  create_status="$API_STATUS"
  create_body="$API_BODY"
  assert_status "$create_status" "201,200" "$create_body"
else
  echo "==> Webapp exists, reusing ${PA_DOMAIN}"
fi

echo "==> Uploading static files to ${PA_SITE_PATH}"
for rel in "${FILES_TO_UPLOAD[@]}"; do
  src="${PROJECT_ROOT}/${rel}"
  dst="${PA_SITE_PATH}/${rel}"
  call_request POST "${BASE_URL}/files/path${dst}" -F "content=@${src}"
  up_status="$API_STATUS"
  up_body="$API_BODY"
  assert_status "$up_status" "201,200" "$up_body"
  echo "   uploaded: ${rel}"
done

if [[ "${PA_REACT_MODE}" == "legacy" ]]; then
  echo "==> Using legacy HTML for /react"
  call_request POST "${BASE_URL}/files/path${PA_SITE_PATH}/react/index.html" -F "content=@${PROJECT_ROOT}/legacy/index.html"
  assert_status "$API_STATUS" "201,200" "$API_BODY"
  call_request POST "${BASE_URL}/files/path${PA_SITE_PATH}/react/docx.min.js" -F "content=@${PROJECT_ROOT}/docx.min.js"
  assert_status "$API_STATUS" "201,200" "$API_BODY"
  call_request POST "${BASE_URL}/files/path${PA_SITE_PATH}/react/html2pdf.bundle.min.js" -F "content=@${PROJECT_ROOT}/html2pdf.bundle.min.js"
  assert_status "$API_STATUS" "201,200" "$API_BODY"
else
  # Build and upload React app under /react if frontend-react is present.
  if [[ -f "${PROJECT_ROOT}/frontend-react/package.json" ]]; then
    echo "==> Building React app (frontend-react)"
    if [[ ! -d "${PROJECT_ROOT}/frontend-react/node_modules" ]]; then
      (cd "${PROJECT_ROOT}/frontend-react" && npm ci)
    fi
    (cd "${PROJECT_ROOT}/frontend-react" && npm run build)

    if [[ -d "${REACT_DIST_DIR}" ]]; then
      echo "==> Uploading React static files to ${PA_SITE_PATH}/react"
      while IFS= read -r -d '' file; do
        rel="${file#${REACT_DIST_DIR}/}"
        dst="${PA_SITE_PATH}/react/${rel}"
        call_request POST "${BASE_URL}/files/path${dst}" -F "content=@${file}"
        up_status="$API_STATUS"
        up_body="$API_BODY"
        assert_status "$up_status" "201,200" "$up_body"
        echo "   uploaded react: ${rel}"
      done < <(find "${REACT_DIST_DIR}" -type f -print0)
    fi
  fi
fi

domain_enc="$(urlencode "$PA_DOMAIN")"
echo "==> Ensuring static mapping '/' -> ${PA_SITE_PATH}"
call_request GET "${BASE_URL}/webapps/${domain_enc}/static_files/"
static_status="$API_STATUS"
static_body="$API_BODY"
assert_status "$static_status" "200" "$static_body"

root_mapping_id="$(
  PA_JSON="$static_body" python3 - <<'PY'
import json, os
text = os.environ.get("PA_JSON", "").strip()
if not text:
    print("")
    raise SystemExit
data = json.loads(text)
if isinstance(data, dict):
    items = data.get("static_files", [])
elif isinstance(data, list):
    items = data
else:
    items = []
for item in items:
    if isinstance(item, dict) and item.get("url") == "/":
        print(item.get("id", ""))
        break
else:
    print("")
PY
)"

if [[ -n "$root_mapping_id" ]]; then
  call_request PATCH "${BASE_URL}/webapps/${domain_enc}/static_files/${root_mapping_id}/" \
    --data-urlencode "url=/" \
    --data-urlencode "path=${PA_SITE_PATH}"
  patch_status="$API_STATUS"
  patch_body="$API_BODY"
  assert_status "$patch_status" "200" "$patch_body"
else
  call_request POST "${BASE_URL}/webapps/${domain_enc}/static_files/" \
    --data-urlencode "url=/" \
    --data-urlencode "path=${PA_SITE_PATH}"
  post_static_status="$API_STATUS"
  post_static_body="$API_BODY"
  assert_status "$post_static_status" "201,200" "$post_static_body"
fi

echo "==> Reloading webapp ${PA_DOMAIN}"
call_request POST "${BASE_URL}/webapps/${domain_enc}/reload/"
reload_status="$API_STATUS"
reload_body="$API_BODY"
assert_status "$reload_status" "200,202" "$reload_body"

echo ""
echo "Deployment completed."
echo "URL: https://${PA_DOMAIN}/"
