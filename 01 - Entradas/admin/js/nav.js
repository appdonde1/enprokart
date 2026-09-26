/* =========================================================
   LA BARRA LATERAL DEL PANEL — dueño único

   Antes esto vivía en dos sitios que ya se habían desincronizado:

     · admin.js       TABS + PAGINAS, con roles, y llamaba «Resumen» al módulo
                      principal.
     · panel-base.js  NAV, sin roles, y llamaba «Panel del evento» a lo mismo.

   Cada uno tenía además su propio renderizador, su propio controlador del menú
   de teléfono y su propio criterio para marcar el ítem activo — uno por
   `data-tab`, el otro por `href`, así que ninguno marcaba los del otro. Y el
   contenedor HTML estaba copiado a mano en ocho páginas con dos ids distintos
   para el mismo hueco.

   Consecuencia real: un mesero que llegara a operaciones.html veía los siete
   ítems de administrador. No pasaba nada porque `exigirAdmin` lo echaba antes,
   pero la barra no era quien lo impedía.

   Acá hay un solo modelo, un solo emisor de marcado y un solo controlador. Es
   un script normal, no un módulo: el panel carga todo con <script src> y no hay
   ningún paso de compilación.
   ========================================================= */

window.PanelNav = (() => {
  "use strict";

  /* Iconos. Mismo lenguaje que ya usaban el pie del sitio público y el ojo de
     la contraseña de esta misma página: viewBox de 24, sin relleno, trazo con
     `currentColor` y remates redondeados. Al heredar el color no hace falta ni
     una regla extra para que el icono siga al ítem entre apagado, activo y
     hover. Son trazos, no una librería: trece iconos no justifican una fuente. */
  const ICONOS = {
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    salon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    imagen: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    escanear: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3 12h18"/>',
    entrada: '<path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2.5 2.5 0 0 0 0 5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 0 0-5z"/><path d="M12 8v1.5M12 14.5V16"/>',
    mesa: '<circle cx="12" cy="11" r="5"/><path d="M12 16v5M8 21h8M4.5 7.5L7 9M19.5 7.5L17 9"/>',
    tablero: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    bandeja: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>',
    megafono: '<path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    equipo: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M18 14.4a6.5 6.5 0 0 1 3.5 5.6"/>',
    billete: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    llave: '<circle cx="9" cy="9" r="3.4"/><path d="M2.8 20a6.4 6.4 0 0 1 12.4 0"/><path d="M17 4h5M17 7.5h5M17 11h3"/>',
  };

  /* El modelo. `id` identifica al módulo en cualquiera de las dos rutas: dentro
     de index.html es el nombre de la pestaña, y desde otra página es el ancla
     que la abre. Los que tienen `pagina` viven en su propio HTML porque llevan
     filtros y estado propios.

     El orden no es alfabético a propósito: es el orden en que se usa el panel. */
  const NAV = [
    {
      grupo: "Evento",
      items: [
        { id: "resumen", label: "Resumen", icon: "grafico", roles: ["admin"] },
        { id: "salon", label: "Salón", icon: "salon", roles: ["admin"] },
        { id: "portada", label: "Portada", icon: "imagen", roles: ["admin"] },
        { id: "eventos", label: "Eventos", icon: "calendario", roles: ["admin"] },
      ],
    },
    {
      grupo: "Puerta",
      items: [
        { id: "validar", label: "Validar", icon: "escanear", roles: ["admin", "mesero"] },
        { id: "entradas", label: "Entradas", icon: "entrada", roles: ["admin", "mesero"] },
      ],
    },
    {
      grupo: "Gestión",
      items: [
        { id: "reservas", pagina: "reservas.html", label: "Reservas", icon: "mesa", roles: ["admin"] },
        { id: "operaciones", pagina: "operaciones.html", label: "Operaciones", icon: "tablero", roles: ["admin"] },
        { id: "solicitudes", pagina: "solicitudes.html", label: "Solicitudes", icon: "bandeja", roles: ["admin"] },
        { id: "publicidad", pagina: "publicidad.html", label: "Publicidad", icon: "megafono", roles: ["admin"] },
      ],
    },
    {
      grupo: "Personal",
      items: [
        { id: "empleados", pagina: "empleados.html", label: "Empleados", icon: "equipo", roles: ["admin"] },
        { id: "nomina", pagina: "nomina.html", label: "Nómina", icon: "billete", roles: ["admin"] },
        { id: "usuarios", pagina: "usuarios.html", label: "Usuarios", icon: "llave", roles: ["admin"] },
      ],
    },
  ];

  /* `developer` ve lo mismo que un admin: es la misma llave que abre las
     políticas de la base, donde `is_admin()` cuenta a los dos. */
  const rolDeVista = (rol) => (rol === "developer" ? "admin" : rol);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const icono = (nombre) =>
    `<svg class="sidebar__icono" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONOS[nombre] ?? ""}</svg>`;

  /* Un ítem. Dentro de index.html los módulos son botones porque no navegan;
     desde cualquier otra página son enlaces a su ancla. Los que tienen página
     propia son enlaces siempre.

     `data-label` alimenta el globito del modo compacto: en ese modo la etiqueta
     está oculta por CSS, y el globito no puede leerla de un nodo que no se ve. */
  function pintarItem(item, { activo, spa }) {
    const esActivo = item.id === activo;
    const marca = esActivo
      ? (item.pagina ? ' aria-current="page"' : ' aria-current="true"')
      : "";
    const clase = `sidebar__item${esActivo ? " active" : ""}`;
    const dentro = `${icono(item.icon)}<span class="sidebar__texto">${esc(item.label)}</span>`;
    const rotulo = ` data-label="${esc(item.label)}"`;

    if (item.pagina) {
      return `<a class="${clase}" href="${esc(item.pagina)}"${marca}${rotulo}>${dentro}</a>`;
    }
    if (spa) {
      return `<button type="button" class="${clase}" data-tab="${esc(item.id)}"${marca}${rotulo}>${dentro}</button>`;
    }
    // Desde una página suelta, el módulo se abre por su ancla en index.html.
    return `<a class="${clase}" href="index.html#${esc(item.id)}"${marca}${rotulo}>${dentro}</a>`;
  }

  /* Dibuja la barra entera. `spa` lo pone index.html, que es la única que tiene
     los paneles dentro. Devuelve los ítems visibles para que quien llame pueda
     decidir cuál abrir primero sin volver a filtrar por rol. */
  function render(contenedor, { activo = null, rol = "admin", spa = false } = {}) {
    if (!contenedor) return [];

    const r = rolDeVista(rol);
    const visibles = [];

    contenedor.innerHTML = NAV.map((g) => {
      const items = g.items.filter((i) => i.roles.includes(r));
      if (!items.length) return "";
      visibles.push(...items);
      return `
        <div class="sidebar__grupo">
          <p class="sidebar__rotulo">${esc(g.grupo)}</p>
          ${items.map((i) => pintarItem(i, { activo, spa })).join("")}
        </div>`;
    }).join("");

    return visibles;
  }

  /* Marca el activo sin volver a dibujar. Toca los dos tipos de ítem: antes
     `abrirTab` solo miraba los `[data-tab]`, así que estando en un módulo los
     enlaces a las otras páginas no se marcaban nunca. */
  function marcarActivo(contenedor, id) {
    contenedor?.querySelectorAll(".sidebar__item").forEach((el) => {
      const suyo = el.dataset.tab === id
        || el.getAttribute("href") === `index.html#${id}`
        || el.getAttribute("href") === `${id}.html`;
      el.classList.toggle("active", suyo);
      if (suyo) el.setAttribute("aria-current", el.tagName === "A" ? "page" : "true");
      else el.removeAttribute("aria-current");
    });
  }

  const titulo = (id) =>
    NAV.flatMap((g) => g.items).find((i) => i.id === id)?.label ?? "";

  /* =========================================================
     EL COMPORTAMIENTO DE LA BARRA

     Dos modos, y el ancho decide cuál:

       · Cajón, por debajo de 600px. La barra se desliza sobre el contenido.
         En un teléfono chico un riel fijo se come el 17% del ancho, y el panel
         es sobre todo tablas: ese espacio hace falta.
       · Riel plegable, de 600px para arriba. Solo iconos, 44px de alto cada
         uno, con el nombre en un globito al pasar o al enfocar. La preferencia
         se guarda: hasta ahora el panel no recordaba absolutamente nada, así
         que cada página se abría como si fuera la primera.

     El plegado arranca puesto entre 600 y 1200px, que es donde más falta hace,
     y quitado por encima. Una vez que alguien lo toca, manda su elección.

     Todo esto estaba duplicado literalmente entre admin.js y panel-base.js, con
     dos estilos distintos de escribir lo mismo.
     ========================================================= */

  const LLAVE = "pk.sidebar.compacta";

  function montarBarra() {
    const shell = document.querySelector(".admin-shell");
    const barra = document.getElementById("sidebar");
    const velo = document.getElementById("sidebarVelo");
    const boton = document.getElementById("btnMenu");
    if (!shell || !barra) return;

    /* ---------- ensanchar el riel (teléfono) ----------
       En el teléfono la barra no se esconde nunca: el riel de iconos está
       siempre puesto y un toque lleva al módulo. Este botón solo la ensancha
       para leer los nombres, y al elegir algo se vuelve al riel, que es el
       estado normal. Por eso el rótulo habla de ampliar y no de abrir. */
    const ancha = () => barra.classList.contains("abierta");

    function ensanchar(quiero) {
      const va = quiero ?? !ancha();
      barra.classList.toggle("abierta", va);
      velo?.classList.toggle("se-ve", va);
      document.body.classList.toggle("menu-abierto", va);
      if (boton) {
        boton.setAttribute("aria-expanded", String(va));
        /* Decía «Abrir menú» también estando abierto, así que un lector de
           pantalla anunciaba «Abrir menú, expandido», que se contradice. */
        boton.setAttribute("aria-label", va ? "Reducir menú" : "Ver nombres del menú");
      }
      if (va) barra.querySelector(".sidebar__item")?.focus();
      else if (document.activeElement === document.body) boton?.focus();
    }

    boton?.addEventListener("click", () => ensanchar());
    velo?.addEventListener("click", () => { ensanchar(false); boton?.focus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ancha()) { ensanchar(false); boton?.focus(); }
    });
    // Elegir un módulo devuelve al riel: ensanchada, la barra tapa el contenido.
    barra.addEventListener("click", (e) => {
      if (e.target.closest(".sidebar__item") && ancha()) ensanchar(false);
    });

    // ---------- riel plegable (de 600px para arriba) ----------
    const hayRiel = window.matchMedia("(min-width: 600px)");
    const porDefecto = window.matchMedia("(min-width: 600px) and (max-width: 1200px)");

    const guardado = () => {
      try { return localStorage.getItem(LLAVE); } catch { return null; }
    };
    const guardar = (v) => {
      try { localStorage.setItem(LLAVE, v ? "1" : "0"); } catch { /* modo privado */ }
    };

    const plegar = document.createElement("button");
    plegar.type = "button";
    plegar.className = "sidebar__plegar";
    plegar.setAttribute("aria-controls", "sidebar");
    plegar.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="M15 6l-6 6 6 6"/></svg><span>Plegar</span>';

    function aplicar(compacta) {
      shell.classList.toggle("admin-shell--compacta", compacta);
      plegar.setAttribute("aria-expanded", String(!compacta));
      plegar.setAttribute("aria-label", compacta ? "Desplegar menú" : "Plegar menú");
    }

    function estadoInicial() {
      if (!hayRiel.matches) { aplicar(false); return; }
      const g = guardado();
      aplicar(g === null ? porDefecto.matches : g === "1");
    }

    plegar.addEventListener("click", () => {
      const ahora = !shell.classList.contains("admin-shell--compacta");
      aplicar(ahora);
      guardar(ahora);
    });

    document.getElementById("sidebarPie")?.appendChild(plegar);
    estadoInicial();
    // Si cambia el ancho y nadie eligió todavía, se recalcula el arranque.
    hayRiel.addEventListener?.("change", () => { if (guardado() === null) estadoInicial(); });
  }

  return { NAV, ICONOS, render, marcarActivo, titulo, rolDeVista, montarBarra };
})();
