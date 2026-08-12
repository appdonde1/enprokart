/* Validación de entradas.
   La decisión la toma siempre el servidor (Edge Function verify-ticket): acá no
   se valida ninguna firma ni se marca nada localmente. */

(function () {
  "use strict";

  const db = window.supabaseClient;

  const loginCard = document.getElementById("loginCard");
  const scanCard = document.getElementById("scanCard");
  const resultCard = document.getElementById("resultCard");
  const loginForm = document.getElementById("loginForm");
  const codeForm = document.getElementById("codeForm");
  const codigoInput = document.getElementById("codigo");
  const btnLogin = document.getElementById("btnLogin");
  const btnValidar = document.getElementById("btnValidar");
  const btnLogout = document.getElementById("btnLogout");
  const staffInfo = document.getElementById("staffInfo");

  const params = new URLSearchParams(window.location.search);
  const codigoEscaneado = params.get("codigo");
  const firmaEscaneada = params.get("firma");

  function setError(campo, mensaje) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (el) el.textContent = mensaje || "";
  }

  async function sesionActual() {
    const { data } = await db.auth.getSession();
    return data.session || null;
  }

  async function mostrarVista() {
    const session = await sesionActual();

    loginCard.classList.toggle("hidden", Boolean(session));
    scanCard.classList.toggle("hidden", !session);

    if (!session) return;

    staffInfo.textContent = `Sesión: ${session.user.email}`;

    if (codigoEscaneado) {
      codigoInput.value = codigoEscaneado;
      await validar(codigoEscaneado, firmaEscaneada);
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("login", "");
    btnLogin.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });

    btnLogin.disabled = false;

    if (error) {
      setError("login", "Correo o contraseña incorrectos.");
      return;
    }
    loginForm.reset();
    await mostrarVista();
  });

  btnLogout.addEventListener("click", async () => {
    await db.auth.signOut();
    resultCard.classList.add("hidden");
    // Quita el código de la URL para que al recargar no se revalide solo.
    window.history.replaceState({}, "", window.location.pathname);
    await mostrarVista();
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const codigo = codigoInput.value.trim();
    if (!codigo) {
      setError("codigo", "Ingresa o escanea un código.");
      return;
    }
    await validar(codigo, null);
  });

  async function validar(codigo, firma) {
    setError("codigo", "");
    btnValidar.disabled = true;
    btnValidar.textContent = "Validando...";

    const session = await sesionActual();
    const payload = { code: codigo };
    if (firma) payload.signature = firma;

    const { data } = await window.callFunction("verify-ticket", payload, session?.access_token);

    btnValidar.disabled = false;
    btnValidar.textContent = "Validar";
    renderResultado(data);
  }

  function renderResultado(data) {
    resultCard.classList.remove("hidden", "verify-card--valida", "verify-card--invalida", "verify-card--usada");
    resultCard.classList.add("verify-card");

    const ticket = data.ticket;

    if (data.result === "valid") {
      resultCard.classList.add("verify-card--valida");
      resultCard.innerHTML = `
        <div class="verify-card__icon">✅</div>
        <p class="verify-card__status">Entrada válida</p>
        ${detalles(ticket)}
      `;
      return;
    }

    if (data.result === "already_used") {
      const cuando = data.used_at ? new Date(data.used_at).toLocaleString("es") : "antes";
      const quien = data.used_by_name ? ` por ${data.used_by_name}` : "";
      resultCard.classList.add("verify-card--usada");
      resultCard.innerHTML = `
        <div class="verify-card__icon">⚠️</div>
        <p class="verify-card__status">Entrada ya utilizada</p>
        <p class="hint">Se validó ${cuando}${quien}.</p>
        ${detalles(ticket)}
      `;
      return;
    }

    resultCard.classList.add("verify-card--invalida");
    const mensaje = data.result === "canceled"
      ? "Entrada cancelada"
      : data.tampered
      ? "El código QR fue alterado"
      : data.error || "Entrada inexistente";

    resultCard.innerHTML = `
      <div class="verify-card__icon">❌</div>
      <p class="verify-card__status">${mensaje}</p>
      ${ticket ? detalles(ticket) : ""}
    `;
  }

  function detalles(ticket) {
    if (!ticket) return "";
    const ubicacion = ticket.seat_number
      ? `Mesa ${ticket.table_number} · Silla ${ticket.seat_number}`
      : "Acceso general (de pie)";

    return `
      <div class="verify-card__details">
        <div class="row"><span>Sección</span><span><strong>${ticket.section_label}</strong></span></div>
        <div class="row"><span>Ubicación</span><span>${ubicacion}</span></div>
        <div class="row"><span>Invitado</span><span>${ticket.buyer_name} ${ticket.buyer_lastname}</span></div>
        <div class="row"><span>Código</span><span>${ticket.code}</span></div>
      </div>
    `;
  }

  mostrarVista();
})();
