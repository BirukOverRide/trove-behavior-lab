#!/usr/bin/env bash
# One-time setup on a fresh Oracle Linux / Ubuntu Always Free VM.
# Run as the deploy user (not necessarily root for app bits; sudo for packages).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Trove · Oracle setup"
echo "    project: $ROOT"

# Detect package manager
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  echo "Unknown package manager. Install nodejs 20+, python3, python3-pip, build tools manually."
  PKG=
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=
else
  SUDO=sudo
fi

if [[ -n "$PKG" ]]; then
  echo "==> System packages ($PKG)"
  if [[ "$PKG" == "apt" ]]; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y curl ca-certificates git build-essential python3 python3-pip python3-venv
    # Node 20 via NodeSource if missing / too old
    if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
      $SUDO apt-get install -y nodejs
    fi
  else
    $SUDO $PKG install -y git gcc gcc-c++ make python3 python3-pip curl
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
      $SUDO $PKG install -y nodejs
    fi
  fi
fi

echo "==> Node $(node -v) · npm $(npm -v) · Python $(python3 --version)"

echo "==> Server deps"
cd "$ROOT/server"
npm install --omit=dev

echo "==> Client deps + production build"
cd "$ROOT/client"
npm install
npm run build

echo "==> Python ML deps"
cd "$ROOT/ml_transformer"
python3 -m pip install --user -r requirements.txt || python3 -m pip install --user numpy

echo "==> Env file"
if [[ ! -f "$ROOT/server/.env" ]]; then
  cp "$ROOT/server/.env.example" "$ROOT/server/.env"
  echo "    Created server/.env — edit XAI_API_KEY if you use Trove Chat"
fi

# Production-friendly defaults (append if missing)
ENVF="$ROOT/server/.env"
grep -q '^HOST=' "$ENVF" 2>/dev/null || echo 'HOST=0.0.0.0' >> "$ENVF"
grep -q '^PORT=' "$ENVF" 2>/dev/null || echo 'PORT=8000' >> "$ENVF"
# Slightly gentler train defaults on free-tier CPU
grep -q '^AUTO_TRAIN_EPOCHS=' "$ENVF" 2>/dev/null || echo 'AUTO_TRAIN_EPOCHS=12' >> "$ENVF"
grep -q '^AUTO_TRAIN_INTERVAL_MS=' "$ENVF" 2>/dev/null || echo 'AUTO_TRAIN_INTERVAL_MS=120000' >> "$ENVF"

echo ""
echo "==> Setup done."
echo "    Start:   $ROOT/deploy/oracle/start.sh"
echo "    Service: $ROOT/deploy/oracle/install-service.sh   (keeps it running after reboot)"
echo "    Guide:   $ROOT/deploy/oracle/ORACLE.md"
echo ""
echo "    Open firewall port 8000 in Oracle Cloud Console (VCN security list / NSG)."
echo "    Then visit: http://YOUR_PUBLIC_IP:8000"
echo "    Admin:     http://YOUR_PUBLIC_IP:8000/admin"
echo "               admin@trove.shop / admin123"
