# Operación

Cómo hacer las tareas de siempre. Cada comando se corre desde la raíz del repo
(`002 Pro Kart Web`) salvo que diga otra cosa. Por qué está armado así:
[[Arquitectura]]. Lo que falta: [[Pendientes]].

> **Regla de oro:** en esta nota no hay claves. Donde un comando necesita una, se
> indica de dónde sacarla.

## Accesos: dónde vive cada cosa

| Qué | Dónde |
|---|---|
| VPS `2.24.109.98` (root) | Llave `~/.ssh/enprokart_deploy` en el equipo de enrri. Emergencia: consola web de Hostinger (hPanel). |
| Supabase (proyecto `tgilgfwxtghcqskfyzif`) | Cuenta dueña de Prokart. Para el CLI: token de acceso en `SUPABASE_ACCESS_TOKEN`. |
| `service_role` | Supabase → Settings → API, o `npx supabase projects api-keys`. No se copia a archivos. |
| Secretos de las funciones | `npx supabase secrets list` (muestra nombres, no valores). |
| Panel de personal | `enprokart.com/admin/`. Cuentas en Supabase → Authentication. |
| Correo `ventas@enprokart.com` | Hostinger → Correos. |
| Bot `@Prokart1_bot` | @BotFather en Telegram. |
| DNS y caché | Cloudflare. |

