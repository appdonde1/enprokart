/* =========================================================
   Firma simple anti-alteración para los códigos QR de entrada.
   No es criptografía de nivel bancario: es una verificación
   ligera para detectar URLs de entrada manipuladas a mano.
   Se usa tanto en app.js (al generar el ticket) como en
   verificar.html (al validar el ticket escaneado).
   ========================================================= */

(function (global) {
  "use strict";

  const SECRETO_EVENTO = "NOCHE-VIP-FEST-2026-SECRETO";

  function firmarTicket(codigo, nombre, apellido, area, mesa, silla) {
    const cadena = [codigo, nombre, apellido, area, mesa || "", silla || "", SECRETO_EVENTO].join(
      "|"
    );
    let hash = 0;
    for (let i = 0; i < cadena.length; i++) {
      hash = (hash * 31 + cadena.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36).toUpperCase();
  }

  global.firmarTicket = firmarTicket;
})(window);
