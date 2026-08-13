/* Cuentas de acceso al panel.

   La jerarquía que se ve acá es la misma que aplica la Edge Function
   `staff-admin`, y no manda esta: esconder un botón es comodidad, no seguridad.
   Si alguien llamara a la función igual, recibiría 403.

   La regla, en una línea: entre administradores no hay ninguna acción. Un admin
   gestiona meseros; editar, degradar, reiniciarle la clave o eliminar a otro
   admin —o a la cuenta de desarrollo— lo hace solo el developer. Y su propia
   cuenta tampoco se toca desde acá: para la clave está el cambio obligatorio del
   primer ingreso. */

(function () {
  "use strict";

  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  const estado = { usuarios: [], miRol: "admin" };

  const ROTULO_ROL = {
    developer: "Desarrollo",
    admin: "Administrador",
    mesero: "Mesero",
  };

  function setError(campo, mensaje) {
    const nodo = document.querySelector(`.error[data-for="${campo}"]`);
    if (nodo) nodo.textContent = mensaje || "";
  }

  // ---------- mi cuenta ----------

  /* El código de administrador propio.

     Sale de `staff-admin`, que lo lee con la clave de servicio y solo para quien
     pregunta: la columna `admin_code` no tiene permiso de lectura desde el
     navegador ni siquiera para un admin. Hace falta tenerlo a mano porque es lo
     que firma cada cambio de sueldo en Nómina y cada cortesía. */
  async function pintarMiCuenta() {
    const perfil = P.perfil ?? {};
    let codigo = null;

    try {
      const r = await P.fn("staff-admin", { action: "my_code" });
      codigo = r.admin_code;
    } catch { /* si falla, la pantalla sigue sirviendo para todo lo demás */ }

    $("miCuenta").innerHTML = `
      <h3>Tu cuenta</h3>
      <p class="hint">
        ${P.esc(perfil.display_name ?? "")} ·
        ${P.esc(ROTULO_ROL[estado.miRol] ?? estado.miRol)}
      </p>
      ${codigo ? `
        <p class="hint">
          Tu código de administrador es <strong class="codigo-admin">${P.esc(codigo)}</strong>.
          Es el que te va a pedir el panel antes de tocar un sueldo o emitir una
          cortesía. No lo compartas: confirma que eres tú quien está frente a la
          pantalla, no que hay una sesión abierta.
        </p>` : ""}`;
  }

  // ---------- lista ----------

  function explicacion() {
    $("explicacionJerarquia").textContent = estado.miRol === "developer"
      ? "Como cuenta de desarrollo, puedes gestionar a todos, incluidos los administradores."
      : "Puedes gestionar a los meseros. Los administradores y la cuenta de desarrollo " +
        "solo los toca el desarrollador: entre administradores no hay acciones, " +
        "tampoco sobre la cuenta propia.";
  }

  function botonesDe(u) {
    if (!u.gestionable) {
      return u.es_uno_mismo
        ? `<span class="etiqueta">tu cuenta</span>`
        : `<span class="etiqueta">solo desarrollo</span>`;
    }

    const otroRol = u.role === "mesero" ? "admin" : "mesero";
    const puedePromover = estado.miRol === "developer";

    return `
      ${puedePromover ? `
        <button type="button" class="btn btn--link" data-accion="rol" data-id="${u.id}" data-rol="${otroRol}">
          Pasar a ${ROTULO_ROL[otroRol].toLowerCase()}
        </button>` : ""}
      <button type="button" class="btn btn--link" data-accion="clave" data-id="${u.id}">Restablecer clave</button>
      <button type="button" class="btn btn--link" data-accion="borrar" data-id="${u.id}">Eliminar</button>`;
  }

  function pintar() {
    const cuerpo = estado.usuarios.map((u) => `
      <tr${u.gestionable ? "" : ' class="fila-retirada"'}>
        <td data-label="Nombre">
          ${P.esc(u.display_name || "—")}
          ${u.role === "developer" ? '<span class="etiqueta">cuenta del desarrollador</span>' : ""}
          ${u.es_uno_mismo ? '<span class="etiqueta">tú</span>' : ""}
        </td>
        <td data-label="Correo">${P.esc(u.email ?? "—")}</td>
        <td data-label="Rol">${P.esc(ROTULO_ROL[u.role] ?? u.role)}</td>
        <td data-label="Clave">
          ${u.must_change_password
            ? '<span class="estado estado--pendiente">sin estrenar</span>'
            : `<small>${P.momento(u.last_password_change)}</small>`}
        </td>
        <td class="col-acciones" data-label="Acciones">${botonesDe(u)}</td>
      </tr>`).join("");

    $("tablaUsuarios").innerHTML = `
      <div class="table-scroll">
        <table class="data-table data-table--apilable">
          <thead><tr>
            <th>Nombre</th><th>Correo</th><th>Rol</th><th>Clave</th><th>Acciones</th>
          </tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
      </div>`;
  }

  async function cargar() {
    const datos = await P.fn("staff-admin", { action: "list" });
    estado.usuarios = datos.staff ?? [];
    estado.miRol = datos.mi_rol ?? "admin";

    // La cuenta de desarrollo queda visible aunque no se pueda tocar: una cuenta
    // con poder total y oculta dentro del sistema de otra persona es una puerta
    // trasera, aunque la intención sea buena.
    explicacion();
    pintar();

    if (estado.miRol !== "developer") {
      // Un admin no puede crear otro admin: la opción no se ofrece, y si igual
      // se mandara, la función devuelve 403.
      $("uRol").querySelector('option[value="admin"]')?.remove();
    }
  }

  // ---------- acciones ----------

  async function accionar(accion, id) {
    const u = estado.usuarios.find((x) => x.id === id);
    if (!u) return;

    if (accion === "rol") {
      const nuevo = document.querySelector(`[data-accion="rol"][data-id="${id}"]`)?.dataset.rol;
      if (!confirm(`¿Pasar a ${u.display_name || u.email} a ${ROTULO_ROL[nuevo].toLowerCase()}?`)) return;
      await P.fn("staff-admin", { action: "update_role", id, role: nuevo });
      return cargar();
    }

    if (accion === "clave") {
      if (!confirm(`¿Restablecer la clave de ${u.display_name || u.email}?`)) return;
      const r = await P.fn("staff-admin", { action: "reset_password", id });
      alert(
        `Clave temporal para ${u.email}:\n\n${r.temporary_password}\n\n` +
        "Se la tiene que cambiar en el primer ingreso. Anótala ahora: no se vuelve a mostrar.",
      );
      return cargar();
    }

    if (accion === "borrar") {
      if (!confirm(
        `¿Eliminar la cuenta de ${u.display_name || u.email}?\n\n` +
        "Pierde el acceso al panel. Si tiene legajo, el legajo queda: no se borra ningún empleado.",
      )) return;
      await P.fn("staff-admin", { action: "delete", id });
      return cargar();
    }
  }

  // ---------- arranque ----------

  (async () => {
    if (!await P.exigirAdmin("usuarios.html")) return;
    P.montarTabsDeModulo();

    document.addEventListener("click", (e) => {
      const boton = e.target.closest("[data-accion]");
      if (!boton) return;
      accionar(boton.dataset.accion, boton.dataset.id).catch((error) => alert(error.message));
    });

    $("btnCrearUsuario").addEventListener("click", async () => {
      setError("alta", "");
      $("claveNueva").hidden = true;
      $("btnCrearUsuario").disabled = true;

      try {
        const r = await P.fn("staff-admin", {
          action: "create",
          email: $("uEmail").value,
          display_name: $("uNombre").value,
          role: $("uRol").value,
        });

        $("claveNueva").hidden = false;
        $("claveNueva").innerHTML =
          `Cuenta creada para <strong>${P.esc(r.email)}</strong>. ` +
          `Clave temporal: <strong class="codigo-admin">${P.esc(r.temporary_password)}</strong>. ` +
          "Anótala ahora: no se vuelve a mostrar, y se la tiene que cambiar en el primer ingreso.";

        $("uNombre").value = "";
        $("uEmail").value = "";
        await cargar();
      } catch (error) {
        setError("alta", error.message);
      } finally {
        $("btnCrearUsuario").disabled = false;
      }
    });

    await cargar();
    await pintarMiCuenta();
  })();
})();
