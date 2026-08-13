/* Empleados: legajos, catálogos y carga de marcaciones.

   Nada de acá lee ni escribe tablas directamente: `empleados` no tiene ningún
   permiso para el navegador porque guarda cédulas, direcciones y sueldos. Todo
   pasa por la Edge Function, que vuelve a verificar el rol en cada llamada.

   El dinero se maneja en centavos enteros de punta a punta. Lo único que hace
   este archivo con reales es leerlos del formulario y volverlos a escribir. */

(function () {
  "use strict";

  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  const DIAS = [
    ["lunes", "Lunes"], ["martes", "Martes"], ["miercoles", "Miércoles"],
    ["jueves", "Jueves"], ["viernes", "Viernes"], ["sabado", "Sábado"],
    ["domingo", "Domingo"],
  ];

  // Las mismas jornadas por unidad que usa `_shared/dinero.ts`. Acá solo sirven
  // para mostrar una equivalencia mientras se escribe: el número que se guarda
  // lo calcula el servidor, que es el único que decide sobre el dinero.
  const JORNADAS = { hora: 0, dia: 1, semana: 6, mes: 30 };

  const estado = {
    areas: [],
    credenciales: [],
    horasJornada: 8,
    editando: null,
    archivo: { lineas: [], columnas: [] },
  };

  let lista = null;

  // ---------- dinero ----------

  /* "80,00" → 8000, sin pasar por punto flotante.

     `Number("80,00".replace(",", ".")) * 100` devuelve 8000.000000000001 para
     algunos valores, y ese resto sobrevive hasta el total de la nómina. Acá se
     separan enteros y centavos y se arma el entero a mano. */
  function aCentavos(texto) {
    let s = String(texto ?? "").trim().replace(/[^\d.,]/g, "");
    if (!s) return 0;

    if (s.includes(",")) {
      s = s.replace(/\./g, "");            // los puntos son separadores de miles
    } else if (/\.\d{1,2}$/.test(s)) {
      s = s.replace(".", ",");             // un punto con 1 o 2 dígitos al final es la coma
    } else {
      s = s.replace(/\./g, "");
    }

    const partes = s.split(",");
    const enteros = Number(partes[0] || 0);
    const centavos = Number((partes[1] || "").padEnd(2, "0").slice(0, 2));
    return enteros * 100 + centavos;
  }

  const deCentavos = (cents) => ((cents ?? 0) / 100).toFixed(2).replace(".", ",");

  function equivalencia() {
    const cents = aCentavos($("eSalario").value);
    const unidad = $("eUnidad").value;
    const destino = $("equivalencia");

    if (!cents) { destino.textContent = ""; return; }

    if (unidad === "hora") {
      destino.textContent = `R$ ${deCentavos(cents)} por hora.`;
      return;
    }

    const horas = JORNADAS[unidad] * estado.horasJornada;
    const porHora = Math.round(cents / horas);
    destino.textContent =
      `R$ ${deCentavos(cents)} ${unidad === "dia" ? "por día" : `por ${unidad}`} ` +
      `con jornada de ${estado.horasJornada} h equivale a R$ ${deCentavos(porHora)} por hora.`;
  }

  // ---------- errores ----------

  function setError(campo, mensaje) {
    const nodo = document.querySelector(`.error[data-for="${campo}"]`);
    if (nodo) nodo.textContent = mensaje || "";
  }

  // ---------- catálogos ----------

  async function cargarCatalogos() {
    const datos = await P.fn("empleados", { action: "catalogos" });
    estado.areas = datos.areas ?? [];
    estado.credenciales = datos.credenciales ?? [];
    estado.horasJornada = datos.horas_jornada ?? 8;

    pintarSelects();
    pintarCatalogos();
    equivalencia();
  }

  function pintarSelects() {
    const activas = estado.areas.filter((a) => a.activa);
    const credenciales = estado.credenciales.filter((c) => c.activa);

    $("eArea").innerHTML = `<option value="">Sin área</option>` +
      activas.map((a) => `<option value="${a.id}">${P.esc(a.nombre)}</option>`).join("");

    $("eCredencial").innerHTML = `<option value="">Sin credencial</option>` +
      credenciales.map((c) => `<option value="${c.id}">${P.esc(c.nombre)}</option>`).join("");
  }

  function pintarCatalogos() {
    const filaArea = (a) => `
      <tr${a.activa ? "" : ' class="fila-retirada"'}>
        <td data-label="Área">${P.esc(a.nombre)}</td>
        <td class="col-acciones" data-label="Acciones">
          <button type="button" class="btn btn--link" data-area="${a.id}" data-activa="${a.activa}">
            ${a.activa ? "Dar de baja" : "Reactivar"}
          </button>
        </td>
      </tr>`;

    const filaCredencial = (c) => `
      <tr${c.activa ? "" : ' class="fila-retirada"'}>
        <td data-label="Credencial">
          ${P.esc(c.nombre)}
          ${c.da_acceso_panel ? `<span class="etiqueta">${P.esc(c.rol_sugerido ?? "acceso")}</span>` : ""}
        </td>
        <td class="col-acciones" data-label="Acciones">
          <button type="button" class="btn btn--link" data-credencial="${c.id}" data-activa="${c.activa}">
            ${c.activa ? "Dar de baja" : "Reactivar"}
          </button>
        </td>
      </tr>`;

    $("listaAreas").innerHTML = `
      <table class="data-table data-table--apilable"><tbody>
        ${estado.areas.map(filaArea).join("")}
      </tbody></table>`;

    $("listaCredenciales").innerHTML = `
      <table class="data-table data-table--apilable"><tbody>
        ${estado.credenciales.map(filaCredencial).join("")}
      </tbody></table>`;
  }

  async function bajaDeCatalogo(accion, id, activa) {
    try {
      await P.fn("empleados", { action: accion, id, activa: !activa });
      await cargarCatalogos();
      lista.cargar();
    } catch (error) {
      setError(accion === "area_baja" ? "area" : "credencial", error.message);
    }
  }

  // ---------- formulario ----------

  function pintarDias(marcados = []) {
    $("eDias").innerHTML = DIAS.map(([valor, rotulo]) => `
      <label class="casilla">
        <input type="checkbox" value="${valor}"${marcados.includes(valor) ? " checked" : ""} />
        <span>${rotulo}</span>
      </label>`).join("");
  }

  function limpiarFormulario() {
    estado.editando = null;
    $("tituloFormulario").textContent = "Agregar empleado";
    $("btnGuardarEmpleado").textContent = "Guardar empleado";
    $("btnCancelarEdicion").hidden = true;

    ["eNombre", "eApellido", "eDocumento", "eNacimiento", "eIngreso", "eTelefono",
     "eEmail", "eDireccion", "eSalario", "eBono", "eReloj"].forEach((id) => { $(id).value = ""; });

    $("eArea").value = "";
    $("eCredencial").value = "";
    $("eUnidad").value = "dia";
    $("eTieneBono").checked = false;
    $("campoBono").hidden = true;
    $("eIngreso").value = new Date().toISOString().slice(0, 10);

    pintarDias();
    setError("empleado", "");
    equivalencia();
  }

  function cargarEnFormulario(e) {
    estado.editando = e.id;
    $("tituloFormulario").textContent = `Editar a ${e.nombre} ${e.apellido}`.trim();
    $("btnGuardarEmpleado").textContent = "Guardar cambios";
    $("btnCancelarEdicion").hidden = false;

    $("eNombre").value = e.nombre ?? "";
    $("eApellido").value = e.apellido ?? "";
    $("eDocumento").value = e.documento ?? "";
    $("eNacimiento").value = e.fecha_nacimiento ?? "";
    $("eIngreso").value = e.fecha_ingreso ?? "";
    $("eTelefono").value = e.telefono ?? "";
    $("eEmail").value = e.email ?? "";
    $("eDireccion").value = e.direccion ?? "";
    $("eArea").value = e.area_id ?? "";
    $("eCredencial").value = e.credencial_id ?? "";
    $("eReloj").value = e.codigo_reloj ?? "";
    $("eSalario").value = deCentavos(e.salario_cents);
    $("eUnidad").value = e.salario_unidad ?? "dia";

    const tieneBono = e.bono_pct !== null && e.bono_pct !== undefined;
    $("eTieneBono").checked = tieneBono;
    $("campoBono").hidden = !tieneBono;
    $("eBono").value = tieneBono ? Number(e.bono_pct) : "";

    pintarDias(e.dias_libres ?? []);
    setError("empleado", "");
    equivalencia();

    document.querySelector('.modulo-tab[data-sub="alta"]')?.click();
  }

  async function guardarEmpleado() {
    const cuerpo = {
      action: estado.editando ? "editar" : "crear",
      id: estado.editando,
      nombre: $("eNombre").value,
      apellido: $("eApellido").value,
      documento: $("eDocumento").value,
      fecha_nacimiento: $("eNacimiento").value,
      fecha_ingreso: $("eIngreso").value,
      telefono: $("eTelefono").value,
      email: $("eEmail").value,
      direccion: $("eDireccion").value,
      area_id: $("eArea").value,
      credencial_id: $("eCredencial").value,
      codigo_reloj: $("eReloj").value,
      dias_libres: [...$("eDias").querySelectorAll("input:checked")].map((c) => c.value),
      salario_cents: aCentavos($("eSalario").value),
      salario_unidad: $("eUnidad").value,
      bono_pct: $("eTieneBono").checked ? $("eBono").value : null,
    };

    setError("empleado", "");
    $("btnGuardarEmpleado").disabled = true;

    try {
      await P.fn("empleados", cuerpo);
      limpiarFormulario();
      await lista.cargar();
      document.querySelector('.modulo-tab[data-sub="lista"]')?.click();
    } catch (error) {
      setError("empleado", error.message);
    } finally {
      $("btnGuardarEmpleado").disabled = false;
    }
  }

  // ---------- acciones sobre un empleado ----------

  function botonesDe(e) {
    if (e.estado === "retirado") {
      return `
        <a class="btn btn--link" href="ficha.html?id=${e.id}" target="_blank" rel="noopener">Ver</a>
        <button type="button" class="btn btn--link" data-accion="reingresar" data-id="${e.id}">Reingresar</button>`;
    }

    const acceso = e.staff_id
      ? `<span class="etiqueta">con acceso</span>`
      : `<button type="button" class="btn btn--link" data-accion="acceso" data-id="${e.id}">Dar acceso</button>`;

    return `
      <a class="btn btn--link" href="ficha.html?id=${e.id}" target="_blank" rel="noopener">Ficha</a>
      <button type="button" class="btn btn--link" data-accion="editar" data-id="${e.id}">Editar</button>
      ${acceso}
      <button type="button" class="btn btn--link" data-accion="retirar" data-id="${e.id}">Retirar</button>`;
  }

  async function accionar(accion, id, empleado) {
    if (accion === "editar") return cargarEnFormulario(empleado);

    if (accion === "retirar") {
      const motivo = prompt(
        `Motivo del retiro de ${empleado.nombre} ${empleado.apellido}:\n\n` +
        "El legajo no se borra: queda como retirado, con su código y su historial.",
      );
      if (motivo === null) return;
      if (motivo.trim().length < 3) return alert("Hace falta el motivo del retiro.");

      await P.fn("empleados", { action: "retirar", id, motivo });
      return lista.cargar();
    }

    if (accion === "reingresar") {
      if (!confirm(`¿Reingresar a ${empleado.nombre} ${empleado.apellido}?`)) return;
      await P.fn("empleados", { action: "reingresar", id });
      return lista.cargar();
    }

    if (accion === "acceso") {
      const credencial = estado.credenciales.find((c) => c.id === empleado.credencial_id);
      const sugerido = credencial?.rol_sugerido ?? "mesero";

      if (!empleado.email) {
        return alert("El legajo necesita un correo antes de poder darle acceso al panel.");
      }

      const rol = prompt(
        `Rol para ${empleado.nombre} ${empleado.apellido} (${empleado.email}):\n\n` +
        `Escribe "mesero" o "admin". La credencial ${credencial?.nombre ?? "cargada"} sugiere "${sugerido}".`,
        sugerido,
      );
      if (rol === null) return;

      try {
        const r = await P.fn("empleados", { action: "dar_acceso", id, role: rol.trim() });
        alert(
          `Cuenta creada para ${r.email}.\n\n` +
          `Clave temporal: ${r.temporary_password}\n\n` +
          "Se la tiene que cambiar en el primer ingreso. Anótala ahora: no se vuelve a mostrar.",
        );
        await lista.cargar();
      } catch (error) {
        alert(error.message);
      }
    }
  }

  // ---------- marcaciones ----------

  function separador() {
    const elegido = $("mapSeparador").value;
    if (elegido === "\\t") return "\t";
    if (elegido !== "auto") return elegido;

    // Gana el que más veces aparece en la primera línea: es lo único que se
    // puede deducir sin conocer el aparato.
    const primera = estado.archivo.lineas[0] ?? "";
    const candidatos = [",", ";", "\t", "|"];
    return candidatos.reduce((mejor, c) =>
      primera.split(c).length > primera.split(mejor).length ? c : mejor, ",");
  }

  const partir = (linea) => linea.split(separador()).map((c) => c.trim().replace(/^"|"$/g, ""));

  /* Fecha y hora desde texto, con el orden que la persona eligió.

     Es el punto donde la primera interpretación va a estar mal en algo, y por
     eso `bruto` viaja igual: si el orden resulta ser el otro, se corrige acá y se
     vuelve a importar sin pedirle nada al aparato. */
  function aMomento(texto) {
    const s = String(texto ?? "").trim();
    if (!s) return null;

    const orden = $("mapFormato").value;
    const m = s.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})[\sT]*(\d{1,2})?:?(\d{2})?:?(\d{2})?/);

    if (!m) {
      const suelta = new Date(s);
      return Number.isNaN(suelta.getTime()) ? null : suelta;
    }

    const [, a, b, c, hh = "0", mm = "0", ss = "0"] = m;
    let dia, mes, anio;

    if (orden === "iso" || a.length === 4) {
      [anio, mes, dia] = [Number(a), Number(b), Number(c)];
    } else if (orden === "mdy") {
      [mes, dia, anio] = [Number(a), Number(b), Number(c)];
    } else {
      // `auto` cae en día/mes/año: es el orden que se usa acá, y si el archivo
      // trae un 13 en la primera posición no habría otra lectura posible.
      [dia, mes, anio] = [Number(a), Number(b), Number(c)];
    }

    if (anio < 100) anio += 2000;
    const fecha = new Date(anio, mes - 1, dia, Number(hh), Number(mm), Number(ss));
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  const esSalida = (celda) => /^(s|sal|salida|out|exit|1)$/i.test(String(celda ?? "").trim());

  function leerArchivo(archivo) {
    const lector = new FileReader();
    lector.onload = () => {
      estado.archivo.lineas = String(lector.result)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (!estado.archivo.lineas.length) {
        setError("marcaciones", "El archivo está vacío.");
        return;
      }

      $("botonArchivo").textContent = `${archivo.name} · ${estado.archivo.lineas.length} líneas`;
      $("mapeoColumnas").hidden = false;
      pintarMapeo();
    };
    lector.readAsText(archivo);
  }

  function pintarMapeo() {
    const columnas = partir(estado.archivo.lineas[0]);
    estado.archivo.columnas = columnas;

    const conEncabezado = $("mapEncabezado").checked;
    const opciones = (conVacia) =>
      (conVacia ? `<option value="">(ninguna)</option>` : "") +
      columnas.map((c, i) =>
        `<option value="${i}">${i + 1}. ${P.esc(conEncabezado ? c : `columna ${i + 1}`)}</option>`).join("");

    $("mapReloj").innerHTML = opciones(false);
    $("mapMomento").innerHTML = opciones(false);
    $("mapTipo").innerHTML = opciones(true);
    $("mapReferencia").innerHTML = opciones(true);

    if (columnas.length > 1) $("mapMomento").value = "1";
    pintarPrevia();
  }

  function filasDelArchivo() {
    const lineas = $("mapEncabezado").checked
      ? estado.archivo.lineas.slice(1)
      : estado.archivo.lineas;

    const iReloj = Number($("mapReloj").value);
    const iMomento = Number($("mapMomento").value);
    const iTipo = $("mapTipo").value === "" ? null : Number($("mapTipo").value);
    const iRef = $("mapReferencia").value === "" ? null : Number($("mapReferencia").value);

    return lineas.map((linea) => {
      const celdas = partir(linea);
      const momento = aMomento(celdas[iMomento]);

      return {
        codigo_reloj: celdas[iReloj] ?? "",
        momento: momento ? momento.toISOString() : "",
        legible: momento ? momento.toLocaleString("es") : "sin leer",
        tipo: iTipo === null ? "entrada" : (esSalida(celdas[iTipo]) ? "salida" : "entrada"),
        referencia_externa: iRef === null ? "" : (celdas[iRef] ?? ""),
        bruto: linea,
      };
    });
  }

  function pintarPrevia() {
    const filas = filasDelArchivo();
    const muestra = filas.slice(0, 8);
    const sinLeer = filas.filter((f) => !f.momento).length;

    $("previaMarcaciones").innerHTML = `
      <thead><tr>
        <th>Código</th><th>Momento</th><th>Marca</th><th>Línea original</th>
      </tr></thead>
      <tbody>${muestra.map((f) => `
        <tr${f.momento ? "" : ' class="fila-alerta"'}>
          <td class="num" data-label="Código">${P.esc(f.codigo_reloj)}</td>
          <td data-label="Momento">${P.esc(f.legible)}</td>
          <td data-label="Marca">${P.esc(f.tipo)}</td>
          <td data-label="Línea original"><small>${P.esc(f.bruto)}</small></td>
        </tr>`).join("")}
      </tbody>`;

    setError("marcaciones", sinLeer
      ? `${sinLeer} de ${filas.length} filas tienen una fecha que no se pudo leer. Prueba otro orden de fecha antes de importar.`
      : "");
  }

  async function importarMarcaciones() {
    const filas = filasDelArchivo().filter((f) => f.momento);
    if (!filas.length) {
      setError("marcaciones", "Ninguna fila tiene una fecha legible.");
      return;
    }

    $("btnImportar").disabled = true;
    try {
      const r = await P.fn("empleados", { action: "marcaciones_importar", filas });
      $("resultadoImportacion").textContent =
        `Entraron ${r.insertadas}. Repetidas y salteadas: ${r.repetidas}. ` +
        `Sin empleado asociado: ${r.sin_empleado}. Descartadas: ${r.descartadas}.`;
      setError("marcaciones", "");
    } catch (error) {
      setError("marcaciones", error.message);
    } finally {
      $("btnImportar").disabled = false;
    }
  }

  // ---------- arranque ----------

  (async () => {
    if (!await P.exigirAdmin("empleados.html")) return;
    P.montarTabsDeModulo();

    lista = window.EmpleadosLista.montar({
      contenedor: $("listaEmpleados"),
      buscador: $("buscar"),
      casillaRetirados: $("verRetirados"),
      pie: $("pieLista"),
      acciones: botonesDe,
      alAccionar: (accion, id, empleado) => {
        accionar(accion, id, empleado).catch((error) => alert(error.message));
      },
    });

    $("btnGuardarEmpleado").addEventListener("click", guardarEmpleado);
    $("btnCancelarEdicion").addEventListener("click", limpiarFormulario);
    $("eTieneBono").addEventListener("change", (e) => {
      $("campoBono").hidden = !e.target.checked;
    });
    $("eSalario").addEventListener("input", equivalencia);
    $("eUnidad").addEventListener("change", equivalencia);

    $("btnCrearArea").addEventListener("click", async () => {
      setError("area", "");
      try {
        await P.fn("empleados", { action: "area_crear", nombre: $("areaNueva").value });
        $("areaNueva").value = "";
        await cargarCatalogos();
      } catch (error) { setError("area", error.message); }
    });

    $("btnCrearCredencial").addEventListener("click", async () => {
      setError("credencial", "");
      const rol = $("credencialRol").value;
      try {
        await P.fn("empleados", {
          action: "credencial_crear",
          nombre: $("credencialNueva").value,
          da_acceso_panel: rol !== "",
          rol_sugerido: rol || null,
        });
        $("credencialNueva").value = "";
        $("credencialRol").value = "";
        await cargarCatalogos();
      } catch (error) { setError("credencial", error.message); }
    });

    document.addEventListener("click", (e) => {
      const area = e.target.closest("[data-area]");
      if (area) return bajaDeCatalogo("area_baja", area.dataset.area, area.dataset.activa === "true");

      const credencial = e.target.closest("[data-credencial]");
      if (credencial) {
        return bajaDeCatalogo("credencial_baja", credencial.dataset.credencial,
                              credencial.dataset.activa === "true");
      }
    });

    $("archivoMarcaciones").addEventListener("change", (e) => {
      const archivo = e.target.files?.[0];
      if (archivo) leerArchivo(archivo);
    });

    ["mapSeparador", "mapEncabezado"].forEach((id) =>
      $(id).addEventListener("change", pintarMapeo));
    ["mapReloj", "mapMomento", "mapTipo", "mapReferencia", "mapFormato"].forEach((id) =>
      $(id).addEventListener("change", pintarPrevia));
    $("btnImportar").addEventListener("click", importarMarcaciones);

    limpiarFormulario();
    await cargarCatalogos();
    await lista.cargar();
  })();
})();
