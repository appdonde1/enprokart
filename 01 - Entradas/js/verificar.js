/* =========================================================
   Página de verificación de entradas.
   Se abre al escanear el QR del ticket con la cámara del
   celular. Valida la firma anti-alteración y comprueba en
   localStorage si la entrada ya fue utilizada (marcándola
   como usada la primera vez que se verifica).
   ========================================================= */

(function () {
  "use strict";

  const AREA_LABELS = { ORO: "Área Oro (VIP)", PLATA: "Área Plata (VIP)", GENERAL: "Área General" };
  const CLAVE_ENTRADAS = "entradasEmitidasEvento";
  const card = document.getElementById("verifyCard");

  function obtenerParametros() {
    const params = new URLSearchParams(window.location.search);
    return {
      codigo: params.get("codigo") || "",
      nombre: params.get("nombre") || "",
      apellido: params.get("apellido") || "",
      area: params.get("area") || "",
      mesa: params.get("mesa") || "",
      silla: params.get("silla") || "",
      firma: params.get("firma") || "",
    };
  }

  function obtenerEntradas() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_ENTRADAS)) || {};
    } catch (e) {
      return {};
    }
  }

  function marcarComoUsada(codigo) {
    const entradas = obtenerEntradas();
    if (entradas[codigo]) {
      entradas[codigo].usada = true;
      localStorage.setItem(CLAVE_ENTRADAS, JSON.stringify(entradas));
    }
  }

  function render(estado, icono, titulo, datos) {
    card.className = `verify-card verify-card--${estado}`;
    const filas = datos
      .map((d) => `<div class="row"><span>${d[0]}</span><span>${d[1]}</span></div>`)
      .join("");

    card.innerHTML = `
      <div class="verify-card__icon">${icono}</div>
      <div class="verify-card__status">${titulo}</div>
      ${filas ? `<div class="verify-card__details">${filas}</div>` : ""}
    `;
  }

  function verificar() {
    const datos = obtenerParametros();

    if (!datos.codigo || !datos.firma) {
      render("invalida", "❌", "Código QR incompleto o inválido", []);
      return;
    }

    const firmaEsperada = firmarTicket(
      datos.codigo,
      datos.nombre,
      datos.apellido,
      datos.area,
      datos.mesa,
      datos.silla
    );

    if (firmaEsperada !== datos.firma) {
      render("invalida", "❌", "Entrada NO válida (firma incorrecta)", [
        ["Código", datos.codigo],
      ]);
      return;
    }

    const entradas = obtenerEntradas();
    const registro = entradas[datos.codigo];

    const filaAsiento =
      datos.mesa && datos.silla
        ? ["Mesa / Silla", `Mesa ${datos.mesa} · Silla ${datos.silla}`]
        : ["Ubicación", "Acceso general (de pie)"];

    const detalles = [
      ["Titular", `${datos.nombre} ${datos.apellido}`],
      ["Área", AREA_LABELS[datos.area] || datos.area],
      filaAsiento,
      ["Código", datos.codigo],
    ];

    if (registro && registro.usada) {
      render("usada", "⚠️", "Entrada YA UTILIZADA", detalles);
      return;
    }

    render("valida", "✅", "Entrada VÁLIDA", detalles);
    marcarComoUsada(datos.codigo);
  }

  verificar();
})();
