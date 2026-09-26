/* Tabla de operaciones: qué se vendió, a quién y quién validó cada entrada.

   Los datos vienen de la Edge Function `operaciones`, no de leer tablas desde
   el navegador: la cédula del comprador no es legible desde acá por diseño, y
   la función la entrega solo después de confirmar que quien pregunta es admin. */

(() => {
  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  let filas = [];

  const ESTADOS = {
    paid: ["Pagada", "ok"],
    pending: ["Pendiente", "espera"],
    expired: ["Vencida", "gris"],
    failed: ["Fallida", "mal"],
    canceled: ["Cancelada", "gris"],
  };

  function pintarResumen(r) {
    $("resumen").innerHTML = [
      ["Compras", r.compras],
      ["Pagadas", r.pagadas],
      ["Recaudado", P.plata(r.recaudado_cents)],
      ["Entradas emitidas", r.entradas],
      ["Entradas validadas", r.validadas],
    ].map(([rotulo, valor]) => `
      <div class="kpi">
        <span class="kpi__label">${rotulo}</span>
        <strong class="kpi__value">${P.esc(valor)}</strong>
      </div>
    `).join("");
  }

  function pintarSinEntregar(pendientes) {
    const caja = $("alertaSinEntregar");
    if (!pendientes.length) { caja.hidden = true; return; }

    caja.hidden = false;
    $("listaSinEntregar").innerHTML = pendientes.map((f) => `
      <p class="sin-entregar">
        <strong>Compra #${P.esc(f.order_number)}</strong> ·
        ${P.esc(f.comprador)} · ${P.esc(f.personas)} persona(s) ·
        ${P.plata(f.monto_cents)} · pagada ${P.momento(f.pagada)}
      </p>
    `).join("");
  }

  /* Una fila por compra, y debajo el detalle de quién validó cada entrada.
     Se muestra desplegado porque el detalle de validación es justamente el
     dato que se busca cuando alguien reclama en la puerta. */
  function pintarTabla() {
    const rawBusca = $("buscar").value.trim().toLowerCase();
    const compactBusca = rawBusca.replace(/\bmesa\s*/g, "").replace(/[-_ ]/g, "");

    const visibles = rawBusca
      ? filas.filter((f) => {
        const texto = `${f.comprador} ${f.documento ?? ""} ${f.order_number} ${f.mesas} ${f.seccion}`.toLowerCase();
        const mesasCompact = (f.mesas || "").toLowerCase().replace(/[-_ ]/g, "");
        const coincideTexto = texto.includes(rawBusca);
        const coincideMesa = compactBusca && mesasCompact && (mesasCompact === compactBusca || mesasCompact.includes(compactBusca));
        return coincideTexto || coincideMesa;
      })
      : filas;

    if (!visibles.length) {
      $("tablaOperaciones").innerHTML =
        `<tbody><tr><td class="vacio">No hay operaciones que mostrar.</td></tr></tbody>`;
      $("pieTabla").textContent = "";
      return;
    }

    $("tablaOperaciones").innerHTML = `
      <thead>
        <tr>
          <th>N.º</th>
          <th>Comprador</th>
          <th>Cédula</th>
          <th>Pers.</th>
          <th>Sección / mesas</th>
          <th>Monto</th>
          <th>Transacción</th>
          <th>Entradas</th>
          <th>Validaciones</th>
          <th>Acción</th>
        </tr>
      </thead>
      <tbody>
        ${visibles.map((f) => {
          const [rotulo, tono] = ESTADOS[f.estado] ?? [f.estado, "gris"];
          const validaciones = f.validaciones.length
            ? f.validaciones.map((v) => `
                <span class="validacion">
                  <b>${P.esc(v.quien)}</b> · ${P.momento(v.cuando)}
                  ${v.mesa ? `· ${P.esc(v.mesa)}` : ""}
                </span>`).join("")
            : `<span class="validacion validacion--nadie">Sin validar</span>`;

          // Acción de liberación: para cualquier reserva que no esté ya cancelada
          const accionHtml = f.estado === "canceled"
            ? `<span class="etiqueta etiqueta--gris">liberada</span>`
            : `<button type="button" class="btn btn--sm btn--danger btn-liberar"
                       data-id="${P.esc(f.order_id)}"
                       data-num="${P.esc(f.order_number)}"
                       data-comprador="${P.esc(f.comprador)}"
                       data-mesas="${P.esc(f.mesas || f.seccion)}"
                       title="Liberar mesas/sillas y cancelar reserva">
                 Liberar
               </button>`;

          return `
            <tr${f.sin_entregar ? ' class="fila-alerta"' : ""}>
              <td class="num" data-label="N.º">#${P.esc(f.order_number)}</td>
              <td data-label="Comprador">
                ${P.esc(f.comprador)}
                ${f.es_cortesia ? '<span class="etiqueta">cortesía</span>' : ""}
              </td>
              <!-- El documento lo aporta la pasarela al aprobarse el pago, así
                   que una compra sin pagar todavía no lo tiene. -->
              <td class="num" data-label="Cédula">${f.documento
                ? P.esc(f.documento)
                : '<span class="vacio-celda">sin pago aún</span>'}</td>
              <td class="num" data-label="Personas">${P.esc(f.personas)}</td>
              <td data-label="Sección">${P.esc(f.seccion)}${f.mesas ? `<br><small>${P.esc(f.mesas)}</small>` : ""}</td>
              <td class="num" data-label="Monto">${P.plata(f.monto_cents)}</td>
              <td data-label="Transacción">
                <span class="estado estado--${tono}">${P.esc(rotulo)}</span><br>
                <small>${P.momento(f.pagada ?? f.iniciada)}</small>
              </td>
              <td class="num" data-label="Entradas">${P.esc(f.entradas_usadas)}/${P.esc(f.entradas_emitidas)}</td>
              <td class="col-validaciones" data-label="Validaciones">${validaciones}</td>
              <td class="col-acciones" data-label="Acción">${accionHtml}</td>
            </tr>`;
        }).join("")}
      </tbody>`;

    // Enganchar botones de liberación
    $("tablaOperaciones").querySelectorAll(".btn-liberar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { id, num, comprador, mesas } = btn.dataset;
        const seguro = confirm(
          `⚠️ ¿LIBERAR RESERVA #${num}?\n\n` +
          `Comprador: ${comprador}\n` +
          `Lugar: ${mesas}\n\n` +
          `Esta acción liberará de inmediato las mesas/sillas en el plano para volver a venderse, ` +
          `invalidará los tickets emitidos y cancelará la reserva, sin importar el estado del dinero.\n\n` +
          `¿Deseas continuar?`
        );
        if (!seguro) return;

        btn.disabled = true;
        btn.textContent = "Liberando...";
        try {
          const res = await P.fn("operaciones", {
            action: "liberar_reserva",
            order_id: id,
          });
          alert(res.mensaje || `Reserva #${num} liberada exitosamente.`);
          await cargar();
        } catch (err) {
          alert(`Error al liberar reserva: ${err.message}`);
          btn.disabled = false;
          btn.textContent = "Liberar";
        }
      });
    });

    $("pieTabla").textContent =
      `${visibles.length} operación(es)${busca ? ` de ${filas.length}` : ""}.`;
  }

  async function cargar() {
    const evento = $("filtroEvento").value;
    const estado = $("filtroEstado").value;

    $("tablaOperaciones").innerHTML =
      `<tbody><tr><td class="vacio">Cargando...</td></tr></tbody>`;

    try {
      const d = await P.fn("operaciones", {
        event_id: evento || undefined,
        status: estado || undefined,
      });
      filas = d.operaciones ?? [];
      pintarResumen(d.resumen ?? {});
      pintarSinEntregar(filas.filter((f) => f.sin_entregar));
      pintarTabla();
    } catch (error) {
      $("tablaOperaciones").innerHTML =
        `<tbody><tr><td class="vacio">${P.esc(error.message)}</td></tr></tbody>`;
    }
  }

  (async () => {
    if (!await P.exigirAdmin("operaciones.html")) return;

    // Todos los eventos, abiertos y cerrados: una auditoría mira hacia atrás.
    try {
      const { eventos } = await P.fn("operaciones", { action: "eventos" });
      $("filtroEvento").innerHTML = `<option value="">Todos los eventos</option>` +
        eventos.map((e) => {
          const fecha = e.event_date ? new Date(e.event_date).toLocaleDateString("es") : "";
          const cerrado = e.status !== "published" ? " · cerrado" : "";
          return `<option value="${P.esc(e.id)}">${P.esc(e.name)} ${fecha}${cerrado}</option>`;
        }).join("");
    } catch { /* si falla, queda el filtro en "todos" */ }

    $("filtroEvento").addEventListener("change", cargar);
    $("filtroEstado").addEventListener("change", cargar);
    $("buscar").addEventListener("input", pintarTabla);

    await cargar();
  })();
})();
