#!/usr/bin/env bash
# Install systemd unit so Trove survives reboot (Oracle Always Free VM).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo $0"
  exit 1
fi

# Resolve real project path for the unit file
UNIT=/etc/systemd/system/trove.service
cat > "$UNIT" <<EOF
[Unit]
Description=Trove shop + behavior AI (Oracle)
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${ROOT}/server
Environment=HOST=0.0.0.0
Environment=PORT=8000
Environment=PYTHON=python3
Environment=NODE_ENV=production
# Optional: uncomment to reduce free-tier load
# Environment=AUTO_TRAIN=0
ExecStart=$(command -v node) ${ROOT}/server/server.js
Restart=on-failure
RestartSec=5
# Soft open-file limit for many bot events
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable trove.service
systemctl restart trove.service
systemctl --no-pager status trove.service || true

echo ""
echo "Service installed: trove.service"
echo "  status:  sudo systemctl status trove"
echo "  logs:    sudo journalctl -u trove -f"
echo "  stop:    sudo systemctl stop trove"
echo "  restart: sudo systemctl restart trove"
