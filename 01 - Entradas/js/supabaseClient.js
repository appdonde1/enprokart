/* Cliente Supabase compartido por el sitio público y el dashboard. */

(function () {
  "use strict";

  const config = window.PROKART_CONFIG;

  if (!config || !config.SUPABASE_ANON_KEY || config.SUPABASE_ANON_KEY.startsWith("PEGAR_AQUI")) {
    console.error("Falta configurar la anon key en js/config.js");
    window.PROKART_CONFIG_INCOMPLETA = true;
  }

  window.supabaseClient = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
  );

  // Las Edge Functions no reciben la sesión automáticamente cuando se las llama
  // con fetch, así que este helper arma la cabecera correcta en cada caso.
  window.callFunction = async function callFunction(name, body, accessToken) {
    const response = await fetch(`${config.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${accessToken || config.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body || {}),
    });

    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  };
})();
