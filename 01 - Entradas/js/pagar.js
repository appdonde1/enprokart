/* =========================================================
   Página de pago.

   Se arma con el id de la orden que viene en la URL, así se puede recargar,
   compartir o volver desde el banco sin perder la compra. Todo el estado real
   vive en el servidor: acá solo se consulta.
   ========================================================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const money = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const orderId = new URLSearchParams(window.location.search).get("order");

  let pollTimer = null;
  let timerInterval = null;
  let qrDibujado = false;

  function mostrar(panel) {
    ["cargando", "panelPago", "panelEntradas", "panelError"].forEach((id) => {
      $(id).classList.toggle("active", id === panel);
    });
  }

  function mostrarError(titulo, texto) {
    $("errorTitulo").textContent = titulo;
    $("errorTexto").textContent = texto || "";
    mostrar("panelError");
    detener();
  }

  function detener() {
    if (pollTimer) clearInterval(pollTimer);
    if (timerInterval) clearInterval(timerInterval);
    pollTimer = null;
    timerInterval = null;
  }

  if (!orderId) {
    mostrarError("No encontramos tu compra", "Volvé al inicio y elegí tu lugar de nuevo.");
    return;
  }

  // ---------- pintar ----------
  function pintarPedido(d) {
    const lugar = d.tables?.length
      ? `${d.tables.length} mesa(s): ${d.tables.join(", ")}`
      : "Sin lugar asignado";

    $("orderSummary").innerHTML = `
      <div class="row"><span>Comprador</span><span>${esc(d.buyer_name)} ${esc(d.buyer_lastname)}</span></div>
      <div class="row"><span>Área</span><span>${esc(d.section_label)}</span></div>
      <div class="row"><span>Personas</span><span>${d.people}</span></div>
      <div class="row"><span>Lugar</span><span>${esc(lugar)}</span></div>
      <div class="row"><span>Total</span><span>${money(d.amount_cents)}</span></div>
    `;
  }

  function pintarPix(d) {
    if (qrDibujado || !d.pix_qr_code) return;
    qrDibujado = true;

    $("pixCode").value = d.pix_qr_code;
    // El código completo tiene cientos de caracteres: se muestran los primeros
    // seis solo para que se vea que hay algo copiable.
    $("pixCodePreview").textContent = d.pix_qr_code.slice(0, 6);

    const cont = $("qrcode");
    cont.innerHTML = "";

    if (d.pix_qr_base64) {
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${d.pix_qr_base64}`;
      img.alt = "Código QR para pagar con PIX";
      img.width = 200;
      img.height = 200;
      cont.appendChild(img);
    } else {
      new QRCode(cont, {
        text: d.pix_qr_code, width: 200, height: 200,
        colorDark: "#0f1117", colorLight: "#ffffff",
      });
    }
  }

  function iniciarTemporizador(expiresAt) {
    if (timerInterval) clearInterval(timerInterval);
    const limite = new Date(expiresAt).getTime();

    const tick = () => {
      const restante = Math.max(0, Math.floor((limite - Date.now()) / 1000));
      const m = Math.floor(restante / 60).toString().padStart(2, "0");
      const s = (restante % 60).toString().padStart(2, "0");
      $("timer").textContent = `${m}:${s}`;

      if (restante <= 0) {
        detener();
        mostrarError("La reserva expiró", "Tu lugar volvió a quedar disponible. Elegilo de nuevo.");
      }
    };

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function pintarEntradas(d) {
    detener();

    const tickets = d.tickets || [];
    $("entradasIntro").textContent = tickets.length === 1
      ? "Presentá este QR en la entrada del evento."
      : `Son ${tickets.length} entradas, una por invitado. Cada QR se valida una sola vez.`;

    const base = window.location.href.replace(/pagar\.html.*$/i, "");

    $("entradas").innerHTML = tickets.map((t) => `
      <div class="ticket">
        <div class="ticket__info">
          <span class="ticket__area ticket__area--${esc(t.section_code)}">${esc(t.section_label)}</span>
          <h3>${esc(t.buyer_name)} ${esc(t.buyer_lastname)}</h3>
          ${t.table_code ? `<div class="row"><strong>Mesa:</strong> ${esc(t.table_code)}</div>` : ""}
          ${tickets.length > 1 ? `<div class="row"><strong>Invitado:</strong> ${t.guest_index} de ${tickets.length}</div>` : ""}
          <div class="row"><strong>Código:</strong> ${esc(t.code)}</div>
        </div>
        <div class="ticket__qr" data-qr="${esc(base)}verificar.html?codigo=${encodeURIComponent(t.code)}&amp;firma=${encodeURIComponent(t.qr_signature)}"></div>
      </div>
    `).join("");

    $("entradas").querySelectorAll("[data-qr]").forEach((cont) => {
      new QRCode(cont, {
        text: cont.dataset.qr, width: 150, height: 150,
        colorDark: "#0f1117", colorLight: "#ffffff",
      });
    });

    mostrar("panelEntradas");
  }

  // ---------- consulta ----------
  async function consultar(manual) {
    const { ok, data } = await window.callFunction("get-order-status", { order_id: orderId });

    if (!ok) {
      mostrarError("No encontramos tu compra", "Puede que el enlace esté incompleto.");
      return;
    }

    if (data.status === "paid") {
      pintarEntradas(data);
      return;
    }

    if (["expired", "canceled", "failed"].includes(data.status)) {
      mostrarError(
        data.status === "expired" ? "La reserva expiró" : "La compra no se completó",
        "Tu lugar volvió a quedar disponible. Podés elegirlo de nuevo.",
      );
      return;
    }

    pintarPedido(data);
    pintarPix(data);
    if (data.expires_at && !timerInterval) iniciarTemporizador(data.expires_at);
    mostrar("panelPago");

    if (manual) {
      $("pagoEstado").textContent =
        "Todavía no llegó la confirmación del banco. Puede tardar unos segundos.";
      $("pagoEstado").className = "pago-estado";
    }
  }

  $("btnCopyPix").addEventListener("click", async () => {
    const etiqueta = $("btnCopyPix").querySelector(".pix-copy__label");
    const original = etiqueta.textContent;
    try {
      await navigator.clipboard.writeText($("pixCode").value);
    } catch (err) {
      // navigator.clipboard no existe fuera de contextos seguros.
      const tmp = document.createElement("textarea");
      tmp.value = $("pixCode").value;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
    }
    $("btnCopyPix").classList.add("pix-copy--copiado");
    etiqueta.textContent = "¡Copiado!";
    setTimeout(() => {
      $("btnCopyPix").classList.remove("pix-copy--copiado");
      etiqueta.textContent = original;
    }, 1600);
  });

  $("btnConfirmarPago").addEventListener("click", async () => {
    const btn = $("btnConfirmarPago");
    btn.disabled = true;
    btn.textContent = "Verificando...";
    await consultar(true);
    btn.disabled = false;
    btn.textContent = "Ya pagué, verificar";
  });

  // El pago lo confirma el webhook de Mercado Pago; acá solo se consulta.
  consultar(false);
  pollTimer = setInterval(() => consultar(false), 4000);
})();
