# 2026-08-14 · Despliegue HTTPS, Hostinger SMTP, Bot Telegram, Consulta por Cédula/CPF y Retención de 90 Días

## Resumen del Trabajo

1. **Sistema de Despliegue Automático por HTTPS (`./desplegar.sh`)**:
   - Se migró el despliegue del sitio web de SCP/SSH a una petición HTTPS POST directa a `https://enprokart.com/api/deploy-webhook-secret-pk`.
   - Implementado en el VPS con un servicio systemd `prokart-deploy.service` ejecutando un servidor nativo en Python 3 (`/usr/local/bin/deploy-server.py`) que escucha localmente en el puerto 9999 y es redirigido por Nginx.
   - Soluciona de forma definitiva los bloqueos del puerto SSH (22) por parte de proveedores de Internet residenciales.

   > **Retirado el 2026-09-12.** El endpoint era público, su token estaba escrito
   > en el repo y el servicio corría como root. El deploy volvió a ser por SSH
   > (`./desplegar.sh`). Ver [[2026-09-12 - revisión contra producción, portada panorámica y deploy por ssh]].

2. **Email Transaccional (Hostinger SMTP + DKIM/SPF)**:
   - Configurado en `supabase/functions/_shared/email.ts` con servidor `smtp.hostinger.com:465`.
   - Remitente oficial: `"ProKart" <ventas@enprokart.com>`.
   - Incluye plantilla HTML oscura con detalles dorados, isotipo blanco de ProKart y generación de códigos QR por entrada.
   - Configurado y verificado el registro **DKIM TXT** (`hostingermail1._domainkey.enprokart.com`) en Cloudflare DNS junto con SPF y DMARC para garantizar la entrega inmediata en Gmail sin filtros.

   > **Desde el 2026-09-12** la contraseña del buzón no está en el código: vive en
   > el secreto `SMTP_PASS` de Supabase.

3. **Notificaciones Automáticas por Telegram**:
   - Bot `@Prokart1_bot` conectado en `supabase/functions/_shared/telegram.ts`.
   - Dispara alertas instantáneas a **3 chats** en cada compra confirmada o cortesía emitida.

   > **Desde el 2026-09-12** el token del bot y los chats viven en los secretos
   > `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_IDS`. Esta nota tenía el comienzo del
   > token y los tres identificadores de chat: se quitaron.

4. **Portal de Consulta por Cédula / CPF ([`verificar.html`](file:///c:/Users/danil/OneDrive/Documentos/Pro%20Kart%20Web/01%20-%20Entradas/verificar.html))**:
   - Interfaz simplificada y optimizada exclusivamente para clientes bajo la etiqueta `Cédula / CPF`.
   - Búsqueda flexible en `verify-ticket` que normaliza CPF brasileño (dígitos limpios o formato `000.000.000-00`) y cédula venezolana (`V-12345678`).

5. **Retención de 90 Días y Purga Automática**:
   - Migración [`20260814000003_retencion_90_dias.sql`](file:///c:/Users/danil/OneDrive/Documentos/Pro%20Kart%20Web/supabase/migrations/20260814000003_retencion_90_dias.sql) aplicada en Supabase.
   - Función `public.cleanup_old_records_90_days()` programada diariamente a las 03:00 AM con `pg_cron`.
