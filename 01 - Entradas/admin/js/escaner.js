/* Escáner de entradas por cámara.
 *
 * En la puerta nadie tipea un código de veinticinco caracteres: se apunta y
 * listo. La cámara lee el QR y valida sola, sin apretar nada. El campo de texto
 * sigue existiendo para cuando la pantalla del invitado está rota o muy sucia.
 *
 * Para leer el QR usa BarcodeDetector si el navegador lo trae: es nativo y no
 * cuesta nada. Pero solo existe en Chrome de Android; en Chrome de escritorio,
 * en Firefox y en el iPhone no está, y ahí el escáner quedaría inservible
 * justo en la mitad de los teléfonos que puede tener alguien en la puerta.
 *
 * Por eso hay un decodificador de respaldo que se baja únicamente cuando falta
 * el nativo: quien tiene el soporte no paga el peso, y quien no lo tiene puede
 * escanear igual.
 *
 * La cámara exige HTTPS. En Netlify eso ya está; en `localhost` también sirve.
 */

window.ProKartEscaner = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* Cuánto se ignora un código ya leído.
     La cámara devuelve el mismo QR treinta veces por segundo mientras siga
     enfrente. Sin esta ventana, una entrada se validaría decenas de veces y el
     registro de quién validó qué quedaría inservible. */
  const REPETIR_MS = 3500;

  const est = {
    stream: null,
    lector: null,
    reloj: null,
    ultimo: "",
    ultimoEn: 0,
    ocupado: false,
    alLeer: null,
  };

  // Lo único imprescindible es la cámara: el decodificador se resuelve solo.
  const soportado = () =>
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  const RESPALDO = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

  /* Deja listo un lector de QR y devuelve una función que recibe el <video>.

     Primero se intenta el nativo. Si no está, se baja el respaldo una sola vez
     y se decodifica sobre un canvas. El canvas se reutiliza entre cuadros: uno
     nuevo por cuadro llenaría la memoria del teléfono en un minuto. */
  async function prepararLector() {
    if ("BarcodeDetector" in window) {
      try {
        const nativo = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => {
          const hallados = await nativo.detect(video);
          return hallados.length ? hallados[0].rawValue : null;
        };
      } catch { /* sigue con el respaldo */ }
    }

    if (!window.jsQR) {
      estado("Preparando el lector…");
      await new Promise((listo, falla) => {
        const s = document.createElement("script");
        s.src = RESPALDO;
        s.onload = listo;
        s.onerror = falla;
        document.head.append(s);
      });
    }
    if (!window.jsQR) throw new Error("sin lector");

    const lienzo = document.createElement("canvas");
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    return (video) => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      // Se lee a la mitad de resolución: alcanza para un QR y es cuatro veces
      // menos trabajo por cuadro.
      lienzo.width = Math.round(w / 2);
      lienzo.height = Math.round(h / 2);
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const hallado = window.jsQR(img.data, img.width, img.height, {
        inversionAttempts: "dontInvert",
      });
      return hallado ? hallado.data : null;
    };
  }

  /* Del QR sale la URL de la página de validación, no el código pelado:
     .../verificar.html?codigo=EVT-...&firma=abc
     Se aceptan las dos formas por si alguna entrada vieja trae solo el código. */
  function leerCodigo(texto) {
    const crudo = String(texto || "").trim();
    if (!crudo) return null;

    try {
      const url = new URL(crudo);
      /* Hay dos formas de QR en circulación: el de la página de pago lleva
         ?codigo=...&firma=... y el del correo y el de «Mis entradas» llevan
         ?c=...&s=... Solo se leía la primera, así que el escáner rechazaba como
         «no es una entrada» casi todos los QR que tiene la gente. */
      const codigo = url.searchParams.get("codigo") || url.searchParams.get("c");
      if (codigo) {
        const firma = url.searchParams.get("firma") || url.searchParams.get("s") || "";
        return { code: codigo.trim().toUpperCase(), signature: firma.trim().toLowerCase() };
      }
    } catch {
      // No era una URL: se sigue con el texto tal cual.
    }

    if (/^EVT-/i.test(crudo)) return { code: crudo.toUpperCase(), signature: "" };
    return null;
  }

  function estado(texto, tono) {
    const el = $("escanerEstado");
    if (!el) return;
    el.textContent = texto || "";
    el.className = "escaner__estado" + (tono ? ` escaner__estado--${tono}` : "");
  }

  /* Un pitido corto al leer. En la puerta se mira al invitado, no a la pantalla:
     el sonido es lo que confirma que el escaneo entró. */
  let audio = null;
  function pitar(ok) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.connect(vol);
      vol.connect(audio.destination);
      osc.frequency.value = ok ? 880 : 220;
      vol.gain.setValueAtTime(0.06, audio.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.12 : 0.3));
      osc.start();
      osc.stop(audio.currentTime + (ok ? 0.12 : 0.3));
    } catch { /* sin sonido se sigue igual */ }
  }

  async function encender() {
    if (!soportado()) return;
    const video = $("escanerVideo");
    if (!video) return;

    estado("Pidiendo permiso…");
    try {
      est.stream = await navigator.mediaDevices.getUserMedia({
        // La de atrás: el invitado muestra su teléfono de frente a quien valida.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch (error) {
      const negado = error?.name === "NotAllowedError";
      estado(
        negado
          ? "Permiso de cámara denegado. Habilítalo en el candado de la barra de direcciones."
          : "No se pudo abrir la cámara. Escribe el código a mano.",
        "mal",
      );
      return;
    }

    video.srcObject = est.stream;
    await video.play().catch(() => {});

    try {
      est.lector = est.lector || await prepararLector();
    } catch {
      estado("No se pudo cargar el lector de QR. Escribe el código a mano.", "mal");
      apagar();
      return;
    }

    $("escaner")?.classList.add("escaner--vivo");
    $("btnCamara").textContent = "Apagar cámara";
    estado("Buscando un QR…");

    // 150ms alcanza de sobra para un QR que se sostiene frente a la cámara, y
    // no calienta el teléfono como leer cada cuadro.
    est.reloj = setInterval(mirar, 150);
  }

  function apagar() {
    clearInterval(est.reloj);
    est.reloj = null;
    if (est.stream) {
      est.stream.getTracks().forEach((t) => t.stop());
      est.stream = null;
    }
    const video = $("escanerVideo");
    if (video) video.srcObject = null;
    $("escaner")?.classList.remove("escaner--vivo");
    const btn = $("btnCamara");
    if (btn) btn.textContent = "Encender cámara";
    estado("");
  }

  async function mirar() {
    const video = $("escanerVideo");
    if (!video || est.ocupado || video.readyState < 2) return;

    let crudo;
    try {
      crudo = await est.lector(video);
    } catch {
      return; // un cuadro ilegible no es un error que valga la pena mostrar
    }
    if (!crudo) return;

    const dato = leerCodigo(crudo);
    if (!dato) {
      estado("Ese QR no es una entrada de Pro Kart.", "mal");
      return;
    }

    // El mismo QR sigue enfrente: se ignora hasta que pase la ventana.
    const ahora = Date.now();
    if (dato.code === est.ultimo && ahora - est.ultimoEn < REPETIR_MS) return;
    est.ultimo = dato.code;
    est.ultimoEn = ahora;

    est.ocupado = true;
    estado("Validando " + dato.code + "…");
    try {
      const ok = await est.alLeer?.(dato);
      pitar(ok !== false);
      estado(ok === false ? "Rechazada" : "Validada", ok === false ? "mal" : "bien");
      // El destello dice el resultado sin que haya que leer nada.
      const marco = document.querySelector(".escaner__marco");
      if (marco) {
        marco.classList.remove("escaner--ok", "escaner--mal");
        void marco.offsetWidth;
        marco.classList.add(ok === false ? "escaner--mal" : "escaner--ok");
      }
    } finally {
      est.ocupado = false;
    }
  }

  function montar(alLeer) {
    est.alLeer = alLeer;
    const btn = $("btnCamara");
    const caja = $("escaner");
    if (!btn || !caja) return;

    if (!soportado()) {
      caja.hidden = true;
      const manual = document.querySelector(".escaner__manual");
      if (manual) {
        manual.open = true;
        manual.classList.add("escaner__manual--unica");
      }
      return;
    }

    btn.addEventListener("click", () => (est.stream ? apagar() : encender()));

    // La cámara no queda prendida de fondo: ni la batería ni la privacidad de
    // quien está enfrente tienen por qué pagar una pestaña olvidada.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && est.stream) apagar();
    });
    window.addEventListener("pagehide", apagar);
  }

  return { montar, apagar, soportado, leerCodigo };
})();
