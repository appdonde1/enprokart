/* Gráficas en SVG, sin librerías externas.

   Todas las series son únicas, así que el color no distingue nada: la identidad
   la llevan las etiquetas y un solo tono transporta la magnitud. Los colores de
   marca (dorado, ámbar, plateado) se descartaron como paleta categórica porque
   dorado y ámbar son indistinguibles incluso con visión normal. */

(function () {
  "use strict";

  const INK = "#f2f2f5";
  const MUTED = "#9aa0ab";
  const GRID = "#2a2f3f";
  const SURFACE = "#1e222f";
  const SERIE = "#ffb703";
  const TRACK = "rgba(255,183,3,0.16)";

  function esc(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function vacio(mensaje) {
    return `<p class="chart-empty">${esc(mensaje)}</p>`;
  }

  window.charts = {
    /* Barras horizontales: nombres de sección largos y comparación de magnitud. */
    barrasHorizontales(container, datos, formatearValor) {
      if (!datos.length || datos.every((d) => d.value === 0)) {
        container.innerHTML = vacio("Todavía no hay ventas confirmadas.");
        return;
      }

      const filaAlto = 42;
      const barraAlto = 18;
      const anchoEtiqueta = 132;
      const anchoValor = 92;
      const ancho = 560;
      const alto = datos.length * filaAlto + 8;
      const maxValor = Math.max(...datos.map((d) => d.value));
      const anchoPista = ancho - anchoEtiqueta - anchoValor;

      const filas = datos.map((d, i) => {
        const y = i * filaAlto + 10;
        const largo = maxValor > 0 ? Math.max(2, (d.value / maxValor) * anchoPista) : 2;
        return `
          <text x="0" y="${y + barraAlto / 2 + 4}" fill="${MUTED}" font-size="12">${esc(d.label)}</text>
          <rect x="${anchoEtiqueta}" y="${y}" width="${largo}" height="${barraAlto}"
                fill="${SERIE}" rx="4"
                style="clip-path: inset(0 0 0 0 round 0 4px 4px 0)"></rect>
          <text x="${anchoEtiqueta + largo + 10}" y="${y + barraAlto / 2 + 4}"
                fill="${INK}" font-size="12" font-weight="600">${esc(formatearValor(d.value))}</text>
        `;
      }).join("");

      container.innerHTML = `
        <svg viewBox="0 0 ${ancho} ${alto}" role="img" class="chart-svg">
          <title>Recaudación por sección</title>
          ${filas}
        </svg>
      `;
    },

    /* Medidores: una razón contra un límite. Pista = paso claro del mismo tono. */
    medidores(container, datos) {
      if (!datos.length) {
        container.innerHTML = vacio("Sin secciones configuradas.");
        return;
      }

      container.innerHTML = datos.map((d) => {
        const pct = d.total > 0 ? Math.round((d.usados / d.total) * 100) : 0;
        return `
          <div class="meter">
            <div class="meter__head">
              <span>${esc(d.label)}</span>
              <span class="meter__value">${d.usados} / ${d.total > 0 ? d.total : "sin límite"}</span>
            </div>
            <div class="meter__track" role="img"
                 aria-label="${esc(d.label)}: ${pct}% ocupado">
              <div class="meter__fill" style="width:${d.total > 0 ? pct : 0}%"></div>
            </div>
          </div>
        `;
      }).join("");
    },

    /* Línea temporal: una sola serie, valor rotulado solo en el extremo. */
    lineaTemporal(container, puntos) {
      if (!puntos.length || puntos.every((p) => p.value === 0)) {
        container.innerHTML = vacio("Todavía no hay ventas confirmadas.");
        return;
      }

      const ancho = 720;
      const alto = 220;
      const margen = { top: 18, right: 54, bottom: 34, left: 44 };
      const areaAncho = ancho - margen.left - margen.right;
      const areaAlto = alto - margen.top - margen.bottom;

      const maxValor = Math.max(...puntos.map((p) => p.value), 1);
      const tope = Math.ceil(maxValor / 5) * 5 || 5;

      const px = (i) => margen.left + (puntos.length === 1 ? areaAncho / 2 : (i / (puntos.length - 1)) * areaAncho);
      const py = (v) => margen.top + areaAlto - (v / tope) * areaAlto;

      const linea = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(" ");
      const area = `${linea} L${px(puntos.length - 1).toFixed(1)},${margen.top + areaAlto} L${px(0).toFixed(1)},${margen.top + areaAlto} Z`;

      const ticks = [0, tope / 2, tope].map((v) => `
        <line x1="${margen.left}" y1="${py(v)}" x2="${ancho - margen.right}" y2="${py(v)}"
              stroke="${GRID}" stroke-width="1"></line>
        <text x="${margen.left - 8}" y="${py(v) + 4}" fill="${MUTED}" font-size="11"
              text-anchor="end" style="font-variant-numeric: tabular-nums">${v}</text>
      `).join("");

      const etiquetasX = puntos.map((p, i) => {
        if (puntos.length > 7 && i % 2 !== 0 && i !== puntos.length - 1) return "";
        return `<text x="${px(i)}" y="${alto - 12}" fill="${MUTED}" font-size="10"
                      text-anchor="middle">${esc(p.label)}</text>`;
      }).join("");

      const ultimo = puntos[puntos.length - 1];

      container.innerHTML = `
        <svg viewBox="0 0 ${ancho} ${alto}" role="img" class="chart-svg">
          <title>Entradas pagadas por día</title>
          ${ticks}
          <path d="${area}" fill="${SERIE}" opacity="0.1"></path>
          <path d="${linea}" fill="none" stroke="${SERIE}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"></path>
          <circle cx="${px(puntos.length - 1)}" cy="${py(ultimo.value)}" r="4.5"
                  fill="${SERIE}" stroke="${SURFACE}" stroke-width="2"></circle>
          <text x="${px(puntos.length - 1)}" y="${py(ultimo.value) - 12}"
                fill="${INK}" font-size="12" font-weight="600" text-anchor="middle">${ultimo.value}</text>
          ${etiquetasX}
        </svg>
      `;
    },

    kpis(container, items) {
      container.innerHTML = items.map((item, i) => `
        <div class="kpi ${i === 0 ? "kpi--hero" : ""}">
          <span class="kpi__label">${esc(item.label)}</span>
          <span class="kpi__value">${esc(item.value)}</span>
          ${item.detail ? `<span class="kpi__detail">${esc(item.detail)}</span>` : ""}
        </div>
      `).join("");
    },
  };

  window.CHART_TOKENS = { SERIE, TRACK, MUTED, INK };
})();
