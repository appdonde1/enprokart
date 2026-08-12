/* Gestión de la publicidad: piezas vitalicias y campañas por fecha.

   Las imágenes van al bucket `publicidad`, que es público de lectura y solo
   escribible por un admin (política sobre storage.objects con is_admin()). Se
   suben con la sesión abierta desde acá, no por Edge Function: el archivo ya
   está en el navegador de quien tiene permiso, y hacerlo pasar por base64 solo
   agregaría un rebote. */

(() => {
  const P = window.PanelBase;
  const $ = (id) => document.getElementById(id);
  const cfg = window.PROKART_CONFIG;

  const urlPublica = (ruta) =>
    `${cfg.SUPABASE_URL}/storage/v1/object/public/publicidad/${ruta}`;

  function setError(campo, mensaje, ok = false) {
    const el = document.querySelector(`.error[data-for="${campo}"]`);
    if (!el) return;
    el.textContent = mensaje || "";
    el.classList.toggle("error--ok", ok);
  }

  // El nombre del archivo confirma que se eligió algo.
  function conectarArchivo(inputId, botonId, textoBase) {
    $(inputId)?.addEventListener("change", () => {
      const archivo = $(inputId).files[0];
      $(botonId).textContent = archivo ? archivo.name : textoBase;
      $(botonId).classList.toggle("cargado", Boolean(archivo));
    });
  }

  async function subir(archivo, slot) {
    const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
    // El nombre lleva marca de tiempo para que reemplazar una pieza no quede
    // tapado por la caché del navegador de quien ya la vio.
    const ruta = `${slot}-${Date.now()}.${extension}`;

    const { error } = await P.db.storage
      .from("publicidad")
      .upload(ruta, archivo, { cacheControl: "3600", upsert: false });

    if (error) throw new Error(`No se pudo subir la imagen: ${error.message}`);
    return ruta;
  }

  // ------------------------------------------------------------ al aire hoy
  async function pintarAlAire() {
    const { data } = await P.db
      .from("ads_public")
      .select("slot, image_path, link_url, es_vitalicia");

    const piezas = Object.fromEntries((data ?? []).map((f) => [f.slot, f]));

    $("alAire").innerHTML = ["banner", "overlay"].map((slot) => {
      const p = piezas[slot];
      if (!p) {
        return `
          <div class="al-aire__caja">
            <h4>${slot === "banner" ? "Banner" : "Overlay"}</h4>
            <p class="vacio">Sin pieza cargada. El espacio no se muestra.</p>
          </div>`;
      }
      return `
        <div class="al-aire__caja">
          <h4>
            ${slot === "banner" ? "Banner" : "Overlay"}
            <span class="etiqueta">${p.es_vitalicia ? "vitalicia" : "campaña"}</span>
          </h4>
          <img src="${P.esc(urlPublica(p.image_path))}" alt="" class="al-aire__img" />
          <p class="ficha__dato"><b>Lleva a</b>
            ${P.esc(p.link_url || (p.es_vitalicia ? "anunciar.html" : "sin enlace"))}</p>
        </div>`;
    }).join("");
  }

  // ------------------------------------------------------------ vitalicias
  async function cargarVitalicias() {
    const { data } = await P.db
      .from("ad_creatives")
      .select("id, slot, image_path, link_url")
      .eq("is_evergreen", true);

    for (const slot of ["banner", "overlay"]) {
      const pieza = (data ?? []).find((p) => p.slot === slot);
      const previa = $(slot === "banner" ? "previaBanner" : "previaOverlay");
      const link = $(slot === "banner" ? "vBannerLink" : "vOverlayLink");

      if (pieza) {
        previa.innerHTML = `<img src="${P.esc(urlPublica(pieza.image_path))}" alt="" />`;
        link.value = pieza.link_url ?? "";
      } else {
        previa.innerHTML = `<p class="vacio">Sin imagen cargada</p>`;
      }
    }
  }

  async function guardarVitalicia(slot) {
    setError("vitalicia", "");
    const archivo = $(slot === "banner" ? "vBannerArchivo" : "vOverlayArchivo").files[0];
    const enlace = $(slot === "banner" ? "vBannerLink" : "vOverlayLink").value.trim() || null;

    try {
      const { data: actual } = await P.db
        .from("ad_creatives").select("id, image_path")
        .eq("is_evergreen", true).eq("slot", slot).maybeSingle();

      let ruta = actual?.image_path;
      if (archivo) ruta = await subir(archivo, `vitalicia-${slot}`);
      if (!ruta) { setError("vitalicia", "Elegí una imagen para esta pieza."); return; }

      if (actual) {
        await P.db.from("ad_creatives")
          .update({ image_path: ruta, link_url: enlace })
          .eq("id", actual.id);
      } else {
        await P.db.from("ad_creatives")
          .insert({ slot, image_path: ruta, link_url: enlace, is_evergreen: true });
      }

      setError("vitalicia", "Guardado.", true);
      await cargarVitalicias();
      await pintarAlAire();
    } catch (error) {
      setError("vitalicia", error.message);
    }
  }

  // ------------------------------------------------------------ campañas
  async function pintarCampanas() {
    const { data } = await P.db
      .from("ad_campaigns")
      .select("id, name, advertiser, starts_on, ends_on, active, ad_creatives(slot)")
      .order("starts_on", { ascending: false });

    if (!data?.length) {
      $("tablaCampanas").innerHTML =
        `<tbody><tr><td class="vacio">Todavía no hay campañas.</td></tr></tbody>`;
      return;
    }

    const hoy = new Date().toISOString().slice(0, 10);

    $("tablaCampanas").innerHTML = `
      <thead>
        <tr><th>Campaña</th><th>Anunciante</th><th>Desde</th><th>Hasta</th>
            <th>Piezas</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>
        ${data.map((c) => {
          const vigente = c.active && c.starts_on <= hoy && hoy <= c.ends_on;
          const futura = c.starts_on > hoy;
          const estado = !c.active ? ["Pausada", "gris"]
            : vigente ? ["Al aire", "ok"]
            : futura ? ["Programada", "espera"]
            : ["Terminada", "gris"];

          return `
            <tr>
              <td>${P.esc(c.name)}</td>
              <td>${P.esc(c.advertiser ?? "—")}</td>
              <td class="num">${P.esc(c.starts_on)}</td>
              <td class="num">${P.esc(c.ends_on)}</td>
              <td>${(c.ad_creatives ?? []).map((p) => P.esc(p.slot)).join(", ") || "—"}</td>
              <td><span class="estado estado--${estado[1]}">${estado[0]}</span></td>
              <td>
                <button type="button" class="btn btn--link" data-pausar="${P.esc(c.id)}" data-activa="${c.active}">
                  ${c.active ? "Pausar" : "Reanudar"}
                </button>
                <button type="button" class="btn btn--link ficha__borrar" data-borrar-campana="${P.esc(c.id)}">
                  Eliminar
                </button>
              </td>
            </tr>`;
        }).join("")}
      </tbody>`;
  }

  async function crearCampana() {
    setError("campana", "");

    const nombre = $("cNombre").value.trim();
    const desde = $("cDesde").value;
    const hasta = $("cHasta").value;
    const banner = $("cBannerArchivo").files[0];
    const overlay = $("cOverlayArchivo").files[0];

    if (!nombre) return setError("campana", "Ponele un nombre a la campaña.");
    if (!desde || !hasta) return setError("campana", "Faltan las fechas.");
    if (hasta < desde) return setError("campana", "La fecha de fin es anterior a la de inicio.");
    if (!banner && !overlay) return setError("campana", "Cargá al menos una pieza.");

    const boton = $("btnCrearCampana");
    boton.disabled = true;
    boton.textContent = "Subiendo...";

    try {
      const { data: campana, error } = await P.db
        .from("ad_campaigns")
        .insert({
          name: nombre,
          advertiser: $("cAnunciante").value.trim() || null,
          starts_on: desde,
          ends_on: hasta,
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      const piezas = [];
      if (banner) {
        piezas.push({
          campaign_id: campana.id, slot: "banner",
          image_path: await subir(banner, "campana-banner"),
          link_url: $("cBannerLink").value.trim() || null,
        });
      }
      if (overlay) {
        piezas.push({
          campaign_id: campana.id, slot: "overlay",
          image_path: await subir(overlay, "campana-overlay"),
          link_url: $("cOverlayLink").value.trim() || null,
        });
      }

      const { error: errorPiezas } = await P.db.from("ad_creatives").insert(piezas);
      if (errorPiezas) {
        // Una campaña sin piezas no muestra nada: se deshace para no dejar
        // una fila que aparenta estar al aire.
        await P.db.from("ad_campaigns").delete().eq("id", campana.id);
        throw new Error(errorPiezas.message);
      }

      $("campanaForm").reset();
      $("cBannerArchivo").value = "";
      $("cOverlayArchivo").value = "";
      $("cBannerBoton").textContent = "Elegir imagen del banner";
      $("cOverlayBoton").textContent = "Elegir imagen del overlay";
      $("cBannerBoton").classList.remove("cargado");
      $("cOverlayBoton").classList.remove("cargado");

      setError("campana", "Campaña abierta.", true);
      await pintarCampanas();
      await pintarAlAire();
    } catch (error) {
      setError("campana", error.message);
    }

    boton.disabled = false;
    boton.textContent = "Abrir campaña";
  }

  // ------------------------------------------------------------ arranque
  document.addEventListener("click", async (e) => {
    const boton = e.target.closest("button");
    if (!boton) return;

    if (boton.dataset.guardarVitalicia) {
      await guardarVitalicia(boton.dataset.guardarVitalicia);
    }

    if (boton.dataset.pausar) {
      await P.db.from("ad_campaigns")
        .update({ active: boton.dataset.activa !== "true" })
        .eq("id", boton.dataset.pausar);
      await pintarCampanas();
      await pintarAlAire();
    }

    if (boton.dataset.borrarCampana) {
      if (!confirm("¿Eliminar esta campaña y sus piezas?")) return;
      await P.db.from("ad_campaigns").delete().eq("id", boton.dataset.borrarCampana);
      await pintarCampanas();
      await pintarAlAire();
    }
  });

  (async () => {
    if (!await P.exigirAdmin("publicidad.html")) return;

    P.montarTabsDeModulo();

    conectarArchivo("cBannerArchivo", "cBannerBoton", "Elegir imagen del banner");
    conectarArchivo("cOverlayArchivo", "cOverlayBoton", "Elegir imagen del overlay");
    conectarArchivo("vBannerArchivo", "vBannerBoton", "Reemplazar imagen");
    conectarArchivo("vOverlayArchivo", "vOverlayBoton", "Reemplazar imagen");

    $("btnCrearCampana").addEventListener("click", crearCampana);

    await pintarAlAire();
    await cargarVitalicias();
    await pintarCampanas();
  })();
})();
