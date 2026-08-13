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

  /* El mismo agrupado que el plano del comprador: A, B y todo lo demás al
     fondo. Las mesas únicas viven en secciones propias pero físicamente están
     en la columna del medio de la C. */
  function agrupar() {
    const por = { A: [], B: [], C: [] };
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

    const g = agrupar();
    const bloque = (mesas, nombre) => mesas.length ? `
      <section class="salon-seccion" style="--columnas:${columnasDe(mesas)}">
        <header class="salon-seccion__head">
          <h3>${P.esc(nombre)}</h3>
          <span class="salon-seccion__dato">${mesas.filter((m) => m.available).length} libres de ${mesas.length}</span>
        </header>
        <div class="salon-grid">${mesas.map(mesaHTML).join("")}</div>
      </section>` : "";

    destino.innerHTML = `
      <p class="salon-tarima" aria-hidden="true"><span>Tarima</span></p>
      <div class="salon-mapa">
        ${bloque(g.A, "Sección A")}
        ${bloque(g.B, "Sección B")}
      </div>
      ${bloque(g.C, "Sección C")}`;

    destino.querySelectorAll("[data-code]").forEach((boton) => {
      boton.addEventListener("click", () => alternar(boton.dataset.code));
    });

    pintarResumenMesas();
  }

  function mesaHTML(mesa) {
    const nombre = mesa.label || mesa.code;
    const elegida = estado.elegidas.has(mesa.code);

    return `
      <button type="button"
              class="mesa-pick ${elegida ? "mesa-pick--elegida" : ""} ${mesa.available ? "" : "mesa-pick--tomada"}"
              style="grid-column:${mesa.pos_x || "auto"};grid-row:${mesa.pos_y || "auto"}"
              data-code="${P.esc(mesa.code)}"
              aria-pressed="${elegida ? "true" : "false"}"
              ${mesa.available ? "" : "disabled"}>
        <span class="mesa-pick__nombre">${P.esc(nombre)}</span>
        <span class="mesa-pick__sillas">${mesa.available ? `${mesa.seat_count} sillas` : "tomada"}</span>
      </button>`;
  }

  function alternar(code) {
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

    await cargarEventos();
  })();
})();
