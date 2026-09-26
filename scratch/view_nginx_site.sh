#!/usr/bin/env bash
ssh -i ~/.ssh/prokart -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new root@2.24.109.98 'cat /etc/nginx/sites-enabled/*'
