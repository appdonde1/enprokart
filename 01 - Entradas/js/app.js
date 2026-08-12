/* =========================================================
   Flujo de venta de entradas - Noche VIP Fest
   Pasos: 1) Registro y selección de área
          2) Pago vía PIX (QR)
          3) Confirmación / Ticket
   ========================================================= */

(function () {
  "use strict";

  // ---------- Estado de la compra ----------
  const state = {
    nombre: "",
    apellido: "",
    documento: "",
    area: "",       // ORO | PLATA | GENERAL
    precio: 0,
    mesa: "",
    silla: "",
    codigoEntrada: "",
  };

  const AREA_LABELS = { ORO: "Área Oro (VIP)", PLATA: "Área Plata (VIP)", GENERAL: "Área General" };
  const AREAS_CON_ASIENTO = ["ORO", "PLATA"];

  // ---------- Configuración del mapa de mesas (referencial) ----------
  const MESAS_CONFIG = {
    ORO: { cantidadMesas: 8, sillasPorMesa: 6 },
    PLATA: { cantidadMesas: 12, sillasPorMesa: 6 },
  };

  // Ocupación "de fábrica" simulada (otros clientes ya compraron esas sillas)
  const OCUPACION_INICIAL = {
    ORO: { 3: [1, 2], 5: [4] },
    PLATA: { 2: [1, 2, 3, 4, 5, 6], 7: [1] },
  };

  const CLAVE_OCUPACION = "ocupacionMesasEvento";

  function obtenerOcupacion() {
    let guardada = {};
    try {
      guardada = JSON.parse(localStorage.getItem(CLAVE_OCUPACION)) || {};
    } catch (e) {
      guardada = {};
    }
    const combinada = { ORO: {}, PLATA: {} };
    ["ORO", "PLATA"].forEach((area) => {
      const base = OCUPACION_INICIAL[area] || {};
      const extra = guardada[area] || {};
      const mesas = new Set([...Object.keys(base), ...Object.keys(extra)]);
      mesas.forEach((mesa) => {
        const sillasBase = base[mesa] || [];
        const sillasExtra = extra[mesa] || [];
        combinada[area][mesa] = Array.from(new Set([...sillasBase, ...sillasExtra]));
      });
    });
    return combinada;
  }

  function guardarSillaOcupada(area, mesa, silla) {
    let guardada = {};
    try {
      guardada = JSON.parse(localStorage.getItem(CLAVE_OCUPACION)) || {};
    } catch (e) {
      guardada = {};
    }
    if (!guardada[area]) guardada[area] = {};
    if (!guardada[area][mesa]) guardada[area][mesa] = [];
    if (!guardada[area][mesa].includes(silla)) guardada[area][mesa].push(silla);
    localStorage.setItem(CLAVE_OCUPACION, JSON.stringify(guardada));
  }

  // ---------- Referencias DOM ----------
  const hero = document.getElementById("hero");
  const btnComprar = document.getElementById("btnComprar");
  const panels = {
    1: document.getElementById("panel-1"),
    2: document.getElementById("panel-2"),
    3: document.getElementById("panel-3"),
  };
  const stepIndicators = document.querySelectorAll(".step-indicator");

  const formRegistro = document.getElementById("formRegistro");
  const areaInputs = document.querySelectorAll('input[name="area"]');
  const seatFields = document.getElementById("seatFields");
  const generalHint = document.getElementById("generalHint");
  const mesaInput = document.getElementById("mesa");
  const sillaInput = document.getElementById("silla");
  const mesaGrid = document.getElementById("mesaGrid");
  const seatsPanel = document.getElementById("seatsPanel");
  const sillaGrid = document.getElementById("sillaGrid");
  const mesaSeleccionadaLabel = document.getElementById("mesaSeleccionadaLabel");
  const seleccionActual = document.getElementById("seleccionActual");

  const orderSummary = document.getElementById("orderSummary");
  const qrcodeContainer = document.getElementById("qrcode");
  const pixCodeInput = document.getElementById("pixCode");
  const timerEl = document.getElementById("timer");
  const btnCopyPix = document.getElementById("btnCopyPix");
  const btnConfirmarPago = document.getElementById("btnConfirmarPago");
  const btnVolverRegistro = document.getElementById("btnVolverRegistro");
  const ticketEl = document.getElementById("ticket");
  const btnNuevaCompra = document.getElementById("btnNuevaCompra");

  let qrInstance = null;
  let timerInterval = null;

  // ---------- Navegación entre pasos ----------
  function goToStep(step) {
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    panels[step].classList.add("active");
    hero.classList.toggle("hidden", step !== 1);

    stepIndicators.forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.remove("active", "done");
      if (s === step) el.classList.add("active");
      else if (s < step) el.classList.add("done");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  btnComprar.addEventListener("click", () => {
    document.getElementById("panel-1").scrollIntoView({ behavior: "smooth" });
  });

  // ---------- Paso 1: mostrar/ocultar mesa y silla según área ----------
  areaInputs.forEach((input) => {
    input.addEventListener("change", () => {
      const areaSeleccionada = input.value;
      const requiereAsiento = AREAS_CON_ASIENTO.includes(areaSeleccionada);
      seatFields.classList.toggle("hidden", !requiereAsiento);
      generalHint.classList.toggle("hidden", requiereAsiento);
      mesaInput.required = requiereAsiento;
      sillaInput.required = requiereAsiento;
      mesaInput.value = "";
      sillaInput.value = "";
      seatsPanel.classList.add("hidden");
      seleccionActual.textContent = "";

      if (requiereAsiento) {
        renderMapaMesas(areaSeleccionada);
      }
    });
  });

  // ---------- Mapa referencial de mesas (al elegir Oro / Plata) ----------
  function renderMapaMesas(area) {
    const config = MESAS_CONFIG[area];
    const ocupacion = obtenerOcupacion()[area] || {};
    mesaGrid.innerHTML = "";
    seatsPanel.classList.add("hidden");

    for (let numMesa = 1; numMesa <= config.cantidadMesas; numMesa++) {
      const sillasOcupadas = ocupacion[numMesa] || [];
      const mesaLlena = sillasOcupadas.length >= config.sillasPorMesa;

      const mesaEl = document.createElement("button");
      mesaEl.type = "button";
      mesaEl.className = "mesa-item" + (mesaLlena ? " mesa-item--occupied" : "");
      mesaEl.textContent = numMesa;
      mesaEl.title = mesaLlena
        ? `Mesa ${numMesa} - sin sillas disponibles`
        : `Mesa ${numMesa} - ${config.sillasPorMesa - sillasOcupadas.length} silla(s) disponible(s)`;
      mesaEl.disabled = mesaLlena;

      mesaEl.addEventListener("click", () => {
        mesaGrid.querySelectorAll(".mesa-item").forEach((el) => el.classList.remove("mesa-item--selected"));
        mesaEl.classList.add("mesa-item--selected");
        renderSillas(area, numMesa, config.sillasPorMesa, sillasOcupadas);
      });

      mesaGrid.appendChild(mesaEl);
    }
  }

  function renderSillas(area, numMesa, sillasPorMesa, sillasOcupadas) {
    seatsPanel.classList.remove("hidden");
    mesaSeleccionadaLabel.textContent = numMesa;
    sillaGrid.innerHTML = "";
    mesaInput.value = "";
    sillaInput.value = "";
    seleccionActual.textContent = "";

    for (let numSilla = 1; numSilla <= sillasPorMesa; numSilla++) {
      const ocupada = sillasOcupadas.includes(numSilla);
      const sillaEl = document.createElement("button");
      sillaEl.type = "button";
      sillaEl.className = "silla-item" + (ocupada ? " silla-item--occupied" : "");
      sillaEl.textContent = numSilla;
      sillaEl.disabled = ocupada;

      sillaEl.addEventListener("click", () => {
        sillaGrid.querySelectorAll(".silla-item").forEach((el) => el.classList.remove("silla-item--selected"));
        sillaEl.classList.add("silla-item--selected");
        mesaInput.value = numMesa;
        sillaInput.value = numSilla;
        setError("mesa", "");
        seleccionActual.textContent = `Seleccionaste: Mesa ${numMesa}, Silla ${numSilla} (Área ${AREA_LABELS[area]})`;
      });

      sillaGrid.appendChild(sillaEl);
    }
  }

  // ---------- Validación simple ----------
  function setError(fieldName, message) {
    const el = document.querySelector(`.error[data-for="${fieldName}"]`);
    if (el) el.textContent = message || "";
    const input = document.getElementById(fieldName);
    if (input) input.classList.toggle("invalid", Boolean(message));
  }

  function validarRegistro() {
    let valido = true;

    if (!document.getElementById("nombre").value.trim()) {
      setError("nombre", "Ingresa el nombre.");
      valido = false;
    } else setError("nombre", "");

    if (!document.getElementById("apellido").value.trim()) {
      setError("apellido", "Ingresa el apellido.");
      valido = false;
    } else setError("apellido", "");

    const documento = document.getElementById("documento").value.trim();
    if (!documento) {
      setError("documento", "Ingresa la cédula/CPF.");
      valido = false;
    } else setError("documento", "");

    const areaSeleccionada = document.querySelector('input[name="area"]:checked');
    if (!areaSeleccionada) {
      setError("area", "Selecciona un área.");
      valido = false;
    } else {
      setError("area", "");
      if (AREAS_CON_ASIENTO.includes(areaSeleccionada.value)) {
        if (!mesaInput.value || !sillaInput.value) {
          setError("mesa", "Selecciona una mesa y una silla en el mapa.");
          valido = false;
        } else setError("mesa", "");
      }
    }

    return valido;
  }

  // ---------- Envío del formulario de registro ----------
  formRegistro.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validarRegistro()) return;

    const areaSeleccionada = document.querySelector('input[name="area"]:checked');

    state.nombre = document.getElementById("nombre").value.trim();
    state.apellido = document.getElementById("apellido").value.trim();
    state.documento = document.getElementById("documento").value.trim();
    state.area = areaSeleccionada.value;
    state.precio = Number(areaSeleccionada.dataset.price);
    state.mesa = AREAS_CON_ASIENTO.includes(state.area) ? mesaInput.value : "";
    state.silla = AREAS_CON_ASIENTO.includes(state.area) ? sillaInput.value : "";
    state.codigoEntrada = generarCodigoEntrada();

    renderResumenPedido();
    generarQrPix();
    iniciarTemporizador(15 * 60);
    goToStep(2);
  });

  btnVolverRegistro.addEventListener("click", () => {
    detenerTemporizador();
    goToStep(1);
  });

  // ---------- Paso 2: resumen del pedido ----------
  function renderResumenPedido() {
    const filaAsiento =
      state.mesa || state.silla
        ? `<div class="row"><span>Mesa / Silla</span><span>Mesa ${state.mesa} · Silla ${state.silla}</span></div>`
        : `<div class="row"><span>Ubicación</span><span>Acceso general (de pie)</span></div>`;

    orderSummary.innerHTML = `
      <div class="row"><span>Comprador</span><span>${state.nombre} ${state.apellido}</span></div>
      <div class="row"><span>Documento</span><span>${state.documento}</span></div>
      <div class="row"><span>Área</span><span>${AREA_LABELS[state.area]}</span></div>
      ${filaAsiento}
      <div class="row"><span>Total a pagar</span><span>R$ ${state.precio.toFixed(2)}</span></div>
    `;
  }

  // ---------- Generación código de entrada único ----------
  function generarCodigoEntrada() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `EVT-${state.area || "GEN"}-${timestamp}-${random}`;
  }

  // ---------- PIX: generación de payload "copia e cola" (EMV) ----------
  function crc16(payload) {
    let polinomio = 0x1021;
    let resultado = 0xffff;

    for (let i = 0; i < payload.length; i++) {
      resultado ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if ((resultado & 0x8000) !== 0) {
          resultado = (resultado << 1) ^ polinomio;
        } else {
          resultado <<= 1;
        }
        resultado &= 0xffff;
      }
    }
    return resultado.toString(16).toUpperCase().padStart(4, "0");
  }

  function emvField(id, value) {
    const length = String(value.length).padStart(2, "0");
    return `${id}${length}${value}`;
  }

  function construirPayloadPix() {
    const chavePix = "evento-vip-fest@pagamento.com";
    const nombreComerciante = "NOCHE VIP FEST".slice(0, 25);
    const ciudad = "SAO PAULO".slice(0, 15);
    const valor = state.precio.toFixed(2);
    const idTransaccion = state.codigoEntrada.slice(0, 25);

    const merchantAccountInfo = emvField("00", "BR.GOV.BCB.PIX") + emvField("01", chavePix);

    let payload =
      emvField("00", "01") +
      emvField("26", merchantAccountInfo) +
      emvField("52", "0000") +
      emvField("53", "986") +
      emvField("54", valor) +
      emvField("58", "BR") +
      emvField("59", nombreComerciante) +
      emvField("60", ciudad) +
      emvField("62", emvField("05", idTransaccion));

    payload += "6304";
    const checksum = crc16(payload);
    return payload + checksum;
  }

  function generarQrPix() {
    const payload = construirPayloadPix();
    pixCodeInput.value = payload;
    qrcodeContainer.innerHTML = "";
    qrInstance = new QRCode(qrcodeContainer, {
      text: payload,
      width: 200,
      height: 200,
      colorDark: "#0f1117",
      colorLight: "#ffffff",
    });
  }

  btnCopyPix.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pixCodeInput.value);
      btnCopyPix.textContent = "¡Copiado!";
      setTimeout(() => (btnCopyPix.textContent = "Copiar"), 1500);
    } catch (err) {
      pixCodeInput.select();
      document.execCommand("copy");
    }
  });

  // ---------- Temporizador de expiración del QR ----------
  function iniciarTemporizador(segundosIniciales) {
    detenerTemporizador();
    let segundosRestantes = segundosIniciales;
    actualizarTimerUI(segundosRestantes);

    timerInterval = setInterval(() => {
      segundosRestantes -= 1;
      actualizarTimerUI(segundosRestantes);
      if (segundosRestantes <= 0) {
        detenerTemporizador();
        alert("El código PIX expiró. Genera uno nuevo.");
        generarQrPix();
        iniciarTemporizador(15 * 60);
      }
    }, 1000);
  }

  function actualizarTimerUI(segundos) {
    const minutos = Math.floor(segundos / 60).toString().padStart(2, "0");
    const segs = (segundos % 60).toString().padStart(2, "0");
    timerEl.textContent = `${minutos}:${segs}`;
  }

  function detenerTemporizador() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ---------- Confirmar pago (simulado) -> Paso 3 ----------
  btnConfirmarPago.addEventListener("click", () => {
    detenerTemporizador();
    if (AREAS_CON_ASIENTO.includes(state.area) && state.mesa && state.silla) {
      guardarSillaOcupada(state.area, state.mesa, state.silla);
    }
    registrarEntradaEmitida();
    renderTicket();
    goToStep(3);
  });

  // ---------- Registro de la entrada emitida (para validar "ya utilizada") ----------
  const CLAVE_ENTRADAS = "entradasEmitidasEvento";

  function registrarEntradaEmitida() {
    let entradas = {};
    try {
      entradas = JSON.parse(localStorage.getItem(CLAVE_ENTRADAS)) || {};
    } catch (e) {
      entradas = {};
    }
    entradas[state.codigoEntrada] = {
      nombre: state.nombre,
      apellido: state.apellido,
      documento: state.documento,
      area: state.area,
      mesa: state.mesa,
      silla: state.silla,
      usada: false,
    };
    localStorage.setItem(CLAVE_ENTRADAS, JSON.stringify(entradas));
  }

  // ---------- Construcción de la URL de verificación (firmada) ----------
  function construirUrlVerificacion() {
    const firma = firmarTicket(
      state.codigoEntrada,
      state.nombre,
      state.apellido,
      state.area,
      state.mesa,
      state.silla
    );
    const params = new URLSearchParams({
      codigo: state.codigoEntrada,
      nombre: state.nombre,
      apellido: state.apellido,
      area: state.area,
      mesa: state.mesa || "",
      silla: state.silla || "",
      firma,
    });
    const base = window.location.href.replace(/index\.html.*$/i, "").replace(/\/?$/, "/");
    return `${base}verificar.html?${params.toString()}`;
  }

  function renderTicket() {
    const filaAsiento =
      state.mesa || state.silla
        ? `<div class="row"><strong>Mesa / Silla:</strong> Mesa ${state.mesa} · Silla ${state.silla}</div>`
        : `<div class="row"><strong>Ubicación:</strong> Acceso general (de pie)</div>`;

    const urlVerificacion = construirUrlVerificacion();

    ticketEl.innerHTML = `
      <div class="ticket__info">
        <span class="ticket__area ticket__area--${state.area}">${AREA_LABELS[state.area]}</span>
        <h3>${state.nombre} ${state.apellido}</h3>
        <div class="row"><strong>Documento:</strong> ${state.documento}</div>
        ${filaAsiento}
        <div class="row"><strong>Código de entrada:</strong> ${state.codigoEntrada}</div>
        <div class="row"><strong>Total pagado:</strong> R$ ${state.precio.toFixed(2)}</div>
        <p class="ticket__qr-hint">Escanea este QR con la cámara del celular para verificar la entrada</p>
      </div>
      <div class="ticket__qr" id="ticketQr"></div>
    `;

    const ticketQrContainer = document.getElementById("ticketQr");
    new QRCode(ticketQrContainer, {
      text: urlVerificacion,
      width: 150,
      height: 150,
      colorDark: "#0f1117",
      colorLight: "#ffffff",
    });
  }

  // ---------- Nueva compra: reinicia el flujo ----------
  btnNuevaCompra.addEventListener("click", () => {
    formRegistro.reset();
    seatFields.classList.add("hidden");
    generalHint.classList.add("hidden");
    seatsPanel.classList.add("hidden");
    seleccionActual.textContent = "";
    mesaGrid.innerHTML = "";
    sillaGrid.innerHTML = "";
    document.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
    document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    goToStep(1);
  });

  // ---------- Estado inicial ----------
  goToStep(1);
})();
