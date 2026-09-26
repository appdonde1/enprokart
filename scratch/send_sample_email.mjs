import nodemailer from "nodemailer";

const SMTP_CONFIG = {
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "ventas@enprokart.com",
    pass: "Prokart26#",
  },
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

const destinatarios = [
  { email: "betsimarquintero027@gmail.com", nombre: "Betsimar Quintero" },
  { email: "comercialsimancas.s@gmail.com", nombre: "Javier Simancas" }
];

async function enviarPrueba() {
  for (const d of destinatarios) {
    const code1 = "EVT-ORO-DEMO-01";
    const code2 = "EVT-ORO-DEMO-02";
    const qrUrl1 = `https://enprokart.com/verificar.html?c=${encodeURIComponent(code1)}&s=DEMOSIG1`;
    const qrUrl2 = `https://enprokart.com/verificar.html?c=${encodeURIComponent(code2)}&s=DEMOSIG2`;
    
    const qrImg1 = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(qrUrl1)}`;
    const qrImg2 = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(qrUrl2)}`;

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Tus Entradas · Pro Kart</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #090a09; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #f2f4f2;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #090a09; padding: 30px 10px;">
          <tr>
            <td align="center">
              <table width="100%" max-width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #101210; border: 1px solid #232823; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                
                <!-- Encabezado / Logo -->
                <tr>
                  <td style="padding: 28px 24px 20px; text-align: center; border-bottom: 1px solid #1c211c; background: radial-gradient(circle at 50% 0%, #1d241d 0%, #101210 70%);">
                    <img src="https://enprokart.com/Logo%20Prokart%20blanco.png" alt="Pro Kart" width="160" style="display: block; margin: 0 auto 12px; border: 0;" />
                    <h1 style="margin: 0; font-size: 22px; color: #ffffff; font-weight: 800; letter-spacing: -0.02em;">¡Tus entradas están listas!</h1>
                    <p style="margin: 6px 0 0; font-size: 14px; color: #d9b85d; font-weight: 600;">Pro Kart Evento Oficial</p>
                  </td>
                </tr>

                <!-- Contenido -->
                <tr>
                  <td style="padding: 24px;">
                    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #d0d7d0;">
                      Hola <strong style="color: #ffffff;">${d.nombre}</strong>, tu compra ha sido confirmada exitosamente. A continuación encontrarás tus entradas con código QR para el acceso al evento:
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" style="background: #161916; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px; font-size: 14px;">
                      <tr>
                        <td style="padding: 4px 0; color: #889688;">N.º de Orden:</td>
                        <td style="padding: 4px 0; color: #ffffff; font-weight: 700; text-align: right;">#DEMO-8842</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #889688;">Evento:</td>
                        <td style="padding: 4px 0; color: #ffffff; font-weight: 700; text-align: right;">Gran Premio Pro Kart 2026</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #889688;">Sección / Ubicación:</td>
                        <td style="padding: 4px 0; color: #d9b85d; font-weight: 700; text-align: right;">Área ORO · Mesa A1</td>
                      </tr>
                    </table>

                    <!-- Tarjeta 1 -->
                    <div style="background: #141614; border: 1px solid #2e352e; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
                      <p style="margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #d9b85d; font-weight: 700;">
                        Entrada 1 de 2
                      </p>
                      <p style="margin: 0 0 14px; font-size: 16px; color: #f2f4f2; font-weight: 600;">
                        Mesa: <b>A1</b> (Asiento 1)
                      </p>

                      <div style="background: #ffffff; padding: 12px; border-radius: 8px; display: inline-block; margin-bottom: 14px;">
                        <img src="${qrImg1}" alt="Código QR de Entrada 1" width="180" height="180" style="display: block; border: 0;" />
                      </div>

                      <p style="margin: 0 0 6px; font-size: 12px; color: #9aa89a;">Código de validación:</p>
                      <p style="margin: 0; font-family: monospace; font-size: 16px; letter-spacing: 0.12em; color: #ff5936; font-weight: 700;">
                        ${code1}
                      </p>
                    </div>

                    <!-- Tarjeta 2 -->
                    <div style="background: #141614; border: 1px solid #2e352e; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
                      <p style="margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #d9b85d; font-weight: 700;">
                        Entrada 2 de 2
                      </p>
                      <p style="margin: 0 0 14px; font-size: 16px; color: #f2f4f2; font-weight: 600;">
                        Mesa: <b>A1</b> (Asiento 2)
                      </p>

                      <div style="background: #ffffff; padding: 12px; border-radius: 8px; display: inline-block; margin-bottom: 14px;">
                        <img src="${qrImg2}" alt="Código QR de Entrada 2" width="180" height="180" style="display: block; border: 0;" />
                      </div>

                      <p style="margin: 0 0 6px; font-size: 12px; color: #9aa89a;">Código de validación:</p>
                      <p style="margin: 0; font-family: monospace; font-size: 16px; letter-spacing: 0.12em; color: #ff5936; font-weight: 700;">
                        ${code2}
                      </p>
                    </div>

                    <!-- Botón directo -->
                    <div style="text-align: center; margin: 30px 0 10px;">
                      <a href="https://enprokart.com/verificar.html" style="background: #ff5936; color: #000000; text-decoration: none; padding: 14px 28px; border-radius: 30px; font-weight: 800; font-size: 15px; display: inline-block;">
                        Ver mis Entradas en la Web ↗
                      </a>
                    </div>

                    <p style="margin: 20px 0 0; font-size: 13px; color: #889688; text-align: center;">
                      Presenta este correo o el código QR desde tu teléfono al ingresar al evento.
                    </p>
                  </td>
                </tr>

                <!-- Pie de página -->
                <tr>
                  <td style="padding: 16px; text-align: center; background: #0b0c0b; border-top: 1px solid #1a1e1a; font-size: 12px; color: #667566;">
                    © 2026 Pro Kart · Todos los derechos reservados.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const info = await transporter.sendMail({
      from: '"Pro Kart Entradas" <ventas@enprokart.com>',
      to: d.email,
      subject: `🎟️ Tus Entradas para el Evento Pro Kart (Orden #DEMO-8842)`,
      html: html,
    });

    console.log(`Enviado a ${d.email}:`, info.messageId);
  }
}

enviarPrueba().catch(console.error);
