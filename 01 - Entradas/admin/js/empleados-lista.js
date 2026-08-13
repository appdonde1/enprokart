/* La lista de empleados, una sola vez.

   Empleados y Nómina muestran la misma gente, con el mismo buscador por cédula y
   el mismo filtro de retirados. Si fueran dos tablas parecidas terminarían
   diciendo cosas distintas: una mostraría a alguien que la otra ya dio de baja,
   y nadie sabría cuál está bien. Acá se arma una vez y cada módulo le pone sus
   propias acciones.

   No decide nada sobre permisos: la Edge Function `empleados` ya rechazó a quien
   no sea admin antes de devolver una sola fila. */

window.EmpleadosLista = (() => {
  const P = window.PanelBase;

  const DIAS_CORTOS = {
    lunes: "Lu", martes: "Ma", miercoles: "Mi", jueves: "Ju",
    viernes: "Vi", sabado: "Sá", domingo: "Do",
  };

  function diasLegibles(dias) {
    if (!Array.isArray(dias) || !dias.length) return "—";
    return dias.map((d) => DIAS_CORTOS[d] ?? d).join(" ");
  }

  /* Cuánto cobra, en el idioma en que se habla del sueldo acá: "R$ 80,00 por
     día". El monto sale de centavos enteros y se formatea una sola vez. */
  function sueldoLegible(empleado) {
    const unidades = { hora: "por hora", dia: "por día", semana: "por semana", mes: "por mes" };
    const monto = P.plata(empleado.salario_cents);
    const cada = unidades[empleado.salario_unidad] ?? "";
    const bono = empleado.bono_pct ? ` + ${Number(empleado.bono_pct)}%` : "";
    return `${monto} ${cada}${bono}`.trim();
  }

  /* Monta la lista dentro de un contenedor.

     `acciones(empleado)` devuelve el HTML de la última columna; los botones que
     lleven `data-accion` y `data-id` llegan a `alAccionar(accion, id, empleado)`
     por delegación, así que la tabla se puede volver a dibujar sin recablear
     nada. */
  function montar(opciones) {
    const {
      contenedor,
      buscador,
      casillaRetirados,
      pie,
      acciones = () => "",
      alAccionar,
      alCargar,
    } = opciones;

    let filas = [];
    let pidiendo = false;

    async function cargar() {
      if (pidiendo) return;
      pidiendo = true;
      contenedor.innerHTML = `<p class="hint">Cargando…</p>`;

      try {
        const datos = await P.fn("empleados", {
          action: "listar",
          buscar: buscador?.value?.trim() || "",
          incluir_retirados: !!casillaRetirados?.checked,
        });
        filas = datos.empleados ?? [];
        pintar();
        alCargar?.(filas);
      } catch (error) {
        contenedor.innerHTML = `<p class="hint">${P.esc(error.message)}</p>`;
      } finally {
        pidiendo = false;
      }
    }

    function pintar() {
      if (!filas.length) {
        contenedor.innerHTML = `<p class="hint">No hay empleados que mostrar.</p>`;
        if (pie) pie.textContent = "";
        return;
      }

      // Los data-label son los que se ven como rótulo cuando la tabla se apila
      // en un teléfono: sin ellos, las celdas quedan sueltas sin decir de qué son.
      const cuerpo = filas.map((e) => {
        const retirado = e.estado === "retirado";
        return `
          <tr${retirado ? ' class="fila-retirada"' : ""}>
            <td class="num" data-label="ID">${P.esc(e.codigo)}</td>
            <td data-label="Nombre y apellido">
              ${P.esc(`${e.nombre} ${e.apellido}`.trim())}
              ${retirado ? '<span class="etiqueta">retirado</span>' : ""}
              ${e.documento ? `<br><small>${P.esc(e.documento)}</small>` : ""}
            </td>
            <td data-label="Área">${P.esc(e.areas?.nombre ?? "—")}</td>
            <td data-label="Credencial">${P.esc(e.credenciales?.nombre ?? "—")}</td>
            <td data-label="Libra">${P.esc(diasLegibles(e.dias_libres))}</td>
            <td class="num" data-label="Sueldo">${P.esc(sueldoLegible(e))}</td>
            <td class="col-acciones" data-label="Acciones">${acciones(e)}</td>
          </tr>`;
      }).join("");

      contenedor.innerHTML = `
        <div class="table-scroll">
          <table class="data-table data-table--apilable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre y apellido</th>
                <th>Área</th>
                <th>Credencial</th>
                <th>Libra</th>
                <th>Sueldo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${cuerpo}</tbody>
          </table>
        </div>`;

      if (pie) {
        const activos = filas.filter((e) => e.estado === "activo").length;
        const retirados = filas.length - activos;
        pie.textContent = retirados
          ? `${activos} en actividad · ${retirados} retirados`
          : `${activos} en actividad`;
      }
    }

    contenedor.addEventListener("click", (e) => {
      const boton = e.target.closest("[data-accion]");
      if (!boton) return;
      const empleado = filas.find((f) => f.id === boton.dataset.id);
      alAccionar?.(boton.dataset.accion, boton.dataset.id, empleado);
    });

    // El buscador espera a que la persona deje de escribir: sin esto cada tecla
    // sería una llamada a la función y la lista parpadearía.
    let reloj = null;
    buscador?.addEventListener("input", () => {
      clearTimeout(reloj);
      reloj = setTimeout(cargar, 250);
    });
    casillaRetirados?.addEventListener("change", cargar);

    return {
      cargar,
      datos: () => filas,
      buscar: (id) => filas.find((f) => f.id === id),
    };
  }

  return { montar, diasLegibles, sueldoLegible };
})();
