/* =========================================================
   Venta de entradas · Pro Kart

   Tres pasos: área → lugar → datos. El cobro vive en pagar.html, así la
   página de pago se puede recargar o compartir sin perder la compra.

   El precio de la sección es por persona y la mesa se cobra entera: una mesa de
   seis sillas a 400 sale 2.400, vayan seis o vayan dos. La mesa no se comparte,
   así que no se cobra a medias. Un grupo de 7 necesita 2 mesas.
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
  const AREA_PLATA = "PLATA";

  /* Oro y Plata se eligen las dos en el plano, así que `assignment_mode` ya no
     alcanza para separarlas: lo que las distingue es el precio y el lugar en el
     salón. Oro son las secciones de adelante —A, B, C y las tres únicas—, que
     comparten tarjeta porque comparten precio; Plata es la del fondo y va sola.

     `AREA_ORO` no es el código de ninguna sección: es el nombre de la tarjeta
     que las agrupa. `AREA_PLATA` sí coincide con el código de su sección. */
  const esDePlata = (s) => s.code === AREA_PLATA;
  const esDeOro = (s) => s.assignment_mode === "manual" && !esDePlata(s);

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
      $("heroSubtitulo").textContent = "No hay ninguna fecha disponible en este momento.";
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
    pintarAreas();
    suscribirRealtime();
  }

  // Todo evento muestra una imagen: si no cargaron la suya, va la genérica.
  const IMAGEN_GENERICA = "placeholders/evento-generico.jpg";

  /* La fecha va sin hora, a propósito.
     Con hora, el mismo evento se leía distinto según desde dónde se mirara —el
     navegador traduce al huso de quien mira— y una fecha de salón no se
     convierte: es la del salón. Sin hora, la fecha es la misma para todos.

     Por eso también la fecha se guarda al mediodía: desde cualquier huso cae
     siempre en el mismo día del calendario. */
  const fechaLarga = (iso) => iso
    ? new Date(iso).toLocaleDateString("es", {
      weekday: "long", day: "numeric", month: "long",
    })
    : "";

  /* =========================================================
     EL CARRUSEL DE PORTADA

     Una diapositiva por fecha publicada. La columna de datos de la derecha
     sigue a la que esté al frente: fecha, lugar y bajada son los de esa fecha,
     no los de un evento fijo.

     Con una sola fecha no se dibuja ningún control: un carrusel de uno es una
     foto, y los puntos y las flechas solo estorbarían.
     ========================================================= */

  const carrusel = {
    fechas: [],
    i: 0,
    reloj: null,
    PAUSA: 6500,
  };

  // Nadie quiere que la página se le mueva sola si pidió que no se mueva.
  const sinMovimiento = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function montarCarrusel(fechas) {
    const portada = $("eventoPortada");
    const pista = $("portadaPista");
    if (!portada || !pista || !fechas.length) return;

    carrusel.fechas = fechas;
    carrusel.i = Math.max(0, fechas.findIndex((e) => e.is_main));

    pista.innerHTML = fechas.map((e, i) => `
      <article class="portada__slide${i === carrusel.i ? " es-activa" : ""}"
               role="group" aria-roledescription="diapositiva"
               aria-label="${i + 1} de ${fechas.length}: ${esc(e.name)}"
               ${i === carrusel.i ? "" : 'aria-hidden="true"'}>
        <img class="portada__img" alt="${esc(e.name)}"
             src="${esc(e.cover_image || IMAGEN_GENERICA)}"
             ${i === carrusel.i ? 'fetchpriority="high"' : 'loading="lazy"'} />
        <div class="portada__velo"></div>
        <div class="portada__texto">
          ${e.event_type ? `<p class="portada__tipo">${esc(e.event_type)}</p>` : ""}
          <h1 class="portada__nombre">${esc(e.name)}</h1>
          <!-- Cada dato aparece solo si está cargado. Sin esta guarda, un evento
               sin fecha dibujaba un punto naranja solo, sin nada al lado. -->
          <p class="portada__cuando">
            ${e.event_date ? `<span><i></i>${esc(fechaLarga(e.event_date))}</span>` : ""}
            ${e.venue || e.city ? `<span><i></i>${esc(e.venue || e.city)}</span>` : ""}
          </p>
        </div>
      </article>
    `).join("");

    // Si la imagen del anunciante no baja, entra la genérica y no un hueco.
    pista.querySelectorAll(".portada__img").forEach((img) => {
      img.addEventListener("error", () => { img.src = IMAGEN_GENERICA; }, { once: true });
    });

    const mando = $("portadaMando");
    const puntos = $("portadaPuntos");
    const varias = fechas.length > 1;
    if (mando) mando.hidden = !varias;

    if (varias && puntos) {
      puntos.innerHTML = fechas.map((e, i) => `
        <button type="button" class="portada__punto" role="tab"
                data-i="${i}" aria-selected="${i === carrusel.i}"
                aria-label="${esc(e.name)}"><span></span></button>
      `).join("");
      puntos.querySelectorAll("[data-i]").forEach((b) => {
        b.addEventListener("click", () => { irASlide(Number(b.dataset.i)); reiniciarReloj(); });
      });
      $("portadaAnterior")?.addEventListener("click", () => { mover(-1); reiniciarReloj(); });
      $("portadaSiguiente")?.addEventListener("click", () => { mover(1); reiniciarReloj(); });

      // Con el dedo: arrastrar es lo primero que alguien prueba en un carrusel.
      let x0 = null;
      portada.addEventListener("pointerdown", (e) => { x0 = e.clientX; }, { passive: true });
      portada.addEventListener("pointerup", (e) => {
        if (x0 === null) return;
        const d = e.clientX - x0;
        x0 = null;
        if (Math.abs(d) > 45) { mover(d < 0 ? 1 : -1); reiniciarReloj(); }
      }, { passive: true });

      // El reloj se frena mientras se mira o se navega con el teclado.
      ["pointerenter", "focusin"].forEach((ev) =>
        portada.addEventListener(ev, pararReloj));
      ["pointerleave", "focusout"].forEach((ev) =>
        portada.addEventListener(ev, arrancarReloj));
      document.addEventListener("visibilitychange", () =>
        document.hidden ? pararReloj() : arrancarReloj());

      arrancarReloj();
    }

    portada.hidden = false;
    document.querySelector(".feature__copy")?.classList.add("feature__copy--secundaria");
    // Deja la pista en la diapositiva de arranque sin animar la entrada.
    pista.style.transition = "none";
    pista.style.transform = `translateX(-${carrusel.i * 100}%)`;
    requestAnimationFrame(() => { pista.style.transition = ""; });
    pintarDatosDeSlide();
  }

  function irASlide(n) {
    const total = carrusel.fechas.length;
    if (!total) return;
    carrusel.i = (n + total) % total;

    // La pista se corre a la izquierda: la que entra viene desde la derecha.
    const pista = $("portadaPista");
    if (pista) pista.style.transform = `translateX(-${carrusel.i * 100}%)`;

    const slides = [...document.querySelectorAll(".portada__slide")];
    slides.forEach((s, i) => {
      const activa = i === carrusel.i;
      s.classList.toggle("es-activa", activa);
      if (activa) s.removeAttribute("aria-hidden");
      else s.setAttribute("aria-hidden", "true");
    });
    document.querySelectorAll(".portada__punto").forEach((p, i) => {
      p.setAttribute("aria-selected", String(i === carrusel.i));
    });
    pintarDatosDeSlide();
  }

  const mover = (paso) => irASlide(carrusel.i + paso);

  function arrancarReloj() {
    if (carrusel.reloj || sinMovimiento() || carrusel.fechas.length < 2) return;
    carrusel.reloj = setInterval(() => mover(1), carrusel.PAUSA);
  }
  function pararReloj() { clearInterval(carrusel.reloj); carrusel.reloj = null; }
  function reiniciarReloj() { pararReloj(); arrancarReloj(); }

  /* La columna de la derecha es la ficha de la fecha que está al frente. La
     portada ya dice el nombre en grande, así que acá no se repite: van los
     datos prácticos y el contador de dónde estás parado. */
  function pintarDatosDeSlide() {
    const e = carrusel.fechas[carrusel.i];
    if (!e) return;

    $("heroSubtitulo").textContent =
      e.description || "Entradas por mesa, con tu lugar asegurado.";

    const datos = [
      ["Fecha", fechaLarga(e.event_date)],
      ["Lugar", e.venue || e.city],
    ].filter(([, v]) => v);
    $("heroDatos").innerHTML = datos
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("");

    const total = carrusel.fechas.length;
    $("heroContador").textContent = String(carrusel.i + 1).padStart(2, "0");
    $("heroContadorTexto").textContent = total > 1
      ? `de ${String(total).padStart(2, "0")} fechas`
      : "Evento destacado";

    // El botón dice lo que va a pasar: solo la fecha que vende entradas abre
    // el flujo de compra; las demás llevan al listado.
    const btn = $("btnComprar");
    if (!btn) return;
    const vende = Boolean(e.is_main && e.sells_tickets);
    btn.dataset.vende = vende ? "1" : "0";
    btn.innerHTML = vende
      ? 'Comprar entradas <span>↗</span>'
      : 'Ver esta fecha <span>↗</span>';
  }

  function pintarEvento(event) {
    // El evento principal solo aporta la bajada por defecto: el resto de la
    // portada la maneja el carrusel.
    if (!carrusel.fechas.length) {
      $("heroSubtitulo").textContent =
        event.description || "Entradas por mesa, con tu lugar asegurado.";
    }
  }

  // ---------- portada: próximos eventos ----------
  const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

  async function cargarProximosEventos() {
    const cont = $("listaEventos");
    if (!cont) return;

    const { data } = await db
      .from("events")
      .select("slug, name, event_date, event_type, city, city_code, description, sells_tickets, is_main, cover_image, venue")
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

    // La misma consulta alimenta el listado y el carrusel de portada: son las
    // mismas fechas y no hay razón para pedirlas dos veces.
    montarCarrusel(eventos);

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
    const oro = state.sections.filter(esDeOro);
    const plata = state.sections.find(esDePlata);
    const sinPlano = state.sections.filter(
      (s) => s.assignment_mode !== "manual" && !esDePlata(s));

    const tarjetas = [];

    if (oro.length) {
      const desde = Math.min(...oro.map((s) => s.price_cents));
      tarjetas.push({
        code: AREA_ORO,
        label: "VIP Oro",
        detalle: "Eliges tu mesa en el plano del salón",
        // El precio y su unidad van separados: como una sola frase, cada área
        // la escribía distinto —"Mesa desde X", "Mesa X", "X por persona"— y
        // las tres cifras quedaban imposibles de comparar de un vistazo.
        // Todas las áreas muestran el precio por persona: es lo único que las
        // hace comparables de un vistazo. Cuánto sale la mesa entera va abajo,
        // porque es lo que se termina pagando.
        precio: money(desde),
        unidad: "por persona",
        incluye: `Mesa de 6 sillas · ${money(desde * 6)} la mesa`,
        tier: "oro",
        insignia: "Oro",
      });
    }

    /* Plata va sola y entre Oro y General, que es donde está en el salón. Se
       elige en el plano igual que Oro: hasta ahora se asignaba por orden de
       llegada y quien la compraba pagaba sin saber dónde se iba a sentar. */
    if (plata) {
      tarjetas.push({
        code: AREA_PLATA,
        label: plata.label,
        detalle: "Eliges tu mesa detrás de la Sección C",
        precio: money(plata.price_cents),
        unidad: "por persona",
        incluye: `Mesa de 4 sillas · ${money(plata.price_cents * 4)} la mesa`,
        tier: "plata",
        insignia: "Plata",
      });
    }

    sinPlano.forEach((s) => {
      tarjetas.push({
        code: s.code,
        label: s.label,
        detalle: "Acceso de pie, sin mesa ni silla",
        precio: money(s.price_cents),
        unidad: "por persona",
        incluye: "Sin mesa · circulas por el salón",
        tier: "general",
        insignia: "General",
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

    // Las dos áreas con plano abren la misma hoja; lo que cambia es qué zona
    // queda viva y cuál se atenúa detrás.
    if (code === AREA_ORO || code === AREA_PLATA) {
      const plata = code === AREA_PLATA;
      state.seccion = {
        code,
        conPlano: true,
        zona: code,
        section: plata ? state.sections.find(esDePlata) : null,
      };
      $("tituloLugar").textContent = plata ? "2. Elige tu mesa en Plata" : "2. Elige tu mesa";
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
        : `${esc(s.label)}: ${money(s.price_cents)} por persona.`;
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

  /* A, B, el fondo y Plata.

     Las mesas únicas tienen código U1..U3 y viven en secciones propias —una por
     mesa, para que cada una pueda tener su precio— pero físicamente están en la
     columna del medio de la Sección C. Por eso caen en el mismo grupo: el plano
     dibuja el salón, no el organigrama de secciones.

     Plata sí es un grupo aparte: está detrás de todo, cuesta distinto y es la
     otra área que se puede elegir. Sus mesas van P1..P90. */
  function agrupar() {
    const por = { A: [], B: [], C: [], P: [] };
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

    /* El plano dibuja el salón entero siempre, y apaga la zona que no se está
       comprando. Antes cada área mostraba solo lo suyo, y quien elegía Plata no
       tenía forma de saber qué tenía delante ni a qué distancia de la tarima
       quedaba. Ahora lo ve: la otra zona queda atenuada, de fondo, sin poder
       tocarse. Es la misma hoja mirada desde dos lugares distintos. */
    const zona = state.seccion?.zona ?? AREA_ORO;

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

    const apagada = (deLaZona) => (deLaZona === zona ? "" : " hoja__zona--apagada");

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

        <div class="hoja__zona${apagada(AREA_ORO)}" data-zona="${AREA_ORO}">
          <div class="hoja__frente">
            ${bloque(g.A, "Sección A")}
            <div class="hoja__pasarela" aria-hidden="true"><span>Pasarela</span></div>
            ${bloque(g.B, "Sección B")}
          </div>
          ${bloque(g.C, "Sección C", "hoja__seccion--fondo")}
        </div>

        ${g.P.length ? `
          <div class="hoja__zona${apagada(AREA_PLATA)}" data-zona="${AREA_PLATA}">
            ${bloque(g.P, "VIP Plata", "hoja__seccion--fondo")}
          </div>` : ""}

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
    // El precio de la sección es por persona; la mesa se cobra entera.
    const precio = (seccion?.price_cents ?? 0) * mesa.seat_count;
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
    /* La zona apagada no se toca ni con el dedo ni con el teclado. Atenuarla
       solo con CSS la dejaría igual de alcanzable con Tab, y alguien podría
       elegir una mesa de un área que no está comprando. */
    lienzo.querySelectorAll(".hoja__zona--apagada .mesa").forEach((boton) => {
      boton.disabled = true;
      boton.setAttribute("tabindex", "-1");
    });

    lienzo.querySelectorAll(".hoja__zona:not(.hoja__zona--apagada) .mesa:not([disabled])").forEach((boton) => {
      const code = boton.dataset.code;
      const mesa = state.tables.find((m) => m.code === code);
      if (!mesa) return;

      const seccion = state.sections.find((s) => s.id === mesa.section_id);
      const precio = seccion?.price_cents ?? 0;   // por persona
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

    $("modalCalculo").innerHTML = vendePorMesa()
      ? `Necesitas <em>${necesarias}</em> ${necesarias === 1 ? "mesa" : "mesas"} de ${porMesa} sillas.`
      : `Son <em>${state.personas}</em> ${state.personas === 1 ? "entrada" : "entradas"}.`;
  }

  /* Cuántas personas entran en una mesa del área elegida. Es lo que decide
     cuántas mesas hacen falta para el grupo, así que Plata no puede usar el
     número de Oro: sus mesas son de 4 y las de Oro de 6. */
  function mesaTipica() {
    if (state.seccion?.zona === AREA_PLATA) return 4;
    if (state.seccion?.conPlano) return 6;
    if (state.seccion?.section?.assignment_mode === "auto_fcfs") return 4;
    return 1;
  }

  /* Un área vende por mesa si se elige en el plano o si la mesa se asigna sola.
     General es la única que vende por cabeza. Hoy ninguna sección es
     `auto_fcfs` —Plata dejó de serlo—, pero la pregunta sigue siendo sobre el
     modo y no sobre el nombre, que es lo que permite agregar una sección nueva
     sin tocar esto. */
  const vendePorMesa = () =>
    Boolean(state.seccion?.conPlano) ||
    state.seccion?.section?.assignment_mode === "auto_fcfs";

  /* Cómo se llama el área en el resumen de la compra. Oro es una tarjeta que
     agrupa varias secciones, así que su nombre no sale de ninguna; Plata y
     General sí tienen el suyo. */
  function nombreDelArea() {
    if (state.seccion?.zona === AREA_ORO) return "VIP Oro";
    return state.seccion?.section?.label ?? "";
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

  /* El precio de la sección es por persona y la mesa se cobra entera: seis
     sillas a 400 son 2.400, vayan seis o vayan dos. Tiene que dar exactamente
     lo mismo que calcula create-order, que es quien cobra. */
  function totalCents() {
    if (state.seccion?.conPlano) {
      return [...state.mesas.values()]
        .reduce((acc, m) => acc + m.price_cents * m.seats, 0);
    }
    const s = state.seccion?.section;
    if (!s) return 0;
    if (s.assignment_mode === "auto_fcfs") {
      // Plata: la mesa asignada también va entera.
      const porMesa = mesaTipica();
      return s.price_cents * porMesa * Math.ceil(state.personas / porMesa);
    }
    // General: no hay mesa, se paga por cabeza.
    return s.price_cents * state.personas;
  }

  function pintarResumen() {
    const porMesa = mesaTipica();
    const necesarias = Math.ceil(state.personas / porMesa);

    $("grupoDato").innerHTML = vendePorMesa()
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
      <div class="row"><span>Área</span><span>${esc(nombreDelArea())}</span></div>
      <div class="row"><span>Personas</span><span>${state.personas}</span></div>
      <div class="row"><span>Lugar</span><span>${esc(detalle)}</span></div>
      <div class="row"><span>Total</span><span>${money(totalCents())}</span></div>
    `;
    irAPaso(3);
  });

  function validar() {
    let ok = true;
    // El documento no está en el formulario: lo trae el pago.
    [["nombre", "Ingresa el nombre."], ["apellido", "Ingresa el apellido."]].forEach(([campo, msg]) => {
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