**Cuidado con la sesión del CLI de Supabase.** Se comparte con otra cuenta del
mismo equipo («Academia TEC-S») y puede cambiar sola. Antes de cualquier comando,
`npx supabase projects list` tiene que mostrar **Prokart**. Lo seguro es exportar
el token de la cuenta dueña:

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'   # de supabase.com → Account → Access Tokens
npx supabase projects list               # debe aparecer Prokart
```

## Publicar la web

```bash
./desplegar.sh              # sube 01 - Entradas al VPS por SSH y compara lo publicado
./desplegar.sh --revertir   # vuelve a la versión anterior
```

- No sube `*.txt`, `serve.ps1`, `*.mp4` ni `Evento Jorge.png`.
- **Sella las hojas y los scripts.** En la copia que sube (no en la carpeta del
  repo) agrega `?v=<fecha y hora>` a cada `css/…` y `js/…` de los HTML. Hace falta
  porque Cloudflare hace que el navegador guarde CSS y JS 4 horas: sin el sello,
  un teléfono mezcla el HTML nuevo con la hoja vieja. Imprime la versión usada
  («versión de archivos: …»).
- **Para comprobar a mano, pedir lo mismo que un navegador:** el HTML tal cual y
  las hojas con el `?v=` que figura en ese HTML. Pedirlas con un `?v=` inventado
  se salta la caché y esconde justo este problema.
- Termina con `✅ Publicado` solo si `index.html`, `js/app.js` y
  `css/style.css` servidos por enprokart.com son idénticos a los locales. Si se
  tocó otro archivo, compararlo igual:

```bash
f=admin/js/escaner.js
[ "$(md5sum < "01 - Entradas/$f")" = "$(curl -s "https://enprokart.com/$f?v=$(date +%s)" | md5sum)" ] && echo OK
```

- **Imágenes nuevas:** no abrirlas por su URL pública antes de publicarlas. Si
  Cloudflare guardó un error, pedirlas con otro `?v=` o purgar la URL.
- **Apps instaladas en el celular:** reciben lo nuevo al cerrarlas del todo y
  abrirlas. **Nunca pedir a los usuarios que borren la app.**

## Probar en local

```powershell
powershell -ExecutionPolicy Bypass -File "01 - Entradas/serve.ps1"
```

Abre `http://localhost:8080/`. Usa la base de producción: mirar sí, guardar no.

## Desplegar Edge Functions

1. Confirmar la cuenta (arriba).
2. Si hay dudas de qué corre en producción, bajar la fuente a una carpeta
   **aparte** (nunca dentro del repo, porque pisa los archivos) y comparar:

```bash
mkdir -p /tmp/fn/supabase && cp supabase/config.toml /tmp/fn/supabase/
cd /tmp/fn && npx supabase functions download <nombre> --project-ref tgilgfwxtghcqskfyzif
diff -r --strip-trailing-cr /tmp/fn/supabase/functions "<repo>/supabase/functions"
rm -rf /tmp/fn
```

3. Desplegar. `config.toml` ya dice qué funciones van sin JWT:

```bash
npx supabase functions deploy <nombre> [<otra> ...] --project-ref tgilgfwxtghcqskfyzif
```

4. **Llamarla una vez.** Una función con un error de sintaxis se despliega sin
   quejarse y después responde 503 `BOOT_ERROR` a todo. Pasó con `verify-ticket`
   durante casi un mes. Sin credenciales, lo normal es 401:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://tgilgfwxtghcqskfyzif.supabase.co/functions/v1/<nombre> -d '{}'
```

5. Si algo falla, mirar los logs (abajo) buscando `worker boot error`.

## Secretos

```bash
npx supabase secrets list                       # nombres
npx supabase secrets set SMTP_PASS=... TELEGRAM_BOT_TOKEN=...
```

Las funciones los leen al arrancar: cambiar un secreto no exige redesplegar.
Los que usa el sistema están en [[Arquitectura]] → Secretos.

## Ver los logs de las funciones

Duran alrededor de un día. Con el token de acceso:

```bash
curl -s -G "https://api.supabase.com/v1/projects/tgilgfwxtghcqskfyzif/analytics/endpoints/logs.all" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  --data-urlencode "sql=select timestamp, event_message from function_logs where event_message like '%email/%' order by timestamp desc limit 50" \
  --data-urlencode "iso_timestamp_start=$(date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "iso_timestamp_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Mensajes útiles: `email/enviado exitosamente … orden #N`, `email/error_envio`,
`telegram/sin configurar`, `worker boot error`, `asaas-webhook: token inválido`.
También se ven en Supabase → Edge Functions → la función → Logs.

## Verificar la validación de entradas sin gastar ninguna

La validación en la puerta con `"peek": true` responde lo mismo pero **no marca
la entrada como usada**.

1. Tomar una entrada `valid` con su firma (con la `service_role`, por
   PostgREST): `tickets?select=code,qr_signature&status=eq.valid&limit=1`.
2. Iniciar sesión de personal:
   `POST /auth/v1/token?grant_type=password` con la clave publicable y el correo
   y la contraseña de una cuenta del panel. Guardar el `access_token`.
3. Llamar a `verify-ticket` con `Authorization: Bearer <access_token>`.
4. Cerrar la sesión: `POST /auth/v1/logout`.

| Llamada | Esperado |
|---|---|
| `{"action":"consultar_ticket","code","signature"}` sin sesión | 200 con la entrada |
| lo mismo con la firma alterada | 403 «Firma de seguridad inválida» |
| `{"action":"consultar_por_cedula","documento"}` sin sesión | 200 |
| `{"code","signature","peek":true}` sin sesión | 401 |
| lo mismo con sesión | 200 `valid` |
| con sesión y firma alterada | 403 «El código QR fue alterado» |
| con sesión y entrada cancelada | 409 `canceled` |
| con sesión y código inexistente | 404 |

Al terminar, comprobar que la entrada sigue `valid` y `used_at` vacío.

El caso «ya utilizada» (409 `already_used`) solo se prueba gastando una entrada:
hacerlo con una cortesía de prueba.

## Avisar al equipo por el bot

Ninguna función manda un texto libre, y el token del bot solo vive en los
secretos. Se usa una función temporal protegida con el secreto del cron, se llama
**una sola vez** y se borra. Siempre desde una carpeta aparte, no dentro del repo.

**1. Preparar la carpeta**

```bash
A=/tmp/aviso && mkdir -p $A/supabase/functions/aviso-equipo
cp supabase/config.toml $A/supabase/
cp -r supabase/functions/_shared $A/supabase/functions/
```

**2. Escribir `$A/supabase/functions/aviso-equipo/index.ts`** (cambiar solo
`TEXTO`; admite HTML de Telegram: `<b>`, `<i>`):

```ts
import { serviceClient } from "../_shared/supabase.ts";
import { llamadaDeCronValida } from "../_shared/cron.ts";

const TEXTO = `✅ <b>Pro Kart · título</b>

Texto del aviso.`;

Deno.serve(async (req) => {
  const db = serviceClient();
  if (!await llamadaDeCronValida(req, db)) {
    return new Response(JSON.stringify({ ok: false, error: "No autorizado" }), { status: 401 });
  }
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chats = (Deno.env.get("TELEGRAM_CHAT_IDS") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || !chats.length) {
    return new Response(JSON.stringify({ ok: false, error: "Faltan los secretos de Telegram" }), { status: 500 });
  }
  const resultados = await Promise.all(chats.map(async (chat, i) => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: TEXTO, parse_mode: "HTML" }),
      });
      const d = await r.json().catch(() => ({}));
      return { chat: i + 1, ok: r.ok && d.ok === true, error: d.description ?? null };
    } catch (err) {
      return { chat: i + 1, ok: false, error: String(err) };
    }
  }));
  return new Response(JSON.stringify({ ok: resultados.every((r) => r.ok), resultados }),
    { headers: { "Content-Type": "application/json" } });
});
```

**3. Desplegar, enviar una vez y borrar**

```bash
REF=tgilgfwxtghcqskfyzif
# Secreto del cron, sin mostrarlo (SR = service_role)
CS=$(curl -s -X POST "https://$REF.supabase.co/rest/v1/rpc/secreto_cron" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" -d '{}' | tr -d '"')
cd $A && npx supabase functions deploy aviso-equipo --project-ref $REF --no-verify-jwt
curl -s -X POST "https://$REF.supabase.co/functions/v1/aviso-equipo" -H "x-cron-secret: $CS" -d '{}'
npx supabase functions delete aviso-equipo --project-ref $REF
rm -rf $A
```

La respuesta dice si cada chat lo recibió (`"ok": true` en los tres). **No
reintentar** si la respuesta es dudosa: se duplicaría el aviso.

**Antes de mandar:** mostrar el texto a quien lo pide, sin detalles técnicos si
va a los admins, y **no pedir nunca que borren la app**.

## Servidor

- **Sitio:** `/var/www/enprokart`; la versión anterior en `/var/www/enprokart.anterior`.
- **Nginx:** `/etc/nginx/sites-enabled/enprokart`, cabeceras en
  `snippets/prokart-seguridad.conf`. Siempre `nginx -t` antes de
  `systemctl reload nginx`.
- **SSH:** `/etc/ssh/sshd_config.d/00-solo-llaves.conf`. Siempre `sshd -t` antes
  de `systemctl reload ssh`, y probar con una conexión nueva sin cerrar la actual.
- **Respaldo previo a los cambios del 12/09:** `/root/respaldo-2026-09-12`.

```bash
ssh -i ~/.ssh/enprokart_deploy root@2.24.109.98
```

## Después de cada entrega

1. Publicar y comprobar (arriba).
2. Si se tocaron funciones: llamarlas una vez y mirar los logs.
3. Probar en un celular: portada, compra hasta el plano, «Mis entradas».
4. Entrada nueva en la [[Bitácora]], [[Arquitectura]] corregida, [[Pendientes]]
   al día y, si corresponde, [[Versiones]].
5. Commit en git.
