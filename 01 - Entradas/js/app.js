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

    $("hero").classList.toggle("hidden", n !== 1);
    $("eventoPortada").hidden = n !== 1;
    $("resumen").hidden = n === 1 || !haySeleccion();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("btnComprar").addEventListener("click", () => {
    $("panel-1").scrollIntoView({ behavior: "smooth" });
  });

  // ---------- carga ----------
  async function cargar() {
    const { data: event } = await db
      .from("events")
      .select("id, name, tagline, event_date, venue, cover_image")
      .eq("slug", EVENT_SLUG)
      .maybeSingle();

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

    pintarAreas();
    suscribirRealtime();
  }

  function pintarEvento(event) {
    $("heroTitulo").textContent = event.name;
    const cuando = event.event_date
      ? new Date(event.event_date).toLocaleString("es", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      })
      : "";
    $("heroSubtitulo").textContent = [cuando, event.venue].filter(Boolean).join(" · ");

    if (event.cover_image) {
      const img = $("eventoImagen");
      img.src = event.cover_image;
      img.alt = event.name;
      $("eventoPortada").hidden = false;
    }
    $("eventoTagline").textContent = event.tagline || "";
    $("eventoNombre").textContent = event.name;
    $("eventoFecha").textContent = cuando;
    $("eventoLugar").textContent = event.venue || "";
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
        detalle: "Elegís tu mesa en el plano del salón",
        precio: `Mesa desde ${money(desde)}`,
        tier: "oro",
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
        precio: esPlata ? `Mesa ${money(s.price_cents)}` : `${money(s.price_cents)} por persona`,
        tier: esPlata ? "plata" : "general",
      });
    });

    $("areasGrid").innerHTML = tarjetas.map((t) => `
      <button type="button" class="area-card area-card--${t.tier}" data-area="${esc(t.code)}">
        <div class="area-card__body">
          <span class="badge ${t.tier === "general" ? "badge--general" : "badge--vip"}">
            ${t.tier === "general" ? "GENERAL" : "VIP"}
          </span>
          <h4>${esc(t.label)}</h4>
          <p>${esc(t.detalle)}</p>
          <span class="price">${esc(t.precio)}</span>
        </div>
      </button>
    `).join("");

    $("areasGrid").querySelectorAll("[data-area]").forEach((btn) => {
      btn.addEventListener("click", () => elegirArea(btn.dataset.area));
    });
  }

  function elegirArea(code) {
    state.mesas.clear();
    state.grupoDefinido = false;
    setError("area", "");
    setError("lugar", "");

    if (code === AREA_ORO) {
      state.seccion = { code: AREA_ORO, conPlano: true };
      $("tituloLugar").textContent = "2. Elegí tu mesa";
      $("planoWrap").hidden = false;
      $("sinPlano").hidden = true;
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

  function pintarPlano() {
    const zonas = { A: $("zonaA"), B: $("zonaB"), C: $("zonaC") };
    Object.values(zonas).forEach((z) => (z.innerHTML = ""));

    // La Única vive en su propia sección pero se dibuja en el centro de C.
    const enC = state.tables
      .filter((m) => m.code.startsWith("C") || m.label)
      .sort((a, b) => Number(a.pos_x || 0) - Number(b.pos_x || 0));

    state.tables.forEach((mesa) => {
      const letra = mesa.code[0];
      const destino = zonas[letra] || zonas.C;
      if (!destino) return;
      destino.appendChild(crearMesa(mesa));
    });

    // Orden visual de la fila C por posición
    if (zonas.C) {
      const hijos = [...zonas.C.children].sort(
        (a, b) => Number(a.dataset.posX || 0) - Number(b.dataset.posX || 0),
      );
      hijos.forEach((h) => zonas.C.appendChild(h));
    }
  }

  function crearMesa(mesa) {
    const seccion = state.sections.find((s) => s.id === mesa.section_id);
    const libre = mesa.available;
    const esUnica = Boolean(mesa.label);

    const b = document.createElement("button");
    b.type = "button";
    b.className = "mesa" + (esUnica ? " mesa--unica" : "");
    b.dataset.code = mesa.code;
    b.dataset.posX = mesa.pos_x || 0;
    b.dataset.estado = libre ? "disponible" : "reservado";
    b.dataset.badge = libre
      ? `Disponible · ${mesa.seat_count} sillas · ${money(seccion?.price_cents ?? 0)}`
      : "Reservada";
    b.setAttribute("aria-pressed", "false");
    b.disabled = !libre;
    b.innerHTML = esUnica
      ? `<b>${esc(mesa.label)}</b><small>${mesa.seat_count} sillas</small>`
      : `${esc(mesa.code)}<small>${mesa.seat_count} sillas</small>`;

    b.addEventListener("click", () => {
      const alternar = () => {
        if (state.mesas.has(mesa.code)) state.mesas.delete(mesa.code);
        else {
          state.mesas.set(mesa.code, {
            code: mesa.code,
            seats: mesa.seat_count,
            price_cents: seccion?.price_cents ?? 0,
          });
        }
        b.setAttribute("aria-pressed", state.mesas.has(mesa.code) ? "true" : "false");
        pintarResumen();
      };
      // El primer toque pregunta cuántos son; recién después selecciona.
      if (!state.grupoDefinido) abrirModal(alternar);
      else alternar();
    });

    return b;
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
      ? `Necesitás <em>${necesarias}</em> ${necesarias === 1 ? "mesa" : "mesas"} de ${porMesa} sillas.`
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
      ? `<b>${state.personas}</b> ${state.personas === 1 ? "persona" : "personas"} · necesitás <em>${necesarias}</em> ${necesarias === 1 ? "mesa" : "mesas"}`
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
      $("resumenAviso").textContent = `Elegí ${necesarias} ${necesarias === 1 ? "mesa" : "mesas"} en el plano.`;
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
      event_slug: EVENT_SLUG,
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
