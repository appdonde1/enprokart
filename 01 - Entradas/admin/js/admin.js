/* Panel del personal: admin (configuración y contabilidad) y mesero (operación).
   Lo que cada rol puede ver o cambiar lo decide RLS en Supabase; acá solo se
   esconde lo que igual sería rechazado por el servidor. */

(function () {
  "use strict";

  const db = window.supabaseClient;

  const TABS = {
    resumen: { label: "Resumen", roles: ["admin"] },
    salon: { label: "Salón", roles: ["admin"] },
    validar: { label: "Validar", roles: ["admin", "mesero"] },
    entradas: { label: "Entradas", roles: ["admin", "mesero"] },
    eventos: { label: "Eventos", roles: ["admin"] },
  };

  const ui = {
    loginWrap: document.getElementById("loginWrap"),
    loginForm: document.getElementById("loginForm"),
    btnLogin: document.getElementById("btnLogin"),
    shell: document.getElementById("shell"),
    tabs: document.getElementById("tabs"),
    userBadge: document.getElementById("userBadge"),
    btnLogout: document.getElementById("btnLogout"),
    eventSelect: document.getElementById("eventSelect"),
    kpiRow: document.getElementById("kpiRow"),
    salonEditor: document.getElementById("salonEditor"),
    validarForm: document.getElementById("validarForm"),
    codigoValidar: document.getElementById("codigoValidar"),
    btnValidarEntrada: document.getElementById("btnValidarEntrada"),
    validarResultado: document.getElementById("validarResultado"),
    tablaEntradas: document.getElementById("tablaEntradas"),
    buscarEntrada: document.getElementById("buscarEntrada"),
    filtroEstado: document.getElementById("filtroEstado"),
    tablaEventos: document.getElementById("tablaEventos"),
    plantilla: document.getElementById("plantilla"),
    btnCrearEvento: document.getElementById("btnCrearEvento"),
  };

  const state = {
    session: null,
    role: null,
    events: [],
    eventId: null,
    sections: [],
    tables: [],
    seats: [],
    orders: [],
    tickets: [],
    tab: null,
  };

  let realtimeChannel = null;

  // ---------- utilidades ----------
  const money = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

  function esc(text) {
    return String(text ?? "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function setError(campo, mensaje) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (el) el.textContent = mensaje || "";
  }

  // ---------- sesión ----------
  ui.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("login", "");
    ui.btnLogin.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });

    ui.btnLogin.disabled = false;
    if (error) {
      setError("login", "Correo o contraseña incorrectos.");
      return;
    }
    ui.loginForm.reset();
    await iniciar();
  });

  ui.btnLogout.addEventListener("click", async () => {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    realtimeChannel = null;
    await db.auth.signOut();
    state.session = null;
    state.role = null;
    ui.shell.classList.add("hidden");
    ui.loginWrap.classList.remove("hidden");
  });

  async function iniciar() {
    const { data } = await db.auth.getSession();
    state.session = data.session;

    if (!state.session) {
      ui.loginWrap.classList.remove("hidden");
      ui.shell.classList.add("hidden");
      return;
    }

    const { data: perfil } = await db
      .from("staff_profiles")
      .select("role, display_name")
      .eq("id", state.session.user.id)
      .maybeSingle();

    if (!perfil) {
      setError("login", "Esta cuenta no tiene acceso al panel.");
      await db.auth.signOut();
      return;
    }

    state.role = perfil.role;
    ui.userBadge.textContent = perfil.display_name || state.session.user.email;
    ui.loginWrap.classList.add("hidden");
    ui.shell.classList.remove("hidden");

    renderTabs();
    await cargarEventos();
  }

  // ---------- pestañas ----------
  function renderTabs() {
    const visibles = Object.entries(TABS).filter(([, cfg]) => cfg.roles.includes(state.role));

    ui.tabs.innerHTML = visibles
      .map(([key, cfg]) => `<button type="button" class="step-indicator" data-tab="${key}">${cfg.label}</button>`)
      .join("");

    ui.tabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => abrirTab(btn.dataset.tab));
    });

    // Los meseros entran directo a lo que usan en la puerta.
    abrirTab(state.role === "admin" ? "resumen" : "validar");
  }

  function abrirTab(tab) {
    state.tab = tab;
    ui.tabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${tab}`);
    });
    if (tab === "validar") ui.codigoValidar.focus();
  }

  // ---------- datos ----------
  async function cargarEventos() {
    const { data: events } = await db
      .from("events")
      .select("id, slug, name, event_date, venue, status")
      .order("event_date", { ascending: false });

    state.events = events || [];

    if (!state.events.length) {
      ui.eventSelect.innerHTML = "<option>Sin eventos</option>";
      return;
    }

    ui.eventSelect.innerHTML = state.events
      .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
      .join("");

    if (ui.plantilla) {
      ui.plantilla.innerHTML = state.events
        .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
        .join("");
    }

    state.eventId = state.events[0].id;
    ui.eventSelect.value = state.eventId;
    await cargarEvento();
  }

  ui.eventSelect.addEventListener("change", async () => {
    state.eventId = ui.eventSelect.value;
    await cargarEvento();
  });

  async function cargarEvento() {
    const { data: sections } = await db
      .from("sections")
      .select("id, code, label, price_cents, assignment_mode, capacity, sort_order")
      .eq("event_id", state.eventId)
      .order("sort_order");

    state.sections = sections || [];
    const sectionIds = state.sections.map((s) => s.id);

    const { data: tables } = sectionIds.length
      ? await db
        .from("tables")
        .select("id, section_id, number, seat_count, pos_x, pos_y, label")
        .in("section_id", sectionIds)
        .order("number")
      : { data: [] };
    state.tables = tables || [];

    const tableIds = state.tables.map((t) => t.id);
    const { data: seats } = tableIds.length
      ? await db.from("seats").select("id, table_id, number, status").in("table_id", tableIds)
      : { data: [] };
    state.seats = seats || [];

    if (state.role === "admin") {
      const { data: orders } = await db
        .from("orders")
        .select("id, section_id, amount_cents, status, created_at")
        .eq("event_id", state.eventId);
      state.orders = orders || [];
    }

    // Los meseros leen la vista sin datos personales ni de pago.
    const fuente = state.role === "admin" ? "tickets" : "tickets_staff";
    const columnas = state.role === "admin"
      ? "code, section_code, section_label, table_number, seat_number, buyer_name, buyer_lastname, status, used_at, created_at"
      : "code, section_code, section_label, table_number, seat_number, buyer_name, buyer_lastname, status, used_at, created_at";

    const { data: tickets } = await db
      .from(fuente)
      .select(columnas)
      .eq("event_id", state.eventId)
      .order("created_at", { ascending: false });
    state.tickets = tickets || [];

    renderTodo();
    suscribirRealtime();
  }

  function renderTodo() {
    if (state.role === "admin") {
      renderResumen();
      renderSalon();
      renderEventos();
    }
    renderEntradas();
  }

  // ---------- realtime ----------
  function suscribirRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);

    realtimeChannel = db
      .channel("admin-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "seats" }, (payload) => {
        const seat = state.seats.find((s) => s.id === payload.new.id);
        if (!seat || seat.status === payload.new.status) return;
        seat.status = payload.new.status;
        if (state.role === "admin") {
          renderResumen();
          actualizarMesaEnEditor(payload.new.table_id);
        }
      })
      .subscribe();
  }

  // ---------- resumen ----------
  function ocupacionPorSeccion() {
    return state.sections.map((section) => {
      const tablas = state.tables.filter((t) => t.section_id === section.id);
      const ids = new Set(tablas.map((t) => t.id));
      const sillas = state.seats.filter((s) => ids.has(s.table_id));
      const total = sillas.length;
      const usados = sillas.filter((s) => s.status !== "available").length;

      if (section.assignment_mode === "none") {
        const vendidas = state.tickets.filter((t) => t.section_code === section.code).length;
        return { label: section.label, usados: vendidas, total: 0 };
      }
      return { label: section.label, usados, total };
    });
  }

  function renderResumen() {
    const pagadas = state.orders.filter((o) => o.status === "paid");
    const recaudado = pagadas.reduce((acc, o) => acc + o.amount_cents, 0);
    const usadas = state.tickets.filter((t) => t.status === "used").length;

    const ocupacion = ocupacionPorSeccion();
    const conLimite = ocupacion.filter((o) => o.total > 0);
    const totalLugares = conLimite.reduce((acc, o) => acc + o.total, 0);
    const lugaresTomados = conLimite.reduce((acc, o) => acc + o.usados, 0);
    const pctGlobal = totalLugares ? Math.round((lugaresTomados / totalLugares) * 100) : 0;

    window.charts.kpis(ui.kpiRow, [
      { label: "Recaudado", value: money(recaudado), detail: `${pagadas.length} pago(s) confirmado(s)` },
      { label: "Entradas emitidas", value: String(state.tickets.length) },
      { label: "Ya utilizadas", value: String(usadas), detail: "Validadas en la puerta" },
      { label: "Ocupación", value: `${pctGlobal}%`, detail: `${lugaresTomados} de ${totalLugares} lugares` },
    ]);

    const porSeccion = state.sections.map((section) => ({
      label: section.label,
      value: pagadas.filter((o) => o.section_id === section.id)
        .reduce((acc, o) => acc + o.amount_cents, 0),
    }));

    window.charts.barrasHorizontales(
      document.getElementById("chartRecaudacion"),
      porSeccion,
      money,
    );

    window.charts.medidores(document.getElementById("chartOcupacion"), ocupacion);

    // Últimos 14 días, incluidos los que no tuvieron ventas.
    const dias = [];
    for (let i = 13; i >= 0; i--) {
      const fecha = new Date();
      fecha.setHours(0, 0, 0, 0);
      fecha.setDate(fecha.getDate() - i);
      dias.push({
        clave: fecha.toISOString().slice(0, 10),
        label: fecha.toLocaleDateString("es", { day: "2-digit", month: "2-digit" }),
        value: 0,
      });
    }
    const indice = new Map(dias.map((d) => [d.clave, d]));
    state.tickets.forEach((ticket) => {
      const dia = indice.get(String(ticket.created_at).slice(0, 10));
      if (dia) dia.value += 1;
    });

    window.charts.lineaTemporal(document.getElementById("chartVentas"), dias);
  }

  // ---------- editor visual del salón ----------
  function renderSalon() {
    ui.salonEditor.innerHTML = state.sections.map((section) => {
      const tablas = state.tables.filter((t) => t.section_id === section.id);

      if (!tablas.length) {
        return `
          <section class="salon-section">
            <header class="salon-section__head">
              <h3>${esc(section.label)}</h3>
              <span class="hint">Sin mesas · acceso de pie</span>
            </header>
          </section>
        `;
      }

      const columnas = Math.max(...tablas.map((t) => t.pos_x || 1));
      const sillas = tablas.reduce((acc, t) => acc + t.seat_count, 0);

      return `
        <section class="salon-section">
          <header class="salon-section__head">
            <h3>${esc(section.label)}</h3>
            <span class="hint">${tablas.length} mesa(s) · ${sillas} lugares · ${esc(descripcionModo(section))}</span>
          </header>
          <div class="salon-grid" style="grid-template-columns: repeat(${columnas}, minmax(64px, 1fr));">
            ${tablas.map((t) => celdaMesa(t)).join("")}
          </div>
        </section>
      `;
    }).join("");

    ui.salonEditor.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        cambiarSillas(btn.dataset.tableId, Number(btn.dataset.step));
      });
    });
  }

  function descripcionModo(section) {
    if (section.assignment_mode === "manual") return "el comprador elige su lugar";
    if (section.assignment_mode === "auto_fcfs") return "asignación por orden de llegada";
    return "sin asiento asignado";
  }

  function celdaMesa(table) {
    const sillas = state.seats.filter((s) => s.table_id === table.id);
    const tomadas = sillas.filter((s) => s.status !== "available").length;
    const lleno = tomadas >= table.seat_count && table.seat_count > 0;

    return `
      <div class="salon-mesa ${lleno ? "salon-mesa--llena" : ""}"
           data-table="${table.id}"
           style="grid-column:${table.pos_x || "auto"};grid-row:${table.pos_y || "auto"}">
        <span class="salon-mesa__num">${esc(table.label || table.number)}</span>
        <span class="salon-mesa__ocup">${tomadas}/${table.seat_count}</span>
        <div class="stepper">
          <button type="button" data-step="-1" data-table-id="${table.id}" aria-label="Quitar una silla">−</button>
          <span>${table.seat_count}</span>
          <button type="button" data-step="1" data-table-id="${table.id}" aria-label="Agregar una silla">+</button>
        </div>
      </div>
    `;
  }

  function actualizarMesaEnEditor(tableId) {
    const celda = ui.salonEditor.querySelector(`[data-table="${tableId}"]`);
    const table = state.tables.find((t) => t.id === tableId);
    if (!celda || !table) return;

    const sillas = state.seats.filter((s) => s.table_id === tableId);
    const tomadas = sillas.filter((s) => s.status !== "available").length;
    celda.querySelector(".salon-mesa__ocup").textContent = `${tomadas}/${table.seat_count}`;
    celda.classList.toggle("salon-mesa--llena", tomadas >= table.seat_count && table.seat_count > 0);
  }

  async function cambiarSillas(tableId, delta) {
    const table = state.tables.find((t) => t.id === tableId);
    if (!table) return;

    const nuevo = table.seat_count + delta;
    if (nuevo < 0 || nuevo > 40) return;

    // El trigger de la base rechaza reducir por debajo de sillas ya tomadas.
    const { error } = await db.from("tables").update({ seat_count: nuevo }).eq("id", tableId);

    if (error) {
      mostrarAvisoSalon(error.message);
      return;
    }

    table.seat_count = nuevo;
    const { data: seats } = await db
      .from("seats").select("id, table_id, number, status").eq("table_id", tableId);
    state.seats = state.seats.filter((s) => s.table_id !== tableId).concat(seats || []);

    renderSalon();
    renderResumen();
  }

  function mostrarAvisoSalon(mensaje) {
    const limpio = mensaje.includes("No se puede reducir")
      ? mensaje.split("\n")[0]
      : "No se pudo aplicar el cambio.";
    let banner = document.getElementById("salonAviso");
    if (!banner) {
      banner = document.createElement("p");
      banner.id = "salonAviso";
      banner.className = "salon-aviso";
      ui.salonEditor.prepend(banner);
    }
    banner.textContent = limpio;
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.remove(), 6000);
  }

  // ---------- validación de entradas ----------
  ui.validarForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const codigo = ui.codigoValidar.value.trim();
    if (!codigo) {
      setError("validar", "Ingresa o escanea un código.");
      return;
    }
    setError("validar", "");
    ui.btnValidarEntrada.disabled = true;
    ui.btnValidarEntrada.textContent = "Validando...";

    const { data } = await window.callFunction(
      "verify-ticket",
      { code: codigo },
      state.session?.access_token,
    );

    ui.btnValidarEntrada.disabled = false;
    ui.btnValidarEntrada.textContent = "Validar";
    ui.codigoValidar.value = "";
    ui.codigoValidar.focus();

    renderResultadoValidacion(data);
    await refrescarTickets();
  });

  function renderResultadoValidacion(data) {
    const t = data.ticket;
    const detalle = t
      ? `
        <div class="verify-card__details">
          <div class="row"><span>Sección</span><span><strong>${esc(t.section_label)}</strong></span></div>
          <div class="row"><span>Ubicación</span><span>${
            t.seat_number ? `Mesa ${esc(t.table_number)} · Silla ${esc(t.seat_number)}` : "Acceso general (de pie)"
          }</span></div>
          <div class="row"><span>Invitado</span><span>${esc(t.buyer_name)} ${esc(t.buyer_lastname)}</span></div>
          <div class="row"><span>Código</span><span>${esc(t.code)}</span></div>
        </div>`
      : "";

    let clase = "verify-card--invalida";
    let icono = "❌";
    let titulo = data.error || "Entrada inexistente";

    if (data.result === "valid") {
      clase = "verify-card--valida";
      icono = "✅";
      titulo = "Entrada válida";
    } else if (data.result === "already_used") {
      clase = "verify-card--usada";
      icono = "⚠️";
      const cuando = data.used_at ? new Date(data.used_at).toLocaleString("es") : "antes";
      titulo = `Entrada ya utilizada (${cuando})`;
    } else if (data.result === "canceled") {
      titulo = "Entrada cancelada";
    } else if (data.tampered) {
      titulo = "El código QR fue alterado";
    }

    ui.validarResultado.innerHTML = `
      <div class="verify-card ${clase}">
        <div class="verify-card__icon">${icono}</div>
        <p class="verify-card__status">${esc(titulo)}</p>
        ${detalle}
      </div>
    `;
  }

  async function refrescarTickets() {
    const fuente = state.role === "admin" ? "tickets" : "tickets_staff";
    const { data } = await db
      .from(fuente)
      .select("code, section_code, section_label, table_number, seat_number, buyer_name, buyer_lastname, status, used_at, created_at")
      .eq("event_id", state.eventId)
      .order("created_at", { ascending: false });
    state.tickets = data || [];
    renderEntradas();
    if (state.role === "admin") renderResumen();
  }

  // ---------- listado de entradas ----------
  ui.buscarEntrada.addEventListener("input", renderEntradas);
  ui.filtroEstado.addEventListener("change", renderEntradas);

  function renderEntradas() {
    const busqueda = ui.buscarEntrada.value.trim().toLowerCase();
    const estado = ui.filtroEstado.value;

    const filas = state.tickets.filter((t) => {
      if (estado && t.status !== estado) return false;
      if (!busqueda) return true;
      return `${t.code} ${t.buyer_name} ${t.buyer_lastname}`.toLowerCase().includes(busqueda);
    });

    if (!filas.length) {
      ui.tablaEntradas.innerHTML =
        '<tbody><tr><td class="empty">No hay entradas que coincidan.</td></tr></tbody>';
      return;
    }

    const etiquetaEstado = {
      valid: '<span class="pill pill--ok">Válida</span>',
      used: '<span class="pill pill--used">Utilizada</span>',
      canceled: '<span class="pill pill--bad">Cancelada</span>',
    };

    ui.tablaEntradas.innerHTML = `
      <thead>
        <tr>
          <th>Código</th><th>Invitado</th><th>Sección</th><th>Ubicación</th><th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${filas.map((t) => `
          <tr>
            <td class="mono">${esc(t.code)}</td>
            <td>${esc(t.buyer_name)} ${esc(t.buyer_lastname)}</td>
            <td>${esc(t.section_label)}</td>
            <td>${t.seat_number ? `Mesa ${esc(t.table_number)} · Silla ${esc(t.seat_number)}` : "General"}</td>
            <td>${etiquetaEstado[t.status] || esc(t.status)}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
  }

  // ---------- apertura de eventos ----------
  function renderEventos() {
    ui.tablaEventos.innerHTML = `
      <thead><tr><th>Evento</th><th>Fecha</th><th>Lugar</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${state.events.map((e) => `
          <tr>
            <td>${esc(e.name)}</td>
            <td>${e.event_date ? new Date(e.event_date).toLocaleString("es") : "—"}</td>
            <td>${esc(e.venue || "—")}</td>
            <td>${esc(e.status)}</td>
            <td>
              <button type="button" class="btn btn--ghost btn--sm"
                      data-toggle-event="${e.id}" data-status="${e.status}">
                ${e.status === "published" ? "Despublicar" : "Publicar"}
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;

    ui.tablaEventos.querySelectorAll("[data-toggle-event]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nuevo = btn.dataset.status === "published" ? "draft" : "published";
        await db.from("events").update({ status: nuevo }).eq("id", btn.dataset.toggleEvent);
        await cargarEventos();
      });
    });
  }

  ui.btnCrearEvento.addEventListener("click", async () => {
    setError("evento", "");
    const nombre = document.getElementById("nuevoNombre").value.trim();
    const fecha = document.getElementById("nuevaFecha").value;
    const venue = document.getElementById("nuevoVenue").value.trim();
    const plantillaId = ui.plantilla.value;

    if (!nombre || !fecha) {
      setError("evento", "El nombre y la fecha son obligatorios.");
      return;
    }

    ui.btnCrearEvento.disabled = true;

    const slug = `${nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

    const { data: nuevo, error } = await db
      .from("events")
      .insert({ slug, name: nombre, event_date: new Date(fecha).toISOString(), venue, status: "draft" })
      .select("id")
      .single();

    if (error || !nuevo) {
      ui.btnCrearEvento.disabled = false;
      setError("evento", "No se pudo crear el evento.");
      return;
    }

    if (plantillaId) await copiarSalon(plantillaId, nuevo.id);

    ui.btnCrearEvento.disabled = false;
    document.getElementById("eventoForm").reset();
    await cargarEventos();
    abrirTab("salon");
  });

  // Copiar el salón evita rearmar 120 mesas a mano en cada evento nuevo.
  async function copiarSalon(origenId, destinoId) {
    const { data: sections } = await db
      .from("sections")
      .select("code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color, notice, id")
      .eq("event_id", origenId)
      .order("sort_order");

    for (const section of sections || []) {
      const { id: origenSectionId, ...campos } = section;
      const { data: creada } = await db
        .from("sections")
        .insert({ ...campos, event_id: destinoId })
        .select("id")
        .single();

      if (!creada) continue;

      const { data: tables } = await db
        .from("tables")
        .select("number, seat_count, pos_x, pos_y, label")
        .eq("section_id", origenSectionId)
        .order("number");

      if (tables?.length) {
        await db.from("tables").insert(tables.map((t) => ({ ...t, section_id: creada.id })));
      }
    }
  }

  iniciar();
})();
