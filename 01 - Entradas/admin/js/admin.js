/* Panel del personal: admin (configuración y contabilidad) y mesero (operación).
   Lo que cada rol puede ver o cambiar lo decide RLS en Supabase; acá solo se
   esconde lo que igual sería rechazado por el servidor. */

(function () {
  "use strict";

  const db = window.supabaseClient;

  /* Los módulos de la barra —cuáles hay, en qué grupo, con qué icono y para qué
     rol— viven en js/nav.js. Acá había una de las dos listas que existían: la
     otra estaba en panel-base.js, sin roles y con otros nombres para los mismos
     módulos. Dos listas de lo mismo se separan solas, y ya lo habían hecho. */

  /* `developer` ve lo mismo que un admin: es la misma llave que abre las
     políticas de la base, donde `is_admin()` cuenta a los dos. La diferencia
     entre ambos es a quién pueden gestionar, y eso se resuelve en la pantalla de
     Usuarios y en la Edge Function, no acá. `state.role` queda intacto. */
  const rolDeVista = (rol) => (rol === "developer" ? "admin" : rol);
  const esAdmin = () => rolDeVista(state.role) === "admin";

  const ui = {
    loginWrap: document.getElementById("loginWrap"),
    loginForm: document.getElementById("loginForm"),
    btnLogin: document.getElementById("btnLogin"),
    shell: document.getElementById("shell"),
    // El hueco de la barra se llama igual en las nueve páginas: antes era
    // `tabs` acá y `panelNav` en las otras ocho, y ese solo detalle impedía
    // que las dos rutas compartieran el mismo renderizador.
    tabs: document.getElementById("panelNav"),
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

  // `ok` usa el mismo hueco para confirmar algo, en verde: subir una imagen y
  // que no aparezca nada es indistinguible de que haya fallado en silencio.
  function setError(campo, mensaje, ok = false) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (!el) return;
    el.textContent = mensaje || "";
    el.classList.toggle("error--ok", Boolean(mensaje) && ok);
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
      setError("login", "Escribe tu usuario y vuelve a tocar el enlace.");
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
      return setError("cambioClave", "Combina letras y números.");
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
  /* El modelo, los iconos y el marcado los emite nav.js, que es el único dueño.
     Acá vivía la mitad de arriba de esa duplicación —una segunda lista de
     módulos y un segundo generador de HTML—. */
  function renderTabs() {
    const rol = rolDeVista(state.role);

    window.PanelNav.render(ui.tabs, { rol, spa: true });

    // Delegado: el nodo se recrea entero en cada render, así que enganchar cada
    // botón por separado obligaba a reenganchar después de cada dibujo.
    ui.tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (btn) abrirTab(btn.dataset.tab);
    });

    window.PanelNav.montarBarra();

    /* El módulo se recuerda en el ancla. Sin esto, recargar la página volvía
       siempre a «Resumen» —se perdía en qué módulo estabas— y el botón «atrás»
       del navegador sacaba del panel en vez de retroceder un módulo.
       Los meseros entran directo a lo que usan en la puerta. */
    const delAncla = location.hash.slice(1);
    const permitido = window.PanelNav.NAV
      .flatMap((g) => g.items)
      .some((i) => !i.pagina && i.id === delAncla && i.roles.includes(rol));

    abrirTab(permitido ? delAncla : (rol === "admin" ? "resumen" : "validar"));

    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && id !== state.tab) abrirTab(id);
    });
  }

  function abrirTab(tab) {
    /* Salir del Salón con cambios sin guardar los perdería sin decir nada:
       `beforeunload` no se entera de un cambio de pestaña, porque la página
       nunca se descarga. */
    if (state.tab === "salon" && tab !== "salon" && pendientes()) {
      const seguir = confirm(
        `Tienes ${pendientes()} cambio(s) sin guardar en el salón.\n\n` +
        "Si sales ahora se pierden.",
      );
      if (!seguir) return;
      borrador.precios.clear();
      borrador.sillas.clear();
      renderSalon();
    }

    state.tab = tab;

    /* Marca los dos tipos de ítem. Antes solo tocaba los `[data-tab]`, así que
       estando dentro de un módulo los enlaces a las otras páginas no se
       marcaban nunca: la barra no decía dónde estabas si venías de una de ellas. */
    window.PanelNav.marcarActivo(ui.tabs, tab);

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${tab}`);
    });

    const titulo = document.getElementById("tituloModulo");
    if (titulo) titulo.textContent = window.PanelNav.titulo(tab);

    // Sin `pushState` se llenaría el historial con una entrada por pestaña.
    if (location.hash.slice(1) !== tab) {
      history.replaceState(null, "", `#${tab}`);
    }

    // Al salir de Validar la cámara se apaga sola.
    if (tab !== "validar") window.ProKartEscaner?.apagar();
  }

  /* El cajón de teléfono lo maneja nav.js —incluido cerrarlo al tocar un ítem—.
     Acá había una copia literal de lo que ya estaba en panel-base.js, escrita
     de otra manera y sin devolver el foco al botón al cerrar. */

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
      .select("id, code, label, price_cents, assignment_mode, capacity, sort_order, on_sale")
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

    if (esAdmin()) {
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
    if (esAdmin()) {
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

    pintarPreviaPortada(e.cover_image);
  }

  /* ---------- imagen de portada ----------

     Hasta ahora acá solo había un campo de texto donde había que escribir el
     nombre del archivo: la imagen se subía por otro lado y si el nombre no
     coincidía, la portada quedaba con la genérica y nadie sabía por qué.

     Se sube al bucket `medios`, el mismo de publicidad. El campo de texto sigue
     existiendo y sigue siendo la fuente de verdad —admite una ruta relativa como
     `placeholders/evento-generico.jpg`— pero ahora se puede llenar solo. */

  const IMAGENES_BUCKET = "medios";

  function pintarPreviaPortada(src) {
    const previa = document.getElementById("pImagenPrevia");
    if (!previa) return;

    if (!src) {
      previa.innerHTML = `<span class="subir-imagen__vacia">Sin imagen</span>`;
      return;
    }
    previa.innerHTML = `<img src="${esc(src)}" alt="" />`;
  }

  const inputPortada = document.getElementById("pImagenArchivo");
  if (inputPortada) {
    inputPortada.addEventListener("change", async () => {
      const archivo = inputPortada.files?.[0];
      if (!archivo) return;

      const boton = document.getElementById("pImagenBoton");
      const campo = document.getElementById("pImagen");
      setError("portada", "");
      boton.textContent = "Subiendo…";

      // La marca de tiempo evita que reemplazar la portada quede tapada por la
      // caché del navegador de quien ya vio la anterior.
      const extension = archivo.name.split(".").pop()?.toLowerCase() || "jpg";
      const ruta = `portada-${Date.now()}.${extension}`;

      const { error } = await db.storage
        .from(IMAGENES_BUCKET)
        .upload(ruta, archivo, { cacheControl: "3600", upsert: false });

      if (error) {
        boton.textContent = "Elegir imagen";
        setError("portada", `No se pudo subir la imagen: ${error.message}`);
        return;
      }

      const url =
        `${window.PROKART_CONFIG.SUPABASE_URL}/storage/v1/object/public/${IMAGENES_BUCKET}/${ruta}`;

      campo.value = url;
      pintarPreviaPortada(url);
      boton.textContent = archivo.name;
      boton.classList.add("cargado");

      // Subida y guardado son dos pasos: la imagen ya está en el bucket, pero
      // la portada no cambia hasta que se guarde. Decirlo evita que alguien se
      // vaya creyendo que ya está.
      setError("portada", "Imagen subida. Falta guardar la portada.", true);
    });
  }

  document.getElementById("pImagen")?.addEventListener("input", (e) => {
    pintarPreviaPortada(e.target.value.trim());
  });

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
        setError("menu", "Pon el nombre del producto.");
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
        if (!esAdmin()) return;
        renderResumen();

        // Solo se redibuja el número de ocupadas de esa mesa. Volver a armar el
        // editor entero borraría lo que la persona esté escribiendo en un precio.
        const celda = ui.salonEditor.querySelector(`[data-table="${payload.new.table_id}"]`);
        const mesa = state.tables.find((t) => t.id === payload.new.table_id);
        if (!celda || !mesa) return;

        const tomadas = state.seats
          .filter((s) => s.table_id === mesa.id && s.status !== "available").length;
        const cuenta = sillasDe(mesa);
        celda.querySelector(".salon-mesa__ocup").textContent = `${tomadas}/${cuenta}`;
        celda.classList.toggle("salon-mesa--llena", tomadas >= cuenta && cuenta > 0);
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

  /* ---------- editor del salón ----------

     Dos reglas ordenan esta pantalla.

     La primera: solo se dibujan las secciones que tienen plano. Las que
     asignan el lugar solas o no tienen mesa —hoy, General— se resumen en una
     fila con su capacidad: dibujarlas era pedirle a la persona que revisara
     una por una algo que nadie elige a mano. Plata sí se dibuja: desde que se
     elige en el plano, su mapa es lo que ve el comprador.

     La segunda: nada se guarda solo. Antes, cada precio tenía su botón y cada
     silla escribía en la base al tocarla, así que un clic de más ya era un
     cambio hecho. Ahora todo se acumula en un borrador y sale en una sola
     tanda, con la cuenta de lo pendiente siempre a la vista y un aviso si se
     intenta salir con cambios sin guardar. */

  const MAX_SILLAS = 40;

  // Lo editado y todavía no guardado. Vacío = no hay nada pendiente.
  const borrador = { precios: new Map(), sillas: new Map(), venta: new Map() };

  const tieneMapa = (section) => section.assignment_mode === "manual";
  const precioDe = (s) => (borrador.precios.has(s.id) ? borrador.precios.get(s.id) : s.price_cents);
  const sillasDe = (t) => (borrador.sillas.has(t.id) ? borrador.sillas.get(t.id) : t.seat_count);
  const pendientes = () => borrador.precios.size + borrador.sillas.size + borrador.venta.size;

  /* Oro no es una sección: es el nombre de las de adelante —A, B, C y las tres
     únicas—, que comparten precio y se ofrecen juntas en una sola tarjeta.
     Plata es la del fondo y va aparte. Es la misma división que hace el sitio.
     Se pregunta por el modo y el código, no por el nombre, para que una
     sección nueva entre sola. */
  const esDePlata = (s) => s.code === "PLATA" || s.code === "VIP_PLATA";
  const esDeOro = (s) => s.assignment_mode === "manual" && !esDePlata(s);
  const esDeGeneral = (s) => !esDeOro(s) && !esDePlata(s);
  const aLaVenta = (s) => (borrador.venta.has(s.id) ? borrador.venta.get(s.id) : s.on_sale !== false);

  function renderSalon() {
    const conMapa = state.sections.filter(tieneMapa)
      .filter((s) => state.tables.some((t) => t.section_id === s.id));
    const sinMapa = state.sections.filter((s) => !conMapa.includes(s));

    const mesas = state.tables.length;
    const lugares = state.tables.reduce((a, t) => a + sillasDe(t), 0);

    ui.salonEditor.innerHTML = `
      <div class="salon-cabecera">
        <div>
          <h2 class="salon-cabecera__titulo">El salón</h2>
          <p class="hint">
            Toca − o + para cambiar las sillas de una mesa. Nada se guarda hasta
            que uses el botón de abajo.
          </p>
        </div>
        <dl class="salon-cifras">
          <div><dt>Mesas</dt><dd>${mesas}</dd></div>
          <div><dt>Lugares</dt><dd>${lugares}</dd></div>
          <div><dt>Secciones</dt><dd>${state.sections.length}</dd></div>
        </dl>
      </div>

      ${bloqueVentas()}

      <p class="salon-tarima" aria-hidden="true"><span>Tarima</span></p>

      <!-- Las mesas únicas van juntas y apiladas, en su propia columna a la
           derecha. Sueltas dentro de la misma retícula que las secciones caían
           donde quedara hueco —U2 arriba, U3 en medio, U1 al otro lado—, así que
           el plano del panel decía un orden que el salón no tiene. Apiladas U1,
           U2, U3 se leen como la fila que son, igual que en el sitio. -->
      <div class="salon-mapa">
        <div class="salon-zonas">
          ${conMapa.filter((s) => !esUnica(s) && !esDelFondo(s)).map(bloqueSeccion).join("")}
        </div>
        ${conMapa.some(esUnica) ? `
          <div class="salon-unicas">
            ${conMapa.filter(esUnica)
              .sort((a, b) => String(a.label).localeCompare(String(b.label), "es", { numeric: true }))
              .map(bloqueSeccion).join("")}
          </div>
        ` : ""}

        <!-- Las secciones de diez columnas o más van debajo, a lo ancho de la
             hoja: en la columna que dejan libre las únicas no entraban. -->
        ${conMapa.some(esDelFondo) ? `
          <div class="salon-fondo">
            ${conMapa.filter(esDelFondo).map(bloqueSeccion).join("")}
          </div>
        ` : ""}
      </div>

      ${sinMapa.length ? `
        <h3 class="salon-rotulo">Sin plano</h3>
        <p class="hint">
          El comprador no elige lugar acá: se le asigna por orden de llegada o
          entra de pie. Por eso no hay mesas que dibujar.
        </p>
        <div class="salon-bolsas">${sinMapa.map(bloqueSinMapa).join("")}</div>
      ` : ""}
    `;

    cablearSalon();
    pintarBarraSalon();
  }

  /* Qué se está vendiendo de cada nivel (Oro, Plata, General), y el interruptor
     de cada sección.

     Van los dos mandos (todas / cada una) porque son dos decisiones distintas:
     "esta noche Oro/Plata/General no se vende" es una sola, y "la Sección B
     está en obra" es otra. Sin el primero, apagar un nivel entero requiere
     múltiples clics; sin el segundo, no habría forma de dejar afuera una sola
     sección. */
  function bloqueVentaGrupo(titulo, hint, secciones, tierClass, grupoId) {
    if (!secciones.length || !esAdmin()) return "";

    const abiertas = secciones.filter(aLaVenta).length;
    const n = secciones.length;
    const nombreBase = titulo.replace(/ a la venta$/i, "");
    const sufijo = nombreBase.toLowerCase().endsWith("a") ? "a" : "o";

    let cuentaTexto = "";
    if (abiertas === n) {
      cuentaTexto = n === 1 ? `${esc(nombreBase)} a la venta` : `Las ${n} a la venta`;
    } else if (abiertas === 0) {
      cuentaTexto = `${esc(nombreBase)} cerrad${sufijo}`;
    } else {
      cuentaTexto = `${abiertas} de ${n} a la venta`;
    }

    return `
      <section class="salon-venta salon-venta--${tierClass}">
        <div class="salon-venta__texto">
          <h3 class="salon-rotulo">${esc(titulo)}</h3>
          <p class="hint">${hint}</p>
        </div>

        <div class="salon-venta__mando">
          <span class="salon-venta__cuenta">${cuentaTexto}</span>
          <button type="button" class="btn btn--ghost" data-venta-todas="1" data-grupo="${grupoId}"
                  ${abiertas === n ? "disabled" : ""}>Abrir ${n === 1 ? "sección" : "todas"}</button>
          <button type="button" class="btn btn--ghost" data-venta-todas="0" data-grupo="${grupoId}"
                  ${abiertas === 0 ? "disabled" : ""}>Cerrar ${n === 1 ? "sección" : "todas"}</button>
        </div>

        <ul class="salon-venta__lista">
          ${secciones.map((s) => `
            <li>
              <button type="button" role="switch" data-venta="${s.id}"
                      aria-checked="${aLaVenta(s) ? "true" : "false"}"
                      class="interruptor ${aLaVenta(s) ? "interruptor--si" : ""} ${borrador.venta.has(s.id) ? "interruptor--tocado" : ""}">
                <span class="interruptor__pista" aria-hidden="true"><i></i></span>
                <span class="interruptor__nombre">${esc(s.label)}</span>
                <span class="interruptor__estado">${aLaVenta(s) ? "A la venta" : "Cerrada"}</span>
              </button>
            </li>`).join("")}
        </ul>
      </section>`;
  }

  function bloqueVentas() {
    const oro = state.sections.filter(esDeOro);
    const plata = state.sections.filter(esDePlata);
    const general = state.sections.filter(esDeGeneral);

    const bOro = bloqueVentaGrupo(
      "Oro a la venta",
      "Lo apagado no se ofrece en el sitio: no sale su tarjeta ni se dibujan sus mesas. Las entradas ya vendidas siguen valiendo, y en Reservas se puede seguir sentando invitados ahí.",
      oro,
      "oro",
      "oro"
    );

    const bPlata = bloqueVentaGrupo(
      "Plata a la venta",
      "Lo apagado no se ofrece en el sitio: la tarjeta de Plata saldrá como agotada y no se podrán elegir sus mesas. Las reservas existentes se mantienen.",
      plata,
      "plata",
      "plata"
    );

    const bGeneral = bloqueVentaGrupo(
      "General a la venta",
      "Entradas de pie / sin plano. Si se apaga, saldrá como agotada en el sitio y no se podrán comprar entradas de esta sección.",
      general,
      "general",
      "general"
    );

    return [bOro, bPlata, bGeneral].filter(Boolean).join("");
  }

  /* Una sección de una sola mesa es una «mesa única». Se agrupan aparte para
     poder apilarlas en su propia columna: mezcladas con las secciones grandes,
     la retícula las repartía por los huecos y el orden dejaba de significar
     nada. Ordenadas por código salen U1, U2, U3.

     Declaración de función y no `const`: `renderSalon` la usa unas ochenta
     líneas más arriba. Hoy funciona porque nadie llama a `renderSalon` hasta
     después de cargar, pero con `const` eso depende del orden de llamada y una
     declaración se eleva y no depende de nada. */
  function esUnica(s) {
    return state.tables.filter((t) => t.section_id === s.id).length === 1;
  }

  /* Cuántas columnas ocupa una sección en el plano. Sale de `pos_x`, que es lo
     que guarda la base. */
  function columnasDe(section) {
    return Math.max(1, ...state.tables
      .filter((t) => t.section_id === section.id)
      .map((t) => t.pos_x || 1));
  }

  /* Una sección de diez columnas o más —hoy VIP Plata, con quince— no entra en
     la columna que dejan libre las mesas únicas: se cortaba en la décima mesa y
     las otras cinco de cada fila quedaban fuera de la vista. Va en su propia
     fila, debajo, con el ancho entero de la hoja. */
  function esDelFondo(section) {
    return !esUnica(section) && columnasDe(section) >= 10;
  }

  function bloqueSeccion(section) {
    const tablas = state.tables
      .filter((t) => t.section_id === section.id)
      .sort((a, b) => (a.pos_y || 1) - (b.pos_y || 1) || (a.pos_x || 1) - (b.pos_x || 1));

    const columnas = Math.max(...tablas.map((t) => t.pos_x || 1));
    const lugares = tablas.reduce((a, t) => a + sillasDe(t), 0);
    const unica = tablas.length === 1;
    const cerrada = !aLaVenta(section);

    /* Una sección ancha ocupa la fila entera del plano. La Sección C son nueve
       mesas por fila y, metida en una columna de trescientos y pico píxeles, no
       cabía: salía con barra de scroll y los botones de sillas montados unos
       sobre otros. El número de columnas lo decide la base —`pos_x`—, así que si
       mañana una sección crece, esto la acompaña sin tocar nada.

       Cinco es el corte: hasta cuatro, una sección convive bien al lado de otra;
       de cinco en adelante, cada mesa baja del mínimo con el que se puede leer
       el número y tocar los botones. */
    const ancha = columnas >= 5;
    // Quince mesas por fila: la casilla se aprieta para que entren sin scroll.
    const densa = columnas >= 10;

    return `
      <section class="salon-seccion${unica ? " salon-seccion--unica" : ""}${ancha ? " salon-seccion--ancha" : ""}${densa ? " salon-seccion--densa" : ""}${cerrada ? " salon-seccion--cerrada" : ""}"
               style="--columnas:${columnas}">
        <header class="salon-seccion__head">
          <h3>${esc(section.label)}</h3>
          <span class="salon-seccion__dato">
            ${cerrada ? "No está a la venta · " : ""}${tablas.length} ${tablas.length === 1 ? "mesa" : "mesas"} · ${lugares} lugares
          </span>
          ${campoPrecio(section)}
        </header>
        <div class="salon-grid">${tablas.map(celdaMesa).join("")}</div>
      </section>`;
  }

  function bloqueSinMapa(section) {
    const tablas = state.tables.filter((t) => t.section_id === section.id);
    const lugares = tablas.reduce((a, t) => a + sillasDe(t), 0);
    const cerrada = !aLaVenta(section);

    const capacidad = tablas.length
      ? `${tablas.length} mesas · ${lugares} lugares`
      : (section.capacity ? `${section.capacity} lugares` : "sin tope");

    return `
      <section class="salon-bolsa${cerrada ? " salon-bolsa--cerrada" : ""}">
        <div>
          <h4>${esc(section.label)}</h4>
          <span class="salon-seccion__dato">${cerrada ? "No está a la venta · " : ""}${capacidad} · ${esc(descripcionModo(section))}</span>
        </div>
        ${campoPrecio(section)}
      </section>`;
  }

  // El precio vive solo en la base: `create-order` lo lee de ahí en cada venta,
  // así que lo que se guarde acá es lo que se cobra. RLS ya rechaza a quien no
  // sea admin; esconder el campo es solo para no ofrecer algo que fallaría.
  function campoPrecio(section) {
    if (!esAdmin()) {
      return `<span class="precio-lectura">${money(section.price_cents)}</span>`;
    }

    const cambiado = borrador.precios.has(section.id);
    return `
      <div class="precio-editor ${cambiado ? "precio-editor--tocado" : ""}">
        <label for="precio-${section.id}">Precio</label>
        <span class="precio-editor__moneda">R$</span>
        <input type="number" id="precio-${section.id}" data-precio="${section.id}"
               min="0" step="0.01" value="${(precioDe(section) / 100).toFixed(2)}" />
      </div>`;
  }

  function descripcionModo(section) {
    if (section.assignment_mode === "manual") return "el comprador elige su lugar";
    if (section.assignment_mode === "auto_fcfs") return "asignación por orden de llegada";
    return "sin asiento asignado";
  }

  function celdaMesa(table) {
    const sillas = state.seats.filter((s) => s.table_id === table.id);
    const tomadas = sillas.filter((s) => s.status !== "available").length;
    const cuenta = sillasDe(table);
    const lleno = tomadas >= cuenta && cuenta > 0;
    const tocada = borrador.sillas.has(table.id);

    return `
      <div class="salon-mesa ${lleno ? "salon-mesa--llena" : ""} ${tocada ? "salon-mesa--tocada" : ""} ${table.label ? "salon-mesa--unica" : ""}"
           data-table="${table.id}"
           style="grid-column:${table.pos_x || "auto"};grid-row:${table.pos_y || "auto"}">
        <span class="salon-mesa__num">${esc(table.code || table.label || table.number)}</span>
        <span class="salon-mesa__ocup">${tomadas}/${cuenta}</span>
        <div class="stepper">
          <button type="button" data-step="-1" data-table-id="${table.id}" aria-label="Quitar una silla">−</button>
          <span>${cuenta}</span>
          <button type="button" data-step="1" data-table-id="${table.id}" aria-label="Agregar una silla">+</button>
        </div>
      </div>`;
  }

  function cablearSalon() {
    ui.salonEditor.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        anotarSillas(btn.dataset.tableId, Number(btn.dataset.step));
      });
    });

    ui.salonEditor.querySelectorAll("[data-precio]").forEach((input) => {
      input.addEventListener("input", () => anotarPrecio(input.dataset.precio, input.value));
    });

    ui.salonEditor.querySelectorAll("[data-venta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = state.sections.find((x) => x.id === btn.dataset.venta);
        if (s) anotarVenta(s, !aLaVenta(s));
      });
    });

    ui.salonEditor.querySelectorAll("[data-venta-todas]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const abrir = btn.dataset.ventaTodas === "1";
        const grupo = btn.dataset.grupo;
        let filtro = esDeOro;
        if (grupo === "plata") filtro = esDePlata;
        else if (grupo === "general") filtro = esDeGeneral;
        else if (grupo === "oro") filtro = esDeOro;
        else if (grupo === "todas") filtro = () => true;

        state.sections.filter(filtro).forEach((s) => anotarVenta(s, abrir, false));
        renderSalon();
      });
    });
  }

  /* Anotar, no guardar. Si el valor vuelve a ser el que ya estaba en la base, el
     cambio se borra del borrador en vez de quedar como pendiente: cambiar algo y
     deshacerlo no debería dejar nada que guardar. */
  function anotarPrecio(sectionId, valor) {
    const section = state.sections.find((s) => s.id === sectionId);
    const reales = Number(valor);
    if (!section || !Number.isFinite(reales) || reales < 0) return;

    const centavos = Math.round(reales * 100);
    if (centavos === section.price_cents) borrador.precios.delete(sectionId);
    else borrador.precios.set(sectionId, centavos);

    pintarBarraSalon();
  }

  /* Igual que el precio: si el interruptor vuelve a donde estaba, el cambio se
     borra del borrador en vez de contar como pendiente. */
  function anotarVenta(section, abierta, repintar = true) {
    if (abierta === (section.on_sale !== false)) borrador.venta.delete(section.id);
    else borrador.venta.set(section.id, abierta);

    if (repintar) renderSalon();
  }

  function anotarSillas(tableId, delta) {
    const table = state.tables.find((t) => t.id === tableId);
    if (!table) return;

    const nuevo = sillasDe(table) + delta;
    if (nuevo < 0 || nuevo > MAX_SILLAS) return;

    if (nuevo === table.seat_count) borrador.sillas.delete(tableId);
    else borrador.sillas.set(tableId, nuevo);

    renderSalon();
  }

  function pintarBarraSalon() {
    const barra = document.getElementById("salonBarra");
    const cuenta = document.getElementById("salonPendientes");
    if (!barra) return;

    const n = pendientes();
    barra.hidden = n === 0;
    if (cuenta) {
      cuenta.textContent = n === 1
        ? "1 cambio sin guardar"
        : `${n} cambios sin guardar`;
    }
  }

  async function guardarSalon() {
    const boton = document.getElementById("btnGuardarSalon");
    if (boton) boton.disabled = true;

    const fallos = [];

    for (const [sectionId, centavos] of borrador.precios) {
      const { error } = await db.from("sections").update({ price_cents: centavos }).eq("id", sectionId);
      if (error) fallos.push(`Precio de ${nombreSeccion(sectionId)}: ${error.message}`);
      else {
        const s = state.sections.find((x) => x.id === sectionId);
        if (s) s.price_cents = centavos;
        borrador.precios.delete(sectionId);
      }
    }

    for (const [sectionId, abierta] of borrador.venta) {
      const { error } = await db.from("sections").update({ on_sale: abierta }).eq("id", sectionId);
      if (error) fallos.push(`Venta de ${nombreSeccion(sectionId)}: ${error.message}`);
      else {
        const s = state.sections.find((x) => x.id === sectionId);
        if (s) s.on_sale = abierta;
        borrador.venta.delete(sectionId);
      }
    }

    for (const [tableId, cuenta] of borrador.sillas) {
      // El trigger de la base rechaza reducir por debajo de sillas ya tomadas.
      const { error } = await db.from("tables").update({ seat_count: cuenta }).eq("id", tableId);
      if (error) {
        fallos.push(`Mesa ${nombreMesa(tableId)}: ${primeraLinea(error.message)}`);
      } else {
        const t = state.tables.find((x) => x.id === tableId);
        if (t) t.seat_count = cuenta;
        borrador.sillas.delete(tableId);

        const { data: seats } = await db
          .from("seats").select("id, table_id, number, status").eq("table_id", tableId);
        state.seats = state.seats.filter((s) => s.table_id !== tableId).concat(seats || []);
      }
    }

    if (boton) boton.disabled = false;

    // Lo que falló se queda en el borrador: la barra sigue mostrando lo que
    // todavía no entró, en vez de decir que se guardó todo.
    renderSalon();
    renderResumen();
    mostrarAvisoSalon(fallos.length
      ? fallos.join(" · ")
      : "Cambios guardados.", fallos.length ? "mal" : "ok");
  }

  function descartarSalon() {
    if (!confirm("¿Descartar los cambios sin guardar del salón?")) return;
    borrador.precios.clear();
    borrador.sillas.clear();
    borrador.venta.clear();
    renderSalon();
  }

  const nombreSeccion = (id) => state.sections.find((s) => s.id === id)?.label ?? "sección";
  const nombreMesa = (id) => {
    const t = state.tables.find((x) => x.id === id);
    return t?.code || t?.label || t?.number || "";
  };
  const primeraLinea = (mensaje) => String(mensaje || "").split("\n")[0];

  function mostrarAvisoSalon(mensaje, tono = "mal") {
    let banner = document.getElementById("salonAviso");
    if (!banner) {
      banner = document.createElement("p");
      banner.id = "salonAviso";
      ui.salonEditor.prepend(banner);
    }
    banner.className = `salon-aviso salon-aviso--${tono}`;
    banner.textContent = mensaje;
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.remove(), 6000);
  }

  document.getElementById("btnGuardarSalon")?.addEventListener("click", guardarSalon);
  document.getElementById("btnDescartarSalon")?.addEventListener("click", descartarSalon);

  /* El aviso al salir. El navegador solo lo muestra si la persona interactuó con
     la página, que acá siempre pasó: para tener cambios pendientes hubo que
     tocar algo. El texto lo elige el navegador, no nosotros. */
  window.addEventListener("beforeunload", (event) => {
    if (!pendientes()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  /* ---------- validación de entradas ----------
     Un solo camino para los dos modos: la cámara y el campo manual llaman a lo
     mismo. Escaneando además viaja la firma del QR, que es lo que permite
     distinguir una entrada alterada de una inexistente. */
  async function validarCodigo({ code, signature }) {
    setError("validar", "");

    const { data } = await window.callFunction(
      "verify-ticket",
      signature ? { code, signature } : { code },
      state.session?.access_token,
    );

    renderResultadoValidacion(data);
    await refrescarTickets();
    return data.result === "valid";
  }

  ui.validarForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const codigo = ui.codigoValidar.value.trim();
    if (!codigo) {
      setError("validar", "Escribe un código o usa la cámara.");
      return;
    }
    ui.btnValidarEntrada.disabled = true;
    ui.btnValidarEntrada.textContent = "Validando...";

    // Si alguien pega la URL entera del QR, se le saca el código igual.
    const leido = window.ProKartEscaner?.leerCodigo(codigo);
    await validarCodigo(leido || { code: codigo.toUpperCase(), signature: "" });

    ui.btnValidarEntrada.disabled = false;
    ui.btnValidarEntrada.textContent = "Validar";
    ui.codigoValidar.value = "";
  });

  window.ProKartEscaner?.montar(validarCodigo);

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
    if (esAdmin()) renderResumen();
  }

  // ---------- listado de entradas ----------
  ui.buscarEntrada.addEventListener("input", renderEntradas);
  ui.filtroEstado.addEventListener("change", renderEntradas);

  function renderEntradas() {
    const rawBusqueda = ui.buscarEntrada.value.trim().toLowerCase();
    const estado = ui.filtroEstado.value;
    const compactBusqueda = rawBusqueda.replace(/\bmesa\s*/g, "").replace(/[-_ ]/g, "");

    const filas = state.tickets.filter((t) => {
      if (estado && t.status !== estado) return false;
      if (!rawBusqueda) return true;

      const code = (t.code || "").toLowerCase();
      const comprador = `${t.buyer_name || ""} ${t.buyer_lastname || ""}`.toLowerCase();
      const seccion = (t.section_label || "").toLowerCase();
      const mesa = (t.table_code || "").toLowerCase();
      const mesaCompact = mesa.replace(/[-_ ]/g, "");

      const coincideTexto = `${code} ${comprador} ${seccion} ${mesa}`.includes(rawBusqueda);
      const coincideMesa = compactBusqueda && mesaCompact && (mesaCompact === compactBusqueda || mesaCompact.includes(compactBusqueda));

      return coincideTexto || coincideMesa;
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
    if (esAdmin()) cargarRedes();
  });
})();
