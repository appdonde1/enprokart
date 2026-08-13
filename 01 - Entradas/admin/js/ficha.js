/* La ficha imprimible de un empleado.

   Los datos vienen de la Edge Function, no de la lista que quedó cargada en la
   otra pestaña: la ficha se abre sola en `ficha.html?id=…` y tiene que valer
   igual si alguien guarda el enlace. Como cualquier otra lectura de un legajo,
   pasa por el control de rol del servidor.

   Lo que se ve en pantalla es exactamente lo que sale por la impresora. La hoja
   la define `css/ficha.css`. */

(function () {
  "use strict";

  const P = window.PanelBase;

  const DIAS = {
    lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves",
    viernes: "Viernes", sabado: "Sábado", domingo: "Domingo",
  };

  const UNIDADES = { hora: "por hora", dia: "por día", semana: "por semana", mes: "por mes" };
  const JORNADAS = { hora: 0, dia: 1, semana: 6, mes: 30 };

  const fecha = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("es") : "—");
  const oNada = (valor) => (valor ? P.esc(valor) : "—");

  function dato(rotulo, valor, clases = "") {
    return `
      <div class="dato ${clases}">
        <dt>${rotulo}</dt>
        <dd>${valor}</dd>
      </div>`;
  }

  function sueldo(e, horasJornada) {
    const monto = P.plata(e.salario_cents);
    const cada = UNIDADES[e.salario_unidad] ?? "";
    if (!e.salario_cents) return "Sin cargar";

    let texto = `${monto} ${cada}`;
    if (e.salario_unidad !== "hora") {
      const porHora = Math.round(e.salario_cents / (JORNADAS[e.salario_unidad] * horasJornada));
      texto += ` · ${P.plata(porHora)} por hora con jornada de ${horasJornada} h`;
    }
    return P.esc(texto);
  }

  function pintar(e, horasJornada) {
    const nombre = `${e.nombre} ${e.apellido}`.trim();
    const dias = (e.dias_libres ?? []).map((d) => DIAS[d] ?? d).join(", ");
    const retirado = e.estado === "retirado";

    document.title = `${nombre} · Ficha · Pro Kart`;

    document.getElementById("hoja").innerHTML = `
      <header class="hoja__encabezado">
        <div class="hoja__marca">
          <img src="../Logo Prokart.png" alt="" />
          <div>
            <strong>Pro Kart</strong>
            <span>Ficha del empleado</span>
          </div>
        </div>
        <div class="hoja__codigo">
          ${P.esc(e.codigo)}
          <small>Legajo</small>
        </div>
      </header>

      <h1 class="hoja__nombre">${P.esc(nombre)}</h1>
      <p class="hoja__cargo">
        ${oNada(e.credenciales?.nombre)}${e.areas?.nombre ? ` · ${P.esc(e.areas.nombre)}` : ""}
        <span class="hoja__estado">${retirado ? "retirado" : "en actividad"}</span>
      </p>

      <section class="bloque">
        <h2 class="bloque__titulo">Identificación</h2>
        <dl class="datos">
          ${dato("Cédula", oNada(e.documento))}
          ${dato("Fecha de nacimiento", fecha(e.fecha_nacimiento))}
          ${dato("Fecha de ingreso", fecha(e.fecha_ingreso))}
          ${dato("Acceso al panel", e.staff_id ? "Sí" : "No")}
        </dl>
      </section>

      <section class="bloque">
        <h2 class="bloque__titulo">Contacto</h2>
        <dl class="datos">
          ${dato("Teléfono", oNada(e.telefono))}
          ${dato("Correo", oNada(e.email))}
          ${dato("Dirección", oNada(e.direccion), "dato--ancho")}
        </dl>
      </section>

      <section class="bloque">
        <h2 class="bloque__titulo">Trabajo</h2>
        <dl class="datos">
          ${dato("Área", oNada(e.areas?.nombre))}
          ${dato("Credencial", oNada(e.credenciales?.nombre))}
          ${dato("Días que libra", dias ? P.esc(dias) : "Ninguno fijo", "dato--ancho")}
          ${dato("Sueldo", sueldo(e, horasJornada), "dato--ancho dato--fuerte")}
          ${e.bono_pct ? dato("Bono", `${P.esc(Number(e.bono_pct))} % sobre el sueldo`) : ""}
          ${e.codigo_reloj ? dato("Código del captahuellas", P.esc(e.codigo_reloj)) : ""}
        </dl>
      </section>

      ${retirado ? `
        <section class="bloque">
          <h2 class="bloque__titulo">Retiro</h2>
          <dl class="datos">
            ${dato("Fecha de retiro", fecha(e.fecha_retiro))}
            ${dato("Motivo", oNada(e.motivo_retiro), "dato--ancho")}
          </dl>
        </section>` : ""}

      <div class="firmas">
        <p class="firma">Firma del empleado</p>
        <p class="firma">Firma de la empresa</p>
      </div>

      <footer class="hoja__pie">
        <span>${P.esc(e.codigo)} · ${P.esc(e.documento ?? "sin cédula cargada")}</span>
        <span>Impresa el ${new Date().toLocaleDateString("es")}</span>
      </footer>`;
  }

  (async () => {
    if (!await P.exigirAdmin("ficha.html")) return;

    const id = new URLSearchParams(location.search).get("id");
    const hoja = document.getElementById("hoja");

    if (!id) {
      hoja.innerHTML = `<p class="hint-plano">Falta el empleado. Se abre desde la lista de Empleados.</p>`;
      return;
    }

    try {
      const datos = await P.fn("empleados", { action: "ficha", id });
      pintar(datos.empleado, datos.horas_jornada ?? 8);
    } catch (error) {
      hoja.innerHTML = `<p class="hint-plano">${P.esc(error.message)}</p>`;
      return;
    }

    document.getElementById("btnImprimir").addEventListener("click", () => window.print());
  })();
})();
