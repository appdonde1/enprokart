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
    sections: [],        // las que se pueden comprar
    sectionsVisibles: [], // todas, incluidas las agotadas — solo las usa el paso 1
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

  /* Antes esto era `toFixed(2).replace(".", ",")`, que no pone separador de
     miles: una mesa de seis a R$ 400 se imprimía «R$ 2400,00». El formateador
     nativo lo resuelve y además pone el espacio duro que usa el portugués de
     Brasil. Se construye una sola vez porque Intl es caro de instanciar. */
  const REALES = new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL",
  });
  const money = (c) => REALES.format((c || 0) / 100);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* El mensaje se escribía en un <span> suelto: sin id, sin role, y el campo no
     lo apuntaba con nada. O sea que quien usa un lector de pantalla enviaba el
     formulario, no pasaba nada audible, y el foco se quedaba donde estaba.
     Ahora el span se anuncia solo y el campo declara que está inválido y por
     qué. `role="alert"` ya viene del HTML: si se pusiera acá, al mismo tiempo
     que el texto, varios lectores no llegan a anunciarlo. */
  function setError(campo, mensaje) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (el) {
      el.textContent = mensaje || "";
      if (!el.id) el.id = `error-${campo}`;
    }

    const input = $(campo);
    if (!input) return;

    input.classList.toggle("invalid", Boolean(mensaje));
    if (mensaje) {
      input.setAttribute("aria-invalid", "true");
      if (el?.id) input.setAttribute("aria-describedby", el.id);
    } else {
      input.removeAttribute("aria-invalid");
    }
  }

  /* Al primer campo con error, para no obligar a buscarlo. `preventScroll` y un
     desplazamiento propio: el foco directo salta el campo al borde de arriba,
     debajo del encabezado pegajoso. */
  function irAlPrimerError() {
    const primero = document.querySelector("#formRegistro [aria-invalid='true']");
    if (!primero) return;
    primero.focus({ preventScroll: true });
    primero.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- navegación ----------

  /* Mueve el riel de pasos y nada más. Va aparte de `irAPaso` porque el paso 4
     —el pago— no tiene panel propio: es una ventana. Y mueve todos los rieles
     de la página de una vez, que es como la ventana de pago mantiene el suyo
     en hora sin saber que existe. */
  function marcarPaso(n) {
    document.querySelectorAll(".step-indicator").forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === n);
      el.classList.toggle("done", s < n);
    });
  }

  /* En qué paso estabas, para saber hacia dónde va el siguiente. */
  let pasoActual = 1;

  function irAPaso(n) {
    /* El panel entra desde el lado hacia el que vas: adelante desde la derecha,
       atrás desde la izquierda. Sin esto se entiende que algo cambió, pero no
       si avanzaste o retrocediste — y son cuatro pasos, así que importa. */
    const panels = document.querySelector(".booking-panels");
    if (panels) panels.dataset.dir = n < pasoActual ? "atras" : "adelante";
    pasoActual = n;

    document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("active"));
    $(`panel-${n}`).classList.add("active");

    marcarPaso(n);

    $("resumen").hidden = n === 1 || !haySeleccion();
    // Los botones del paso 2 viven en el pie del flujo, fuera del panel.
    $("pieLugar").hidden = n !== 2;
    $("pieDatos").hidden = n !== 3;

    /* Abierto, el flujo ocupa la ventana entera y el que scrollea es el panel,
       no la página. Así que al cambiar de paso lo que hay que devolver arriba
       es el panel nuevo: mover la página no haría nada, y el paso entrante se
       quedaría a media altura si el anterior estaba scrolleado. */
    const panel = $(`panel-${n}`);
    if (panel) panel.scrollTo({ top: 0, behavior: "smooth" });
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
      .select("id, code, label, price_cents, assignment_mode, capacity, notice, theme_color, on_sale")
      .eq("event_id", event.id)
      .order("sort_order");

    /* Lo apagado en el panel no se puede comprar, pero sí se tiene que ver.

       Antes esto era un filtro y punto: la sección apagada desaparecía de la
       lista sin ninguna explicación. Y como el admin apaga una sección
       justamente cuando se agota, el efecto era que el área más cara —la que
       más tira de la venta— se borraba sola de la página, y quien la había
       visto el día anterior no entendía qué había pasado.

       Ahora hay dos listas. `state.sections` son las que se pueden comprar, y
       es la que sigue alimentando el plano, el resumen y el cobro: nada de eso
       cambia. `state.sectionsVisibles` las lleva todas, y la usa solo el paso 1
       para poder dibujar la agotada en su sitio, en gris y sin poder tocarla. */
    state.sectionsVisibles = sections || [];
    state.sections = (sections || []).filter((s) => s.on_sale !== false);

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

  /* Para el listón: día y mes, sin el día de la semana. En un cartel «26 de
     septiembre» es la forma en que la fecha se lee de un vistazo; añadirle
     «sábado» delante alarga la línea sin aportar nada que no se deduzca. */
  const fechaCorta = (iso) => iso
    ? new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long" })
    : "";

  /* =========================================================
     EL CARRUSEL DE PORTADA — PANORÁMICO

     Una diapositiva por fecha publicada, de lado a lado de la pantalla. La
     ficha de debajo sigue a la que esté al frente: fecha, lugar y bajada son
     los de esa fecha, no los de un evento fijo.

     El desplazamiento es scroll nativo con scroll-snap: este archivo no mueve
     nada con el dedo, solo mira dónde quedó el scroll y marca cuál es la
     activa. El carrusel anterior movía un transform con pointerdown/pointerup,
     y en el teléfono el navegador se quedaba con el gesto y el pointerup no
     llegaba: deslizar no hacía nada.

     El reloj no es un setInterval: es la animación CSS de la barra de progreso.
     Cuando la barra se termina de llenar se pasa a la siguiente. Así lo que se
     ve y lo que pasa no pueden desincronizarse, y pausar es pausar la barra.

     Con una sola fecha no se dibuja ningún control: un carrusel de uno es una
     foto, y las barras y las flechas solo estorbarían.
     ========================================================= */

  const carrusel = {
    fechas: [],
    i: 0,
    destino: null,   // a dónde va un desplazamiento pedido por código
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

    pista.innerHTML = fechas.map((e, i) => {
      const src = esc(e.cover_image || IMAGEN_GENERICA);
      const carga = i === carrusel.i ? 'fetchpriority="high"' : 'loading="lazy"';
      /* Sobre la foto, solo el nombre y la fecha: son los dos datos que el
         admin escribe en la pestaña Portada para esto. Lo demás va en la ficha
         de debajo. */
      return `
      <article class="portada__slide" data-i="${i}"
               role="group" aria-roledescription="diapositiva"
               aria-label="${i + 1} de ${fechas.length}: ${esc(e.name)}">
        <div class="portada__media">
          <img class="portada__fondo" src="${src}" alt="" aria-hidden="true" ${carga} decoding="async" />
          <img class="portada__img" src="${src}" alt="${esc(e.name)}" ${carga} decoding="async" />
        </div>
        <div class="portada__velo" aria-hidden="true"></div>
        <div class="portada__liston">
          <p class="portada__titulo">${esc(e.name)}</p>
          ${e.event_date
            ? `<p class="portada__fecha">${esc(fechaCorta(e.event_date))}</p>` : ""}
        </div>
      </article>`;
    }).join("");

    /* Cuando la imagen llega se conoce su forma. Un afiche vertical no se
       recorta para llenar el cuadro apaisado: la hoja lo muestra entero sobre
       una copia desenfocada. */
    pista.querySelectorAll(".portada__slide").forEach((slide) => {
      const img = slide.querySelector(".portada__img");
      const fondo = slide.querySelector(".portada__fondo");
      const medir = () => slide.classList.toggle("portada__slide--vertical",
        img.naturalHeight > img.naturalWidth * 0.9);

      if (img.complete && img.naturalWidth) medir();
      else img.addEventListener("load", medir, { once: true });

      // Si la imagen del evento no baja, entra la genérica y no un hueco.
      img.addEventListener("error", () => {
        img.addEventListener("load", medir, { once: true });
        img.src = IMAGEN_GENERICA;
        fondo.src = IMAGEN_GENERICA;
      }, { once: true });
    });

    const barras = $("portadaPuntos");
    const anterior = $("portadaAnterior");
    const siguiente = $("portadaSiguiente");
    const varias = fechas.length > 1;
    [barras, anterior, siguiente].forEach((el) => { if (el) el.hidden = !varias; });

    if (varias && barras) {
      portada.style.setProperty("--portada-pausa", `${carrusel.PAUSA}ms`);
      barras.innerHTML = fechas.map((e, i) => `
        <button type="button" class="portada__tab" role="tab"
                data-i="${i}" aria-selected="false"
                aria-label="${esc(e.name)}"><span><i></i></span></button>
      `).join("");
      barras.querySelectorAll("[data-i]").forEach((b) => {
        b.addEventListener("click", () => irASlide(Number(b.dataset.i)));
      });
      anterior?.addEventListener("click", () => mover(-1));
      siguiente?.addEventListener("click", () => mover(1));

      /* El reloj. Con «reducir movimiento» la barra no se anima; además la hoja
         global acorta cualquier animación a casi cero, y si se escuchara el
         final igual, pasaría de fecha en fecha sin parar. */
      if (sinMovimiento()) {
        portada.classList.add("portada--quieta");
      } else {
        barras.addEventListener("animationend", (ev) => {
          if (ev.animationName === "portada-progreso") mover(1);
        });
      }

      /* Se pausa mientras el dedo está encima, con el ratón encima, con el foco
         adentro y con la pestaña en segundo plano. Al tocar también se olvida
         cualquier desplazamiento en camino: el dedo manda. */
      const pausar = () => portada.classList.add("portada--pausa");
      const seguir = () => portada.classList.remove("portada--pausa");
      pista.addEventListener("touchstart", () => { carrusel.destino = null; pausar(); }, { passive: true });
      pista.addEventListener("touchend", seguir, { passive: true });
      pista.addEventListener("touchcancel", seguir, { passive: true });
      portada.addEventListener("mouseenter", pausar);
      portada.addEventListener("mouseleave", seguir);
      portada.addEventListener("focusin", pausar);
      portada.addEventListener("focusout", seguir);
      document.addEventListener("visibilitychange", () =>
        document.hidden ? pausar() : seguir());

      /* El scroll dice cuál quedó al frente. Se mide en el cuadro siguiente y no
         en cada evento. Mientras un desplazamiento pedido por código está en
         camino se ignoran las posiciones intermedias: si no, irían marcando
         como activas todas las fechas por las que pasa. */
      let cuadro = 0;
      pista.addEventListener("scroll", () => {
        cancelAnimationFrame(cuadro);
        cuadro = requestAnimationFrame(() => {
          const ancho = pista.clientWidth || 1;
          const i = Math.round(pista.scrollLeft / ancho);
          if (carrusel.destino !== null) {
            if (i === carrusel.destino && Math.abs(pista.scrollLeft - i * ancho) < 4) {
              carrusel.destino = null;
            }
            return;
          }
          if (i !== carrusel.i && i >= 0 && i < carrusel.fechas.length) activar(i);
        });
      }, { passive: true });

      // Al girar el teléfono cambia el ancho: la fecha del frente se queda.
      window.addEventListener("resize", () => {
        pista.scrollLeft = carrusel.i * pista.clientWidth;
      });
    }

    portada.hidden = false;
    // La primera vez sin animación: la portada aparece ya en su fecha.
    requestAnimationFrame(() => { pista.scrollLeft = carrusel.i * pista.clientWidth; });
    activar(carrusel.i);
  }

  /* Marca cuál está al frente: la diapositiva, su barra y la ficha de debajo.
     Cambiar `es-activa` es lo que reinicia el acercamiento y la entrada del
     título; cambiar `aria-selected` reinicia la barra, o sea el reloj. */
  function activar(n) {
    carrusel.i = n;
    document.querySelectorAll(".portada__slide").forEach((s, i) => {
      const activa = i === n;
      s.classList.toggle("es-activa", activa);
      if (activa) s.removeAttribute("aria-hidden");
      else s.setAttribute("aria-hidden", "true");
    });
    document.querySelectorAll(".portada__tab").forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === n));
      b.classList.toggle("es-vista", i < n);
    });
    pintarDatosDeSlide();
  }

  function irASlide(n) {
    const total = carrusel.fechas.length;
    const pista = $("portadaPista");
    if (!total || !pista) return;
    const i = (n + total) % total;
    if (i === carrusel.i) return;

    carrusel.destino = i;
    pista.scrollTo({
      left: i * pista.clientWidth,
      behavior: sinMovimiento() ? "auto" : "smooth",
    });
    activar(i);
  }

  const mover = (paso) => irASlide(carrusel.i + paso);

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
      ? 'Comprar entradas'
      : 'Ver esta fecha';
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
          <span class="event-row__arrow" aria-hidden="true"></span>
        </a>
      `;
    }).join("");

    // Las filas se crean después del script que abre la reserva, así que se
    // reutiliza el mismo botón en vez de duplicar esa lógica.
    /* La fila lleva a la compra aunque la portada esté mostrando otra fecha.
       El botón de la portada decide según la diapositiva del frente: si el
       carrusel había rotado a una fecha que no vende, tocar esta fila solo
       bajaba al listado. Primero se trae al frente la fecha que vende. */
    cont.querySelectorAll("[data-abre-reserva]").forEach((fila) => {
      fila.addEventListener("click", (e) => {
        e.preventDefault();
        const vende = carrusel.fechas.findIndex((f) => f.is_main && f.sells_tickets);
        if (vende >= 0) irASlide(vende);
        $("btnComprar")?.click();
      });
    });
  }

  // ---------- portada: menú ----------

  /* Fotos de la casa para los productos que todavía no tienen la suya. Ya
     estaban en el repositorio y no las usaba nadie. */
  const PLACEHOLDERS_MENU = [
    "placeholders/menu-parrilla.jpg",
    "placeholders/menu-burger.jpg",
    "placeholders/menu-pizza.jpg",
    "placeholders/menu-tenders.jpg",
  ];

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

    /* Sin precios: el menú de la portada muestra qué hay, no cuánto cuesta.

       La foto era un `background-image` inline. Eso costaba tres cosas: no
       admite `loading="lazy"` —así que el teléfono se bajaba las cuatro fotos
       antes de que nadie llegara a la sección—, no admite `alt`, y la URL
       terminaba dentro de `url('…')` mientras `esc()` no escapa la comilla
       simple: un nombre de archivo con apóstrofo rompía el atributo entero. */
    cont.innerHTML = data.map((p, i) => {
      /* Si el producto no tiene foto cargada entra una de la casa, en vez de la
         trama diagonal: el collage vive de las imágenes y con la mitad de las
         baldosas en gris se lee como si faltara algo. Se reparten por posición
         y no al azar para que no cambien en cada recarga. */
      const foto = p.image_url || PLACEHOLDERS_MENU[i % PLACEHOLDERS_MENU.length];
      return `
      <figure class="menu-tile menu-tile--foto${p.image_url ? "" : " menu-tile--generica"}">
        <img class="menu-tile__foto" src="${esc(foto)}"
             alt="" loading="lazy" decoding="async" />
        <figcaption>
          <b>${String(i + 1).padStart(2, "0")}</b>
          <strong>${esc(p.name)}</strong>
          ${p.description ? `<em>${esc(p.description)}</em>` : ""}
        </figcaption>
      </figure>
    `;
    }).join("");

    // Si una foto cargada desde la base no baja, entra la de la casa en su
    // lugar y la baldosa no queda en negro.
    cont.querySelectorAll(".menu-tile__foto").forEach((img, i) => {
      img.addEventListener("error", () => {
        img.src = PLACEHOLDERS_MENU[i % PLACEHOLDERS_MENU.length];
      }, { once: true });
    });
  }

  // ---------- paso 1: áreas ----------

  /* Cuántas mesas quedan libres en un conjunto de secciones.
     Solo tiene respuesta para las áreas que se eligen en el plano: de esas
     conocemos cada mesa y su disponibilidad. Para las de entrada general la
     base nos da la capacidad total, no la vendida, así que devuelve null y la
     tarjeta no dice nada en vez de inventar un número. */
  function mesasLibres(secciones) {
    const ids = new Set(secciones.map((s) => s.id));
    if (!state.tables.length) return null;
    return state.tables.filter((t) => ids.has(t.section_id) && t.available).length;
  }

  /* Una sección está agotada por dos caminos, y los dos cuentan:
       · el admin la apagó en el panel (`on_sale === false`), que es lo que hace
         cuando ya no quedan lugares;
       · o quedan cero mesas libres en el plano, que lo sabemos solos. */
  function estaAgotada(secciones) {
    if (!secciones.length) return false;
    if (secciones.every((s) => s.on_sale === false)) return true;
    const libres = mesasLibres(secciones);
    return libres === 0;
  }

  function pintarAreas() {
    // El paso 1 dibuja todas, incluidas las agotadas; el resto del flujo sigue
    // trabajando solo con las que se pueden comprar.
    const todas = state.sectionsVisibles ?? state.sections;
    const oro = todas.filter(esDeOro);
    const plata = todas.find(esDePlata);
    const sinPlano = todas.filter(
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
        incluye: [`Mesa de 6 sillas`, `${money(desde * 6)} la mesa entera`, `Eliges tu mesa en el plano`, `Las más cerca de la tarima`],
        tier: "oro",
        insignia: "Oro",
        libres: mesasLibres(oro),
        agotada: estaAgotada(oro),
        /* El ancla de la comparación. No dice «la más elegida» porque no
           tenemos ese dato y no se inventa: dice que es la que está más cerca
           del escenario, que es verdad por construcción —las áreas se ordenan
           por cercanía a la tarima unas líneas más abajo—. */
        destacada: "Mejor ubicación",
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
        incluye: [`Mesa de 4 sillas`, `${money(plata.price_cents * 4)} la mesa entera`, `Eliges tu mesa en el plano`, `Detrás de la Sección C`],
        tier: "plata",
        insignia: "Plata",
        libres: mesasLibres([plata]),
        agotada: estaAgotada([plata]),
      });
    }

    sinPlano.forEach((s) => {
      tarjetas.push({
        code: s.code,
        label: s.label,
        detalle: "Acceso de pie, sin mesa ni silla",
        precio: money(s.price_cents),
        unidad: "por persona",
        incluye: ["Entrada individual", "Acceso de pie", "Circulas por el salón", "Sin lugar asignado"],
        tier: "general",
        insignia: "General",
        libres: null,   // sin plano no sabemos cuántas quedan
        agotada: s.on_sale === false,
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
    ` + tarjetas.map((t, i) => {
      const agotada = Boolean(t.agotada);
      const donde = i === 0 ? "Adelante"
        : i === tarjetas.length - 1 ? "Al fondo" : "Detrás";

      /* La disponibilidad solo se muestra cuando la sabemos y cuando dice algo:
         «quedan 40 mesas» no ayuda a decidir y mete ruido en la tarjeta. Por
         debajo de diez es cuando el dato empieza a pesar. */
      const quedan = t.libres !== null && t.libres > 0 && t.libres <= 10
        ? `<span class="area-card__quedan">Quedan ${t.libres} ${t.libres === 1 ? "mesa" : "mesas"}</span>`
        : "";

      return `
      <button type="button" class="area-card area-card--${t.tier}${agotada ? " area-card--agotada" : ""}${t.destacada && !agotada ? " area-card--destacada" : ""}"
              data-area="${esc(t.code)}" style="--i:${i + 1}"${agotada ? " disabled" : ""}>

        <!-- La cinta del nivel, en su metal. La llevan las tres: antes solo la
             tenía Oro, y como Oro estaba agotado —y a las agotadas se les quita
             el destello— la pantalla acababa sin un solo brillo.
             Agotada cambia de mensaje pero no desaparece: un nivel agotado
             sigue siendo el nivel que es, y decirlo en la esquina es lo que
             explica por qué está en gris. -->
        <span class="area-card__cinta${agotada ? " area-card__cinta--agotada" : ""}">
          ${agotada ? "Agotado" : esc(t.insignia)}
        </span>

        <!-- El tilde de «elegida». Va en un elemento propio porque los dos
             pseudo-elementos de la tarjeta los ocupa el material. -->
        <span class="area-card__ok" aria-hidden="true">✓</span>

        <!-- Solo la posición. El nivel ya lo dice la cinta, y decirlo aquí otra
             vez era la tercera aparición de la misma palabra en la tarjeta. -->
        <span class="area-card__tag">${donde}</span>
        <span class="area-card__titulo">${esc(t.label)}</span>

        <!-- El precio va pegado al nombre: es lo que se compara entre las tres
             tarjetas, y separarlo obligaba a saltar de una punta a la otra. -->
        <span class="area-card__precio">
          <span class="price">${esc(t.precio)}</span>
          <span class="area-card__unidad">${esc(t.unidad)}</span>
        </span>

        <span class="area-card__detalle">${esc(t.detalle)}</span>

        <!-- La acción va en medio, no al final: es lo que hace que la tarjeta se
             lea como una oferta cerrada —qué es, cuánto, y el botón— y deja la
             lista de abajo como el detalle que se consulta si hace falta. -->
        <span class="area-card__ir">${agotada ? "Sin lugares" : "Elegir"}</span>

        <!-- Lo que incluye, en lista. Antes era una sola línea corrida en el
             gris más apagado de la tarjeta, siendo el dato que decide la compra.
             Todas las líneas salen de datos que tenemos: sillas, precio de la
             mesa entera, cómo se asigna el lugar y dónde queda. -->
        <ul class="area-card__lista">
          ${t.incluye.map((x) => `<li>${esc(x)}</li>`).join("")}
        </ul>
        ${quedan}
      </button>
    `;
    }).join("");

    $("areasGrid").querySelectorAll("[data-area]").forEach((btn) => {
      btn.addEventListener("click", () => elegirArea(btn.dataset.area));
    });

    /* La entrada. Se marca acá y no se deja al observador de scroll porque
       estas tarjetas nacen dentro de un panel que puede estar oculto: cuando el
       flujo se abre ya están pintadas, y el observador no dispararía nunca.

       La tarima va primero —es el frente del salón y ordena la lectura— y
       detrás las áreas, de adelante hacia el fondo. El `--i` de cada tarjeta lo
       lleva ya la plantilla; acá solo se enciende la animación. */
    if (!sinMovimiento()) {
      $("areasGrid").querySelector(".areas-tarima")?.classList.add("entra");
      $("areasGrid").querySelectorAll(".area-card").forEach((c) => c.classList.add("entra"));
    }
  }

  /* Al volver con "Cambiar área" hay que ver cuál se había elegido.
     Era `aria-pressed`, que describe un interruptor que queda hundido; estos
     botones no conmutan nada, avanzan al paso 2. `aria-current` es lo que
     significa de verdad: de este conjunto, éste es el vigente. */
  function marcarAreaElegida(code) {
    $("areasGrid").querySelectorAll("[data-area]").forEach((btn) => {
      if (btn.dataset.area === code) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
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

    /* El correo ya no es opcional: ahí llegan las entradas con su código. La
       comprobación es la misma que hace create-order, para que el formulario
       no deje pasar algo que el servidor va a rechazar. */
    const correo = $("email").value.trim();
    if (!correo) { setError("email", "Ingresa tu correo: ahí te llegan las entradas."); ok = false; }
    else if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(correo)) {
      setError("email", "Ese correo no parece válido. Ej: nombre@correo.com"); ok = false;
    } else setError("email", "");

    return ok;
  }

  /* ---------- la ventana de pago ----------

     El último vistazo antes de que exista el cobro. Va acá y no en pagar.html
     a propósito: allá la mesa ya está tomada y el reloj de los cinco minutos
     ya corre, así que revisar la compra costaría tiempo de reserva. Acá
     todavía no se llamó a create-order, y por eso "Editar" no tiene nada que
     cancelar: cierra la ventana y devuelve al formulario. */
  function abrirVentanaDePago() {
    const elegidas = [...state.mesas.values()];
    const lugar = state.seccion?.conPlano
      ? `${elegidas.length} ${elegidas.length === 1 ? "mesa" : "mesas"}: ${elegidas.map((m) => m.code).join(", ")}`
      : state.seccion?.section?.label ?? "";

    // Cada línea aparece solo si tiene contenido: el correo es opcional y una
    // fila vacía haría dudar de si falta un dato.
    const filas = [
      ["Evento", state.event?.name],
      ["Fecha", fechaLarga(state.event?.event_date)],
      ["Área", nombreDelArea()],
      ["Lugar", lugar],
      [state.personas === 1 ? "Persona" : "Personas", String(state.personas)],
      ["A nombre de", `${$("nombre").value.trim()} ${$("apellido").value.trim()}`.trim()],
      ["WhatsApp", $("whatsapp").value.trim()],
      ["Correo", $("email").value.trim()],
    ].filter(([, valor]) => valor);

    $("resumenPago").innerHTML = filas
      .map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)
      .join("");

    // El total no va en la lista: vive en el pie, donde no se lo lleva el scroll.
    $("pagoTotal").textContent = money(totalCents());

    setError("pago", "");
    $("modalPago").hidden = false;
    marcarPaso(4);
    $("btnPagar").focus();
  }

  function cerrarVentanaDePago() {
    $("modalPago").hidden = true;
    // El riel vuelve a Datos, que es el paso al que se vuelve.
    marcarPaso(3);
  }

  // Mientras el cobro se está generando la ventana no se cierra: cerrarla
  // dejaría una compra creada de la que el visitante ya no vería nada.
  let generandoCobro = false;

  $("formRegistro").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validar()) { irAlPrimerError(); return; }
    abrirVentanaDePago();
  });

  $("btnEditarCompra").addEventListener("click", () => {
    cerrarVentanaDePago();
    $("nombre").focus();
  });

  $("modalPago").addEventListener("click", (e) => {
    if (e.target === $("modalPago") && !generandoCobro) cerrarVentanaDePago();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalPago").hidden && !generandoCobro) {
      cerrarVentanaDePago();
    }
  });

  $("btnPagar").addEventListener("click", async () => {
    if (generandoCobro) return;
    generandoCobro = true;

    const btn = $("btnPagar");
    const editar = $("btnEditarCompra");
    btn.disabled = true;
    editar.disabled = true;
    btn.textContent = "Generando cobro...";
    setError("pago", "");

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

    generandoCobro = false;
    btn.disabled = false;
    editar.disabled = false;
    btn.textContent = "Pagar";

    if (!ok) {
      // Si la mesa se ocupó mientras se revisaba, no hay nada que confirmar:
      // se cierra la ventana y se vuelve al plano, que es donde se arregla.
      if (status === 409) {
        cerrarVentanaDePago();
        setError("lugar", data.error || "Ese lugar ya no está disponible.");
        await refrescarMesas();
        irAPaso(2);
      } else {
        setError("pago", data.error || "No se pudo iniciar la compra.");
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
