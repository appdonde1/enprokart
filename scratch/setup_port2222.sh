#!/usr/bin/env bash
ssh -i ~/.ssh/prokart -o ConnectTimeout=10 root@2.24.109.98 bash -s << 'EOF'
set -euo pipefail
echo -e "Port 22\nPort 2222" > /etc/ssh/sshd_config.d/custom_port.conf
ufw allow 2222/tcp
systemctl restart ssh || systemctl restart sshd
echo "SETUP_2222_SUCCESSFUL"
EOF
