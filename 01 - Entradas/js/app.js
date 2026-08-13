/* =========================================================
   Venta de entradas · Pro Kart

   Tres pasos: área → lugar → datos. El cobro vive en pagar.html, así la
   página de pago se puede recargar o compartir sin perder la compra.

   Se vende por mesa: la mesa va completa y el precio de la sección es el de
   una mesa. Un grupo de 7 necesita 2 mesas.
   ========================================================= */

(function () {
  "use strict";

  const db = window.supabaseClient;
  const EVENT_SLUG = window.PROKART_CONFIG.EVENT_SLUG;

  const state = {
    event: null,
    sections: [],
    tables: [],
    seccion: null,      // sección elegida (o grupo de secciones del plano)
    personas: 2,
    grupoDefinido: false,
    mesas: new Map(),   // code -> {code, seats, price_cents, section_code}
  };

  let realtimeChannel = null;
  let alCerrarModal = null;

  // Las secciones con plano se ofrecen juntas como "VIP Oro".
  const AREA_ORO = "ORO";

  const $ = (id) => document.getElementById(id);
  const money = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function setError(campo, mensaje) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (el) el.textContent = mensaje || "";
    const input = $(campo);
    if (input) input.classList.toggle("invalid", Boolean(mensaje));
  }

  // ---------- navegación ----------
  function irAPaso(n) {
    document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("active"));
    $(`panel-${n}`).classList.add("active");

    document.querySelectorAll(".step-indicator").forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === n);
      el.classList.toggle("done", s < n);
    });

    $("resumen").hidden = n === 1 || !haySeleccion();

    // El flujo vive dentro de #reservar, en medio de la página. Antes esto
    // ocultaba el hero y subía al tope: como el hero desaparecía, el visitante
    // terminaba mirando "Próximos eventos" en vez del paso siguiente.
    const shell = $("reservar");
    if (shell && !shell.hidden) {
      shell.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Abrir el flujo y desplazarse hasta él lo hace el script de index.html,
  // que es quien conoce la sección #reservar. Duplicarlo acá hacía que dos
  // desplazamientos suaves compitieran en el mismo clic.

  // ---------- carga ----------
  async function cargar() {
    // La portada y el listado se llenan aunque el evento principal falle.
    cargarProximosEventos();
    cargarMenu();

    // El evento del flujo de reserva es el marcado como principal en el panel;
    // si no hay ninguno, se cae al configurado en config.js.
    let { data: event } = await db
      .from("events")
      .select("id, slug, name, tagline, description, event_date, venue, cover_image")
      .eq("status", "published")
      .eq("is_main", true)
      .maybeSingle();

    if (!event) {
      const alterno = await db
        .from("events")
        .select("id, slug, name, tagline, description, event_date, venue, cover_image")
        .eq("slug", EVENT_SLUG)
        .maybeSingle();
      event = alterno.data;
    }

    if (!event) {
      $("heroTitulo").textContent = "Evento no disponible";
      $("areasGrid").innerHTML = '<p class="hint">No se pudo cargar el evento.</p>';
      return;
    }

    state.event = event;
    pintarEvento(event);

    const { data: sections } = await db
      .from("sections")
      .select("id, code, label, price_cents, assignment_mode, capacity, notice, theme_color")
      .eq("event_id", event.id)
      .order("sort_order");
    state.sections = sections || [];

    const conPlano = state.sections.filter((s) => s.assignment_mode === "manual");
    if (conPlano.length) {
      const { data: tables } = await db
        .from("tables_public")
        .select("id, section_id, code, seat_count, label, available, pos_x, pos_y")
        .in("section_id", conPlano.map((s) => s.id))
        .order("code");
      state.tables = tables || [];
    }

    pintarPrecioDesde();
    pintarAreas();
    suscribirRealtime();
  }

  // Todo evento muestra una imagen: si no cargaron la suya, va la genérica.
  const IMAGEN_GENERICA = "placeholders/evento-generico.jpg";

  function pintarEvento(event) {
    const cuando = event.event_date
      ? new Date(event.event_date).toLocaleString("es", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      })
      : "";

    const img = $("eventoImagen");
    img.src = event.cover_image || IMAGEN_GENERICA;
    img.alt = event.name;
    img.addEventListener("error", () => { img.src = IMAGEN_GENERICA; }, { once: true });
    $("eventoPortada").hidden = false;
    $("eventoTagline").textContent = event.tagline || "";
    $("eventoNombre").textContent = event.name;
    $("eventoFecha").textContent = cuando;
    // El lugar solo se muestra si está cargado; si no, la fila queda a medias.
    const lugar = $("eventoLugar");
    lugar.textContent = event.venue || "";
    lugar.closest("span").hidden = !event.venue;

    // La portada ya dice nombre, bajada y fecha. La columna de la derecha no
    // repite nada de eso: lleva el precio —lo que se busca después del
    // nombre— y una ficha con los datos prácticos.
    document.querySelector(".feature__copy")?.classList.add("feature__copy--secundaria");
    $("heroSubtitulo").textContent =
      event.description || "Entradas por mesa, con tu lugar asegurado.";

    const datos = [["Fecha", cuando], ["Lugar", event.venue]].filter(([, v]) => v);
    $("heroDatos").innerHTML = datos
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("");
  }

  // El precio más bajo del evento. Se pinta al cargar las secciones, no antes.
  //
  // Sale partido en dos: "Mesas desde" es el rótulo y el importe es la cifra.
  // Como una sola frase, el número —que es el dato que la gente vino a buscar—
  // competía con su propia aclaración y encima partía el renglón.
  function pintarPrecioDesde() {
    if (!state.sections.length) return;
    const desde = Math.min(...state.sections.map((s) => s.price_cents));
    const conPlano = state.sections.some((s) => s.assignment_mode === "manual");
    $("heroTitulo").innerHTML =
      `<span class="feature__price-rotulo">${conPlano ? "Mesas desde" : "Entradas desde"}</span>` +
      `<b>${esc(money(desde))}</b>`;
  }

  // ---------- portada: próximos eventos ----------
  const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

  async function cargarProximosEventos() {
    const cont = $("listaEventos");
    if (!cont) return;

    const { data } = await db
      .from("events")
      .select("slug, name, event_date, event_type, city, city_code, description, sells_tickets, is_main")
      .eq("status", "published")
      .order("event_date");

    const eventos = (data || []).filter((e) => {
      if (!e.event_date) return true;
      // Se muestran los de hoy en adelante.
      return new Date(e.event_date).getTime() >= Date.now() - 12 * 3600 * 1000;
    });

    if (!eventos.length) {
      cont.innerHTML = '<p class="hint">Todavía no hay fechas publicadas.</p>';
      return;
    }

    cont.innerHTML = eventos.map((e) => {
      const f = e.event_date ? new Date(e.event_date) : null;
      const dia = f ? String(f.getDate()).padStart(2, "0") : "--";
      const mes = f ? MESES[f.getMonth()] : "";
      const destino = e.is_main && e.sells_tickets ? "#reservar" : "#eventos";

      return `
        <a class="event-row" href="${destino}"${e.is_main && e.sells_tickets ? ' data-abre-reserva="1"' : ""}>
          <time><strong>${dia}</strong><span>${mes}</span></time>
          <div class="event-row__main">
            <span class="event-row__type">${esc(e.event_type || "EVENTO")}</span>
            <h3>${esc(e.name)}</h3>
            <p>${esc(e.description || "")}</p>
          </div>
          <div class="event-row__place">
            <span>${esc(e.city_code || "")}</span>
            <small>${esc(e.city || "")}</small>
          </div>
          <span class="event-row__arrow">↗</span>
        </a>
      `;
    }).join("");

    // Las filas se crean después del script que abre la reserva, así que se
    // reutiliza el mismo botón en vez de duplicar esa lógica.
    cont.querySelectorAll("[data-abre-reserva]").forEach((fila) => {
      fila.addEventListener("click", (e) => {
        e.preventDefault();
        $("btnComprar")?.click();
      });
    });
  }

  // ---------- portada: menú ----------
  async function cargarMenu() {
    const cont = $("listaMenu");
    if (!cont) return;

    const { data } = await db
      .from("menu_items")
      .select("name, description, image_url")
      .eq("active", true)
      .order("sort_order");

    if (!data?.length) {
      cont.innerHTML = '<div class="menu-tile"><span>Menú en preparación</span></div>';
      return;
    }

    // Sin precios: el menú de la portada muestra qué hay, no cuánto cuesta.
    cont.innerHTML = data.map((p, i) => `
      <figure class="menu-tile${p.image_url ? " menu-tile--foto" : ""}"
              ${p.image_url ? `style="background-image:url('${esc(p.image_url)}')"` : ""}>
        <figcaption>
          <b>${String(i + 1).padStart(2, "0")}</b>
          <strong>${esc(p.name)}</strong>
          ${p.description ? `<em>${esc(p.description)}</em>` : ""}
        </figcaption>
      </figure>
    `).join("");
  }

  // ---------- paso 1: áreas ----------
  function pintarAreas() {
    const conPlano = state.sections.filter((s) => s.assignment_mode === "manual");
    const sinPlano = state.sections.filter((s) => s.assignment_mode !== "manual");

    const tarjetas = [];

    if (conPlano.length) {
      const desde = Math.min(...conPlano.map((s) => s.price_cents));
      tarjetas.push({
        code: AREA_ORO,
        label: "VIP Oro",
        detalle: "Eliges tu mesa en el plano del salón",
        // El precio y su unidad van separados: como una sola frase, cada área
        // la escribía distinto —"Mesa desde X", "Mesa X", "X por persona"— y
        // las tres cifras quedaban imposibles de comparar de un vistazo.
        precio: money(desde),
        unidad: "la mesa, desde",
        incluye: "Mesa de 6 u 8 sillas · la eliges tú",
        tier: "oro",
        insignia: "Oro",
      });
    }

    sinPlano.forEach((s) => {
      const esPlata = s.assignment_mode === "auto_fcfs";
      tarjetas.push({
        code: s.code,
        label: s.label,
        detalle: esPlata
          ? "Mesa asignada por orden de llegada"
          : "Acceso de pie, sin mesa ni silla",
        precio: money(s.price_cents),
        unidad: esPlata ? "la mesa" : "por persona",
        incluye: esPlata
          ? "Mesa de 4 sillas · se asigna al entrar"
          : "Sin mesa · circulas por el salón",
        tier: esPlata ? "plata" : "general",
        insignia: esPlata ? "Plata" : "General",
      });
    });

    /* Las áreas se listan por cercanía a la tarima —Oro adelante, Plata detrás,
       General al fondo—, así que el orden de la lista ya es el plano del salón.
       Con una sola barra de tarima arriba de las tres alcanza para decirlo.

       Antes cada tarjeta llevaba su propio mini-plano de cuatro bandas: tres
       copias del mismo dibujo, con la tarima pintada en naranja —lo más
       llamativo de la tarjeta era justo lo que no se compra— y repitiendo por
       tercera vez las palabras Oro, Plata y General que ya estaban en la
       insignia y en el título. */
    $("areasGrid").innerHTML = `
      <p class="areas-tarima" aria-hidden="true"><span>Tarima</span></p>
    ` + tarjetas.map((t, i) => `
      <button type="button" class="area-card area-card--${t.tier}" data-area="${esc(t.code)}">
        <span class="area-card__body">
          <!-- Nivel y ubicación en un solo rótulo. La insignia suelta repetía
               la palabra que ya dice el título dos renglones más abajo. -->
          <span class="area-card__tag">
            ${esc(t.insignia)} <i>·</i> ${i === 0 ? "Adelante" : i === tarjetas.length - 1 ? "Al fondo" : "Detrás"}
          </span>
          <span class="area-card__titulo">${esc(t.label)}</span>
          <span class="area-card__detalle">${esc(t.detalle)}</span>
          <span class="area-card__incluye">${esc(t.incluye)}</span>
        </span>
        <span class="area-card__precio">
          <span class="price">${esc(t.precio)}</span>
          <span class="area-card__unidad">${esc(t.unidad)}</span>
          <span class="area-card__ir">Elegir <b>→</b></span>
        </span>
      </button>
    `).join("");

    $("areasGrid").querySelectorAll("[data-area]").forEach((btn) => {
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => elegirArea(btn.dataset.area));
    });
  }

  // Al volver con "Cambiar área" hay que ver cuál se había elegido.
  function marcarAreaElegida(code) {
    $("areasGrid").querySelectorAll("[data-area]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.area === code ? "true" : "false");
    });
  }

  function elegirArea(code) {
    state.mesas.clear();
    state.grupoDefinido = false;
    setError("area", "");
    setError("lugar", "");
    marcarAreaElegida(code);

    if (code === AREA_ORO) {
      state.seccion = { code: AREA_ORO, conPlano: true };
      $("tituloLugar").textContent = "2. Elige tu mesa";
      $("planoWrap").hidden = false;
      $("sinPlano").hidden = true;
      reiniciarEntradaPlano();
      pintarPlano();
    } else {
      const s = state.sections.find((x) => x.code === code);
      if (!s) return;
      state.seccion = { code: s.code, conPlano: false, section: s };
      $("tituloLugar").textContent = `2. ${s.label}`;
      $("planoWrap").hidden = true;
      $("sinPlano").hidden = false;
      $("sinPlanoTexto").innerHTML = s.notice
        ? esc(s.notice)
        : `Cada entrada de ${esc(s.label)} cuesta ${money(s.price_cents)}.`;
      // Sin plano no hay nada que tocar: se pregunta la cantidad de una.
      abrirModal(null);
    }

    $("grupo").hidden = !state.grupoDefinido;
    irAPaso(2);
    pintarResumen();
  }

  $("btnVolverArea").addEventListener("click", () => irAPaso(1));
  $("btnVolverLugar").addEventListener("click", () => irAPaso(2));

  // ---------- plano ----------
  function seccionDeMesa(code) {
    const mesa = state.tables.find((m) => m.code === code);
    if (!mesa) return null;
    return state.sections.find((s) => s.id === mesa.section_id) || null;
  }

  /* =========================================================
     EL PLANO

     Una hoja de plano apoyada sobre la página. El sitio es casi negro; el plano
     es claro, cuadriculado y con la tarima en negro macizo, como el papel que
     un productor apoya sobre la mesa para decidir dónde va cada quien. El
     contraste es a propósito: en toda la compra hay un solo momento en que la
     persona mira el salón, y ese momento tiene que verse distinto del resto.

     Es una grilla de CSS y no un SVG dibujado a mano. La posición de cada mesa
     sale de `pos_x`/`pos_y`, que es lo que edita el panel: si mañana se agrega
     una fila o se corre una mesa, el plano se reacomoda solo. Y la respuesta al
     ancho de pantalla la da el CSS, sin volver a dibujar nada en JavaScript.

     Las sillas no se dibujan. Se vende la mesa entera, así que el número de
     sillas es un dato —dice cuánta gente entra—, no una forma que haya que
     contar con la vista.
     ========================================================= */

  let planoYaEntro = false;
  function reiniciarEntradaPlano() { planoYaEntro = false; }

  /* A, B y el fondo.

     Las mesas únicas tienen código U1..U3 y viven en secciones propias —una por
     mesa, para que cada una pueda tener su precio— pero físicamente están en la
     columna del medio de la Sección C. Por eso caen en el mismo grupo: el plano
     dibuja el salón, no el organigrama de secciones. */
  function agrupar() {
    const por = { A: [], B: [], C: [] };
    for (const m of state.tables) {
      const letra = (m.code || "")[0];
      (por[letra] || por.C).push(m);
    }
    for (const k of Object.keys(por)) {
      por[k].sort((a, b) =>
        (Number(a.pos_y || 1) - Number(b.pos_y || 1)) ||
        (Number(a.pos_x || 0) - Number(b.pos_x || 0)));
    }
    return por;
  }

  const columnasDe = (mesas) =>
    Math.max(1, ...mesas.map((m, i) => Number(m.pos_x) || ((i % 3) + 1)));

  function pintarPlano() {
    const lienzo = $("planoLienzo");
    if (!lienzo) return;
    if (!state.tables.length) { lienzo.innerHTML = ""; return; }

    const g = agrupar();
    const entra = !planoYaEntro;
    planoYaEntro = true;

    const bloque = (mesas, nombre, clase = "") => {
      if (!mesas.length) return "";
      return `
        <section class="hoja__seccion ${clase}">
          <h4 class="hoja__rotulo">${esc(nombre)}</h4>
          <div class="hoja__grid" style="--columnas:${columnasDe(mesas)}">
            ${mesas.map(mesaHTML).join("")}
          </div>
        </section>`;
    };

    lienzo.innerHTML = `
      <div class="hoja${entra ? " hoja--entra" : ""}">

        <!-- La tarima en T: la barra es el escenario y el pie, la pasarela que
             baja al salón. Marca de qué lado se mira todo lo demás. -->
        <div class="hoja__tarima" aria-hidden="true">
          <div class="hoja__tarima-barra">
            <span class="hoja__tarima-luces"><i></i><i></i><i></i><i></i></span>
            Tarima
          </div>
          <div class="hoja__tarima-pie"></div>
        </div>

        <div class="hoja__frente">
          ${bloque(g.A, "Sección A")}
          <div class="hoja__pasarela" aria-hidden="true"><span>Pasarela</span></div>
          ${bloque(g.B, "Sección B")}
        </div>

        ${bloque(g.C, "Sección C", "hoja__seccion--fondo")}

        <ul class="hoja__leyenda">
          <li><i class="hoja__marca hoja__marca--libre"></i>Disponible</li>
          <li><i class="hoja__marca hoja__marca--elegida"></i>Tu selección</li>
          <li><i class="hoja__marca hoja__marca--tomada"></i>Reservada</li>
          <li><i class="hoja__marca hoja__marca--unica"></i>Mesa única</li>
        </ul>
      </div>`;

    cablearPlano(lienzo);
  }

  function mesaHTML(mesa) {
    const seccion = state.sections.find((s) => s.id === mesa.section_id);
    const precio = seccion?.price_cents ?? 0;
    const libre = mesa.available;
    const unica = Boolean(mesa.label);
    const elegida = state.mesas.has(mesa.code);
    const nombre = unica ? mesa.label : mesa.code;

    const clases = [
      "mesa",
      unica ? "mesa--unica" : "",
      libre ? "" : "mesa--tomada",
      elegida ? "mesa--elegida" : "",
    ].filter(Boolean).join(" ");

    return `
      <button type="button" class="${clases}"
              style="grid-column:${mesa.pos_x || "auto"};grid-row:${mesa.pos_y || "auto"}"
              data-code="${esc(mesa.code)}"
              ${libre ? "" : "disabled"}
              aria-pressed="${elegida ? "true" : "false"}"
              title="${esc(nombre)} · ${libre ? `${mesa.seat_count} sillas · ${money(precio)}` : "reservada"}">
        <span class="mesa__nombre">${esc(nombre)}</span>
        <span class="mesa__sillas">${libre ? `${mesa.seat_count} sillas` : "reservada"}</span>
      </button>`;
  }

  function cablearPlano(lienzo) {
    lienzo.querySelectorAll(".mesa:not([disabled])").forEach((boton) => {
      const code = boton.dataset.code;
      const mesa = state.tables.find((m) => m.code === code);
      if (!mesa) return;

      const seccion = state.sections.find((s) => s.id === mesa.section_id);
      const precio = seccion?.price_cents ?? 0;
      const nombre = mesa.label || mesa.code;

      const alternar = () => {
        if (state.mesas.has(code)) state.mesas.delete(code);
        else state.mesas.set(code, { code, seats: mesa.seat_count, price_cents: precio });

        const ahora = state.mesas.has(code);
        boton.classList.toggle("mesa--elegida", ahora);
        boton.setAttribute("aria-pressed", ahora ? "true" : "false");

        // El pulso se dispara solo al elegir, no al soltar.
        if (ahora) {
          boton.classList.remove("mesa--pulso");
          void boton.offsetWidth;
          boton.classList.add("mesa--pulso");
        }
        pintarResumen();
      };

      boton.addEventListener("click", () => {
        // El primer toque pregunta cuántos son; recién después selecciona.
        if (!state.grupoDefinido) abrirModal(alternar);
        else alternar();
      });

      const leer = () => marcarLectura(`${nombre} · ${mesa.seat_count} sillas · ${money(precio)}`);
      boton.addEventListener("pointerenter", leer);
      boton.addEventListener("focus", leer);
    });
  }

  let lecturaTimer = null;
  function marcarLectura(texto) {
    const out = $("planoLectura");
    if (!out) return;
    out.textContent = texto;
    out.classList.add("plano__lectura--viva");
    clearTimeout(lecturaTimer);
    lecturaTimer = setTimeout(() => out.classList.remove("plano__lectura--viva"), 2600);
  }

  // ---------- modal ----------
  function abrirModal(despues) {
    alCerrarModal = despues || null;
    $("modal").hidden = false;
    pintarModal();
  }

  function pintarModal() {
    $("personas").textContent = state.personas;
    const porMesa = mesaTipica();
    const necesarias = Math.ceil(state.personas / porMesa);

    $("modalCalculo").innerHTML = state.seccion?.conPlano || state.seccion?.section?.assignment_mode === "auto_fcfs"
      ? `Necesitas <em>${necesarias}</em> ${necesarias === 1 ? "mesa" : "mesas"} de ${porMesa} sillas.`
      : `Son <em>${state.personas}</em> ${state.personas === 1 ? "entrada" : "entradas"}.`;
  }

  function mesaTipica() {
    if (state.seccion?.conPlano) return 6;
    if (state.seccion?.section?.assignment_mode === "auto_fcfs") return 4;
    return 1;
  }

  $("mas").addEventListener("click", () => { state.personas = Math.min(60, state.personas + 1); pintarModal(); });
  $("menos").addEventListener("click", () => { state.personas = Math.max(1, state.personas - 1); pintarModal(); });

  $("modalOk").addEventListener("click", () => {
    state.grupoDefinido = true;
    $("modal").hidden = true;
    $("grupo").hidden = false;
    const accion = alCerrarModal;
    alCerrarModal = null;
    if (accion) accion();
    pintarResumen();
  });

  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) { alCerrarModal = null; $("modal").hidden = true; }
  });

  $("grupoEditar").addEventListener("click", () => abrirModal(null));

  // ---------- resumen ----------
  function haySeleccion() {
    return state.grupoDefinido && (state.mesas.size > 0 || !state.seccion?.conPlano);
  }

  function totalCents() {
    if (state.seccion?.conPlano) {
      return [...state.mesas.values()].reduce((acc, m) => acc + m.price_cents, 0);
    }
    const s = state.seccion?.section;
    if (!s) return 0;
    if (s.assignment_mode === "auto_fcfs") {
      return s.price_cents * Math.ceil(state.personas / mesaTipica());
    }
    return s.price_cents * state.personas;
  }

  function pintarResumen() {
    const porMesa = mesaTipica();
    const necesarias = Math.ceil(state.personas / porMesa);

    $("grupoDato").innerHTML = state.seccion?.conPlano || state.seccion?.section?.assignment_mode === "auto_fcfs"
      ? `<b>${state.personas}</b> ${state.personas === 1 ? "persona" : "personas"} · necesitas <em>${necesarias}</em> ${necesarias === 1 ? "mesa" : "mesas"}`
      : `<b>${state.personas}</b> ${state.personas === 1 ? "entrada" : "entradas"}`;

    $("total").textContent = money(totalCents());
    $("resumen").hidden = !state.grupoDefinido;

    const btn = $("btnIrDatos");

    if (!state.seccion?.conPlano) {
      $("resumenMesas").innerHTML = `<b>${esc(state.seccion?.section?.label ?? "")}</b>`;
      $("resumenAviso").textContent = "";
      btn.disabled = !state.grupoDefinido;
      return;
    }

    const elegidas = [...state.mesas.values()];
    const lugares = elegidas.reduce((acc, m) => acc + m.seats, 0);

    if (!elegidas.length) {
      $("resumenMesas").textContent = "Ninguna mesa seleccionada";
      $("resumenAviso").textContent = `Elige ${necesarias} ${necesarias === 1 ? "mesa" : "mesas"} en el plano.`;
      btn.disabled = true;
      return;
    }

    $("resumenMesas").innerHTML =
      `<b>${elegidas.length}</b> ${elegidas.length === 1 ? "mesa" : "mesas"}: ${elegidas.map((m) => esc(m.code)).join(", ")} · ${lugares} lugares`;

    if (lugares < state.personas) {
      const faltan = Math.ceil((state.personas - lugares) / porMesa);
      $("resumenAviso").textContent =
        `Te falta${faltan === 1 ? "" : "n"} ${faltan} mesa${faltan === 1 ? "" : "s"} para ${state.personas} personas.`;
      btn.disabled = true;
    } else {
      $("resumenAviso").textContent = "";
      btn.disabled = false;
    }
  }

  // ---------- paso 3 ----------
  $("btnIrDatos").addEventListener("click", () => {
    const elegidas = [...state.mesas.values()];
    const detalle = state.seccion?.conPlano
      ? `${elegidas.length} mesa(s): ${elegidas.map((m) => m.code).join(", ")}`
      : state.seccion?.section?.label ?? "";

    $("resumenCompra").innerHTML = `
      <div class="row"><span>Área</span><span>${esc(state.seccion?.conPlano ? "VIP Oro" : state.seccion?.section?.label)}</span></div>
      <div class="row"><span>Personas</span><span>${state.personas}</span></div>
      <div class="row"><span>Lugar</span><span>${esc(detalle)}</span></div>
      <div class="row"><span>Total</span><span>${money(totalCents())}</span></div>
    `;
    irAPaso(3);
  });

  function validar() {
    let ok = true;
    [["nombre", "Ingresa el nombre."], ["apellido", "Ingresa el apellido."],
     ["documento", "Ingresa la cédula/CPF."]].forEach(([campo, msg]) => {
      if (!$(campo).value.trim()) { setError(campo, msg); ok = false; } else setError(campo, "");
    });

    const wa = $("whatsapp").value.trim();
    if (!wa) { setError("whatsapp", "Ingresa tu WhatsApp."); ok = false; }
    else if (wa.replace(/\D/g, "").length < 10) {
      setError("whatsapp", "Incluye el código de área. Ej: (11) 99999-9999"); ok = false;
    } else setError("whatsapp", "");

    return ok;
  }

  $("formRegistro").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validar()) return;

    const btn = $("btnContinuar");
    btn.disabled = true;
    btn.textContent = "Generando cobro...";

    const cuerpo = {
      // El del evento realmente cargado, no el de la configuración.
      event_slug: state.event?.slug || EVENT_SLUG,
      people: state.personas,
      buyer: {
        nombre: $("nombre").value.trim(),
        apellido: $("apellido").value.trim(),
        documento: $("documento").value.trim(),
        whatsapp: $("whatsapp").value.trim(),
        email: $("email").value.trim(),
      },
    };

    if (state.seccion.conPlano) cuerpo.table_codes = [...state.mesas.keys()];
    else cuerpo.section_code = state.seccion.section.code;

    const { ok, status, data } = await window.callFunction("create-order", cuerpo);

    btn.disabled = false;
    btn.textContent = "Ir a pagar";

    if (!ok) {
      if (status === 409) {
        setError("lugar", data.error || "Ese lugar ya no está disponible.");
        await refrescarMesas();
        irAPaso(2);
      } else {
        setError("whatsapp", data.error || "No se pudo iniciar la compra.");
      }
      return;
    }

    window.location.href = `pagar.html?order=${encodeURIComponent(data.order_id)}`;
  });

  // ---------- disponibilidad en vivo ----------
  async function refrescarMesas() {
    const conPlano = state.sections.filter((s) => s.assignment_mode === "manual");
    if (!conPlano.length) return;

    const { data } = await db
      .from("tables_public")
      .select("id, section_id, code, seat_count, label, available, pos_x, pos_y")
      .in("section_id", conPlano.map((s) => s.id))
      .order("code");

    state.tables = data || [];
    // Si alguna mesa elegida se ocupó mientras tanto, se quita de la selección.
    [...state.mesas.keys()].forEach((code) => {
      const m = state.tables.find((t) => t.code === code);
      if (!m || !m.available) state.mesas.delete(code);
    });
    if (state.seccion?.conPlano) pintarPlano();
    pintarResumen();
  }

  function suscribirRealtime() {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    realtimeChannel = db
      .channel("mesas-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "seats" }, () => {
        // Una silla cambió: se recalcula el estado de las mesas.
        clearTimeout(suscribirRealtime._t);
        suscribirRealtime._t = setTimeout(refrescarMesas, 400);
      })
      .subscribe();
  }

  irAPaso(1);
  cargar();
})();
