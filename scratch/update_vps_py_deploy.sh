#!/usr/bin/env bash
ssh -i ~/.ssh/prokart -p 2222 -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new root@2.24.109.98 bash -s << 'EOF'
cat << 'PYEOF' > /usr/local/bin/deploy-server.py
import http.server
import subprocess
import os

SECRET = "ProkartDeploy2026SecretKey#"

class DeployHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/deploy-webhook-secret-pk":
            token = self.headers.get("X-Deploy-Token")
            if token != SECRET:
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b"Forbidden")
                return
            
            length = int(self.headers.get("Content-Length", 0))
            remaining = length
            
            with open("/tmp/prokart.tgz", "wb") as f:
                while remaining > 0:
                    chunk_size = min(remaining, 65536)
                    chunk = self.rfile.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
            
            try:
                cmd = (
                    "rm -rf /var/www/enprokart.nuevo && "
                    "mkdir -p /var/www/enprokart.nuevo && "
                    "tar -xzf /tmp/prokart.tgz -C /var/www/enprokart.nuevo && "
                    "chown -R www-data:www-data /var/www/enprokart.nuevo && "
                    "rm -rf /var/www/enprokart.viejo && "
                    "[ -d /var/www/enprokart ] && mv /var/www/enprokart /var/www/enprokart.viejo && "
                    "mv /var/www/enprokart.nuevo /var/www/enprokart && "
                    "rm -rf /var/www/enprokart.viejo && "
                    "systemctl reload nginx"
                )
                subprocess.check_call(cmd, shell=True)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"DEPLOY_OK")
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", 9999), DeployHandler)
    server.serve_forever()
PYEOF

systemctl restart prokart-deploy
echo "PY_DEPLOY_STREAM_UPDATED"
EOF
