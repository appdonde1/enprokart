#!/usr/bin/env bash
ssh -i ~/.ssh/prokart -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new root@2.24.109.98 'ufw status verbose; echo "---CURL LOCAL---"; curl -Iv http://localhost/ 2>&1 | head -15'
