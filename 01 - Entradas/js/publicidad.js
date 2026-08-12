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
  const urlDeImagen = (ruta) =>
    /^https?:\/\//i.test(ruta) ? ruta : `${SB}/storage/v1/object/public/publicidad/${ruta}`;

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

  function pintarBanner(pieza) {
    if (!pieza) return;
    const caja = $("adBanner");
    const img = $("adBannerImg");
    const link = $("adBannerLink");
    if (!caja || !img || !link) return;

    img.src = urlDeImagen(pieza.image_path);
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

  function abrirOverlay(pieza) {
    if (!pieza || yaLoVioHoy()) return;

    const caja = $("overlayAd");
    const img = $("overlayAdImg");
    const link = $("overlayAdLink");
    if (!caja || !img || !link) return;

    img.src = urlDeImagen(pieza.image_path);
    link.href = pieza.link_url || (pieza.es_vitalicia ? "anunciar.html" : "#");
    link.target = pieza.link_url && !pieza.es_vitalicia ? "_blank" : "_self";

    caja.hidden = false;
    $("overlayAdCerrar")?.focus();

    // El bloqueo del scroll lo pone el CSS mirando si este elemento está
    // visible, así que ocultarlo alcanza para devolver el scroll siempre.
    const cerrar = () => {
      caja.hidden = true;
      marcarVisto();
      document.removeEventListener("keydown", conEscape);
    };

    // Tres formas de salir. El botón muestra un número, y un número no se lee
    // como "cerrar": si alguien no lo interpreta, tiene que poder irse igual.
    const conEscape = (e) => { if (e.key === "Escape") cerrar(); };
    $("overlayAdCerrar")?.addEventListener("click", cerrar);
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
    const caja = $("overlayAd");
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
    const el = $("overlayVisitas");
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
    pintarBanner(anuncios.banner);
    abrirOverlay(anuncios.overlay);
  });
})();
