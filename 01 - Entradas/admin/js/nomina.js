/* Nómina semanal.

   El panel no calcula sueldos: los pide y los muestra. Cada ajuste viaja con su
   motivo y con el código de administrador, y el servidor decide si entra. Acá no
   se guarda el código en ningún lado ni se compara con nada: se escribe, se
   manda y se olvida.

   Lo cobrado por mesas no aparece en esta pantalla y no alimenta ningún cálculo.
   Son dos circuitos separados. */

(function () {
  "use strict";

  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  const estado = { semanas: [], semana: null, lineas: [], ajuste: null };
  let lista = null;

  // La misma conversión que en Empleados: enteros de centavos, sin pasar por
  // punto flotante en ningún paso.
  function aCentavos(texto) {
    let s = String(texto ?? "").trim().replace(/[^\d.,]/g, "");
    if (!s) return 0;

    if (s.includes(",")) s = s.replace(/\./g, "");
    else if (/\.\d{1,2}$/.test(s)) s = s.replace(".", ",");
    else s = s.replace(/\./g, "");

    const partes = s.split(",");
    return Number(partes[0] || 0) * 100 + Number((partes[1] || "").padEnd(2, "0").slice(0, 2));
  }

  const deCentavos = (cents) => ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
  const dia = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("es") : "—");

  function setError(campo, mensaje) {
    const nodo = document.querySelector(`.error[data-for="${campo}"]`);
    if (nodo) nodo.textContent = mensaje || "";
  }

  // ---------- semanas ----------

  async function cargarSemanas(elegir) {
    const { semanas } = await P.fn("nomina", { action: "semanas" });
    estado.semanas = semanas ?? [];

    $("selectorSemana").innerHTML = estado.semanas.length
      ? estado.semanas.map((s) =>
          `<option value="${s.id}">${dia(s.desde)} — ${dia(s.hasta)}${s.estado === "cerrada" ? " · cerrada" : ""}</option>`
        ).join("")
      : `<option value="">No hay semanas abiertas</option>`;

    const id = elegir ?? estado.semanas[0]?.id;
    if (!id) {
      estado.semana = null;
      $("tablaLineas").innerHTML = `<p class="hint">Abre una semana para empezar.</p>`;
      $("resumenSemana").innerHTML = "";
      $("pieSemana").hidden = true;
      return;
    }

    $("selectorSemana").value = id;
    await verSemana(id);
  }

  async function verSemana(id) {
    const datos = await P.fn("nomina", { action: "semana_ver", id });
    estado.semana = datos.semana;
    estado.lineas = datos.lineas ?? [];

    const cerrada = datos.semana.estado === "cerrada";
    $("avisoCerrada").hidden = !cerrada;
    $("pieSemana").hidden = cerrada;

    const conBono = estado.lineas.filter((l) => l.bono_cents > 0).length;
    $("resumenSemana").innerHTML = [
      ["Empleados", estado.lineas.length],
      ["Total de la semana", P.plata(datos.total_cents)],
      ["Con bono", conBono],
    ].map(([rotulo, valor]) => `
      <div class="kpi">
        <span class="kpi__label">${rotulo}</span>
        <strong class="kpi__value">${P.esc(valor)}</strong>
      </div>`).join("");

    pintarLineas(cerrada);
  }

  function pintarLineas(cerrada) {
    if (!estado.lineas.length) {
      $("tablaLineas").innerHTML = `<p class="hint">Esta semana no tiene ninguna línea.</p>`;
      return;
    }

    const acciones = (l) => cerrada ? "—" : `
      <button type="button" class="btn btn--link" data-ajuste="sueldo" data-id="${l.id}">Sueldo</button>
      <button type="button" class="btn btn--link" data-ajuste="bono" data-id="${l.id}">Bono</button>
      <button type="button" class="btn btn--link" data-ajuste="descuento" data-id="${l.id}">Descuento</button>`;

    // Los ajustes se muestran debajo de cada línea, no en otra pantalla: el
    // motivo de un cambio de sueldo sirve justamente al lado del número.
    const historial = (l) => !l.ajustes?.length ? "" : `
      <ul class="ajustes">
        ${l.ajustes.map((a) => `
          <li>
            <strong>${P.esc(a.tipo)}</strong>
            ${a.valor_cents !== null ? P.plata(a.valor_cents) : `${Number(a.porcentaje)}%`}
            — ${P.esc(a.motivo)}
            <small>${P.esc(a.quien)} · ${P.momento(a.hecho_en)}</small>
          </li>`).join("")}
      </ul>`;

    const cuerpo = estado.lineas.map((l) => `
      <tr>
        <td class="num" data-label="ID">${P.esc(l.codigo ?? "—")}</td>
        <td data-label="Empleado">
          ${P.esc(l.nombre)}
          ${l.documento ? `<br><small>${P.esc(l.documento)}</small>` : ""}
          ${historial(l)}
        </td>
        <td data-label="Área">${P.esc(l.area ?? "—")}</td>
        <td class="num" data-label="Sueldo">${P.plata(l.salario_base_cents)}</td>
        <td class="num" data-label="Bono">
          ${l.bono_cents ? `${P.plata(l.bono_cents)}<br><small>${Number(l.bono_pct)}%</small>` : "—"}
        </td>
        <td class="num" data-label="Descuento">${l.descuento_cents ? `− ${P.plata(l.descuento_cents)}` : "—"}</td>
        <td class="num" data-label="Total"><strong>${P.plata(l.total_cents)}</strong></td>
        <td class="col-acciones" data-label="Acciones">${acciones(l)}</td>
      </tr>`).join("");

    $("tablaLineas").innerHTML = `
      <div class="table-scroll">
        <table class="data-table data-table--apilable">
          <thead><tr>
            <th>ID</th><th>Empleado</th><th>Área</th><th>Sueldo</th>
            <th>Bono</th><th>Descuento</th><th>Total</th><th>Acciones</th>
          </tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
      </div>`;
  }

  // ---------- ajustes ----------

  const ROTULOS = {
    sueldo: {
      titulo: "Cambiar el sueldo de la semana",
      ayuda: "Es el sueldo nuevo, no la diferencia.",
    },
    bono: {
      titulo: "Cambiar el bono",
      ayuda: "Es el porcentaje nuevo sobre el sueldo de la semana.",
    },
    descuento: {
      titulo: "Aplicar un descuento",
      ayuda: "Se suma a los descuentos que ya tenga. Para deshacer uno, carga el mismo monto en negativo.",
    },
  };

  function abrirAjuste(tipo, lineaId) {
    const linea = estado.lineas.find((l) => l.id === lineaId);
    if (!linea) return;

    estado.ajuste = { tipo, lineaId };

    $("tituloAjuste").textContent = ROTULOS[tipo].titulo;
    $("sobreQuien").textContent = `${linea.nombre} · total actual ${P.plata(linea.total_cents)}`;
    $("ayudaMonto").textContent = ROTULOS[tipo].ayuda;

    $("campoMonto").hidden = tipo === "bono";
    $("campoPorcentaje").hidden = tipo !== "bono";

    $("ajusteMonto").value = tipo === "sueldo" ? deCentavos(linea.salario_base_cents) : "";
    $("ajustePorcentaje").value = tipo === "bono" ? (linea.bono_pct ?? "") : "";
    $("ajusteMotivo").value = "";
    $("ajusteCodigo").value = "";

    setError("ajuste", "");
    $("veloAjuste").hidden = false;
    $("ajusteMotivo").focus();
  }

  function cerrarAjuste() {
    estado.ajuste = null;
    $("veloAjuste").hidden = true;
    $("ajusteCodigo").value = "";
  }

  async function confirmarAjuste() {
    if (!estado.ajuste) return;
    const { tipo, lineaId } = estado.ajuste;

    const motivo = $("ajusteMotivo").value.trim();
    if (motivo.length < 5) {
      return setError("ajuste", "Hace falta un motivo: sin él el ajuste no queda justificado.");
    }

    const codigo = $("ajusteCodigo").value.trim();
    if (!/^\d{3}$/.test(codigo)) {
      return setError("ajuste", "El código de administrador son 3 dígitos.");
    }

    const cuerpo = {
      action: "linea_ajustar",
      linea_id: lineaId,
      tipo,
      motivo,
      admin_code: codigo,
    };

    if (tipo === "bono") cuerpo.porcentaje = $("ajustePorcentaje").value;
    else cuerpo.valor_cents = aCentavos($("ajusteMonto").value) * (
      // Un descuento puede venir en negativo para deshacer otro; el signo se
      // toma del texto tal como se escribió.
      tipo === "descuento" && $("ajusteMonto").value.trim().startsWith("-") ? -1 : 1
    );

    setError("ajuste", "");
    $("btnConfirmarAjuste").disabled = true;

    try {
      await P.fn("nomina", cuerpo);
      cerrarAjuste();
      await verSemana(estado.semana.id);
    } catch (error) {
      setError("ajuste", error.message);
      $("ajusteCodigo").value = "";
      $("ajusteCodigo").focus();
    } finally {
      $("btnConfirmarAjuste").disabled = false;
    }
  }

  // ---------- cierre ----------

  async function cerrarSemana() {
    if (!estado.semana) return;

    const codigo = prompt(
      "Cerrar la semana congela sus números: después no entra ningún ajuste.\n\n" +
      "Escribe tu código de administrador de 3 dígitos:",
    );
    if (codigo === null) return;

    try {
      await P.fn("nomina", { action: "semana_cerrar", id: estado.semana.id, admin_code: codigo.trim() });
      await cargarSemanas(estado.semana.id);
    } catch (error) {
      alert(error.message);
    }
  }

  // ---------- arranque ----------

  (async () => {
    if (!await P.exigirAdmin("nomina.html")) return;
    P.montarTabsDeModulo();

    lista = window.EmpleadosLista.montar({
      contenedor: $("listaEmpleados"),
      buscador: $("buscar"),
      casillaRetirados: $("verRetirados"),
      pie: $("pieLista"),
      acciones: (e) =>
        `<a class="btn btn--link" href="ficha.html?id=${e.id}" target="_blank" rel="noopener">Ficha</a>`,
    });

    $("selectorSemana").addEventListener("change", (e) => {
      if (e.target.value) verSemana(e.target.value).catch((err) => alert(err.message));
    });

    $("btnNuevaSemana").addEventListener("click", () => {
      $("formNuevaSemana").hidden = false;

      // Propone la semana en curso, de lunes a domingo: es como se paga acá.
      const hoy = new Date();
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);

      $("semanaDesde").value = lunes.toISOString().slice(0, 10);
      $("semanaHasta").value = domingo.toISOString().slice(0, 10);
    });

    $("btnCancelarSemana").addEventListener("click", () => { $("formNuevaSemana").hidden = true; });

    $("btnAbrirSemana").addEventListener("click", async () => {
      setError("semana", "");
      try {
        const r = await P.fn("nomina", {
          action: "semana_abrir",
          desde: $("semanaDesde").value,
          hasta: $("semanaHasta").value,
        });
        $("formNuevaSemana").hidden = true;
        await cargarSemanas(r.semana.id);
      } catch (error) { setError("semana", error.message); }
    });

    $("btnSincronizar").addEventListener("click", async () => {
      try {
        await P.fn("nomina", { action: "semana_sincronizar", id: estado.semana.id });
        await verSemana(estado.semana.id);
      } catch (error) { alert(error.message); }
    });

    $("btnCerrarSemana").addEventListener("click", cerrarSemana);
    $("btnConfirmarAjuste").addEventListener("click", confirmarAjuste);
    $("btnCancelarAjuste").addEventListener("click", cerrarAjuste);
    $("veloAjuste").addEventListener("click", (e) => {
      if (e.target === $("veloAjuste")) cerrarAjuste();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("veloAjuste").hidden) cerrarAjuste();
    });

    document.addEventListener("click", (e) => {
      const boton = e.target.closest("[data-ajuste]");
      if (boton) abrirAjuste(boton.dataset.ajuste, boton.dataset.id);
    });

    await cargarSemanas();
    await lista.cargar();
  })();
})();
