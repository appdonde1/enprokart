/* Publicidad, redes del pie y contador de visitas.

   Todo lo de esta página es accesorio: si algo de acá falla, la portada y la
   compra tienen que seguir funcionando igual. Por eso cada bloque atrapa sus
   propios errores y, ante la duda, no muestra nada en vez de mostrar roto. */

(() => {
  const cfg = window.PROKART_CONFIG ?? {};
  const SB = cfg.SUPABASE_URL;
  const KEY = cfg.SUPABASE_ANON_KEY;
  if (!SB || !KEY) return;

  const $ = (id) => document.getElementById(id);

  const cabeceras = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  // La imagen vive en el bucket público `publicidad`; en la base guardamos solo
  // la ruta, así el dominio de Supabase no queda incrustado en cada fila.
  // El bucket se llama `medios` y no `publicidad` a propósito: los bloqueadores
  // de anuncios cancelan cualquier descarga cuya URL contenga esa palabra, y el
  // espacio que alguien pagó quedaba vacío.
  const urlDeImagen = (ruta) =>
    /^https?:\/\//i.test(ruta) ? ruta : `${SB}/storage/v1/object/public/medios/${ruta}`;

  /* Carga una imagen y avisa si el navegador la dejó pasar.

     Hace falta porque una extensión de bloqueo puede cancelar la descarga: sin
     esta comprobación se abriría una pantalla completa con un hueco adentro. */
  function cargaBien(url) {
    return new Promise((resolve) => {
      const prueba = new Image();
      prueba.onload = () => resolve(true);
      prueba.onerror = () => resolve(false);
      prueba.src = url;
    });
  }

  // ------------------------------------------------------------ redes del pie
  async function pintarRedes() {
    const r = await fetch(`${SB}/rest/v1/site_settings?select=instagram_url,tiktok_url,whatsapp_url&limit=1`, {
      headers: cabeceras,
    });
    if (!r.ok) return;
    const [ajustes] = await r.json();
    if (!ajustes) return;

    const mapa = [
      ["redInstagram", ajustes.instagram_url],
      ["redTiktok", ajustes.tiktok_url],
      ["redWhatsapp", ajustes.whatsapp_url],
    ];

    for (const [id, url] of mapa) {
      const li = $(id);
      if (!li) continue;
      // Sin enlace cargado, el ícono no aparece: un ícono que no lleva a
      // ningún lado es peor que la ausencia del ícono.
      if (!url) { li.hidden = true; continue; }
      li.querySelector("a").href = url;
      li.hidden = false;
    }
  }

  // ------------------------------------------------------------ anuncios
  async function traerAnuncios() {
    const r = await fetch(`${SB}/rest/v1/ads_public?select=slot,image_path,link_url,es_vitalicia`, {
      headers: cabeceras,
    });
    if (!r.ok) return {};
    const filas = await r.json();
    return Object.fromEntries(filas.map((f) => [f.slot, f]));
  }

  async function pintarBanner(pieza) {
    if (!pieza) return;
    const caja = $("piezaDestacada");
    const img = $("piezaImg");
    const link = $("piezaLink");
    if (!caja || !img || !link) return;

    const url = urlDeImagen(pieza.image_path);
    // Si el navegador no deja bajar la imagen, se deja el hueco cerrado: un
    // marco vacío se lee como un error del sitio, no como un aviso ausente.
    if (!await cargaBien(url)) return;

    img.src = url;
    // Una vitalicia sin enlace propio lleva al formulario para alquilar el
    // espacio: es un aviso de la casa y tiene que poder venderse solo.
    link.href = pieza.link_url || (pieza.es_vitalicia ? "anunciar.html" : "#");
    link.target = pieza.link_url && !pieza.es_vitalicia ? "_blank" : "_self";
    caja.hidden = false;
  }

  // ------------------------------------------------------------ overlay
  const CLAVE_VISTO = "prokart_overlay_visto";

  function yaLoVioHoy() {
    try {
      return localStorage.getItem(CLAVE_VISTO) === new Date().toDateString();
    } catch {
      // Si el navegador bloquea el almacenamiento, se prefiere no molestar.
      return true;
    }
  }

  function marcarVisto() {
    try {
      localStorage.setItem(CLAVE_VISTO, new Date().toDateString());
    } catch { /* no pasa nada: se volverá a mostrar la próxima vez */ }
  }

  async function abrirOverlay(pieza) {
    if (!pieza || yaLoVioHoy()) return;

    const caja = $("bienvenidaCaja");
    const img = $("bienvenidaImg");
    const link = $("bienvenidaLink");
    if (!caja || !img || !link) return;

    const url = urlDeImagen(pieza.image_path);

    /* Nada de esto se abre a ciegas.

       Esta pantalla tapa el sitio entero y bloquea el scroll mientras está
       arriba. Si la imagen no llega —una extensión de bloqueo, la red— quedaría
       una pantalla negra sin contenido y sin explicación, y el visitante no
       entiende ni qué pasó ni cómo salir. Antes de abrirla hay que saber que
       tiene algo que mostrar. */
    if (!await cargaBien(url)) return;

    img.src = url;
    link.href = pieza.link_url || (pieza.es_vitalicia ? "anunciar.html" : "#");
    link.target = pieza.link_url && !pieza.es_vitalicia ? "_blank" : "_self";

    caja.hidden = false;
    $("bienvenidaCerrar")?.focus();

    // El bloqueo del scroll lo pone el CSS mirando si este elemento está
    // visible, así que ocultarlo alcanza para devolver el scroll siempre.
    const cerrar = () => {
      caja.hidden = true;
      marcarVisto();
      document.removeEventListener("keydown", conEscape);
    };

    /* Segunda red: una extensión también puede ocultar el elemento por su
       nombre, sin tocar el atributo `hidden`. Ahí el CSS lo seguiría contando
       como abierto y la página quedaría trabada sin nada a la vista. Si después
       de pintarlo no ocupa lugar en la pantalla, se cierra solo. */
    requestAnimationFrame(() => {
      if (!caja.hidden && caja.offsetHeight === 0) cerrar();
    });

    // Tres formas de salir. El botón muestra un número, y un número no se lee
    // como "cerrar": si alguien no lo interpreta, tiene que poder irse igual.
    const conEscape = (e) => { if (e.key === "Escape") cerrar(); };
    $("bienvenidaCerrar")?.addEventListener("click", cerrar);
    caja.addEventListener("click", (e) => { if (e.target === caja) cerrar(); });
    document.addEventListener("keydown", conEscape);

    // Tocar el anuncio también cuenta como haberlo visto: si no, al volver con
    // el botón atrás el overlay reaparece y tapa la página otra vez.
    link.addEventListener("click", cerrar);
  }

  /* Al volver con el botón atrás, el navegador puede restaurar la página tal
     como estaba, con el overlay abierto. Se cierra: ya lo vio, y encontrárselo
     de nuevo al retroceder es exactamente lo que molesta. */
  window.addEventListener("pageshow", (evento) => {
    if (!evento.persisted) return;
    const caja = $("bienvenidaCaja");
    if (caja && !caja.hidden) caja.hidden = true;
  });

  // ------------------------------------------------------------ visitas
  async function contarVisita() {
    const r = await fetch(`${SB}/functions/v1/registrar-visita`, {
      method: "POST",
      headers: cabeceras,
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.visitas_hoy;
  }

  function pintarVisitas(n) {
    const el = $("visitasHoy");
    if (!el) return;
    // Sin dato se deja el guion: inventar un número en un contador que se le
    // muestra a un anunciante sería exactamente lo contrario de lo que se pidió.
    el.textContent = typeof n === "number" ? n.toLocaleString("es") : "—";
  }

  // ------------------------------------------------------------ arranque
  document.addEventListener("DOMContentLoaded", async () => {
    pintarRedes().catch(() => {});

    const [anuncios, visitas] = await Promise.all([
      traerAnuncios().catch(() => ({})),
      contarVisita().catch(() => null),
    ]);

    pintarVisitas(visitas);
    // Ambas esperan a que la imagen cargue antes de mostrar nada, así que se
    // dejan correr en paralelo: el banner no tiene por qué esperar al overlay.
    pintarBanner(anuncios.banner).catch(() => {});
    abrirOverlay(anuncios.overlay).catch(() => {});
  });
})();
