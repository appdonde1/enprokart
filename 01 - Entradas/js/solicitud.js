/* Envío de los formularios públicos: empleo y publicidad.

   Las validaciones de acá son una cortesía para quien completa el formulario:
   avisan antes de mandar. La validación que manda es la de la Edge Function,
   que no confía en nada de esto. */

window.ProKartSolicitud = (() => {
  const cfg = window.PROKART_CONFIG ?? {};
  const $ = (id) => document.getElementById(id);

  const PALABRAS_MINIMAS = 6;
  const MAX_CV_BYTES = 5 * 1024 * 1024;
  const EXTENSIONES = ["pdf", "doc", "docx"];

  function contarPalabras(frase) {
    return String(frase).trim().split(/\s+/).filter((p) => p.length > 1).length;
  }

  function mostrarError(mensaje) {
    const caja = $("formError");
    if (caja) caja.textContent = mensaje ?? "";
  }

  function mostrarGracias(titulo, texto) {
    const form = $("formCard");
    const gracias = $("formGracias");
    if (!form || !gracias) return;
    $("graciasTitulo").textContent = titulo;
    $("graciasTexto").textContent = texto;
    form.hidden = true;
    gracias.hidden = false;
    gracias.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* Lee el archivo como data URL. Se manda en base64 dentro del JSON en vez de
     subirlo directo a Storage: subirlo desde el navegador obligaría a dejar el
     bucket abierto a escritura anónima, y ahí puede escribir cualquiera. */
  function leerArchivo(archivo) {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
      lector.readAsDataURL(archivo);
    });
  }

  function validarArchivo(archivo) {
    if (!archivo) return "Adjunta tu currículum";
    const ext = archivo.name.split(".").pop()?.toLowerCase() ?? "";
    if (!EXTENSIONES.includes(ext)) return "El currículum tiene que ser PDF, DOC o DOCX";
    if (archivo.size > MAX_CV_BYTES) return "El archivo no puede pesar más de 5 MB";
    return null;
  }

  async function enviar(cuerpo) {
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/crear-solicitud`, {
      method: "POST",
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error ?? "No pudimos enviar tu solicitud");
    return datos;
  }

  function conBoton(boton, textoOcupado, tarea) {
    const original = boton.textContent;
    boton.disabled = true;
    boton.textContent = textoOcupado;
    return tarea().finally(() => {
      boton.disabled = false;
      boton.textContent = original;
    });
  }

  return {
    PALABRAS_MINIMAS,
    contarPalabras,
    mostrarError,
    mostrarGracias,
    leerArchivo,
    validarArchivo,
    enviar,
    conBoton,
  };
})();
