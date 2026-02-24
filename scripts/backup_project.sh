#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TS="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="${BACKUP_DIR}/tz_generator_backup_${TS}.tar.gz"
CHECKSUM="${ARCHIVE}.sha256"

mkdir -p "${BACKUP_DIR}"

# Include project sources, exclude volatile and generated directories
(
  cd "${PROJECT_ROOT}"
  tar -czf "${ARCHIVE}" \
    --exclude='backups' \
    --exclude='frontend-react/node_modules' \
    --exclude='frontend-react/dist' \
    --exclude='.git' \
    .
)

shasum -a 256 "${ARCHIVE}" > "${CHECKSUM}"

echo "Backup created: ${ARCHIVE}"
echo "Checksum: ${CHECKSUM}"
