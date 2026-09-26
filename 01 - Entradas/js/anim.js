/* =========================================================
   ANIMACIÓN DE ENTRADA

   El sitio no tenía ninguna: cero IntersectionObserver, cero animation-timeline.
   La portada tenía un acercamiento lento y el plano una entrada escalonada, y
   entre medias había tres mil píxeles de scroll sin una sola señal de que algo
   estuviera vivo.

   Reglas que sigue este archivo, en este orden:

   1. Nada que cueste layout. Solo `transform` y `opacity`, que el compositor
      resuelve sin volver a medir la página. El sitio se usa casi siempre desde
      un teléfono y un reflow por cada elemento que entra se nota.
   2. Nada que retrase la lectura. Los reveals son de 420ms y disparan al 12% de
      visibilidad: para cuando el elemento está donde se lee, ya terminó.
   3. El contenido no depende de esto. Sin JS, con el script caído o con
      IntersectionObserver ausente, todo se ve en su estado final: la clase que
      esconde solo se aplica si este archivo llegó a ejecutarse.
   4. Con «reducir movimiento» activado no se monta nada en absoluto.

   No hay conteo animado en los precios, aunque estaba previsto. Un número que
   corre hasta su valor es divertido en una landing y es hostil en una compra:
   retrasa el único dato que la persona vino a leer y, en un teléfono, lo hace
   justo mientras el dedo ya va bajando. El precio entra con su tarjeta y se lee
   entero desde el primer cuadro.
   ========================================================= */

(() => {
  "use strict";

  const raiz = document.documentElement;

  /* Misma pregunta que hace app.js para frenar el reloj del carrusel. Si el
     sistema pide menos movimiento, este archivo no existe: no se marca la clase
     que activa los estados iniciales, así que el CSS deja todo visible. */
  const sinMovimiento =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (sinMovimiento || !("IntersectionObserver" in window)) return;

  /* Si el script del <head> se cansó de esperar y ya mostró todo, no se vuelve
     a esconder nada: animar ahora sería hacer desaparecer contenido que la
     persona ya está leyendo. */
  if (window.PROKART_REVEAL === "caducado") return;
  window.PROKART_REVEAL = "listo";

  /* La clase tiene que estar en <html> antes de la primera pintura, y por eso
     la pone el script del <head> de index.html: desde acá, al final del body,
     los elementos se veían un cuadro en su sitio y luego saltaban al estado
     inicial. Se repite por si esta hoja se carga en una página sin ese script. */
  raiz.classList.add("con-reveal");

  /* Qué se anima. Son los bloques que el ojo lee como unidades; los hijos
     sueltos no se animan por su cuenta para que la página no parpadee entera. */
  const SELECTORES = [
    ".feature__pie",
    ".section-heading",
    ".event-row",
    ".menu-intro",
    ".menu-tile",
    ".experience-card",
    ".area-card",
    ".areas-tarima",
    ".pieza-destacada",
  ].join(",");

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add("esta-a-la-vista");
      // Una sola vez: lo que ya entró no vuelve a animarse al subir.
      observador.unobserve(entrada.target);
    }
  }, {
    threshold: 0.12,
    /* El margen negativo abajo evita que un bloque dispare cuando asoma un
       píxel por el borde inferior: espera a que esté realmente entrando. */
    rootMargin: "0px 0px -6% 0px",
  });

  /* El escalonado se calcula por posición dentro del hermano, no con un
     contador global: si fuera global, la cuarta sección arrancaría con medio
     segundo de retraso y se vería como que la página se cuelga. Se corta a los
     seis para que una lista larga de eventos no tenga la última fila esperando
     un segundo entero. */
  function preparar(el) {
    if (el.dataset.reveal) return;
    el.dataset.reveal = "1";

    const hermanos = el.parentElement
      ? [...el.parentElement.children].filter((n) => n.matches?.(SELECTORES))
      : [el];
    const i = Math.min(hermanos.indexOf(el), 5);
    if (i > 0) el.style.setProperty("--i", String(i));

    observador.observe(el);
  }

  const barrer = (dentro) => dentro.querySelectorAll?.(SELECTORES).forEach(preparar);

  barrer(document);

  /* Las tarjetas de área, las filas de eventos y las piezas del menú las pinta
     app.js cuando vuelve la consulta, o sea después de este barrido. En vez de
     adivinar cuánto tarda, se miran los tres contenedores que sabemos que se
     rellenan solos. Es un observador acotado a tres nodos: no cuesta nada. */
  const dinamicos = ["listaEventos", "listaMenu", "areasGrid"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (dinamicos.length) {
    const alRepintar = new MutationObserver((cambios) => {
      for (const cambio of cambios) barrer(cambio.target);
    });
    for (const nodo of dinamicos) {
      alRepintar.observe(nodo, { childList: true });
    }
  }

})();
