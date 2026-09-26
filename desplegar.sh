#!/usr/bin/env bash
# Publica el sitio (01 - Entradas) en el VPS por SSH.
#
#   ./desplegar.sh              publica lo que hay en la carpeta
#   ./desplegar.sh --revertir   vuelve a la versión publicada antes
#
# Reemplaza al webhook por HTTPS que había acá. Ese endpoint era público, su
# token estaba escrito en este mismo archivo y corría como root descomprimiendo
# lo que le llegara: quien tuviera una copia del repo podía cambiar la página
# de pago. Por SSH la credencial es la llave, y en el servidor no queda nada
# escuchando.
#
# Publicar es un intercambio de carpetas: se sube a una nueva, se comprueba y
# recién ahí se cambia por la actual, que queda como `.anterior` para volver.
set -euo pipefail

SERVIDOR="${PROKART_SSH:-root@2.24.109.98}"
LLAVE="${PROKART_LLAVE:-$HOME/.ssh/enprokart_deploy}"
DESTINO="/var/www/enprokart"
ORIGEN="01 - Entradas"
SITIO="https://enprokart.com"

ssh_vps() {
  ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "$SERVIDOR" "$@"
}

if [ "${1:-}" = "--revertir" ]; then
  ssh_vps "set -e
    [ -d $DESTINO.anterior ] || { echo 'No hay versión anterior para volver.'; exit 1; }
    mv $DESTINO $DESTINO.revertida
    mv $DESTINO.anterior $DESTINO
    mv $DESTINO.revertida $DESTINO.anterior"
  echo "↩️  Revertido. La versión que se quitó quedó como $DESTINO.anterior"
  exit 0
fi

[ -d "$ORIGEN" ] || { echo "❌ No encuentro '$ORIGEN'. Corre este comando desde la raíz del proyecto."; exit 1; }

paquete="$(mktemp -t prokart-XXXX.tgz)"
preparado="$(mktemp -d -t prokart-XXXX)"
trap 'rm -rf "$paquete" "$preparado"' EXIT

cp -r "$ORIGEN"/. "$preparado"/

# Cada publicación le pone un ?v= nuevo a las hojas y scripts propios en todos
# los HTML. Hace falta porque Cloudflare le dice al navegador que guarde CSS y JS
# cuatro horas (max-age=14400) aunque Nginx diga no-cache. Sin esto, el teléfono
# de alguien carga el HTML nuevo con la hoja vieja: el 2026-09-12 así volvieron
# a verse la foto de fondo y el botón grande que ya se habían quitado.
# La carpeta del repo no se toca: el sello va solo en la copia que se sube.
estampa="$(date +%Y%m%d%H%M%S)"
find "$preparado" -name "*.html" -print0 | xargs -0 sed -i -E \
  "s#((href|src)=\"(\.\./)?(css|js)/[^\"?]+\.(css|js))\"#\1?v=$estampa\"#g"

# Fuera del paquete: notas internas, el servidor de pruebas y los originales
# pesados que la página no usa (evento.jpg es la versión liviana de
# «Evento Jorge.png»).
GZIP=-9 tar -czf "$paquete" -C "$preparado" \
  --exclude='*.txt' --exclude='serve.ps1' --exclude='.DS_Store' \
  --exclude='Evento Jorge.png' --exclude='*.mp4' .
echo "📦 Paquete: $(du -h "$paquete" | cut -f1)  ·  versión de archivos: $estampa"

echo "🚀 Subiendo a $SERVIDOR..."
ssh_vps "set -e
  rm -rf $DESTINO.nuevo
  mkdir -p $DESTINO.nuevo
  tar -xzf - -C $DESTINO.nuevo --no-same-owner
  test -s $DESTINO.nuevo/index.html
  chown -R www-data:www-data $DESTINO.nuevo
  find $DESTINO.nuevo -type d -exec chmod 755 {} +
  find $DESTINO.nuevo -type f -exec chmod 644 {} +
  rm -rf $DESTINO.anterior
  if [ -d $DESTINO ]; then mv $DESTINO $DESTINO.anterior; fi
  mv $DESTINO.nuevo $DESTINO" < "$paquete"

# Se comprueba lo que recibe un navegador de verdad: el HTML tal cual y las hojas
# y scripts con el mismo ?v= que llevan los HTML publicados, pasando por
# Cloudflare. Antes se pedía con un ?v= inventado, que se saltaba la caché y no
# podía detectar una hoja vieja.
echo "🔎 Comprobando..."
fallos=0
for archivo in index.html js/app.js css/style.css css/barra.css; do
  [ -f "$preparado/$archivo" ] || continue
  local_md5=$(md5sum < "$preparado/$archivo" | cut -c1-32)
  if [ "$archivo" = "index.html" ]; then url="$SITIO/"; else url="$SITIO/$archivo?v=$estampa"; fi
  remoto_md5=$(curl -sS "$url" | md5sum | cut -c1-32)
  if [ "$local_md5" = "$remoto_md5" ]; then echo "   ✓ $archivo"; else echo "   ✗ $archivo no coincide"; fallos=1; fi
done
# Primero se guarda el HTML y después se busca: con `curl | grep -q`, grep corta
# la lectura al encontrar el texto, curl falla por la tubería cerrada y, con
# pipefail, el script lo tomaba como que no estaba.
html_publicado="$(curl -sS "$SITIO/")"
if ! grep -q "css/style.css?v=$estampa" <<< "$html_publicado"; then
  echo "   ✗ el HTML publicado no pide las hojas de esta versión"; fallos=1
fi
codigo=$(curl -sS -o /dev/null -w "%{http_code}" "$SITIO/")
echo "   $SITIO → HTTP $codigo"

if [ "$fallos" = 0 ] && [ "$codigo" = 200 ]; then
  echo "✅ Publicado. Para volver atrás: ./desplegar.sh --revertir"
else
  echo "⚠️  Publicado, pero la comprobación falló. Revisa, o vuelve atrás con ./desplegar.sh --revertir"
  exit 1
fi
