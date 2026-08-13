/* Base común de las páginas sueltas del panel.

   `index.html` es una sola página con pestañas; Operaciones, Solicitudes y
   Publicidad son páginas aparte porque cada una tiene su propio filtrado y
   su propio estado. Todas necesitan lo mismo antes de mostrar nada: sesión
   iniciada y rol de administrador.

   Esto es comodidad de la interfaz, no seguridad. Quien decide de verdad es el
   servidor: las Edge Functions vuelven a verificar el rol en cada llamada y las
   políticas de la base tampoco confían en el navegador. Si alguien saltea esta
   pantalla, no obtiene nada. */

window.PanelBase = (() => {
  const cfg = window.PROKART_CONFIG ?? {};
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  let sesion = null;
  let perfil = null;

  // La misma barra lateral que index.html, para que moverse entre páginas no se
  // sienta como salir del panel.
  const NAV = [
    { grupo: "Evento", items: [{ href: "index.html", label: "Panel del evento" }] },
    {
      grupo: "Gestión",
      items: [
        { href: "reservas.html", label: "Reservas" },
        { href: "operaciones.html", label: "Operaciones" },
        { href: "solicitudes.html", label: "Solicitudes" },
        { href: "publicidad.html", label: "Publicidad" },
      ],
    },
    {
      grupo: "Personal",
      items: [
        { href: "empleados.html", label: "Empleados" },
        { href: "nomina.html", label: "Nómina" },
        { href: "usuarios.html", label: "Usuarios" },
      ],
    },
  ];

  /* `developer` entra a todo lo que entra un admin: es la misma llave que abre
     las políticas de la base, donde `is_admin()` cuenta a los dos. Lo que los
     separa es a quién pueden gestionar, y eso lo decide la Edge Function. */
  const puedeEntrar = (rol) => rol === "admin" || rol === "developer";

  function pintarNav(actual) {
    const nav = document.getElementById("panelNav");
    if (!nav) return;

    nav.innerHTML = NAV.map((g) => `
      <div class="sidebar__grupo">
        <p class="sidebar__rotulo">${g.grupo}</p>
        ${g.items.map((p) =>
          `<a href="${p.href}" class="sidebar__item${p.href === actual ? " active" : ""}">${p.label}</a>`
        ).join("")}
      </div>
    `).join("");

    const titulo = document.getElementById("tituloModulo");
    const item = NAV.flatMap((g) => g.items).find((p) => p.href === actual);
    if (titulo && item) titulo.textContent = item.label;
  }

  // ---------- menú en teléfono ----------
  function montarMenu() {
    const barra = document.getElementById("sidebar");
    const velo = document.getElementById("sidebarVelo");
    const boton = document.getElementById("btnMenu");
    if (!barra || !boton) return;

    const cerrar = () => {
      barra.classList.remove("abierta");
      velo?.setAttribute("hidden", "");
      boton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-abierto");
    };

    boton.addEventListener("click", () => {
      const abierta = barra.classList.toggle("abierta");
      abierta ? velo?.removeAttribute("hidden") : velo?.setAttribute("hidden", "");
      boton.setAttribute("aria-expanded", String(abierta));
      document.body.classList.toggle("menu-abierto", abierta);
    });

    velo?.addEventListener("click", cerrar);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
  }

  // Pestañas dentro de un módulo, delegadas: sirve para cualquier página.
  function montarTabsDeModulo(alCambiar) {
    document.addEventListener("click", (e) => {
      const boton = e.target.closest(".modulo-tab");
      if (!boton) return;

      const modulo = boton.closest(".tab-panel") ?? document;
      modulo.querySelectorAll(".modulo-tab").forEach((b) => b.classList.toggle("active", b === boton));
      modulo.querySelectorAll(".modulo-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.sub === boton.dataset.sub);
      });

      alCambiar?.(boton.dataset.sub);
    });
  }

  async function exigirAdmin(paginaActual) {
    const { data } = await db.auth.getSession();
    sesion = data?.session ?? null;

    if (!sesion) {
      // Se vuelve al login en vez de mostrar una página vacía con errores.
      location.replace("index.html");
      return null;
    }

    const { data: fila } = await db
      .from("staff_profiles")
      .select("role, display_name")
      .eq("id", sesion.user.id)
      .maybeSingle();

    perfil = fila;

    if (!puedeEntrar(fila?.role)) {
      location.replace("index.html");
      return null;
    }

    pintarNav(paginaActual);
    montarMenu();

    const badge = document.getElementById("userBadge");
    if (badge) badge.textContent = fila.display_name || sesion.user.email;

    document.getElementById("btnLogout")?.addEventListener("click", async () => {
      await db.auth.signOut();
      location.replace("index.html");
    });

    document.getElementById("panelShell")?.removeAttribute("hidden");
    return fila;
  }

  // Llama a una Edge Function con el token de la sesión abierta.
  async function fn(nombre, cuerpo = {}) {
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${nombre}`, {
      method: "POST",
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${sesion.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error ?? `Error ${r.status}`);
    return datos;
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const plata = (cents) =>
    `R$ ${((cents ?? 0) / 100).toFixed(2).replace(".", ",")}`;

  const momento = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("es")} ${d.toTimeString().slice(0, 5)}`;
  };

  return {
    db, fn, exigirAdmin, montarTabsDeModulo, esc, plata, momento,
    get sesion() { return sesion; },
    get perfil() { return perfil; },
  };
})();
