#!/usr/bin/env bash
ssh -i ~/.ssh/prokart -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new root@2.24.109.98 'iptables -L -n -v | head -30; echo "---NGINX STATUS---"; systemctl status nginx --no-pager | head -10'
