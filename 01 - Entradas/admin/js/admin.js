/* Panel del personal: admin (configuración y contabilidad) y mesero (operación).
   Lo que cada rol puede ver o cambiar lo decide RLS en Supabase; acá solo se
   esconde lo que igual sería rechazado por el servidor. */

(function () {
  "use strict";

  const db = window.supabaseClient;

  /* Los módulos de esta página, agrupados como se usan: lo del evento, lo de
     la puerta y lo que se administra. Un mesero solo ve el grupo de la puerta. */
  const TABS = {
    resumen: { label: "Resumen", roles: ["admin"], grupo: "Evento" },
    salon: { label: "Salón", roles: ["admin"], grupo: "Evento" },
    portada: { label: "Portada", roles: ["admin"], grupo: "Evento" },
    eventos: { label: "Eventos", roles: ["admin"], grupo: "Evento" },
    validar: { label: "Validar", roles: ["admin", "mesero"], grupo: "Puerta" },
    entradas: { label: "Entradas", roles: ["admin", "mesero"], grupo: "Puerta" },
  };

  // Módulos que viven en su propia página porque tienen filtros y estado propios.
  const PAGINAS = [
    { href: "operaciones.html", label: "Operaciones", roles: ["admin"], grupo: "Gestión" },
    { href: "solicitudes.html", label: "Solicitudes", roles: ["admin"], grupo: "Gestión" },
    { href: "publicidad.html", label: "Publicidad", roles: ["admin"], grupo: "Gestión" },
  ];

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

  // Solo estas columnas llegan al navegador: los permisos de la base
  // impiden leer el documento y el WhatsApp del comprador.
  const COLUMNAS_TICKET =
    "code, section_code, section_label, table_number, table_code, seat_number, " +
    "guest_index, buyer_name, buyer_lastname, status, used_at, is_courtesy, created_at";

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

  const DOMINIO = "enprokart.com";

  // El campo pide solo el usuario; el dominio lo pone el sistema. Si alguien
  // escribe el correo entero por costumbre, se le recorta en vez de rechazarlo.
  function correoDelUsuario() {
    const escrito = document.getElementById("usuario").value.trim().toLowerCase();
    return `${escrito.replace(/@.*$/, "")}@${DOMINIO}`;
  }

  ui.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("login", "");
    ui.btnLogin.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email: correoDelUsuario(),
      password: document.getElementById("password").value,
    });

    ui.btnLogin.disabled = false;
    if (error) {
      setError("login", "Usuario o contraseña incorrectos.");
      return;
    }
    ui.loginForm.reset();
    await iniciar();
  });

  // Ver la contraseña: en un teléfono, escribir a ciegas una clave generada
  // como "Vbugq-KRXNk-Npxo" es la causa más común de no poder entrar.
  document.getElementById("verClave")?.addEventListener("click", () => {
    const campo = document.getElementById("password");
    const boton = document.getElementById("verClave");
    const visible = campo.type === "text";
    campo.type = visible ? "password" : "text";
    boton.setAttribute("aria-pressed", String(!visible));
    boton.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
    boton.classList.toggle("viendo", !visible);
    campo.focus();
  });

  // Olvidé mi contraseña: no manda correo (el dominio no tiene buzones). Deja
  // el pedido en el panel y un admin genera una clave nueva.
  document.getElementById("btnOlvide")?.addEventListener("click", async () => {
    const escrito = document.getElementById("usuario").value.trim();
    if (!escrito) {
      setError("login", "Escribí tu usuario y volvé a tocar el enlace.");
      document.getElementById("usuario").focus();
      return;
    }

    setError("login", "");
    try {
      await fetch(`${window.PROKART_CONFIG.SUPABASE_URL}/functions/v1/crear-solicitud`, {
        method: "POST",
        headers: {
          apikey: window.PROKART_CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.PROKART_CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "clave", usuario: escrito }),
      });
    } catch { /* se responde igual: ver abajo */ }

    // Siempre el mismo mensaje, exista o no ese usuario. Decir "ese usuario no
    // existe" le confirma a un desconocido qué cuentas hay.
    const caja = document.querySelector('.error[data-for="login"]');
    if (caja) {
      caja.textContent = "Listo. Un administrador te va a entregar una clave nueva.";
      caja.classList.add("error--ok");
    }
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
      .select("role, display_name, must_change_password")
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

    // La clave temporal la dictó otra persona: mientras siga puesta, el panel
    // no se abre. No es una sugerencia que se pueda saltear.
    if (perfil.must_change_password) {
      ui.shell.classList.add("hidden");
      document.getElementById("bloqueoClave").hidden = false;
      document.getElementById("claveActual").focus();
      return;
    }

    ui.shell.classList.remove("hidden");

    renderTabs();
    await cargarEventos();
  }

  // ---------- cambio de clave obligatorio ----------
  document.getElementById("cambioClaveForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("cambioClave", "");

    const actual = document.getElementById("claveActual").value;
    const nueva1 = document.getElementById("claveNueva1").value;
    const nueva2 = document.getElementById("claveNueva2").value;

    if (nueva1 !== nueva2) return setError("cambioClave", "Las dos claves nuevas no coinciden.");
    if (nueva1.length < 8) return setError("cambioClave", "La clave nueva necesita al menos 8 caracteres.");
    if (!/[a-zA-Z]/.test(nueva1) || !/[0-9]/.test(nueva1)) {
      return setError("cambioClave", "Combiná letras y números.");
    }
    if (nueva1 === actual) return setError("cambioClave", "La clave nueva tiene que ser distinta de la actual.");

    const boton = document.getElementById("btnCambiarClave");
    boton.disabled = true;
    boton.textContent = "Guardando...";

    try {
      // Se comprueba la clave actual volviendo a iniciar sesión con ella. Sin
      // esto, cualquiera que encuentre una sesión abierta podría apropiarse de
      // la cuenta cambiando la clave sin conocer la anterior.
      const { error: malActual } = await db.auth.signInWithPassword({
        email: state.session.user.email,
        password: actual,
      });
      if (malActual) throw new Error("La contraseña actual no es correcta.");

      const { data: sesion } = await db.auth.getSession();
      const respuesta = await fetch(
        `${window.PROKART_CONFIG.SUPABASE_URL}/functions/v1/staff-admin`,
        {
          method: "POST",
          headers: {
            apikey: window.PROKART_CONFIG.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${sesion.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "change_own_password", new_password: nueva1 }),
        },
      );

      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo cambiar la clave.");

      // Cambiar la clave invalida la sesión: se vuelve a entrar con la nueva.
      await db.auth.signInWithPassword({ email: state.session.user.email, password: nueva1 });

      document.getElementById("cambioClaveForm").reset();
      document.getElementById("bloqueoClave").hidden = true;
      await iniciar();
    } catch (error) {
      setError("cambioClave", error.message);
    }

    boton.disabled = false;
    boton.textContent = "Guardar y entrar";
  });

  document.getElementById("btnSalirDeBloqueo")?.addEventListener("click", async () => {
    await db.auth.signOut();
    location.reload();
  });

  // ---------- barra lateral ----------
  function renderTabs() {
    const modulos = Object.entries(TABS).filter(([, cfg]) => cfg.roles.includes(state.role));
    const paginas = PAGINAS.filter((p) => p.roles.includes(state.role));

    // Se arma por grupos y en el orden en que aparecen, sin ordenar alfabético:
    // el orden dice cómo se usa el panel.
    const grupos = [];
    const agregar = (grupo, html) => {
      const existente = grupos.find((g) => g.nombre === grupo);
      if (existente) existente.items.push(html);
      else grupos.push({ nombre: grupo, items: [html] });
    };

    for (const [key, cfg] of modulos) {
      agregar(cfg.grupo, `<button type="button" class="sidebar__item" data-tab="${key}">${cfg.label}</button>`);
    }
    for (const p of paginas) {
      agregar(p.grupo, `<a class="sidebar__item" href="${p.href}">${p.label}</a>`);
    }

    ui.tabs.innerHTML = grupos.map((g) => `
      <div class="sidebar__grupo">
        <p class="sidebar__rotulo">${g.nombre}</p>
        ${g.items.join("")}
      </div>
    `).join("");

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

    const titulo = document.getElementById("tituloModulo");
    if (titulo) titulo.textContent = TABS[tab]?.label ?? "";

    // En el teléfono la barra tapa el contenido: elegir algo tiene que cerrarla.
    cerrarMenu();

    if (tab === "validar") ui.codigoValidar.focus();
  }

  // ---------- menú en teléfono ----------
  function abrirMenu() {
    document.getElementById("sidebar")?.classList.add("abierta");
    document.getElementById("sidebarVelo")?.removeAttribute("hidden");
    document.getElementById("btnMenu")?.setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-abierto");
  }

  function cerrarMenu() {
    document.getElementById("sidebar")?.classList.remove("abierta");
    document.getElementById("sidebarVelo")?.setAttribute("hidden", "");
    document.getElementById("btnMenu")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-abierto");
  }

  document.getElementById("btnMenu")?.addEventListener("click", () => {
    const abierta = document.getElementById("sidebar")?.classList.contains("abierta");
    abierta ? cerrarMenu() : abrirMenu();
  });
  document.getElementById("sidebarVelo")?.addEventListener("click", cerrarMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarMenu(); });

  // ---------- pestañas dentro de un módulo ----------
  // Delegado: sirve para los módulos que ya existen y para los que se agreguen,
  // sin volver a cablear nada.
  document.addEventListener("click", (e) => {
    const boton = e.target.closest(".modulo-tab");
    if (!boton) return;

    const modulo = boton.closest(".tab-panel");
    if (!modulo) return;

    modulo.querySelectorAll(".modulo-tab").forEach((b) => {
      b.classList.toggle("active", b === boton);
    });
    modulo.querySelectorAll(".modulo-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.sub === boton.dataset.sub);
    });

    if (boton.dataset.sub === "visitas") cargarVisitas();
  });

  // ---------- datos ----------
  async function cargarEventos() {
    const { data: events } = await db
      .from("events")
      .select("id, slug, name, event_date, venue, status, tagline, cover_image, event_type, city, city_code, description, is_main, sells_tickets")
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

    // Los permisos por columna limitan qué campos llegan al navegador,
    // así que ambos roles pueden leer la tabla directamente.
    const { data: tickets } = await db
      .from("tickets")
      .select(COLUMNAS_TICKET)
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
      renderPortada();
      cargarMenu();
    }
    renderEntradas();
  }

  // ---------- portada del sitio ----------
  function renderPortada() {
    const e = state.events.find((x) => x.id === state.eventId);
    if (!e) return;

    const campos = {
      pNombre: e.name, pTagline: e.tagline, pLugar: e.venue,
      pTipo: e.event_type, pDescripcion: e.description,
      pCiudad: e.city, pCiudadCorta: e.city_code, pImagen: e.cover_image,
    };
    Object.entries(campos).forEach(([id, valor]) => {
      const el = document.getElementById(id);
      if (el) el.value = valor ?? "";
    });

    const fecha = document.getElementById("pFecha");
    if (fecha) {
      // El input datetime-local necesita hora local sin zona.
      fecha.value = e.event_date
        ? new Date(new Date(e.event_date).getTime() - new Date().getTimezoneOffset() * 60000)
          .toISOString().slice(0, 16)
        : "";
    }
  }

  const btnPortada = document.getElementById("btnGuardarPortada");
  if (btnPortada) {
    btnPortada.addEventListener("click", async () => {
      setError("portada", "");
      btnPortada.disabled = true;

      const valor = (id) => document.getElementById(id).value.trim() || null;
      const fecha = document.getElementById("pFecha").value;

      const { error } = await db.from("events").update({
        name: valor("pNombre"),
        tagline: valor("pTagline"),
        venue: valor("pLugar"),
        event_type: valor("pTipo"),
        description: valor("pDescripcion"),
        city: valor("pCiudad"),
        city_code: valor("pCiudadCorta"),
        cover_image: valor("pImagen"),
        event_date: fecha ? new Date(fecha).toISOString() : null,
      }).eq("id", state.eventId);

      btnPortada.disabled = false;

      if (error) {
        setError("portada", "No se pudo guardar.");
        return;
      }
      setError("portada", "");
      btnPortada.textContent = "Guardado";
      setTimeout(() => (btnPortada.textContent = "Guardar portada"), 2000);
      await cargarEventos();
    });
  }

  // ---------- menú ----------
  async function cargarMenu() {
    const tabla = document.getElementById("tablaMenu");
    if (!tabla) return;

    const { data } = await db
      .from("menu_items")
      .select("id, name, description, price_cents, active, sort_order")
      .order("sort_order");

    const items = data || [];

    if (!items.length) {
      tabla.innerHTML = '<tbody><tr><td class="empty">Todavía no hay productos.</td></tr></tbody>';
      return;
    }

    tabla.innerHTML = `
      <thead><tr><th>Producto</th><th>Descripción</th><th>Precio</th><th>Visible</th><th></th></tr></thead>
      <tbody>
        ${items.map((p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.description || "—")}</td>
            <td>${p.price_cents == null ? "—" : money(p.price_cents)}</td>
            <td>${p.active ? '<span class="pill pill--ok">Sí</span>' : '<span class="pill pill--bad">No</span>'}</td>
            <td>
              <button type="button" class="btn btn--ghost btn--sm" data-menu-toggle="${p.id}" data-activo="${p.active}">
                ${p.active ? "Ocultar" : "Mostrar"}
              </button>
              <button type="button" class="btn btn--ghost btn--sm" data-menu-borrar="${p.id}">Borrar</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;

    tabla.querySelectorAll("[data-menu-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await db.from("menu_items")
          .update({ active: btn.dataset.activo !== "true" })
          .eq("id", btn.dataset.menuToggle);
        await cargarMenu();
      });
    });

    tabla.querySelectorAll("[data-menu-borrar]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await db.from("menu_items").delete().eq("id", btn.dataset.menuBorrar);
        await cargarMenu();
      });
    });
  }

  const btnMenu = document.getElementById("btnAgregarMenu");
  if (btnMenu) {
    btnMenu.addEventListener("click", async () => {
      setError("menu", "");
      const nombre = document.getElementById("mNombre").value.trim();
      if (!nombre) {
        setError("menu", "Poné el nombre del producto.");
        return;
      }

      const precio = document.getElementById("mPrecio").value;
      btnMenu.disabled = true;

      const { error } = await db.from("menu_items").insert({
        name: nombre,
        description: document.getElementById("mDescripcion").value.trim() || null,
        price_cents: precio === "" ? null : Math.round(Number(precio) * 100),
        sort_order: 99,
      });

      btnMenu.disabled = false;

      if (error) {
        setError("menu", "No se pudo agregar.");
        return;
      }
      document.getElementById("menuForm").reset();
      await cargarMenu();
    });
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
              ${campoPrecio(section)}
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
            ${campoPrecio(section)}
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

    ui.salonEditor.querySelectorAll("[data-precio-guardar]").forEach((btn) => {
      btn.addEventListener("click", () => guardarPrecio(btn.dataset.precioGuardar));
    });
    ui.salonEditor.querySelectorAll("[data-precio-input]").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          guardarPrecio(input.dataset.precioInput);
        }
      });
    });
  }

  // El precio vive solo en la base: `create-order` lo lee de ahí en cada venta,
  // así que lo que se guarde acá es lo que se cobra. RLS ya rechaza a quien no
  // sea admin; esconder el campo es solo para no ofrecer algo que fallaría.
  function campoPrecio(section) {
    if (state.role !== "admin") {
      return `<span class="precio-lectura">${money(section.price_cents)}</span>`;
    }
    return `
      <div class="precio-editor">
        <label for="precio-${section.id}">Precio</label>
        <span class="precio-editor__moneda">R$</span>
        <input type="number" id="precio-${section.id}" data-precio-input="${section.id}"
               min="0" step="0.01" value="${(section.price_cents / 100).toFixed(2)}" />
        <button type="button" class="btn btn--ghost btn--sm" data-precio-guardar="${section.id}">
          Guardar
        </button>
        <span class="precio-editor__estado" id="precio-estado-${section.id}"></span>
      </div>
    `;
  }

  async function guardarPrecio(sectionId) {
    const input = ui.salonEditor.querySelector(`[data-precio-input="${sectionId}"]`);
    const estado = document.getElementById(`precio-estado-${sectionId}`);
    if (!input) return;

    const reales = Number(input.value);
    if (!Number.isFinite(reales) || reales < 0) {
      estado.textContent = "Precio inválido";
      estado.className = "precio-editor__estado precio-editor__estado--error";
      return;
    }

    const centavos = Math.round(reales * 100);
    const { error } = await db
      .from("sections").update({ price_cents: centavos }).eq("id", sectionId);

    if (error) {
      estado.textContent = "No se pudo guardar";
      estado.className = "precio-editor__estado precio-editor__estado--error";
      return;
    }

    const section = state.sections.find((s) => s.id === sectionId);
    if (section) section.price_cents = centavos;

    estado.textContent = "Guardado";
    estado.className = "precio-editor__estado precio-editor__estado--ok";
    setTimeout(() => { estado.textContent = ""; }, 2500);
    renderResumen();
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
            t.table_code ? `Mesa ${esc(t.table_code)}` : "Acceso general (de pie)"
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
    const { data } = await db
      .from("tickets")
      .select(COLUMNAS_TICKET)
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
            <td>${t.table_code ? `Mesa ${esc(t.table_code)}` : "General"}</td>
            <td>${etiquetaEstado[t.status] || esc(t.status)}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
  }

  // ---------- apertura de eventos ----------
  function renderEventos() {
    ui.tablaEventos.innerHTML = `
      <thead><tr><th>Evento</th><th>Fecha</th><th>Lugar</th><th>Estado</th><th>Portada</th><th></th></tr></thead>
      <tbody>
        ${state.events.map((e) => `
          <tr>
            <td>${esc(e.name)}</td>
            <td>${e.event_date ? new Date(e.event_date).toLocaleString("es") : "—"}</td>
            <td>${esc(e.venue || "—")}</td>
            <td>${e.status === "published"
              ? '<span class="pill pill--ok">Publicado</span>'
              : '<span class="pill pill--bad">Borrador</span>'}</td>
            <td>${e.is_main
              ? '<span class="pill pill--used">En portada</span>'
              : `<button type="button" class="btn btn--ghost btn--sm" data-portada="${e.id}">Poner</button>`}</td>
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

    // Solo un evento puede estar en portada, así que primero se baja el anterior.
    ui.tablaEventos.querySelectorAll("[data-portada]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await db.from("events").update({ is_main: false }).eq("is_main", true);
        await db.from("events").update({ is_main: true }).eq("id", btn.dataset.portada);
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

  // ---------- visitas al sitio ----------

  /* El resumen diario de visitas. Se carga al abrir la pestaña y no al entrar
     al panel: es un dato que se consulta, no que se vigila. */
  async function cargarVisitas() {
    const desde = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

    const { data, error } = await db
      .from("visits_totals")
      .select("day, uniques, pageviews")
      .gte("day", desde)
      .order("day");

    const caja = document.getElementById("kpiVisitas");
    if (error || !data) {
      if (caja) caja.innerHTML = `<p class="hint">No se pudieron leer las visitas.</p>`;
      return;
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const deHoy = data.find((d) => d.day === hoy);
    const unicos = data.reduce((acc, d) => acc + d.uniques, 0);
    const vistas = data.reduce((acc, d) => acc + Number(d.pageviews), 0);
    const promedio = data.length ? Math.round(unicos / data.length) : 0;
    const nUtil = (n) => Number(n).toLocaleString("es");

    window.charts.kpis(caja, [
      { label: "Visitantes hoy", value: nUtil(deHoy?.uniques ?? 0), detail: "Personas distintas" },
      { label: "Últimos 30 días", value: nUtil(unicos) },
      { label: "Promedio diario", value: nUtil(promedio) },
      { label: "Páginas vistas", value: nUtil(vistas), detail: "Incluye recargas" },
    ]);

    // Se rellenan los días sin visitas: un hueco en la serie se lee como un día
    // que no existió, no como un día sin nadie.
    const dias = [];
    for (let i = 29; i >= 0; i--) {
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
    for (const fila of data) {
      const dia = indice.get(fila.day);
      if (dia) dia.value = fila.uniques;
    }

    window.charts.lineaTemporal(document.getElementById("chartVisitas"), dias);
  }

  // ---------- redes del pie ----------
  async function cargarRedes() {
    const { data } = await db
      .from("site_settings")
      .select("instagram_url, tiktok_url, whatsapp_url")
      .limit(1)
      .maybeSingle();

    if (!data) return;
    const campo = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.value = valor ?? "";
    };
    campo("rInstagram", data.instagram_url);
    campo("rTiktok", data.tiktok_url);
    campo("rWhatsapp", data.whatsapp_url);
  }

  document.getElementById("btnGuardarRedes")?.addEventListener("click", async () => {
    setError("redes", "");
    const valor = (id) => document.getElementById(id).value.trim() || null;

    const { error } = await db.from("site_settings").update({
      instagram_url: valor("rInstagram"),
      tiktok_url: valor("rTiktok"),
      whatsapp_url: valor("rWhatsapp"),
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    setError("redes", error ? "No se pudieron guardar las redes." : "");
    if (!error) {
      const caja = document.querySelector('.error[data-for="redes"]');
      if (caja) {
        caja.textContent = "Guardado.";
        caja.classList.add("error--ok");
        setTimeout(() => { caja.textContent = ""; caja.classList.remove("error--ok"); }, 2500);
      }
    }
  });

  iniciar().then(() => {
    if (state.role === "admin") cargarRedes();
  });
})();
