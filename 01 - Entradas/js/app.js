/* =========================================================
   Flujo de venta de entradas - Pro Kart
   Pasos: 1) Registro y selección de área
          2) Pago vía PIX (Pagar.me)
          3) Confirmación / Ticket

   La disponibilidad vive en Supabase y se sincroniza por Realtime:
   lo que ve un comprador es lo que ven todos.
   ========================================================= */

(function () {
  "use strict";

  const db = window.supabaseClient;
  const EVENT_SLUG = window.PROKART_CONFIG.EVENT_SLUG;

  // ---------- Estado ----------
  const state = {
    nombre: "",
    apellido: "",
    documento: "",
    whatsapp: "",
    email: "",
    section: null,
    mesa: "",
    silla: "",
    orderId: "",
    ticket: null,
  };

  const catalogo = {
    sections: [],
    tablesBySection: new Map(),
    seatsByTable: new Map(),
    tableById: new Map(),
  };

  let pollTimer = null;
  let timerInterval = null;
  let realtimeChannel = null;

  // ---------- Referencias DOM ----------
  const hero = document.getElementById("hero");
  const btnComprar = document.getElementById("btnComprar");
  const panels = {
    1: document.getElementById("panel-1"),
    2: document.getElementById("panel-2"),
    3: document.getElementById("panel-3"),
  };
  const stepIndicators = document.querySelectorAll(".step-indicator");

  const formRegistro = document.getElementById("formRegistro");
  const areasGrid = document.getElementById("areasGrid");
  const seatFields = document.getElementById("seatFields");
  const generalHint = document.getElementById("generalHint");
  const mesaInput = document.getElementById("mesa");
  const sillaInput = document.getElementById("silla");
  const mesaGrid = document.getElementById("mesaGrid");
  const seatsPanel = document.getElementById("seatsPanel");
  const sillaGrid = document.getElementById("sillaGrid");
  const mesaSeleccionadaLabel = document.getElementById("mesaSeleccionadaLabel");
  const seleccionActual = document.getElementById("seleccionActual");
  const btnContinuar = document.getElementById("btnContinuar");

  const orderSummary = document.getElementById("orderSummary");
  const qrcodeContainer = document.getElementById("qrcode");
  const pixCodeInput = document.getElementById("pixCode");
  const pixCodePreview = document.getElementById("pixCodePreview");
  const btnCopyPix = document.getElementById("btnCopyPix");
  const timerEl = document.getElementById("timer");
  const btnConfirmarPago = document.getElementById("btnConfirmarPago");
  const btnVolverRegistro = document.getElementById("btnVolverRegistro");
  const pagoEstado = document.getElementById("pagoEstado");
  const ticketEl = document.getElementById("ticket");
  const btnNuevaCompra = document.getElementById("btnNuevaCompra");
  const avisoModal = document.getElementById("avisoModal");
  const avisoTexto = document.getElementById("avisoTexto");
  const avisoAceptar = document.getElementById("avisoAceptar");
  const avisoCancelar = document.getElementById("avisoCancelar");

  // ---------- Navegación ----------
  function goToStep(step) {
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    panels[step].classList.add("active");
    hero.classList.toggle("hidden", step !== 1);

    stepIndicators.forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.remove("active", "done");
      if (s === step) el.classList.add("active");
      else if (s < step) el.classList.add("done");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  btnComprar.addEventListener("click", () => {
    panels[1].scrollIntoView({ behavior: "smooth" });
  });

  // ---------- Carga del catálogo ----------
  function formatPrice(cents) {
    return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
  }

  async function cargarCatalogo() {
    const { data: event, error: eventError } = await db
      .from("events")
      .select("id, name, event_date, venue")
      .eq("slug", EVENT_SLUG)
      .maybeSingle();

    if (eventError || !event) {
      document.getElementById("heroTitulo").textContent = "Evento no disponible";
      areasGrid.innerHTML =
        '<p class="hint">No se pudo cargar el evento. Revisa la configuración de Supabase.</p>';
      return;
    }

    document.getElementById("heroTitulo").textContent = event.name;
    const cuando = event.event_date
      ? new Date(event.event_date).toLocaleString("es", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      })
      : "";
    document.getElementById("heroSubtitulo").textContent =
      [cuando, event.venue].filter(Boolean).join(" · ");

    const { data: sections } = await db
      .from("sections")
      .select("id, code, label, price_cents, has_seating, assignment_mode, capacity, notice")
      .eq("event_id", event.id)
      .order("sort_order");

    catalogo.sections = sections || [];

    const sectionIds = catalogo.sections.map((s) => s.id);
    const { data: tables } = await db
      .from("tables")
      .select("id, section_id, number, seat_count, label")
      .in("section_id", sectionIds)
      .order("number");

    catalogo.tablesBySection = new Map();
    catalogo.tableById = new Map();
    (tables || []).forEach((table) => {
      if (!catalogo.tablesBySection.has(table.section_id)) {
        catalogo.tablesBySection.set(table.section_id, []);
      }
      catalogo.tablesBySection.get(table.section_id).push(table);
      catalogo.tableById.set(table.id, table);
    });

    await cargarSillas();
    renderAreas();
    suscribirRealtime();
  }

  // Solo se traen las sillas de las secciones donde el comprador elige asiento;
  // VIP Plata tiene 480 y no se dibuja nunca.
  async function cargarSillas() {
    const manualSections = catalogo.sections.filter((s) => s.assignment_mode === "manual");
    const tableIds = manualSections.flatMap((s) =>
      (catalogo.tablesBySection.get(s.id) || []).map((t) => t.id)
    );
    if (tableIds.length === 0) return;

    const { data: seats } = await db
      .from("seats_public")
      .select("id, table_id, number, status")
      .in("table_id", tableIds)
      .order("number");

    catalogo.seatsByTable = new Map();
    (seats || []).forEach((seat) => {
      if (!catalogo.seatsByTable.has(seat.table_id)) catalogo.seatsByTable.set(seat.table_id, []);
      catalogo.seatsByTable.get(seat.table_id).push(seat);
    });
  }

  function disponiblesEnMesa(tableId) {
    const seats = catalogo.seatsByTable.get(tableId) || [];
    return seats.filter((s) => s.status === "available").length;
  }

  // ---------- Áreas ----------
  function renderAreas() {
    areasGrid.innerHTML = "";

    catalogo.sections.forEach((section) => {
      const card = document.createElement("label");
      card.className = `area-card area-card--${section.code.toLowerCase()}`;

      const esVip = section.assignment_mode !== "none";
      const detalle = section.assignment_mode === "manual"
        ? "Mesa y silla asignada"
        : section.assignment_mode === "auto_fcfs"
        ? "Mesa asignada por orden de llegada"
        : "Acceso de pie · Sin mesa ni silla asignada";

      card.innerHTML = `
        <input type="radio" name="area" value="${section.code}" />
        <div class="area-card__body">
          <span class="badge ${esVip ? "badge--vip" : "badge--general"}">${esVip ? "VIP" : "GENERAL"}</span>
          <h4>${section.label}</h4>
          <p>${detalle}</p>
          <span class="price">${formatPrice(section.price_cents)}</span>
        </div>
      `;

      card.querySelector("input").addEventListener("change", () => seleccionarArea(section));
      areasGrid.appendChild(card);
    });
  }

  function limpiarSeleccionAsiento() {
    mesaInput.value = "";
    sillaInput.value = "";
    seatsPanel.classList.add("hidden");
    seleccionActual.textContent = "";
    mesaGrid.innerHTML = "";
    sillaGrid.innerHTML = "";
  }

  function seleccionarArea(section) {
    // VIP Plata avisa antes de continuar: el comprador no elige su mesa.
    if (section.assignment_mode === "auto_fcfs" && section.notice) {
      mostrarAviso(section.notice, () => aplicarArea(section), () => deseleccionarArea());
      return;
    }
    aplicarArea(section);
  }

  function aplicarArea(section) {
    state.section = section;
    limpiarSeleccionAsiento();
    setError("area", "");
    setError("mesa", "");

    const eligeAsiento = section.assignment_mode === "manual";
    seatFields.classList.toggle("hidden", !eligeAsiento);
    generalHint.classList.toggle("hidden", eligeAsiento);

    if (eligeAsiento) {
      renderMapaMesas(section);
    } else if (section.notice) {
      generalHint.innerHTML = `<strong>${section.label}:</strong> ${section.notice}`;
    }
  }

  function deseleccionarArea() {
    state.section = null;
    document.querySelectorAll('input[name="area"]').forEach((input) => (input.checked = false));
    seatFields.classList.add("hidden");
    generalHint.classList.add("hidden");
    limpiarSeleccionAsiento();
  }

  // ---------- Aviso inline (VIP Plata) ----------
  let avisoOnCancel = null;

  function mostrarAviso(texto, onAceptar, onCancelar) {
    avisoTexto.textContent = texto;
    avisoOnCancel = onCancelar;
    avisoModal.classList.remove("hidden");

    avisoAceptar.onclick = () => {
      avisoModal.classList.add("hidden");
      avisoOnCancel = null;
      onAceptar();
    };
    avisoCancelar.onclick = () => {
      avisoModal.classList.add("hidden");
      avisoOnCancel = null;
      onCancelar();
    };
  }

  avisoModal.addEventListener("click", (event) => {
    if (event.target === avisoModal && avisoOnCancel) {
      avisoModal.classList.add("hidden");
      avisoOnCancel();
      avisoOnCancel = null;
    }
  });

  // ---------- Mapa de mesas ----------
  function renderMapaMesas(section) {
    const tables = catalogo.tablesBySection.get(section.id) || [];
    mesaGrid.innerHTML = "";
    seatsPanel.classList.add("hidden");

    tables.forEach((table) => {
      const libres = disponiblesEnMesa(table.id);
      const llena = libres === 0;

      const mesaEl = document.createElement("button");
      mesaEl.type = "button";
      mesaEl.className = "mesa-item" + (llena ? " mesa-item--occupied" : "");
      mesaEl.dataset.tableId = table.id;
      mesaEl.dataset.status = llena ? "reservado" : "disponible";
      mesaEl.dataset.badge = llena ? "Reservado" : `Disponible · ${libres}`;
      mesaEl.textContent = table.label || table.number;
      mesaEl.disabled = llena;

      mesaEl.addEventListener("click", () => {
        mesaGrid.querySelectorAll(".mesa-item").forEach((el) =>
          el.classList.remove("mesa-item--selected")
        );
        mesaEl.classList.add("mesa-item--selected");
        renderSillas(table);
      });

      mesaGrid.appendChild(mesaEl);
    });
  }

  function renderSillas(table) {
    seatsPanel.classList.remove("hidden");
    mesaSeleccionadaLabel.textContent = table.label || table.number;
    sillaGrid.innerHTML = "";
    mesaInput.value = "";
    sillaInput.value = "";
    seleccionActual.textContent = "";

    const seats = catalogo.seatsByTable.get(table.id) || [];

    seats.forEach((seat) => {
      const libre = seat.status === "available";
      const sillaEl = document.createElement("button");
      sillaEl.type = "button";
      sillaEl.className = "silla-item" + (libre ? "" : " silla-item--occupied");
      sillaEl.dataset.seatId = seat.id;
      sillaEl.dataset.status = libre ? "disponible" : "reservado";
      sillaEl.dataset.badge = libre ? "Disponible" : "Reservado";
      sillaEl.textContent = seat.number;
      sillaEl.disabled = !libre;

      sillaEl.addEventListener("click", () => {
        sillaGrid.querySelectorAll(".silla-item").forEach((el) =>
          el.classList.remove("silla-item--selected")
        );
        sillaEl.classList.add("silla-item--selected");
        mesaInput.value = table.number;
        sillaInput.value = seat.number;
        setError("mesa", "");
        seleccionActual.textContent =
          `Seleccionaste: Mesa ${table.label || table.number}, Silla ${seat.number} · ${state.section.label}`;
      });

      sillaGrid.appendChild(sillaEl);
    });
  }

  // ---------- Realtime ----------
  function suscribirRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);

    realtimeChannel = db
      .channel("seats-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "seats" },
        (payload) => aplicarCambioSilla(payload.new),
      )
      .subscribe();
  }

  function aplicarCambioSilla(seat) {
    if (!seat || !catalogo.seatsByTable.has(seat.table_id)) return;

    const seats = catalogo.seatsByTable.get(seat.table_id);
    const actual = seats.find((s) => s.id === seat.id);
    if (!actual || actual.status === seat.status) return;
    actual.status = seat.status;

    const libre = seat.status === "available";

    const sillaEl = sillaGrid.querySelector(`[data-seat-id="${seat.id}"]`);
    if (sillaEl) {
      sillaEl.classList.toggle("silla-item--occupied", !libre);
      sillaEl.dataset.status = libre ? "disponible" : "reservado";
      sillaEl.dataset.badge = libre ? "Disponible" : "Reservado";
      sillaEl.disabled = !libre;

      // Si otro comprador se adelantó, se avisa en vez de dejarlo avanzar.
      if (!libre && sillaEl.classList.contains("silla-item--selected")) {
        sillaEl.classList.remove("silla-item--selected");
        mesaInput.value = "";
        sillaInput.value = "";
        seleccionActual.textContent = "";
        setError("mesa", "Esa silla acaba de ser reservada. Elige otra.");
      }
    }

    const mesaEl = mesaGrid.querySelector(`[data-table-id="${seat.table_id}"]`);
    if (mesaEl) {
      const libres = disponiblesEnMesa(seat.table_id);
      const llena = libres === 0;
      mesaEl.classList.toggle("mesa-item--occupied", llena);
      mesaEl.dataset.status = llena ? "reservado" : "disponible";
      mesaEl.dataset.badge = llena ? "Reservado" : `Disponible · ${libres}`;
      mesaEl.disabled = llena;
    }
  }

  // ---------- Validación ----------
  function setError(fieldName, message) {
    const el = document.querySelector(`.error[data-for="${fieldName}"]`);
    if (el) el.textContent = message || "";
    const input = document.getElementById(fieldName);
    if (input) input.classList.toggle("invalid", Boolean(message));
  }

  function validarRegistro() {
    let valido = true;

    const requeridos = [
      ["nombre", "Ingresa el nombre."],
      ["apellido", "Ingresa el apellido."],
      ["documento", "Ingresa la cédula/CPF."],
    ];

    requeridos.forEach(([campo, mensaje]) => {
      if (!document.getElementById(campo).value.trim()) {
        setError(campo, mensaje);
        valido = false;
      } else setError(campo, "");
    });

    const whatsapp = document.getElementById("whatsapp").value.trim();
    if (!whatsapp) {
      setError("whatsapp", "Ingresa tu número de WhatsApp.");
      valido = false;
    } else if (whatsapp.replace(/\D/g, "").length < 10) {
      setError("whatsapp", "Incluye el código de área. Ej: (11) 99999-9999");
      valido = false;
    } else setError("whatsapp", "");

    if (!state.section) {
      setError("area", "Selecciona un área.");
      valido = false;
    } else {
      setError("area", "");
      if (state.section.assignment_mode === "manual" && (!mesaInput.value || !sillaInput.value)) {
        setError("mesa", "Selecciona una mesa y una silla en el mapa.");
        valido = false;
      }
    }

    return valido;
  }

  // ---------- Paso 1 -> 2 ----------
  formRegistro.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validarRegistro()) return;

    state.nombre = document.getElementById("nombre").value.trim();
    state.apellido = document.getElementById("apellido").value.trim();
    state.documento = document.getElementById("documento").value.trim();
    state.whatsapp = document.getElementById("whatsapp").value.trim();
    state.email = document.getElementById("email").value.trim();
    state.mesa = mesaInput.value;
    state.silla = sillaInput.value;

    btnContinuar.disabled = true;
    btnContinuar.textContent = "Generando cobro...";

    const { ok, status, data } = await window.callFunction("create-order", {
      event_slug: EVENT_SLUG,
      section_code: state.section.code,
      table_number: state.mesa ? Number(state.mesa) : null,
      seat_number: state.silla ? Number(state.silla) : null,
      buyer: {
        nombre: state.nombre,
        apellido: state.apellido,
        documento: state.documento,
        whatsapp: state.whatsapp,
        email: state.email,
      },
    });

    btnContinuar.disabled = false;
    btnContinuar.textContent = "Continuar al pago";

    if (!ok) {
      if (status === 409) {
        setError("mesa", data.error || "Esa ubicación ya no está disponible.");
        await cargarSillas();
        if (state.section.assignment_mode === "manual") renderMapaMesas(state.section);
      } else {
        setError("area", data.error || "No se pudo iniciar la compra.");
      }
      return;
    }

    state.orderId = data.order_id;
    state.mesa = data.table_number ?? "";
    state.silla = data.seat_number ?? "";

    renderResumenPedido(data);
    renderPix(data);
    iniciarTemporizador(data.expires_at);
    iniciarPolling();
    goToStep(2);
  });

  btnVolverRegistro.addEventListener("click", () => {
    detenerTemporizador();
    detenerPolling();
    goToStep(1);
  });

  // ---------- Paso 2 ----------
  function renderResumenPedido(data) {
    const ubicacion = data.seat_number
      ? `Mesa ${data.table_number} · Silla ${data.seat_number}`
      : "Acceso general (de pie)";

    const asignada = state.section.assignment_mode === "auto_fcfs"
      ? '<div class="row"><span></span><span class="hint">Asignada por orden de llegada</span></div>'
      : "";

    orderSummary.innerHTML = `
      <div class="row"><span>Comprador</span><span>${state.nombre} ${state.apellido}</span></div>
      <div class="row"><span>Documento</span><span>${state.documento}</span></div>
      <div class="row"><span>WhatsApp</span><span>${state.whatsapp}</span></div>
      <div class="row"><span>Área</span><span>${data.section.label}</span></div>
      <div class="row"><span>Ubicación</span><span>${ubicacion}</span></div>
      ${asignada}
      <div class="row"><span>Total a pagar</span><span>${formatPrice(data.amount_cents)}</span></div>
    `;
  }

  function renderPix(data) {
    pixCodeInput.value = data.pix_qr_code;
    // El código completo tiene cientos de caracteres: se muestran los primeros
    // seis solo para que se vea que hay algo copiable.
    pixCodePreview.textContent = data.pix_qr_code.slice(0, 6);

    qrcodeContainer.innerHTML = "";

    if (data.pix_qr_base64) {
      // Mercado Pago ya devuelve la imagen: se usa esa en vez de redibujarla.
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${data.pix_qr_base64}`;
      img.alt = "Código QR para pagar con PIX";
      img.width = 200;
      img.height = 200;
      qrcodeContainer.appendChild(img);
    } else {
      new QRCode(qrcodeContainer, {
        text: data.pix_qr_code,
        width: 200,
        height: 200,
        colorDark: "#0f1117",
        colorLight: "#ffffff",
      });
    }
  }

  btnCopyPix.addEventListener("click", async () => {
    const original = btnCopyPix.querySelector(".pix-copy__label").textContent;
    try {
      await navigator.clipboard.writeText(pixCodeInput.value);
    } catch (err) {
      // navigator.clipboard no existe fuera de contextos seguros (http en LAN).
      const temporal = document.createElement("textarea");
      temporal.value = pixCodeInput.value;
      document.body.appendChild(temporal);
      temporal.select();
      document.execCommand("copy");
      temporal.remove();
    }
    btnCopyPix.classList.add("pix-copy--copiado");
    btnCopyPix.querySelector(".pix-copy__label").textContent = "¡Copiado!";
    setTimeout(() => {
      btnCopyPix.classList.remove("pix-copy--copiado");
      btnCopyPix.querySelector(".pix-copy__label").textContent = original;
    }, 1600);
  });

  // El vencimiento lo define el servidor, no un contador local.
  function iniciarTemporizador(expiresAt) {
    detenerTemporizador();
    const limite = new Date(expiresAt).getTime();

    const tick = () => {
      const restante = Math.max(0, Math.floor((limite - Date.now()) / 1000));
      const minutos = Math.floor(restante / 60).toString().padStart(2, "0");
      const segundos = (restante % 60).toString().padStart(2, "0");
      timerEl.textContent = `${minutos}:${segundos}`;

      if (restante <= 0) {
        detenerTemporizador();
        detenerPolling();
        pagoEstado.textContent =
          "La reserva expiró. Vuelve atrás y elige tu lugar de nuevo.";
        pagoEstado.className = "pago-estado pago-estado--error";
      }
    };

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function detenerTemporizador() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  // El pago lo confirma el webhook de Pagar.me; acá solo se consulta el estado.
  function iniciarPolling() {
    detenerPolling();
    pagoEstado.textContent = "Esperando la confirmación del pago...";
    pagoEstado.className = "pago-estado";
    pollTimer = setInterval(consultarEstadoPago, 4000);
  }

  function detenerPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function consultarEstadoPago(manual) {
    const { ok, data } = await window.callFunction("get-order-status", { order_id: state.orderId });
    if (!ok) return false;

    if (data.status === "paid" && data.ticket) {
      detenerPolling();
      detenerTemporizador();
      state.ticket = data.ticket;
      renderTicket();
      goToStep(3);
      return true;
    }

    if (["expired", "canceled", "failed"].includes(data.status)) {
      detenerPolling();
      pagoEstado.textContent = "La compra expiró o fue cancelada. Vuelve atrás e inténtalo de nuevo.";
      pagoEstado.className = "pago-estado pago-estado--error";
      return false;
    }

    if (manual) {
      pagoEstado.textContent =
        "Todavía no recibimos la confirmación del banco. Puede tardar unos segundos.";
      pagoEstado.className = "pago-estado";
    }
    return false;
  }

  btnConfirmarPago.addEventListener("click", async () => {
    btnConfirmarPago.disabled = true;
    btnConfirmarPago.textContent = "Verificando...";
    await consultarEstadoPago(true);
    btnConfirmarPago.disabled = false;
    btnConfirmarPago.textContent = "Ya realicé el pago";
  });

  // ---------- Paso 3 ----------
  function construirUrlVerificacion(ticket) {
    const params = new URLSearchParams({ codigo: ticket.code, firma: ticket.qr_signature });
    const base = window.location.href.replace(/index\.html.*$/i, "").replace(/\/?$/, "/");
    return `${base}verificar.html?${params.toString()}`;
  }

  function renderTicket() {
    const ticket = state.ticket;
    const ubicacion = ticket.seat_number
      ? `<div class="row"><strong>Mesa / Silla:</strong> Mesa ${ticket.table_number} · Silla ${ticket.seat_number}</div>`
      : `<div class="row"><strong>Ubicación:</strong> Acceso general (de pie)</div>`;

    ticketEl.innerHTML = `
      <div class="ticket__info">
        <span class="ticket__area ticket__area--${ticket.section_code}">${ticket.section_label}</span>
        <h3>${ticket.buyer_name} ${ticket.buyer_lastname}</h3>
        <div class="row"><strong>Documento:</strong> ${state.documento}</div>
        ${ubicacion}
        <div class="row"><strong>Código de entrada:</strong> ${ticket.code}</div>
        <p class="ticket__qr-hint">Presenta este QR en la entrada del evento</p>
      </div>
      <div class="ticket__qr" id="ticketQr"></div>
    `;

    new QRCode(document.getElementById("ticketQr"), {
      text: construirUrlVerificacion(ticket),
      width: 150,
      height: 150,
      colorDark: "#0f1117",
      colorLight: "#ffffff",
    });
  }

  btnNuevaCompra.addEventListener("click", async () => {
    formRegistro.reset();
    deseleccionarArea();
    state.orderId = "";
    state.ticket = null;
    document.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
    document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    await cargarSillas();
    goToStep(1);
  });

  // ---------- Inicio ----------
  goToStep(1);
  cargarCatalogo();
})();
