/* Las tres bandejas: postulaciones de empleo, pedidos de publicidad y
   reinicios de clave.

   Los currículums se descargan con una URL firmada que dura cinco minutos, no
   con un enlace fijo: el bucket es privado y un enlace que quede en un chat o
   en el historial deja de servir enseguida. */

(() => {
  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);

  let bandeja = "empleo";
  let solicitudes = [];

  const CONTADORES = { empleo: "numEmpleo", publicidad: "numPublicidad", clave: "numClave" };

  function ficha(s) {
    const nueva = s.status === "nueva";
    const contacto = [s.whatsapp, s.email].filter(Boolean).map(P.esc).join(" · ");

    const cuerpo = {
      empleo: `
        <p class="ficha__dato"><b>Cédula</b> ${P.esc(s.documento)}</p>
        ${contacto ? `<p class="ficha__dato"><b>Contacto</b> ${contacto}</p>` : ""}`,
      publicidad: `
        <p class="ficha__dato"><b>Comercio</b> ${P.esc(s.comercio)}</p>
        <p class="ficha__dato"><b>Cédula</b> ${P.esc(s.documento)}</p>
        ${contacto ? `<p class="ficha__dato"><b>Contacto</b> ${contacto}</p>` : ""}
        <p class="ficha__texto">${P.esc(s.descripcion)}</p>`,
      clave: `
        <p class="ficha__dato"><b>Usuario</b> ${P.esc(s.staff_email)}</p>
        <p class="ficha__texto">Pidió que le reinicien la contraseña.</p>`,
    }[s.kind] ?? "";

    const acciones = [];
    if (s.kind === "empleo" && s.cv_path) {
      acciones.push(`<button type="button" class="btn btn--ghost" data-cv="${P.esc(s.id)}">Descargar CV</button>`);
    }
    if (s.kind === "clave" && nueva) {
      acciones.push(`<button type="button" class="btn btn--primary" data-clave="${P.esc(s.id)}" data-email="${P.esc(s.staff_email)}">Generar clave nueva</button>`);
    }
    acciones.push(nueva
      ? `<button type="button" class="btn btn--ghost" data-atender="${P.esc(s.id)}">Marcar atendida</button>`
      : `<button type="button" class="btn btn--link" data-reabrir="${P.esc(s.id)}">Reabrir</button>`);
    acciones.push(`<button type="button" class="btn btn--link ficha__borrar" data-borrar="${P.esc(s.id)}">Eliminar</button>`);

    return `
      <article class="ficha${nueva ? " ficha--nueva" : ""}">
        <header class="ficha__cabecera">
          <h3>${P.esc([s.nombre, s.apellido].filter(Boolean).join(" ") || "Sin nombre")}</h3>
          <span class="ficha__fecha">${P.momento(s.created_at)}</span>
        </header>
        ${cuerpo}
        <div class="ficha__acciones">${acciones.join("")}</div>
      </article>`;
  }

  function pintar() {
    const lista = $("listaSolicitudes");
    if (!solicitudes.length) {
      lista.innerHTML = `<p class="vacio">No hay solicitudes en esta bandeja.</p>`;
      return;
    }
    lista.innerHTML = solicitudes.map(ficha).join("");
  }

  async function cargar() {
    $("listaSolicitudes").innerHTML = `<p class="vacio">Cargando...</p>`;
    try {
      const { solicitudes: todas } = await P.fn("solicitud-accion", { action: "list", kind: bandeja });
      const estado = $("filtroEstado").value;
      solicitudes = estado ? todas.filter((s) => s.status === estado) : todas;
      pintar();
      // Los contadores muestran lo que falta atender, que es lo que importa.
      $(CONTADORES[bandeja]).textContent = todas.filter((s) => s.status === "nueva").length;
    } catch (error) {
      $("listaSolicitudes").innerHTML = `<p class="vacio">${P.esc(error.message)}</p>`;
    }
  }

  // Cuenta lo pendiente de las tres bandejas para los números de arriba.
  async function contarTodas() {
    for (const kind of Object.keys(CONTADORES)) {
      try {
        const { solicitudes: todas } = await P.fn("solicitud-accion", { action: "list", kind });
        $(CONTADORES[kind]).textContent = todas.filter((s) => s.status === "nueva").length;
      } catch { /* si una falla, las otras igual se muestran */ }
    }
  }

  function mostrarClave(clave) {
    $("claveTexto").textContent = clave;
    $("claveNueva").hidden = false;
    $("claveNueva").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.addEventListener("click", async (e) => {
    const boton = e.target.closest("button");
    if (!boton) return;

    if (boton.dataset.kind) {
      bandeja = boton.dataset.kind;
      document.querySelectorAll(".bandeja").forEach((b) => b.classList.toggle("active", b === boton));
      await cargar();
      return;
    }

    const conBoton = async (tarea) => {
      const texto = boton.textContent;
      boton.disabled = true;
      boton.textContent = "...";
      try { await tarea(); } catch (error) { alert(error.message); }
      boton.disabled = false;
      boton.textContent = texto;
    };

    if (boton.dataset.cv) {
      await conBoton(async () => {
        const { url } = await P.fn("solicitud-accion", { action: "cv", id: boton.dataset.cv });
        window.open(url, "_blank", "noopener");
      });
    }

    if (boton.dataset.clave) {
      await conBoton(async () => {
        // La clave la genera `staff-admin`, que ya es el único lugar donde se
        // arman contraseñas. Acá solo se busca a quién corresponde.
        const { staff } = await P.fn("staff-admin", { action: "list" });
        const persona = staff.find((s) => s.email?.toLowerCase() === boton.dataset.email?.toLowerCase());
        if (!persona) throw new Error("Ese usuario ya no existe");

        const { temporary_password } = await P.fn("staff-admin", {
          action: "reset_password", id: persona.id,
        });
        await P.fn("solicitud-accion", { action: "atender", id: boton.dataset.clave });
        mostrarClave(temporary_password);
        await cargar();
      });
    }

    if (boton.dataset.atender) {
      await conBoton(async () => {
        await P.fn("solicitud-accion", { action: "atender", id: boton.dataset.atender });
        await cargar();
      });
    }

    if (boton.dataset.reabrir) {
      await conBoton(async () => {
        await P.fn("solicitud-accion", { action: "reabrir", id: boton.dataset.reabrir });
        await cargar();
      });
    }

    if (boton.dataset.borrar) {
      if (!confirm("¿Eliminar esta solicitud? Si trae currículum, también se borra el archivo.")) return;
      await conBoton(async () => {
        await P.fn("solicitud-accion", { action: "eliminar", id: boton.dataset.borrar });
        await cargar();
      });
    }
  });

  $("btnCopiarClave")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText($("claveTexto").textContent).catch(() => {});
    $("btnCopiarClave").textContent = "Copiada";
    setTimeout(() => { $("btnCopiarClave").textContent = "Copiar"; }, 1600);
  });

  $("btnCerrarClave")?.addEventListener("click", () => { $("claveNueva").hidden = true; });

  (async () => {
    if (!await P.exigirAdmin("solicitudes.html")) return;
    $("filtroEstado").addEventListener("change", cargar);
    await cargar();
    contarTodas();
  })();
})();
