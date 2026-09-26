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
    mesasInfo: {},
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
    ocultarPopover();

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

    const destino = $("planoReservas");
    if (destino && !estado.mesas.length) {
      destino.innerHTML = `<p class="hint" style="padding: 2.5rem; text-align: center;">Cargando mapa del salón...</p>`;
    }

    if (conPlano.length) {
      const { data: mesas } = await P.db
        .from("tables_public")
        .select("id, section_id, code, seat_count, label, available, pos_x, pos_y")
        .in("section_id", conPlano.map((s) => s.id))
        .order("code");
      estado.mesas = mesas ?? [];

      // 1. PINTAR EL PLANO DE INMEDIATO para que aparezca al instante
      pintarPlano();
      ejecutarBusquedaMesa();

      // 2. Cargar en segundo plano la info contextual (comprador, notas) sin congelar la pantalla
      P.fn("operaciones", {
        action: "info_mesas",
        event_id: evento.id,
      }).then((infoRes) => {
        if (infoRes?.info_mesas) {
          estado.mesasInfo = infoRes.info_mesas;
          pintarPlano();
          ejecutarBusquedaMesa();
        }
      }).catch((err) => {
        console.warn("operaciones/info_mesas:", err);
      });
    } else {
      estado.mesas = [];
      estado.mesasInfo = {};
      pintarPlano();
      ejecutarBusquedaMesa();
    }
  }

  // ---------- plano ----------

  /* El mismo agrupado que el plano del comprador: A, B, el fondo y Plata. Las
     mesas únicas viven en secciones propias pero físicamente están en la
     columna del medio de la C, y por eso caen en su grupo. */
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
          <li><i class="hoja__marca hoja__marca--tomada"></i>Tomada · menú contextual / liberar</li>
          <li><i class="hoja__marca hoja__marca--unica"></i>Mesa única</li>
        </ul>
      </div>
      </div>`;

    destino.querySelectorAll("[data-code]").forEach((boton) => {
      const code = boton.dataset.code;
      const isAvailable = boton.dataset.available === "1";

      boton.addEventListener("click", (e) => {
        if (!isAvailable) {
          // Si está tomada, abrir el menú contextual anclado
          mostrarPopover(boton, code, true);
        } else {
          alternar(code, true);
        }
      });

      // Menú contextual en clic derecho
      boton.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        mostrarPopover(boton, code, true);
      });

      // Hover / foco para lectura y popover
      const entrar = () => {
        marcarLectura(boton.dataset.lectura);
        mostrarPopover(boton, code, false);
      };
      const salir = () => {
        programarOcultarPopover();
      };

      boton.addEventListener("pointerenter", entrar);
      boton.addEventListener("pointerleave", salir);
      boton.addEventListener("focus", entrar);
      boton.addEventListener("blur", salir);
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
    const info = estado.mesasInfo[mesa.code];

    const clases = [
      "mesa",
      unica ? "mesa--unica" : "",
      libre ? "" : "mesa--tomada mesa--liberable",
      elegida ? "mesa--elegida" : "",
    ].filter(Boolean).join(" ");

    let lectura = `${nombre} · ${mesa.seat_count} sillas`;
    if (info) {
      lectura = `${nombre} · ${info.comprador} · ${info.descripcion || (info.is_courtesy ? "Cortesía" : "Tomada")}`;
    } else if (!libre) {
      lectura += " · Tomada";
    }

    return `
      <button type="button" class="${clases}"
              style="grid-column:${mesa.pos_x || "auto"};grid-row:${mesa.pos_y || "auto"}"
              data-code="${P.esc(mesa.code)}"
              data-available="${libre ? "1" : "0"}"
              data-lectura="${P.esc(lectura)}"
              aria-pressed="${elegida ? "true" : "false"}"
              title="${libre ? "Elegir mesa" : `Mesa tomada (${info?.comprador ? P.esc(info.comprador) : "clic para ver"})`}">
        <span class="mesa__nombre">${P.esc(nombre)}</span>
        <span class="mesa__sillas">${libre ? `${mesa.seat_count} sillas` : (info?.comprador ? P.esc(info.comprador.split(" ")[0]) : "tomada")}</span>
      </button>`;
  }

  // =========================================================
  // Menú Contextual / Tooltip flotante para mesas
  // =========================================================

  let popoverTimer = null;
  let popoverFijo = false;

  function programarOcultarPopover() {
    if (popoverFijo) return;
    clearTimeout(popoverTimer);
    popoverTimer = setTimeout(() => {
      ocultarPopover();
    }, 180);
  }

  function ocultarPopover() {
    popoverFijo = false;
    const pop = $("mesaPopover");
    if (pop) {
      pop.hidden = true;
      pop.setAttribute("aria-hidden", "true");
    }
  }

  function mostrarPopover(boton, code, fijar = false) {
    clearTimeout(popoverTimer);
    const pop = $("mesaPopover");
    if (!pop) return;

    if (fijar) popoverFijo = true;

    const mesa = estado.mesas.find((m) => m.code === code);
    if (!mesa) return;

    const info = estado.mesasInfo[code];
    const libre = mesa.available;
    const seccion = estado.secciones.find((s) => s.id === mesa.section_id);

    // Cabecera
    $("popoverCodigo").textContent = `Mesa ${mesa.label || mesa.code}`;
    $("popoverSeccion").textContent = `${seccion?.label || "Salón"} · ${mesa.seat_count} sillas`;

    const badge = $("popoverEstadoBadge");
    if (libre) {
      badge.textContent = "Disponible";
      badge.className = "badge badge--ok";
    } else if (info?.is_courtesy) {
      badge.textContent = "Cortesía";
      badge.className = "badge badge--vip";
    } else if (info?.estado === "paid") {
      badge.textContent = "Pagada";
      badge.className = "badge badge--ok";
    } else if (info?.estado === "pending") {
      badge.textContent = "Pendiente";
      badge.className = "badge badge--espera";
    } else {
      badge.textContent = "Tomada";
      badge.className = "badge";
    }

    // Cuerpo
    const cuerpo = $("popoverCuerpo");
    const descActual = info?.descripcion || info?.motivo || "";

    if (info) {
      cuerpo.innerHTML = `
        <div class="mesa-popover__fila">
          <span class="mesa-popover__etiqueta">A nombre de</span>
          <span class="mesa-popover__valor"><strong>${P.esc(info.comprador)}</strong></span>
        </div>
        <div class="mesa-popover__fila">
          <div class="mesa-popover__fila-cabecera">
            <span class="mesa-popover__etiqueta">Descripción / Nota</span>
            <button type="button" class="btn-editar-nota" id="btnAbrirEditorNota">
              ${descActual ? "✏️ Editar" : "+ Agregar nota"}
            </button>
          </div>
          <div id="contenedorNotaMesa">
            ${descActual ? `<div class="mesa-popover__motivo">${P.esc(descActual)}</div>` : `<small class="hint" style="margin:2px 0 0;">Sin descripción</small>`}
          </div>
        </div>
        <div class="mesa-popover__fila">
          <span class="mesa-popover__etiqueta">Detalle</span>
          <span class="mesa-popover__valor">
            ${info.personas || mesa.seat_count} personas
            ${info.total_entradas ? `· ${info.total_entradas} entradas (${info.entradas_usadas || 0} validadas)` : ""}
            ${info.order_number ? `· Orden #${P.esc(info.order_number)}` : ""}
          </span>
        </div>
        ${info.documento || info.whatsapp ? `
          <div class="mesa-popover__fila">
            <span class="mesa-popover__etiqueta">Contacto</span>
            <span class="mesa-popover__valor">${P.esc(info.documento ? `CI: ${info.documento}` : "")} ${P.esc(info.whatsapp ? `· WA: ${info.whatsapp}` : "")}</span>
          </div>
        ` : ""}
      `;
    } else if (!libre) {
      cuerpo.innerHTML = `
        <div class="mesa-popover__fila">
          <span class="mesa-popover__etiqueta">Estado</span>
          <span class="mesa-popover__valor">Mesa reservada o tomada en el sistema.</span>
        </div>
        <div class="mesa-popover__fila">
          <div class="mesa-popover__fila-cabecera">
            <span class="mesa-popover__etiqueta">Descripción / Nota</span>
            <button type="button" class="btn-editar-nota" id="btnAbrirEditorNota">+ Agregar nota</button>
          </div>
          <div id="contenedorNotaMesa">
            <small class="hint" style="margin:2px 0 0;">Sin descripción</small>
          </div>
        </div>
      `;
    } else {
      cuerpo.innerHTML = `
        <div class="mesa-popover__fila">
          <span class="mesa-popover__etiqueta">Estado</span>
          <span class="mesa-popover__valor">Mesa libre para venta o cortesía.</span>
        </div>
        <div class="mesa-popover__fila">
          <span class="mesa-popover__etiqueta">Capacidad</span>
          <span class="mesa-popover__valor">${mesa.seat_count} personas</span>
        </div>
        <div class="mesa-popover__fila">
          <div class="mesa-popover__fila-cabecera">
            <span class="mesa-popover__etiqueta">Nota de mesa</span>
            <button type="button" class="btn-editar-nota" id="btnAbrirEditorNota">+ Agregar nota</button>
          </div>
          <div id="contenedorNotaMesa">
            ${descActual ? `<div class="mesa-popover__motivo">${P.esc(descActual)}</div>` : `<small class="hint" style="margin:2px 0 0;">Sin nota</small>`}
          </div>
        </div>
      `;
    }

    // Configurar editor interactivo de notas
    const btnAbrirEditor = $("btnAbrirEditorNota");
    if (btnAbrirEditor) {
      btnAbrirEditor.onclick = (e) => {
        e.stopPropagation();
        popoverFijo = true; // Mantener abierto mientras se edita
        const contenedor = $("contenedorNotaMesa");
        contenedor.innerHTML = `
          <div class="mesa-popover__editor-nota">
            <input type="text" id="popNotaInput" value="${P.esc(descActual)}" placeholder="Ej: Invitado VIP, mesa junta, etc." maxlength="160" />
            <div class="mesa-popover__editor-nota-acciones">
              <button type="button" class="btn btn--sm btn--primary" id="btnGuardarNotaMesa">Guardar</button>
              <button type="button" class="btn btn--sm btn--ghost" id="btnCancelarNotaMesa">Cancelar</button>
            </div>
          </div>
        `;
        const input = $("popNotaInput");
        input.focus();
        input.select();

        $("btnCancelarNotaMesa").onclick = () => mostrarPopover(boton, code, true);

        $("btnGuardarNotaMesa").onclick = async () => {
          const nuevaNota = input.value.trim();
          const evento = eventoActual();
          if (!evento) return;

          $("btnGuardarNotaMesa").disabled = true;
          $("btnGuardarNotaMesa").textContent = "Guardando...";

          try {
            await P.fn("operaciones", {
              action: "guardar_nota_mesa",
              event_id: evento.id,
              table_code: code,
              notes: nuevaNota,
            });

            if (!estado.mesasInfo[code]) {
              estado.mesasInfo[code] = {
                table_code: code,
                comprador: "Nota asignada",
                descripcion: nuevaNota,
                motivo: nuevaNota,
                is_courtesy: false,
              };
            } else {
              estado.mesasInfo[code].descripcion = nuevaNota;
              estado.mesasInfo[code].motivo = nuevaNota;
            }

            // Actualizar lectura del botón en el mapa
            boton.dataset.lectura = `${mesa.label || mesa.code} · ${estado.mesasInfo[code].comprador} · ${nuevaNota || "Sin descripción"}`;

            mostrarPopover(boton, code, true);
          } catch (err) {
            alert(`Error al guardar descripción: ${err.message}`);
            mostrarPopover(boton, code, true);
          }
        };
      };
    }

    // Acciones
    const acciones = $("popoverAcciones");
    if (!libre) {
      acciones.innerHTML = `
        <button type="button" class="btn btn--sm btn--danger" id="popBtnLiberar">
          🔓 Liberar mesa
        </button>
        <button type="button" class="btn btn--sm btn--ghost" id="popBtnCopiar">
          📋 Copiar
        </button>
      `;
      $("popBtnLiberar").onclick = () => alternar(code, false);
      $("popBtnCopiar").onclick = () => {
        const texto = `Mesa ${mesa.code}: ${info?.comprador || "Tomada"}${info?.motivo ? ` (${info.motivo})` : ""}`;
        navigator.clipboard?.writeText(texto);
        $("popBtnCopiar").textContent = "✓ Copiado";
        setTimeout(() => { $("popBtnCopiar").textContent = "📋 Copiar"; }, 1500);
      };
    } else {
      const elegida = estado.elegidas.has(code);
      acciones.innerHTML = `
        <button type="button" class="btn btn--sm ${elegida ? "btn--ghost" : "btn--primary"}" id="popBtnElegir">
          ${elegida ? "✕ Deseleccionar" : "✓ Seleccionar mesa"}
        </button>
      `;
      $("popBtnElegir").onclick = () => {
        alternar(code, true);
        ocultarPopover();
      };
    }

    // Posicionamiento inteligente
    pop.hidden = false;
    pop.setAttribute("aria-hidden", "false");

    const r = boton.getBoundingClientRect();
    const caja = pop.querySelector(".mesa-popover__caja");
    const popW = caja.offsetWidth || 280;
    const popH = caja.offsetHeight || 180;

    let left = r.left + r.width / 2 - popW / 2;
    if (left < 12) left = 12;
    if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;

    let top = r.top - popH - 10;
    if (top < 10) {
      // Si no cabe arriba, ponerlo abajo de la mesa
      top = r.bottom + 10;
    }

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // =========================================================
  // Buscador de mesas e invitados en el plano
  // =========================================================

  function prepararBuscadorPlano() {
    const input = $("buscarMesaPlano");
    const btnLimpiar = $("btnLimpiarBuscarMesa");
    if (!input) return;

    input.addEventListener("input", ejecutarBusquedaMesa);
    btnLimpiar.addEventListener("click", () => {
      input.value = "";
      ejecutarBusquedaMesa();
      input.focus();
    });

    // Cerrar popover al hacer clic fuera o presionar Escape
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#mesaPopover") && !e.target.closest(".mesa")) {
        ocultarPopover();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") ocultarPopover();
    });

    // Mantener popover si el puntero entra en él
    const pop = $("mesaPopover");
    if (pop) {
      pop.addEventListener("pointerenter", () => clearTimeout(popoverTimer));
      pop.addEventListener("pointerleave", programarOcultarPopover);
    }
  }

  function normalizarCodigo(str) {
    return (str || "").toLowerCase().replace(/\bmesa\s*/g, "").replace(/[-_ ]/g, "").trim();
  }

  function ejecutarBusquedaMesa() {
    const input = $("buscarMesaPlano");
    const resEl = $("resultadoBuscarMesa");
    const btnLimpiar = $("btnLimpiarBuscarMesa");
    if (!input || !resEl) return;

    const raw = input.value.trim().toLowerCase();
    const compact = normalizarCodigo(raw);
    btnLimpiar.hidden = !raw;

    const lienzo = $("planoReservas");
    const hoja = lienzo?.querySelector(".hoja");
    if (!hoja) return;

    // Limpiar clases previas
    hoja.querySelectorAll(".mesa").forEach((btn) => {
      btn.classList.remove("mesa--busqueda-activa", "mesa--resaltada");
    });

    if (!raw) {
      hoja.classList.remove("hoja--filtrada");
      resEl.textContent = "";
      ocultarPopover();
      return;
    }

    hoja.classList.add("hoja--filtrada");

    const coincidencias = [];

    hoja.querySelectorAll("[data-code]").forEach((boton) => {
      const code = boton.dataset.code;
      const codeCompact = normalizarCodigo(code);
      const info = estado.mesasInfo[code];
      const comprador = (info?.comprador || "").toLowerCase();
      const motivo = (info?.motivo || info?.descripcion || "").toLowerCase();

      // Coincidencia por código de mesa (ej. "p11", "P-11", "11", "p 11")
      // o por nombre del comprador o motivo
      const coincideCodigo = codeCompact === compact || codeCompact.includes(compact) || (code && code.toLowerCase().includes(raw));
      const coincideComprador = comprador.includes(raw);
      const coincideMotivo = motivo.includes(raw);

      if (coincideCodigo || coincideComprador || coincideMotivo) {
        boton.classList.add("mesa--busqueda-activa", "mesa--resaltada");
        coincidencias.push({ boton, code, info });
      }
    });

    if (!coincidencias.length) {
      resEl.textContent = "0 mesas encontradas";
      ocultarPopover();
      return;
    }

    resEl.textContent = coincidencias.length === 1
      ? `1 mesa encontrada (${coincidencias[0].code}${coincidencias[0].info?.comprador ? ` · ${coincidencias[0].info.comprador}` : ""})`
      : `${coincidencias.length} mesas encontradas`;

    // Hacer scroll suave hacia la primera coincidencia y mostrar su popover
    const primera = coincidencias[0].boton;
    primera.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    mostrarPopover(primera, coincidencias[0].code, false);
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

    if (estado.elegidas.has(code)) {
      estado.elegidas.delete(code);
    } else {
      estado.elegidas.add(code);
    }
    pintarPlano();
  }

  function sincronizarPersonasPlano() {
    const inp = $("rPersonas");
    const nota = $("rPersonasNota");
    if (!inp) return;

    if (!enPlano()) {
      inp.readOnly = false;
      inp.placeholder = "Ej: 1";
      if (!inp.value || Number(inp.value) < 1) inp.value = "1";
      if (nota) nota.textContent = "";
      return;
    }

    const elegidas = [...estado.elegidas];
    const lugares = elegidas.reduce((a, code) => {
      const m = estado.mesas.find((x) => x.code === code);
      return a + (m?.seat_count ?? 0);
    }, 0);

    inp.readOnly = true;
    if (elegidas.length > 0) {
      inp.value = lugares;
      if (nota) nota.textContent = `(${lugares} sillas en ${elegidas.length} mesa/s · mesa completa)`;
    } else {
      inp.value = "";
      inp.placeholder = "Selecciona mesa en el plano";
      if (nota) nota.textContent = "(Se define por las sillas de la mesa)";
    }
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

    sincronizarPersonasPlano();
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

    let personas = Number($("rPersonas").value);

    if (enPlano()) {
      if (!estado.elegidas.size) return setError("Elige al menos una mesa en el plano.");
      const elegidas = [...estado.elegidas];
      const lugares = elegidas.reduce((a, code) => {
        const m = estado.mesas.find((x) => x.code === code);
        return a + (m?.seat_count ?? 0);
      }, 0);
      personas = lugares; // Solo mesas completas: se emiten todas las sillas de las mesas
    } else {
      if (!Number.isFinite(personas) || personas < 1) return setError("Indica cuántas personas son.");
    }

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
    P.montarTabsDeModulo(() => sincronizarPersonasPlano());
    sincronizarPersonasPlano();

    $("rEvento").addEventListener("change", () => cargarSalon().catch((e) => setError(e.message)));
    $("btnEmitir").addEventListener("click", emitir);
    prepararZoom();
    prepararBuscadorPlano();

    await cargarEventos();
  })();
})();
