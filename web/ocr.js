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
  // Tesseract lee bien con letras de ~25 px: se lleva el lado corto de la foto a ~2800 px
  // (agrandando las fotos pequeñas) sin pasar de 14 Mpx, el máximo seguro en móviles.
  const LADO_CORTO = 2800, MAX_PIXELES = 14e6;

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
  // Para avisar de fotos malas: lado corto más pequeño de las fotos y peor confianza del OCR (0-100)
  let calidad = { ladoCorto: Infinity, confianza: 100 };
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

  /** Zona del papel dentro de la foto (la factura sobre una mesa oscura): se busca en una
   *  copia pequeña el tramo más largo de columnas y filas mayoritariamente claras. */
  function zonaPapel(bmp) {
    const ancho = 240, k = ancho / bmp.width, alto = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas"); c.width = ancho; c.height = alto;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, ancho, alto);
    const px = ctx.getImageData(0, 0, ancho, alto).data, g = new Uint8Array(ancho * alto), hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) { g[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000; hist[g[i]]++; }
    // umbral de Otsu entre papel (claro) y fondo
    let suma = 0; for (let v = 0; v < 256; v++) suma += v * hist[v];
    let sB = 0, wB = 0, mejor = 0, umbral = 128;
    for (let v = 0; v < 256; v++) {
      wB += hist[v]; if (!wB) continue;
      const wF = g.length - wB; if (!wF) break;
      sB += v * hist[v];
      const dif = sB / wB - (suma - sB) / wF, var_ = wB * wF * dif * dif;
      if (var_ > mejor) { mejor = var_; umbral = v; }
    }
    const tramo = (n, claroEn) => {
      let mejorT = [0, n], ini = 0, largo = 0, best = 0;
      for (let i = 0; i < n; i++) {
        if (claroEn(i) > 0.5) { if (!largo) ini = i; largo++; if (largo > best) { best = largo; mejorT = [ini, i + 1]; } }
        else largo = 0;
      }
      return mejorT;
    };
    const [c0, c1] = tramo(ancho, (x) => { let n = 0; for (let y = 0; y < alto; y++) n += g[y * ancho + x] > umbral; return n / alto; });
    const [f0, f1] = tramo(alto, (y) => { let n = 0; for (let x = c0; x < c1; x++) n += g[y * ancho + x] > umbral; return n / (c1 - c0); });
    const m = 3, x0 = Math.max(0, c0 - m), x1 = Math.min(ancho, c1 + m), y0 = Math.max(0, f0 - m), y1 = Math.min(alto, f1 + m);
    // solo se recorta si el papel no ocupa ya casi toda la foto y el recorte es razonable
    const frac = ((x1 - x0) * (y1 - y0)) / (ancho * alto);
    if (frac > 0.85 || (x1 - x0) < ancho * 0.15 || (y1 - y0) < alto * 0.15) return { x: 0, y: 0, w: bmp.width, h: bmp.height };
    return { x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
  }

  /** Foto -> lienzo enderezado (EXIF), recortado al papel, escalado, en gris y con la luz
   *  igualada (las sombras y reflejos se corrigen dividiendo por el brillo de cada zona). */
  async function prepararImagen(fuente, factor = 1, suavizado = "high") {
    const esFoto = !(fuente instanceof HTMLCanvasElement) && !(fuente instanceof ImageBitmap);
    const bmp = esFoto ? await createImageBitmap(fuente, { imageOrientation: "from-image" }) : fuente;
    if (esFoto) calidad.ladoCorto = Math.min(calidad.ladoCorto, Math.min(bmp.width, bmp.height));
    const z = esFoto || fuente instanceof ImageBitmap ? zonaPapel(bmp) : { x: 0, y: 0, w: bmp.width, h: bmp.height };
    const k = factor * Math.min(LADO_CORTO / Math.min(z.w, z.h), Math.sqrt(MAX_PIXELES / (z.w * z.h)));
    const W = Math.round(z.w * k), H = Math.round(z.h * k);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = suavizado;   // "low" = bilineal
    ctx.drawImage(bmp, z.x, z.y, z.w, z.h, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H), px = img.data;
    for (let i = 0; i < px.length; i += 4) px[i] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    // brillo del fondo: media de una ventana grande, calculada en una versión 4 veces más pequeña
    const w4 = Math.ceil(W / 4), h4 = Math.ceil(H / 4), peq = new Float64Array(w4 * h4), cnt = new Uint16Array(w4 * h4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = (y >> 2) * w4 + (x >> 2); peq[j] += px[(y * W + x) * 4]; cnt[j]++; }
    for (let j = 0; j < peq.length; j++) peq[j] /= cnt[j];
    const ii = new Float64Array((w4 + 1) * (h4 + 1));
    for (let y = 0; y < h4; y++) for (let x = 0, fila = 0; x < w4; x++) {
      fila += peq[y * w4 + x]; ii[(y + 1) * (w4 + 1) + x + 1] = ii[y * (w4 + 1) + x + 1] + fila;
    }
    const r = Math.max(4, Math.floor(Math.min(w4, h4) / 12)), fondo = new Float32Array(w4 * h4);
    for (let y = 0; y < h4; y++) {
      const a0 = Math.max(0, y - r), a1 = Math.min(h4, y + r + 1);
      for (let x = 0; x < w4; x++) {
        const b0 = Math.max(0, x - r), b1 = Math.min(w4, x + r + 1);
        const s = ii[a1 * (w4 + 1) + b1] - ii[a0 * (w4 + 1) + b1] - ii[a1 * (w4 + 1) + b0] + ii[a0 * (w4 + 1) + b0];
        fondo[y * w4 + x] = s / ((a1 - a0) * (b1 - b0));
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, v = Math.min(255, (px[i] / Math.max(1, fondo[(y >> 2) * w4 + (x >> 2)])) * 235);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Une las líneas que Tesseract devuelve por bloques en renglones (ver ReglasFactura.renglonesOcr). */
  function lineasDe(data) {
    return (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).map((l) => ({
      palabras: (l.words || []).map((w) => ({ texto: w.text, confianza: w.confidence, ...w.bbox })),
    }))));
  }

  /** OCR de una página. El resultado de Tesseract cambia mucho con pequeños cambios de la
   *  imagen, así que se prueban variantes hasta que la suma de las líneas cuadra con el total
   *  (normalmente a la primera) y, si ninguna cuadra, se queda la que mejor puntúa.
   *  lienzo(variante) prepara la imagen con ese filtro de escalado. */
  async function ocr(lienzo, pagina, paginas, progreso) {
    const w = await obtenerTrabajador();
    const pasadas = [
      { modo: "6", variante: "high" },   // bloque único: lee renglones completos (tiques y tablas)
      { modo: "6", variante: "low" },    // lo mismo con otro filtro al agrandar la foto
      { modo: "3", variante: "high" },   // segmentación automática (facturas con varias columnas)
    ];
    const imagenes = {};
    let mejor = null;
    for (let n = 0; n < pasadas.length; n++) {
      const { modo, variante } = pasadas[n];
      avisar = (m) => {
        if (m.status === "recognizing text") progreso(`Leyendo página ${pagina} de ${paginas}${n ? ` (intento ${n + 1})` : ""}… ${Math.round(m.progress * 100)}%`);
        else if (/load/.test(m.status)) progreso("Preparando el lector (solo tarda la primera vez)…");
      };
      imagenes[variante] = imagenes[variante] || await lienzo(variante);
      await w.setParameters({ tessedit_pageseg_mode: modo });
      const { data } = await w.recognize(imagenes[variante], {}, { blocks: true, text: true });
      const lineas = lineasDe(data);
      const texto = lineas.length ? ReglasFactura.renglonesOcr(lineas) : (data.text || "");
      const nota = ReglasFactura.puntuar(texto);
      if (!mejor || nota.puntos > mejor.nota.puntos) mejor = { texto, nota, confianza: data.confidence };
      if (nota.cuadra) break;
    }
    calidad.confianza = Math.min(calidad.confianza, mejor.confianza);
    return mejor.texto;
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
      if (texto.replace(/\s/g, "").length > 40) { textos.push(texto); continue; }   // PDF con texto: sin OCR
      const vista = pag.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas");
      c.width = vista.width; c.height = vista.height;
      await pag.render({ canvasContext: c.getContext("2d"), viewport: vista }).promise;
      textos.push(await ocr((v) => prepararImagen(c, 1, v), n, pdf.numPages, progreso));
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
      // algunos PDF repiten cada texto encima de sí mismo (efecto negrita): "SubtotalSubtotal"
      if (f.trozos.some((o) => o.str === it.str && Math.abs(o.x - x) < alto * 0.6)) continue;
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
    calidad = { ladoCorto: Infinity, confianza: 100 };
    const textos = [];
    let i = 0;
    for (const f of ficheros) {
      i++;
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) textos.push(await textoPdf(f, progreso));
      else {
        progreso(`Preparando página ${i} de ${ficheros.length}…`);
        let bmp;
        try { bmp = await createImageBitmap(f, { imageOrientation: "from-image" }); }
        catch (e) { throw new Error(`No se pudo abrir ${f.name || "la imagen"}. Usa JPG, PNG o WEBP.`); }
        calidad.ladoCorto = Math.min(calidad.ladoCorto, Math.min(bmp.width, bmp.height));
        textos.push(await ocr((v) => prepararImagen(bmp, 1, v), i, ficheros.length, progreso));
      }
    }
    return textos.join("\n");
  }

  /** Aviso para el usuario si la lectura ha salido mal (pobre = pocos datos encontrados), o null. */
  function avisoCalidad(pobre) {
    if (!pobre) return null;
    const motivos = [];
    if (calidad.ladoCorto < 1400) motivos.push(`la foto es pequeña (${calidad.ladoCorto} px de ancho; las fotos reenviadas por WhatsApp pierden resolución)`);
    if (calidad.confianza < 75) motivos.push("el texto se ha leído con dificultad (foto borrosa, inclinada, con sombras o arrugada)");
    return "Lectura de baja calidad" + (motivos.length ? `: ${motivos.join("; ")}` : "") +
      ". Para mejorar: usa la foto original de la cámara, acércate hasta que la factura llene la foto " +
      "(si es grande o muy larga, hazla en dos fotos —arriba y abajo— y añade las dos), con buena luz " +
      "y la hoja plana, o usa el modo IA.";
  }

  window.LectorGratis = { leerTexto, avisoCalidad, CDN };
})();
