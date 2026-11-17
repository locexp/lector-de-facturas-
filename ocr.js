/* Modo gratuito: saca el texto de fotos (Tesseract.js) y PDF (pdf.js) en el propio navegador.
 *
 * Las librerías y el idioma español (~2 MB) se descargan la primera vez y el navegador los
 * guarda; después funciona sin conexión. Las fotos no salen del móvil.
 */
(function () {
  "use strict";

  const CDN = {
    tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    idioma: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int",
    pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
  };
  const LADO_MIN = 1600, LADO_MAX = 2600;   // tamaño de imagen con el que Tesseract lee mejor

  const scripts = {};
  function cargarScript(url) {
    scripts[url] = scripts[url] || new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = url; s.onload = ok;
      s.onerror = () => { delete scripts[url]; mal(new Error("No se pudo descargar el lector gratuito. Necesitas Internet la primera vez.")); };
      document.head.appendChild(s);
    });
    return scripts[url];
  }

  let trabajador = null, avisar = () => {};
  async function obtenerTrabajador() {
    if (!trabajador) {
      trabajador = (async () => {
        await cargarScript(CDN.tesseract);
        const w = await Tesseract.createWorker("spa", 1, {
          workerPath: CDN.worker, corePath: CDN.core, langPath: CDN.idioma,
          logger: (m) => avisar(m),
        });
        // conserva los espacios entre columnas: ayuda a separar descripción, cantidad y precios
        await w.setParameters({ preserve_interword_spaces: "1" });
        return w;
      })().catch((e) => { trabajador = null; throw e; });
    }
    return trabajador;
  }

  /** Foto -> lienzo enderezado (EXIF), escalado y en escala de grises con más contraste. */
  async function prepararImagen(fuente) {
    const bmp = fuente instanceof HTMLCanvasElement ? fuente
      : await createImageBitmap(fuente, { imageOrientation: "from-image" });
    const lado = Math.max(bmp.width, bmp.height);
    const k = lado < LADO_MIN ? LADO_MIN / lado : lado > LADO_MAX ? LADO_MAX / lado : 1;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
    // gris + estirar el contraste entre los percentiles 2 y 98 (fotos con poca luz)
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
      px[i] = g; hist[g]++;
    }
    const total = px.length / 4;
    let lo = 0, hi = 255, acum = 0;
    for (let v = 0; v < 256; v++) { acum += hist[v]; if (acum > total * 0.02) { lo = v; break; } }
    acum = 0;
    for (let v = 255; v >= 0; v--) { acum += hist[v]; if (acum > total * 0.02) { hi = v; break; } }
    const rango = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / rango));
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function ocr(lienzo, pagina, paginas, progreso) {
    avisar = (m) => {
      if (m.status === "recognizing text") progreso(`Leyendo página ${pagina} de ${paginas}… ${Math.round(m.progress * 100)}%`);
      else if (/load/.test(m.status)) progreso("Preparando el lector (solo tarda la primera vez)…");
    };
    const w = await obtenerTrabajador();
    const { data } = await w.recognize(lienzo);
    return data.text || "";
  }

  /** Texto de un PDF: usa su capa de texto si la tiene; si es escaneado, lo pasa por OCR. */
  async function textoPdf(fichero, progreso) {
    progreso("Abriendo PDF…");
    await cargarScript(CDN.pdf);
    pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await pdfjsLib.getDocument({ data: await fichero.arrayBuffer() }).promise;
    const textos = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 10); n++) {
      const pag = await pdf.getPage(n);
      const contenido = await pag.getTextContent();
      const texto = lineasPdf(contenido.items);
      if (texto.replace(/\s/g, "").length > 40) { textos.push(texto); continue; }
      const vista = pag.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas");
      c.width = vista.width; c.height = vista.height;
      await pag.render({ canvasContext: c.getContext("2d"), viewport: vista }).promise;
      textos.push(await ocr(await prepararImagen(c), n, pdf.numPages, progreso));
    }
    return textos.join("\n");
  }

  /** Agrupa los trozos de texto del PDF por renglón (misma altura) y de izquierda a derecha. */
  function lineasPdf(items) {
    const filas = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], alto = Math.abs(it.transform[3]) || 10;
      let f = filas.find((r) => Math.abs(r.y - y) < alto * 0.5);
      if (!f) filas.push(f = { y, trozos: [] });
      f.trozos.push({ x, fin: x + (it.width || 0), str: it.str, alto });
    }
    return filas.sort((a, b) => b.y - a.y).map((f) => {
      f.trozos.sort((a, b) => a.x - b.x);
      let s = "", fin = null;
      for (const t of f.trozos) {
        if (fin !== null) s += t.x - fin > t.alto * 1.2 ? "    " : (t.x - fin > t.alto * 0.15 ? " " : "");
        s += t.str; fin = t.fin;
      }
      return s;
    }).join("\n");
  }

  /** ficheros -> texto de la factura completa (todas las páginas). */
  async function leerTexto(ficheros, progreso = () => {}) {
    const textos = [];
    let i = 0;
    for (const f of ficheros) {
      i++;
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) textos.push(await textoPdf(f, progreso));
      else {
        progreso(`Preparando página ${i} de ${ficheros.length}…`);
        let lienzo;
        try { lienzo = await prepararImagen(f); }
        catch (e) { throw new Error(`No se pudo abrir ${f.name || "la imagen"}. Usa JPG, PNG o WEBP.`); }
        textos.push(await ocr(lienzo, i, ficheros.length, progreso));
      }
    }
    return textos.join("\n");
  }

  window.LectorGratis = { leerTexto, CDN };
})();
