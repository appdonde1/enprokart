/* Consulta pública de entradas Pro Kart por Cédula / CPF. */

(function () {
  "use strict";

  // Elementos de consulta por cédula / CPF
  const cedulaForm = document.getElementById("cedulaForm");
  const inputCedula = document.getElementById("inputCedula");
  const btnBuscarCedula = document.getElementById("btnBuscarCedula");
  const contenedorEntradas = document.getElementById("contenedorEntradas");

  // Parámetros de URL
  const params = new URLSearchParams(window.location.search);
  const cedulaParam = params.get("cedula") || params.get("cpf") || params.get("ci") || params.get("dni") || params.get("doc");

  function setError(campo, mensaje) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (el) el.textContent = mensaje || "";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  cedulaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const doc = inputCedula.value.trim();
    if (!doc) return setError("cedula", "Por favor ingresa tu Cédula / CPF.");
    await buscarPorCedula(doc);
  });

  async function buscarPorCedula(doc) {
    setError("cedula", "");
    btnBuscarCedula.disabled = true;
    btnBuscarCedula.textContent = "Buscando...";
    contenedorEntradas.innerHTML = `<div class="verify-card"><p class="hint">Consultando entradas...</p></div>`;
    contenedorEntradas.classList.remove("hidden");

    try {
      const resp = await window.callFunction("verify-ticket", {
        action: "consultar_por_cedula",
        documento: doc,
      });

      if (!resp.ok) {
        throw new Error(resp.data?.error || "No se pudo realizar la consulta.");
      }

      const tickets = resp.data?.tickets || [];
      renderizarEntradasComprador(tickets, doc);
    } catch (err) {
      setError("cedula", err.message);
      contenedorEntradas.classList.add("hidden");
    } finally {
      btnBuscarCedula.disabled = false;
      btnBuscarCedula.textContent = "Buscar entradas";
    }
  }

  function renderizarEntradasComprador(tickets, doc) {
    if (!tickets.length) {
      contenedorEntradas.innerHTML = `
        <div class="verify-card">
          <div class="verify-card__icon">🔍</div>
          <h3 class="verify-card__status">Sin entradas activas</h3>
          <p class="hint">No encontramos entradas asociadas al documento <b>${esc(doc)}</b>.</p>
          <p class="hint" style="font-size: 0.8rem; color: var(--dim);">Verifica que esté escrito correctamente como se ingresó al momento de la compra.</p>
        </div>
      `;
      contenedorEntradas.classList.remove("hidden");
      return;
    }

    const html = tickets.map((t, idx) => {
      const qrUrl = `https://enprokart.com/verificar.html?c=${encodeURIComponent(t.code)}&s=${encodeURIComponent(t.qr_signature || "")}`;
      const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(qrUrl)}`;
      
      const fecha = t.event_date ? new Date(t.event_date).toLocaleDateString("es", {
        weekday: "short", day: "numeric", month: "short", year: "numeric"
      }) : "";

      const estadoBadge = t.status === "used"
        ? `<span class="estado estado--gris">Utilizada</span>`
        : t.status === "canceled"
        ? `<span class="estado estado--mal">Cancelada</span>`
        : `<span class="estado estado--ok">Válida</span>`;

      return `
        <div class="ticket-item">
          <div class="ticket-item__header">
            <span class="ticket-item__num">Entrada ${t.guest_index || (idx + 1)}${doc === null ? "" : " de " + tickets.length}</span>
            ${estadoBadge}
          </div>

          <h3 class="ticket-item__evento">${esc(t.event_name)}</h3>
          <p class="ticket-item__lugar">
            ${fecha ? `${fecha} · ` : ""}<b>${esc(t.section_label)}</b>${t.table_code ? ` · Mesa <b>${esc(t.table_code)}</b>` : ""}
          </p>

          <div class="ticket-item__qr-caja">
            <img src="${qrImg}" alt="QR Entrada" class="ticket-item__qr-img" />
          </div>

          <div>
            <span class="ticket-item__code">${esc(t.code)}</span>
          </div>

          <p class="ticket-item__titular">
            Titular: ${esc(t.buyer_name)} ${esc(t.buyer_lastname)}${t.buyer_document ? ` · Doc. ${esc(t.buyer_document)}` : ""}
          </p>
        </div>
      `;
    }).join("");

    contenedorEntradas.innerHTML = html;
    contenedorEntradas.classList.remove("hidden");
    contenedorEntradas.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* Una entrada suelta, abierta desde su QR: verificar.html?c=CODIGO&s=FIRMA
     (o ?codigo=...&firma=...). Es lo que pasa cuando alguien apunta la cámara
     del teléfono al QR del correo en vez de usar el escáner del panel: antes la
     página abría vacía, con el buscador de cédula. Consultar no marca la
     entrada como usada; eso solo lo hace el panel del personal. */
  async function mostrarEntradaDelQr(code, signature) {
    contenedorEntradas.innerHTML = '<div class="verify-card"><p class="hint">Consultando entrada...</p></div>';
    contenedorEntradas.classList.remove("hidden");
    try {
      const resp = await window.callFunction("verify-ticket", {
        action: "consultar_ticket",
        code,
        signature,
      });
      if (!resp.ok || !resp.data?.ticket) {
        throw new Error(resp.data?.error || "No se pudo leer esta entrada.");
      }
      renderizarEntradasComprador([resp.data.ticket], null);
    } catch (err) {
      contenedorEntradas.innerHTML =
        '<div class="verify-card"><div class="verify-card__icon">⚠️</div>' +
        '<h3 class="verify-card__status">Entrada no válida</h3>' +
        '<p class="hint">' + esc(err.message) + '</p></div>';
    }
  }

  // Arranque inicial si viene por URL
  (async function arranque() {
    const codigoQr = params.get("c") || params.get("codigo");
    const firmaQr = params.get("s") || params.get("firma");
    if (codigoQr && firmaQr) {
      await mostrarEntradaDelQr(codigoQr.trim().toUpperCase(), firmaQr.trim().toLowerCase());
      return;
    }
    if (cedulaParam) {
      inputCedula.value = cedulaParam;
      await buscarPorCedula(cedulaParam);
    }
  })();
})();
