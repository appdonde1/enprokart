#!/usr/bin/env bash
# Sube el sitio al VPS. Un comando: ./desplegar.sh
#
# El sitio es estático: acá solo viajan archivos. La base, la autenticación y
# las funciones de cobro viven en Supabase y no se tocan desde este guion; para
# esas va `supabase functions deploy`.
set -euo pipefail

HOST="${PROKART_HOST:-root@2.24.109.98}"
CLAVE="${PROKART_KEY:-$HOME/.ssh/prokart}"
ORIGEN="01 - Entradas"
DESTINO="/var/www/enprokart"

[ -d "$ORIGEN" ] || { echo "No encuentro '$ORIGEN'. Corré esto desde la raíz del repositorio."; exit 1; }
[ -f "$CLAVE" ] || { echo "No encuentro la clave en $CLAVE. Ponela ahí o exportá PROKART_KEY."; exit 1; }

paquete="$(mktemp -t prokart-XXXX.tgz)"
trap 'rm -f "$paquete"' EXIT

# Se excluye lo que no es parte del sitio publicado.
tar -czf "$paquete" -C "$ORIGEN" --exclude='*.txt' --exclude='serve.ps1' --exclude='.DS_Store' .
echo "empaquetado: $(du -h "$paquete" | cut -f1)"

scp -i "$CLAVE" -o StrictHostKeyChecking=accept-new "$paquete" "$HOST:/tmp/prokart.tgz"

# El reemplazo va en un directorio nuevo y después se cambia de nombre: si algo
# falla a mitad de camino, el sitio que está sirviendo no queda a medias.
ssh -i "$CLAVE" -o StrictHostKeyChecking=accept-new "$HOST" bash -s <<'REMOTO'
set -euo pipefail
nuevo="/var/www/enprokart.nuevo"
rm -rf "$nuevo" && mkdir -p "$nuevo"
tar -xzf /tmp/prokart.tgz -C "$nuevo"
rm -f /tmp/prokart.tgz

chown -R www-data:www-data "$nuevo"
find "$nuevo" -type d -exec chmod 755 {} \;
find "$nuevo" -type f -exec chmod 644 {} \;

rm -rf /var/www/enprokart.viejo
[ -d /var/www/enprokart ] && mv /var/www/enprokart /var/www/enprokart.viejo
mv "$nuevo" /var/www/enprokart
rm -rf /var/www/enprokart.viejo

nginx -t >/dev/null && systemctl reload nginx
echo "publicados $(find /var/www/enprokart -type f | wc -l) archivos"
REMOTO

echo "comprobando…"
codigo=$(curl -sS -o /dev/null -w "%{http_code}" https://enprokart.com/)
echo "https://enprokart.com  HTTP $codigo"
