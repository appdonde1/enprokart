import nodemailer from "npm:nodemailer@6.9.13";

const SMTP_CONFIG = {
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  debug: true,
  logger: true,
  auth: {
    user: "ventas@enprokart.com",
    pass: "Prokart26#",
  },
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

async function testVerbose() {
  const info = await transporter.sendMail({
    from: '"Pro Kart" <ventas@enprokart.com>',
    to: "comercialsimancas.s@gmail.com",
    subject: "Prueba directa Pro Kart",
    text: "Hola, este es un mensaje de prueba de Pro Kart.",
    html: "<b>Hola</b>, este es un mensaje de prueba de Pro Kart."
  });
  console.log("RESPONSE:", JSON.stringify(info, null, 2));
}

await testVerbose();
