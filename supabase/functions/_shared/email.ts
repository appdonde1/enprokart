import nodemailer from "npm:nodemailer@6.9.13";

/* Las credenciales del buzón viven en los secretos de Supabase, no acá. Estaban
   escritas en este archivo: viajaban con cada copia de la carpeta y con cada
   despliegue. Se cargan con: supabase secrets set SMTP_HOST=... SMTP_USER=...
   Si faltan, nodemailer no autentica y enviarEntradasPorCorreo devuelve false:
   la compra sigue su curso y la entrada se puede reenviar. */
const SMTP_CONFIG = {
  host: Deno.env.get("SMTP_HOST") ?? "smtp.hostinger.com",
  port: Number(Deno.env.get("SMTP_PORT") ?? "465"),
  secure: true,
  auth: {
    user: Deno.env.get("SMTP_USER") ?? "",
    pass: Deno.env.get("SMTP_PASS") ?? "",
  },
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

export interface EntradaEmail {
  code: string;
  qrSignature: string;
  tableCode?: string | null;
  guestIndex: number;
}

export interface DatosEnvioEntradas {
  destinatario: string;
  nombreComprador: string;
  documento?: string | null;
  orderNumber: number | string;
  eventoNombre: string;
  eventoFecha?: string | null;
  seccionNombre: string;
  mesas?: string | null;
  entradas: EntradaEmail[];
}

export async function enviarEntradasPorCorreo(datos: DatosEnvioEntradas): Promise<boolean> {
  if (!datos.destinatario || !datos.destinatario.includes("@")) {
    console.warn("email/sin_destinatario:", datos.destinatario);
    return false;
  }

  const tarjetasEntradasHtml = datos.entradas.map((t) => {
    const qrUrl = `https://enprokart.com/verificar.html?c=${encodeURIComponent(t.code)}&s=${encodeURIComponent(t.qrSignature)}`;
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(qrUrl)}`;

    return `
      <div style="background: #141614; border: 1px solid #2e352e; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
        <p style="margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #d9b85d; font-weight: 700;">
          Entrada ${t.guestIndex} de ${datos.entradas.length}
        </p>
        <p style="margin: 0 0 14px; font-size: 16px; color: #f2f4f2; font-weight: 600;">
          ${t.tableCode ? `Mesa: <b>${t.tableCode}</b>` : `Sección: <b>${datos.seccionNombre}</b>`}
        </p>

        <div style="background: #ffffff; padding: 12px; border-radius: 8px; display: inline-block; margin-bottom: 14px;">
          <img src="${qrImgSrc}" alt="Código QR de Entrada" width="180" height="180" style="display: block; border: 0;" />
        </div>

        <p style="margin: 0 0 6px; font-size: 12px; color: #9aa89a;">Código de validación:</p>
        <p style="margin: 0; font-family: monospace; font-size: 15px; letter-spacing: 0.1em; color: #ff5936; font-weight: 700;">
          ${t.code}
        </p>
      </div>
    `;
  }).join("");

  const urlConsulta = datos.documento
    ? `https://enprokart.com/verificar.html?cedula=${encodeURIComponent(datos.documento)}`
    : `https://enprokart.com/verificar.html`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Tus entradas para Pro Kart</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #090a09; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e6e8e6;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090a09; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" style="max-width: 600px; background: #0f110f; border: 1px solid #232823; border-radius: 16px; overflow: hidden;" cellpadding="0" cellspacing="0">
              <!-- Encabezado -->
              <tr>
                <td style="background: #141614; padding: 25px; text-align: center; border-bottom: 1px solid #232823;">
                  <img src="https://enprokart.com/Logo%20Prokart%20blanco.png" alt="ProKart" width="160" style="display: block; margin: 0 auto 10px; border: 0;" />
                  <p style="margin: 4px 0 0; color: #d9b85d; font-size: 13px; font-weight: 600;">
                    Comprobante y Entradas Oficiales
                  </p>
                </td>
              </tr>

              <!-- Cuerpo -->
              <tr>
                <td style="padding: 30px 25px;">
                  <h2 style="margin: 0 0 10px; font-size: 20px; color: #ffffff;">
                    ¡Hola, ${datos.nombreComprador}!
                  </h2>
                  <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #b0beb0;">
                    Tu compra para <b>${datos.eventoNombre}</b> ha sido confirmada con éxito. Aquí tienes tus entradas digitales y códigos QR de acceso.
                  </p>

                  <div style="background: #141614; border-radius: 10px; padding: 16px; margin-bottom: 25px; font-size: 14px; line-height: 1.6; border-left: 3px solid #d9b85d;">
                    <p style="margin: 0;"><b>Evento:</b> ${datos.eventoNombre}</p>
                    ${datos.eventoFecha ? `<p style="margin: 4px 0 0;"><b>Fecha:</b> ${datos.eventoFecha}</p>` : ""}
                    <p style="margin: 4px 0 0;"><b>Orden N.º:</b> #${datos.orderNumber}</p>
                    <p style="margin: 4px 0 0;"><b>Ubicación:</b> ${datos.seccionNombre}${datos.mesas ? ` (Mesa(s): ${datos.mesas})` : ""}</p>
                    ${datos.documento ? `<p style="margin: 4px 0 0;"><b>Titular:</b> ${datos.nombreComprador} · C.I. ${datos.documento}</p>` : ""}
                  </div>

                  <!-- Entradas -->
                  <h3 style="margin: 0 0 14px; font-size: 16px; color: #ffffff; border-bottom: 1px solid #232823; padding-bottom: 8px;">
                    Tus Entradas (${datos.entradas.length})
                  </h3>

                  ${tarjetasEntradasHtml}

                  <div style="text-align: center; margin-top: 25px; padding: 20px; background: #141614; border-radius: 10px;">
                    <p style="margin: 0 0 12px; font-size: 13px; color: #9aa89a;">
                      También puedes consultar y descargar tus entradas en cualquier momento ingresando tu cédula en nuestra web:
                    </p>
                    <a href="${urlConsulta}" style="display: inline-block; background: #ff5936; color: #090a09; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
                      Ver mis entradas en la web
                    </a>
                  </div>
                </td>
              </tr>

              <!-- Pie -->
              <tr>
                <td style="background: #090a09; padding: 20px; text-align: center; border-top: 1px solid #232823; font-size: 12px; color: #6a786a;">
                  <p style="margin: 0 0 6px;">ProKart · Todos los derechos reservados</p>
                  <p style="margin: 0;">Presenta este correo o el código QR desde tu móvil al llegar a la puerta del evento.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: '"ProKart" <ventas@enprokart.com>',
      to: datos.destinatario,
      subject: `Tus entradas para ${datos.eventoNombre} (Orden #${datos.orderNumber})`,
      html,
    });
    console.log(`email/enviado exitosamente a ${datos.destinatario} para orden #${datos.orderNumber}`);
    return true;
  } catch (error) {
    console.error("email/error_envio:", error);
    return false;
  }
}
