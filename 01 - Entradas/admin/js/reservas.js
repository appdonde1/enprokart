/* Reservas de cortesía.

   La Edge Function `courtesy-ticket` existía completa desde hace tiempo —
   reserva las mesas, emite una entrada por invitado con monto en cero y deja el
   registro de quién la autorizó— pero no había ninguna pantalla que la llamara.
   Esta es esa pantalla.

   Una cortesía ocupa el mismo lugar físico que alguien que pagó, así que se
   reserva igual: por mesa entera. Lo único distinto es el monto y que queda
   anotada en `courtesy_log` con el motivo.

   El código de 3 dígitos se escribe acá y se compara en el servidor. Nunca se
   guarda ni se compara en el navegador. */

(function () {
  "use strict";

  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  const estado = {
    eventos: [],
    secciones: [],
    mesas: [],
    elegidas: new Set(),
  };

  function setError(mensaje, ok = false) {
    const el = document.querySelector('.error[data-for="reserva"]');
    if (!el) return;
    el.textContent = mensaje || "";
    el.classList.toggle("error--ok", Boolean(mensaje) && ok);
  }

  const eventoActual = () => estado.eventos.find((e) => e.id === $("rEvento").value);

  // ---------- carga ----------

  async function cargarEventos() {
    const { data } = await P.db
      .from("events")
      .select("id, slug, name, event_date, status")
      .order("event_date", { ascending: false });

    estado.eventos = data ?? [];
    $("rEvento").innerHTML = estado.eventos
      .map((e) => `<option value="${e.id}">${P.esc(e.name)}</option>`)
      .join("");

    await cargarSalon();
  }

  async function cargarSalon() {
    const evento = eventoActual();
    if (!evento) return;

    estado.elegidas.clear();

    const { data: secciones } = await P.db
      .from("sections")
      .select("id, code, label, price_cents, assignment_mode, capacity")
      .eq("event_id", evento.id)
      .order("sort_order");

    estado.secciones = secciones ?? [];

    // Solo las secciones con plano tienen mesas que elegir; el resto va por la
    // otra pestaña, que es exactamente la división que hace la Edge Function.
    const conPlano = estado.secciones.filter((s) => s.assignment_mode === "manual");
    const sinPlano = estado.secciones.filter((s) => s.assignment_mode !== "manual");

    $("rSeccion").innerHTML = sinPlano.length
      ? sinPlano.map((s) => `<option value="${P.esc(s.code)}">${P.esc(s.label)}</option>`).join("")
      : `<option value="">Este evento no tiene secciones sin plano</option>`;

    if (conPlano.length) {
      const { data: mesas } = await P.db
        .from("tables_public")
        .select("id, section_id, code, seat_count, label, available, pos_x, pos_y")
        .in("section_id", conPlano.map((s) => s.id))
        .order("code");
      estado.mesas = mesas ?? [];
    } else {
      estado.mesas = [];
    }

    pintarPlano();
  }

  // ---------- plano ----------

  /* El mismo agrupado que el plano del comprador: A, B, el fondo y Plata. Las
     mesas únicas viven en secciones propias pero físicamente están en la
     columna del medio de la C, y por eso caen en su grupo.

     Plata necesita su propia canasta. Sin ella, sus noventa mesas caían en la
     de la C por el `|| por.C` de abajo, y como cada mesa se dibuja en la
     `pos_x`/`pos_y` que trae, P1 aterrizaba encima de C1: la Sección C se
     estiraba a seis filas y las mesas de Plata quedaban tapadas, imposibles de
     tocar. Los dos problemas eran el mismo. */
  function agrupar() {
    const por = { A: [], B: [], C: [], P: [] };
    for (const m of estado.mesas) {
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

  /* =========================================================
     EL PLANO: la misma hoja que ve quien compra

     El marcado copia js/app.js → pintarPlano() y mesaHTML(), y las clases
     vienen de ../css/plano.css. Si se cambia uno, se cambia el otro: el admin
     tiene que ver el salón exactamente como lo ve el comprador, con la tarima,
     la pasarela entre A y B, las únicas en la columna del medio de la C y
     Plata al fondo.

     Antes este plano usaba las clases del editor del Salón (salon-*). Un ajuste
     de ese editor para el teléfono les dio un ancho mínimo por columnas, y acá
     sacaba la Sección C y Plata fuera de la tarjeta.

     Diferencias con la web, a propósito:
       · ninguna zona se apaga: el admin reserva en Oro y en Plata;
       · una mesa tomada no está deshabilitada: tocarla ofrece liberarla.
     ========================================================= */
  function pintarPlano() {
    const destino = $("planoReservas");
    if (!estado.mesas.length) {
      destino.innerHTML = `<p class="hint">Este evento no tiene mesas en el plano.</p>`;
      pintarResumenMesas();
      return;
    }

    // Cada toque vuelve a dibujar la hoja: se guarda el arrastre para no saltar.
    const arrastre = destino.scrollLeft;
    const g = agrupar();
    const bloque = (mesas, nombre, clase = "") => mesas.length ? `
        <section class="hoja__seccion ${clase}">
          <h4 class="hoja__rotulo">${P.esc(nombre)} · ${mesas.filter((m) => m.available).length} libres de ${mesas.length}</h4>
          <div class="hoja__grid" style="--columnas:${columnasDe(mesas)}">
            ${mesas.map(mesaHTML).join("")}
          </div>
        </section>` : "";

    destino.innerHTML = `
      <div class="hoja-marco">
      <div class="hoja">
        <div class="hoja__tarima" aria-hidden="true">
          <div class="hoja__tarima-barra">
            <span class="hoja__tarima-luces"><i></i><i></i><i></i><i></i></span>
            Tarima
          </div>
          <div class="hoja__tarima-pie"></div>
        </div>

        <div class="hoja__zona">
          <div class="hoja__frente">
            ${bloque(g.A, "Sección A")}
            <div class="hoja__pasarela" aria-hidden="true"><span>Pasarela</span></div>
            ${bloque(g.B, "Sección B")}
          </div>
          ${bloque(g.C, "Sección C", "hoja__seccion--fondo")}
        </div>

        ${g.P.length ? `
          <div class="hoja__zona">
            ${bloque(g.P, "VIP Plata", "hoja__seccion--fondo")}
          </div>` : ""}

        <ul class="hoja__leyenda">
          <li><i class="hoja__marca hoja__marca--libre"></i>Disponible</li>
          <li><i class="hoja__marca hoja__marca--elegida"></i>Elegida</li>
          <li><i class="hoja__marca hoja__marca--tomada"></i>Tomada · toca para liberar</li>
          <li><i class="hoja__marca hoja__marca--unica"></i>Mesa única</li>
        </ul>
      </div>
      </div>`;

    destino.querySelectorAll("[data-code]").forEach((boton) => {
      boton.addEventListener("click", () =>
        alternar(boton.dataset.code, boton.dataset.available === "1"));
      const leer = () => marcarLectura(boton.dataset.lectura);
      boton.addEventListener("pointerenter", leer);
      boton.addEventListener("focus", leer);
    });

    medirHoja();
    aplicarZoom(zoom.escala);
    destino.scrollLeft = arrastre;

    pintarResumenMesas();
  }

  /* ---------- zoom del plano ----------

     En el teléfono la hoja mide 760px (plano.css) para que cada mesa se pueda
     tocar, y se arrastra. Para ver el salón entero de un vistazo, el admin la
     aleja pellizcando con dos dedos o con los botones de la cabecera.

     La hoja no se re-maqueta: guarda su ancho real y se escala con transform,
     así las mesas no cambian de fila. El marco que la envuelve toma el tamaño
     escalado. Solo el plano se escala; el zoom de la página no se toca.
     En pantallas donde la hoja ya entra completa no hay zoom ni botones. */
  const zoom = { escala: 1, min: 1, ancho: 0, alto: 0, pellizcoHasta: 0 };
  const ZOOM_MAX = 1.5;
  const ZOOM_PASO = 1.25;

  function rellenoDe(lienzo) {
    const cs = getComputedStyle(lienzo);
    return { izq: parseFloat(cs.paddingLeft) || 0, der: parseFloat(cs.paddingRight) || 0 };
  }

  // La hoja a tamaño real, sin escala. Con cada dibujo y al cambiar el ancho.
  function medirHoja() {
    const lienzo = $("planoReservas");
    const hoja = lienzo.querySelector(".hoja");
    zoom.ancho = zoom.alto = 0;
    if (!hoja) return;
    const marco = hoja.parentElement;
    marco.classList.remove("hoja-marco--zoom");
    marco.style.width = marco.style.height = "";
    hoja.style.width = hoja.style.transform = "";
    zoom.ancho = hoja.offsetWidth;
    zoom.alto = hoja.offsetHeight;
    const r = rellenoDe(lienzo);
    zoom.min = Math.min(1, (lienzo.clientWidth - r.izq - r.der) / zoom.ancho);
  }

  // El contenedor que scrollea en vertical: la página, salvo que el panel tenga uno propio.
  function scrollVertical(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  /* foco: el punto de la pantalla que tiene que quedar quieto (entre los dedos,
     o el centro del lienzo con los botones). Sin foco no se corrige el scroll:
     es un redibujo con la misma escala. */
  function aplicarZoom(escala, foco) {
    const lienzo = $("planoReservas");
    const hoja = lienzo.querySelector(".hoja");
    const controles = $("planoZoom");
    const hayZoom = Boolean(hoja) && zoom.ancho > 0 && zoom.min < 0.99;
    if (controles) controles.hidden = !hayZoom;
    if (!hayZoom) {
      zoom.escala = 1;
      lienzo.classList.remove("plano__lienzo--entero");
      return;
    }

    const marco = hoja.parentElement;
    const antes = zoom.escala;
    const nueva = Math.min(ZOOM_MAX, Math.max(zoom.min, escala));
    const r = rellenoDe(lienzo);
    const caja = lienzo.getBoundingClientRect();

    // Qué punto del papel está bajo el foco antes del cambio.
    let papelX = 0, papelY = 0;
    if (foco) {
      const topeMarco = marco.getBoundingClientRect().top;
      papelX = (lienzo.scrollLeft + foco.x - caja.left - lienzo.clientLeft - r.izq) / antes;
      papelY = (foco.y - topeMarco) / antes;
    }

    zoom.escala = nueva;
    marco.classList.add("hoja-marco--zoom");
    hoja.style.width = `${zoom.ancho}px`;
    hoja.style.transform = `scale(${nueva})`;
    marco.style.width = `${zoom.ancho * nueva}px`;
    marco.style.height = `${zoom.alto * nueva}px`;

    const entera = zoom.ancho * nueva <= lienzo.clientWidth - r.izq - r.der + 1;
    lienzo.classList.toggle("plano__lienzo--entero", entera);

    if (foco) {
      lienzo.scrollLeft = papelX * nueva - (foco.x - caja.left - lienzo.clientLeft - r.izq);
      const desfase = marco.getBoundingClientRect().top + papelY * nueva - foco.y;
      if (Math.abs(desfase) > 0.5) scrollVertical(lienzo).scrollBy(0, desfase);
    }

    if (controles) {
      const [alejar, entero, acercar] = controles.querySelectorAll("button");
      const enMinimo = nueva <= zoom.min + 0.001;
      alejar.disabled = enMinimo;
      acercar.disabled = nueva >= ZOOM_MAX - 0.001;
      entero.textContent = enMinimo ? "Tamaño real" : "Ver todo";
    }
  }

  // Centro de la parte visible del lienzo: el foco de los botones.
  function centroDelLienzo() {
    const caja = $("planoReservas").getBoundingClientRect();
    const alto = window.innerHeight || document.documentElement.clientHeight;
    const arriba = Math.max(caja.top, 0);
    const abajo = Math.min(caja.bottom, alto);
    return { x: caja.left + caja.width / 2, y: arriba < abajo ? (arriba + abajo) / 2 : caja.top };
  }

  function prepararZoom() {
    const lienzo = $("planoReservas");
    const controles = $("planoZoom");

    controles.addEventListener("click", (e) => {
      const boton = e.target.closest("[data-zoom]");
      if (!boton || boton.disabled) return;
      const accion = boton.dataset.zoom;
      let escala = zoom.escala;
      if (accion === "alejar") escala /= ZOOM_PASO;
      else if (accion === "acercar") escala *= ZOOM_PASO;
      else escala = zoom.escala <= zoom.min + 0.001 ? 1 : zoom.min;
      aplicarZoom(escala, centroDelLienzo());
    });

    // Pellizco con dos dedos. Un dedo sigue siendo el arrastre del navegador.
    let pellizco = null;
    let cuadro = 0;
    const distancia = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const medio = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    lienzo.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2 || controles.hidden) return;
      pellizco = { distancia: distancia(e.touches) || 1, escala: zoom.escala };
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    lienzo.addEventListener("touchmove", (e) => {
      if (!pellizco || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const escala = pellizco.escala * distancia(e.touches) / pellizco.distancia;
      const foco = medio(e.touches);
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => aplicarZoom(escala, foco));
    }, { passive: false });

    const soltar = (e) => {
      if (!pellizco || e.touches.length >= 2) return;
      pellizco = null;
      // El dedo que queda al soltar no tiene que elegir ni liberar una mesa.
      zoom.pellizcoHasta = Date.now() + 450;
    };
    lienzo.addEventListener("touchend", soltar);
    lienzo.addEventListener("touchcancel", soltar);

    // Safari en iPhone: sin esto el pellizco también agranda la página entera.
    lienzo.addEventListener("gesturestart", (e) => e.preventDefault());

    lienzo.addEventListener("click", (e) => {
      if (Date.now() < zoom.pellizcoHasta) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Girar el teléfono, o volver a la pestaña «En el plano» (oculta, el lienzo
    // mide 0), cambia cuánto entra: se vuelve a medir. Solo cuenta el ancho; el
    // alto cambia con cada zoom.
    let anchoLienzo = lienzo.clientWidth;
    new ResizeObserver(() => {
      if (lienzo.clientWidth === anchoLienzo) return;
      anchoLienzo = lienzo.clientWidth;
      if (!anchoLienzo) return;
      medirHoja();
      aplicarZoom(zoom.escala);
    }).observe(lienzo);
  }

  function mesaHTML(mesa) {
    const unica = Boolean(mesa.label);
    const nombre = unica ? mesa.label : mesa.code;
    const elegida = estado.elegidas.has(mesa.code);
    const libre = mesa.available;

    const clases = [
      "mesa",
      unica ? "mesa--unica" : "",
      libre ? "" : "mesa--tomada mesa--liberable",
      elegida ? "mesa--elegida" : "",
    ].filter(Boolean).join(" ");

    const lectura = `${nombre} · ${mesa.seat_count} sillas${libre ? "" : " · tomada"}`;

    return `
      <button type="button" class="${clases}"
              style="grid-column:${mesa.pos_x || "auto"};grid-row:${mesa.pos_y || "auto"}"
              data-code="${P.esc(mesa.code)}"
              data-available="${libre ? "1" : "0"}"
              data-lectura="${P.esc(lectura)}"
              aria-pressed="${elegida ? "true" : "false"}"
              title="${libre ? "Elegir mesa" : "Mesa tomada (toca para liberar)"}">
        <span class="mesa__nombre">${P.esc(nombre)}</span>
        <span class="mesa__sillas">${libre ? `${mesa.seat_count} sillas` : "tomada · liberar"}</span>
      </button>`;
  }

  /* El marcador de la cabecera del plano: dice qué mesa se está tocando, igual
     que en la web. En un teléfono el `title` no se ve nunca. */
  let lecturaReloj = null;
  function marcarLectura(texto) {
    const salida = $("planoLectura");
    if (!salida || !texto) return;
    salida.textContent = texto;
    salida.classList.add("plano__lectura--viva");
    clearTimeout(lecturaReloj);
    lecturaReloj = setTimeout(() => salida.classList.remove("plano__lectura--viva"), 2600);
  }

  async function alternar(code, available) {
    if (!available) {
      const evento = eventoActual();
      if (!evento) return;
      const seguro = confirm(
        `⚠️ ¿LIBERAR MESA ${code}?\n\n` +
        `Esta mesa actualmente está tomada/reservada.\n\n` +
        `Al confirmarlo, sus sillas quedarán disponibles de inmediato en el plano para volver a venderse, ` +
        `sin importar si hubo un pago asociado.\n\n` +
        `¿Deseas liberar la mesa ${code}?`
      );
      if (!seguro) return;

      try {
        const res = await P.fn("operaciones", {
          action: "liberar_mesa",
          table_code: code,
          event_id: evento.id,
        });
        alert(res.mensaje || `Mesa ${code} liberada con éxito.`);
        await cargarSalon();
      } catch (err) {
        alert(`Error al liberar mesa: ${err.message}`);
      }
      return;
    }

    if (estado.elegidas.has(code)) estado.elegidas.delete(code);
    else estado.elegidas.add(code);
    pintarPlano();
  }

  function pintarResumenMesas() {
    const elegidas = [...estado.elegidas];
    const lugares = elegidas.reduce((a, code) => {
      const m = estado.mesas.find((x) => x.code === code);
      return a + (m?.seat_count ?? 0);
    }, 0);

    $("resumenMesas").textContent = elegidas.length
      ? `${elegidas.length} mesa(s): ${elegidas.join(", ")} · entran ${lugares} personas`
      : "Ninguna mesa elegida todavía.";
  }

  // ---------- emitir ----------

  const enPlano = () =>
    document.querySelector('.modulo-tab[data-sub="plano"]')?.classList.contains("active");

  async function emitir() {
    setError("");

    const evento = eventoActual();
    if (!evento) return setError("Elige un evento.");

    const nombre = $("rNombre").value.trim();
    const apellido = $("rApellido").value.trim();
    if (!nombre || !apellido) return setError("Faltan el nombre y el apellido del invitado.");

    const personas = Number($("rPersonas").value);
    if (!Number.isFinite(personas) || personas < 1) return setError("Indica cuántas personas son.");

    const motivo = $("rMotivo").value.trim();
    if (motivo.length < 4) {
      return setError("Escribe el motivo: es lo que después explica por qué se regaló una mesa.");
    }

    const codigo = $("rCodigo").value.trim();
    if (!/^\d{3}$/.test(codigo)) return setError("El código de administrador son 3 dígitos.");

    const cuerpo = {
      event_slug: evento.slug,
      nombre, apellido,
      documento: $("rDocumento").value.trim(),
      whatsapp: $("rWhatsapp").value.trim(),
      email: $("rEmail").value.trim(),
      people: personas,
      reason: motivo,
      admin_code: codigo,
    };

    if (enPlano()) {
      if (!estado.elegidas.size) return setError("Elige al menos una mesa en el plano.");
      cuerpo.table_codes = [...estado.elegidas];
    } else {
      const seccion = $("rSeccion").value;
      if (!seccion) return setError("Elige una sección.");
      cuerpo.section_code = seccion;
    }

    $("btnEmitir").disabled = true;
    try {
      const r = await P.fn("courtesy-ticket", cuerpo);
      mostrarResultado(r, nombre, apellido);

      // El código se borra siempre: dejarlo escrito convierte la confirmación en
      // un trámite y una segunda cortesía saldría sola con un clic.
      $("rCodigo").value = "";
      estado.elegidas.clear();
      await cargarSalon();
    } catch (error) {
      setError(error.message);
      $("rCodigo").value = "";
      $("rCodigo").focus();
    } finally {
      $("btnEmitir").disabled = false;
    }
  }

  function mostrarResultado(r, nombre, apellido) {
    const caja = $("resultado");
    const entradas = r.tickets ?? (r.ticket ? [r.ticket] : []);

    caja.hidden = false;
    caja.innerHTML = `
      <h3>Cortesía emitida</h3>
      <p class="hint">
        ${P.esc(`${nombre} ${apellido}`.trim())} ·
        compra N.º ${P.esc(r.order_number ?? "—")} ·
        ${entradas.length} entrada(s)
      </p>
      <div class="table-scroll">
        <table class="data-table data-table--apilable">
          <thead><tr><th>Invitado</th><th>Mesa</th><th>Código</th></tr></thead>
          <tbody>
            ${entradas.map((t, i) => `
              <tr>
                <td data-label="Invitado">${i + 1}</td>
                <td data-label="Mesa">${P.esc(t.table_code ?? "—")}</td>
                <td class="num" data-label="Código">${P.esc(t.code ?? t)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="hint">
        Ya están emitidas y valen en la puerta. Se ven también en Operaciones,
        marcadas como cortesía.
      </p>`;

    caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- arranque ----------

  (async () => {
    if (!await P.exigirAdmin("reservas.html")) return;
    P.montarTabsDeModulo();

    $("rEvento").addEventListener("change", () => cargarSalon().catch((e) => setError(e.message)));
    $("btnEmitir").addEventListener("click", emitir);
    prepararZoom();

    await cargarEventos();
  })();
})();
