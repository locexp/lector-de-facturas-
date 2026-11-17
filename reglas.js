/* Reglas para sacar los datos de una factura a partir de su texto (modo gratuito).
 *
 * El texto viene del OCR (Tesseract) o de la capa de texto de un PDF. Funciona en el
 * navegador (window.ReglasFactura) y en Node (require) para los tests.
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.ReglasFactura = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- utilidades ----------
  const quitarTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const plano = (s) => quitarTildes(String(s || "")).toLowerCase();
  const red2 = (n) => Math.round(n * 100) / 100;
  const cerca = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

  /** "1.234,56" / "1,234.56" / "12,5" / "99.95 €" -> número (o null). */
  function parsearImporte(texto) {
    let s = String(texto).replace(/[€$£\s]|EUR/gi, "");
    let negativo = /^-|-$|^\(.*\)$/.test(s);
    s = s.replace(/[()\-+]/g, "");
    if (!/\d/.test(s)) return null;
    const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
    if (coma >= 0 && punto >= 0) {
      const dec = coma > punto ? "," : ".";
      s = s.split(dec === "," ? "." : ",").join("").replace(dec, ".");
    } else if (coma >= 0) {
      // una sola coma = decimal (estilo español, también "13,0200"); varias = separador de miles
      s = s.indexOf(",") === coma ? s.replace(",", ".") : s.replace(/,/g, "");
    } else if (punto >= 0) {
      // un solo punto con 3 cifras detrás = miles ("1.234"); con 1-2 o 4 cifras = decimal
      s = s.indexOf(".") !== punto || /\.\d{3}$/.test(s) ? s.replace(/\./g, "") : s;
    }
    const n = Number(s);
    return Number.isFinite(n) ? (negativo ? -n : n) : null;
  }

  // Importe: 1.234,56 | 1234,56 | 1234.56 | 12 (sin decimales solo si se pide)
  const RE_IMPORTE = /-?\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d{1,2})?(?!\d)|-?\d+[.,]\d{1,2}(?!\d)/g;
  const RE_PORCENTAJE = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g;
  const RE_FECHA = /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/;
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];
  const RE_FECHA_LARGA = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES.join("|")}|setiembre)\\s+(?:de\\s+)?(\\d{4})\\b`);

  /** Importes de una línea, sin contar porcentajes, fechas, NIF, teléfonos ni códigos postales. */
  function importes(linea, { enteros = false } = {}) {
    let s = linea
      .replace(RE_PORCENTAJE, " ")
      .replace(new RegExp(RE_FECHA.source, "g"), " ")
      .replace(/\b(?:ES)?[A-Z]?\d{7,8}[A-Z]?\b/g, " ")   // NIF / teléfonos
      .replace(/\b\d{9,}\b/g, " ");
    const res = [];
    const re = enteros ? /-?\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d{1,2})?(?!\d)|-?\d+(?:[.,]\d{1,2})?(?!\d)/g : RE_IMPORTE;
    for (const m of s.matchAll(re)) {
      const n = parsearImporte(m[0]);
      if (n !== null) res.push(n);
    }
    return res;
  }

  function porcentajes(linea) {
    return [...linea.matchAll(RE_PORCENTAJE)].map((m) => parsearImporte(m[1])).filter((n) => n !== null && n <= 30);
  }

  // ---------- NIF / CIF / NIE ----------
  const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

  function nifValido(nif) {
    let n = String(nif || "").toUpperCase().replace(/[\s.\-]/g, "");
    if (n.startsWith("ES")) n = n.slice(2);
    if (/^\d{8}[A-Z]$/.test(n)) return LETRAS_DNI[+n.slice(0, 8) % 23] === n[8];
    if (/^[XYZ]\d{7}[A-Z]$/.test(n)) return LETRAS_DNI[+("XYZ".indexOf(n[0]) + n.slice(1, 8)) % 23] === n[8];
    if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(n)) {
      const d = n.slice(1, 8);
      let pares = 0, impares = 0;
      for (let i = 0; i < 7; i++) {
        const v = +d[i];
        if (i % 2) pares += v; else { const x = v * 2; impares += Math.floor(x / 10) + (x % 10); }
      }
      const c = (10 - ((pares + impares) % 10)) % 10;
      return n[8] === String(c) || n[8] === "JABCDEFGHI"[c];
    }
    return null;
  }

  /** Corrige confusiones típicas del OCR en la parte numérica (O->0, I/l->1). */
  function arreglarNif(c) {
    c = c.toUpperCase().replace(/[\s.\-]/g, "");
    let pre = "";
    if (c.startsWith("ES") && c.length > 9) { pre = "ES"; c = c.slice(2); }
    const num = (s) => s.replace(/O/g, "0").replace(/[IL|]/g, "1");
    if (/^[0-9OIL|]{8}[A-Z]$/.test(c)) c = num(c.slice(0, 8)) + c[8];
    else if (/^[A-Z][0-9OIL|]{7}[0-9A-Z]$/.test(c)) c = c[0] + num(c.slice(1, 8)) + c[8];
    return pre + c;
  }

  const RE_NIF = /\b(?:ES[\s\-]?)?(?:[A-Z][\s.\-]?[0-9OIl|]{2}[.\s]?[0-9OIl|]{3}[.\s]?[0-9OIl|]{2}[\s.\-]?[0-9A-Z]|[0-9OIl|]{2}[.\s]?[0-9OIl|]{3}[.\s]?[0-9OIl|]{3}[\s.\-]?[A-Z])\b/g;

  const LETRA_COMO_NUMERO = { 7: "Z", 2: "Z", 8: "B", 0: "D", 5: "S", 6: "G", 4: "A", 1: "T" };
  const RE_DNI_SIN_LETRA = /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\s.\-]?\d\b/g;
  const CIFRA_COMO_LETRA = { 8: ["B"], 5: ["B", "S"], 6: ["G"], 4: ["A"], 0: ["D", "Q"] };
  const letraCalculada = new Set();

  function buscarNifs(lineas) {
    const res = [];
    lineas.forEach((l, i) => {
      const candidatos = [...l.replace(/(\d{7,8})([a-z])\b/g, (m, a, b) => a + b.toUpperCase()).matchAll(RE_NIF)].map((m) => m[0]);
      if (/\b(nif|dni|cif|nie|n\.i\.f|d\.n\.i)\b/i.test(quitarTildes(l))) {
        for (const m of l.matchAll(RE_DNI_SIN_LETRA)) {
          const d = m[0].replace(/\D/g, ""), letra = LETRA_COMO_NUMERO[d[8]];
          if (letra && nifValido(d.slice(0, 8) + letra)) candidatos.push(d.slice(0, 8) + letra);
          // o es un CIF con la letra del principio leída como cifra: B->8 o 5, G->6, A->4, D->0, S->5
          for (const l0 of CIFRA_COMO_LETRA[d[0]] || []) {
            if (nifValido(l0 + d.slice(1)) && !candidatos.includes(l0 + d.slice(1))) { candidatos.push(l0 + d.slice(1)); break; }
          }
        }
      }
      // DNI sin la letra, solo en su línea ("78105855"): la letra se calcula
      const solo = l.trim().match(/^(?:(?:nif|dni|n\.i\.f\.?)\s*:?\s*)?(\d{8})$/i);
      if (solo) { candidatos.push(solo[1] + LETRAS_DNI[+solo[1] % 23]); letraCalculada.add(solo[1] + LETRAS_DNI[+solo[1] % 23]); }
      for (const c of candidatos) {
        const valor = arreglarNif(c);
        const sinPrefijo = valor.replace(/^ES/, "");
        const ok = nifValido(sinPrefijo);
        if (ok === null) continue;
        if (!res.some((r) => r.valor === sinPrefijo)) res.push({ valor: sinPrefijo, valido: ok, linea: i });
      }
    });
    return res;
  }

  // ---------- IBAN ----------
  function ibanValido(iban) {
    const s = iban.slice(4) + iban.slice(0, 4);
    let resto = 0;
    for (const ch of s) {
      const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const d of v) resto = (resto * 10 + +d) % 97;
    }
    return resto === 1;
  }

  // ---------- palabras clave ----------
  const K = {
    cliente: /\b(cliente|destinatario|facturar a|datos del cliente|comprador|receptor|sr\.?|sra\.?)\b|\bcli[.:]|\bdest[.:]/,
    emisor: /\b(emisor|proveedor|vendedor)\b/,
    total: /\b(total|importe total|a pagar|total factura|liquido)\b|\btot\.|\bimp\.? total\b/,
    noTotal: /\b(subtotal|sub-total|total base|total b\.?\s?i\.?|base|total iva|total impuestos|total cuota|total dto|total descuento|total lineas?|total articulos|total unidades|total uds|total items)\b/,
    base: /\b(base imponible|base imp\.?|b\. ?imponible|total b\.?\s?i|base)\b|\bb\.\s?i\.|\bb\.\s?imp\b/,
    iva: /\b(i\.?v\.?a\.?|cuota)\b/,
    recargo: /\b(recargo|r\.? ?e\.? )\b|\brec\.\s?eq|\brec\.|\br\.\s?e\.|\breq\b/,
    irpf: /\b(irpf|retencion)\b|\bret\./,
    descuento: /\b(descuento|dto\.?|dcto\.?|bonif\.?|bonificacion)\b/,
    nombreEmpresa: /\b(s\.?\s?[li1]\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?|s\.?\s?l\.?\s?l\.?|c\.?\s?b\.?|sociedad|slne)$/,
    direccion: /(^|[^a-z])(c\/|calle|avda|avenida|av\.|plaza|pza|paseo|ctra|carretera|camino|ronda|poligono|pol\.|travesia|urb\.)(?![a-z])|\b\d{5}\b/,
  };

  // ---------- diccionario de nombres de columnas y etiquetas (completos y abreviados) ----------
  // Se comparan en minúsculas, sin tildes, sin puntos y sin dos puntos: "Cód." = "cod", "P.U." = "pu".
  const COLUMNAS = {
    referencia: ["codigo", "cod", "ref", "referencia", "art", "articulo", "ean", "sku", "n art", "num art", "cod art"],
    descripcion: ["descripcion", "desc", "descrip", "descr", "concepto", "concep", "conc", "denominacion", "denom",
      "detalle", "producto", "prod", "designacion", "descripcion articulo", "nombre"],
    cantidad: ["cantidad", "cant", "ctd", "ctdad", "cdad", "ctd total", "cant total", "uds", "ud", "u", "und", "unid",
      "unidades", "u/v", "uv", "qty", "piezas", "pzas", "bultos", "n uds", "n unid"],
    kilos: ["kg", "kgs", "kilos", "peso", "peso kg", "kg neto", "peso neto"],
    precio_kilo: ["€/kg", "eur/kg", "precio kg", "precio/kg", "p/kg", "€ kg", "pvp kg", "precio €/kg"],
    precio: ["precio", "pvp", "pu", "p/u", "p u", "p unit", "p unitario", "precio unit", "precio unitario", "pr unit",
      "precio ud", "precio und", "€/u", "precio €/u", "p ud", "tarifa", "unitario", "importe unit", "precio €", "precio neto"],
    dto: ["dto", "dto %", "% dto", "%dto", "dtos", "%dtos", "% dtos", "dcto", "dcto %", "descuento", "desc %", "% desc",
      "bonif", "dto1", "dto 1", "%dto1"],
    tipo: ["% iva", "%iva", "iva %", "iva", "tipo", "tipo iva", "t iva", "% i v a", "impuestos", "imp %", "% imp", "igic", "% igic"],
    importe: ["importe", "imp", "total", "total linea", "subtotal", "suma", "neto", "valor", "importe neto", "base",
      "base imp", "importe €", "total €", "imp €", "total sin iva", "importe sin iva", "total neto", "imp (€)", "importe (€)"],
    lote: ["lote", "lot", "n lote"],
    caducidad: ["caducidad", "cad", "f cad", "fecha cad", "consumo pref", "cons pref"],
    ignorar: ["cajas", "caja", "u/c", "uc", "prom", "promo", "promocion", "envase", "formato", "unid caja", "uds caja",
      "almacen", "alm", "ubicacion", "iva incl"],
  };
  const DICC_COLUMNAS = new Map(Object.entries(COLUMNAS).flatMap(([k, vs]) => vs.map((v) => [v, k])));
  const normEtiqueta = (t) => plano(t).replace(/\(\s*[€e]\s*\)/g, " ").replace(/[.:,]/g, " ").replace(/\s+/g, " ").trim();

  /** "Cód.  Desc.  Ctd.  P.U.  Dto.  Imp." -> ["referencia", "descripcion", "cantidad", "precio", "dto", "importe"],
   *  o null si la línea no es una cabecera de tabla de productos. */
  function columnasTabla(linea) {
    if (importes(linea).length || /\d{2,}/.test(linea.replace(/dto\s?\d|%/gi, ""))) return null;
    const res = [];
    let desconocidas = 0;
    for (const trozo of linea.trim().split(/\s{2,}/)) {
      const pal = trozo.split(/\s+/);
      for (let i = 0; i < pal.length;) {
        let j = Math.min(pal.length, i + 3), k = null;
        for (; j > i; j--) { k = DICC_COLUMNAS.get(normEtiqueta(pal.slice(i, j).join(" "))); if (k) break; }
        if (k) { res.push(k); i = j; } else { if (normEtiqueta(pal[i])) desconocidas++; i++; }
      }
    }
    const ok = res.length >= 3 && desconocidas <= 1 && (res.includes("descripcion") || res.includes("referencia")) &&
      (res.includes("importe") || res.includes("precio"));
    return ok ? res : null;
  }

  // Títulos de la tabla de totales (resumen de impuestos)
  const RESUMEN = new Map(Object.entries({
    base: ["base", "base imponible", "base imp", "b imp", "b i", "bi", "total b i", "total bi", "b imponible",
      "importe neto", "neto", "subtotal", "total neto", "base €"],
    tipo: ["% iva", "%iva", "iva %", "tipo", "tipo iva", "%", "% igic", "%igic"],
    cuota: ["iva", "cuota", "cuota iva", "i v a", "imp iva", "importe iva", "total iva", "cuota €", "igic", "cuota igic"],
    prec: ["% rec", "%rec", "% re", "%re", "% r e", "%r e", "% req", "%req", "yrec", "tipo rec", "% rec eq"],
    rec: ["rec", "recargo", "r e", "rec eq", "req", "recargo eq", "importe rec", "cuota rec", "cuota re"],
    irpf: ["irpf", "ret", "retencion", "ret irpf", "cuota irpf"],
    dto: ["dto", "descuento", "imp dto", "dcto", "% dto", "%dto", "dto pp"],
    total: ["total", "total factura", "tot", "tot fra", "total fra", "importe total", "a pagar", "total a pagar",
      "liquido", "total €", "total eur"],
  }).flatMap(([k, vs]) => vs.map((v) => [v, k])));

  const NO_NUMERICAS = new Set(["referencia", "descripcion", "lote", "caducidad"]);

  /** Con las columnas de la cabecera, asigna cada número de la línea a su columna. Las columnas
   *  vacías se saltan: se prueban todas las formas de repartir los números (en orden) y se queda
   *  la que cuadra (cantidad x precio - dto = importe, % de IVA válido...). */
  function asignarColumnas(nums, columnas, tipoLeido) {
    let cols = columnas.filter((c) => !NO_NUMERICAS.has(c));
    if (tipoLeido !== null) { const i = cols.lastIndexOf("tipo"); if (i >= 0) cols = cols.filter((_, k) => k !== i); }
    const n = cols.length, k = nums.length;
    if (!k || k > n || n > 12) return null;
    let mejor = null;
    const prueba = (pos) => {
      const a = {};
      pos.forEach((c, i) => { a[cols[c]] = nums[i]; });
      if (a.importe === undefined) return;
      let s = k === n ? 0.5 : 0;
      const q = a.cantidad, p = a.precio, d = a.dto, imp = a.importe;
      if (q !== undefined && p !== undefined) {
        const bruto = q * p * (d ? 1 - d / 100 : 1);
        s += cerca(bruto, imp, 0.021 + Math.abs(q) * 0.00006) || (d && cerca(q * p - d, imp, 0.021)) ? 6 : -2;
      } else if (p !== undefined) s += cerca(p, imp, 0.011) ? 3 : -1;
      if (a.kilos !== undefined && a.precio_kilo !== undefined) s += cerca(red2(a.kilos * a.precio_kilo), imp, 0.011) ? 6 : -2;
      if (a.tipo !== undefined) s += TIPOS_IVA.includes(a.tipo) ? 1 : -6;
      if (d !== undefined) s += d >= 0 && d < 100 ? 0.3 : -6;
      s -= cols.filter((c, i) => !pos.includes(i) && ["cantidad", "precio", "importe"].includes(c)).length * 0.2;
      if (!mejor || s > mejor.s) mejor = { s, a };
    };
    const rec = (ini, pos) => {
      if (pos.length === k) return prueba(pos);
      for (let c = ini; c <= n - (k - pos.length); c++) rec(c + 1, [...pos, c]);
    };
    rec(0, []);
    if (!mejor || mejor.s < (k === n ? 0 : 3)) return null;
    return mejor.a;
  }

  const FORMAS_PAGO = [
    [/\btransferencia\b|\btransf\b|\btrans\.\s?banc/, "Transferencia"], [/\bdomiciliaci[oó]n|recibo domiciliado|adeudo\b/, "Domiciliación"],
    [/\bbizum\b/, "Bizum"], [/\bpaypal\b/, "PayPal"], [/\bpagare\b/, "Pagaré"], [/\bcheque\b/, "Cheque"],
    [/\btarjeta|visa|mastercard|maestro|amex|contactless|datafono\b/, "Tarjeta"],
    [/\befectivo|contado|metalico\b/, "Efectivo"],
  ];

  // ---------- extracción de cabecera ----------
  function fechaDe(linea) {
    let m = linea.match(RE_FECHA);
    if (m) {
      let [, d, mes, a] = m;
      if (a.length === 2) a = "20" + a;
      if (+mes > 12 && +d <= 12) [d, mes] = [mes, d];
      if (+d >= 1 && +d <= 31 && +mes >= 1 && +mes <= 12) return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    m = plano(linea).match(RE_FECHA_LARGA);
    if (m) {
      const mes = m[2] === "setiembre" ? 9 : MESES.indexOf(m[2]) + 1;
      return `${m[3]}-${String(mes).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
    return null;
  }

  /** Primer importe que aparece después de la palabra clave en la línea. */
  function importeTrasPalabra(linea, re) {
    const p = plano(linea), m = p.match(re);
    if (!m) return null;
    const v = importes(linea.slice(m.index + m[0].length));
    return v.length ? v[0] : null;
  }

  /** Valor numérico de la línea con la palabra clave (o de la siguiente si no tiene). */
  function importeTrasClave(lineas, i, re) {
    if (re) { const v = importeTrasPalabra(lineas[i], re); if (v !== null) return v; }
    const enLinea = importes(lineas[i]);
    if (enLinea.length) return enLinea[enLinea.length - 1];
    const sig = lineas[i + 1] && importes(lineas[i + 1]);
    return sig && sig.length && !/[a-z]{4,}/i.test(lineas[i + 1]) ? sig[sig.length - 1] : null;
  }

  function numeroFactura(lineas) {
    const res = [
      /(?:[fh]a[cl]?tura|fact\.?|fra\.?|ticket|tique|recibo|albaran|n[º°o]\.?\s*(?:de\s*)?(?:factura|documento|doc\.?)|documento)\s*(?:(?:simplificada|pro-?\s?forma|rectificativa|proforma)\s*)?(?:n\s?[º°o*?.]*(?:\d(?=\s*[:#]))?|num\.?|numero|nro\.?|#)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/.]*\d[A-Z0-9\-\/]*)/i,
      /^\s*(?:n[º°o*?]\.?|num\.?|numero|nro\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]*\d[A-Z0-9\-\/]*)/i,
    ];
    for (const re of res) {
      for (const l0 of lineas) {
        const l = l0.replace(/(\w)\s+\/\s+(?=\w)/g, "$1/");   // "2026 / FV38 / 4397" -> "2026/FV38/4397"
        const m = quitarTildes(l).match(re);
        if (!m || RE_FECHA.test(m[1]) || nifValido(m[1]) !== null) continue;
        if (K.total.test(plano(l)) || /^\d+[.,]\d{1,2}$/.test(m[1])) continue;   // es un importe, no un número
        return m[1].replace(/[.:]$/, "");
      }
    }
    return null;
  }

  function nombreCerca(lineas, desde, hasta) {
    for (let i = Math.max(0, desde); i < Math.min(lineas.length, hasta); i++) {
      const p = plano(lineas[i]).trim();
      if (K.nombreEmpresa.test(p.replace(/[,]/g, ""))) return limpiarNombre(lineas[i]);
    }
    return null;
  }

  function limpiarNombre(l) {
    return l.replace(/\s{3,}[^\s:]+(?:\s[^\s:]+)*:.*$/, "").replace(/^(?:[^\s\p{Lu}]\S?\s+)+/u, "").replace(/(,?\s+)[Ss][i1|]$/, "$1SL").replace(/^\s*(cliente|emisor|proveedor|raz[oó]n social|nombre|destinatario|facturar a)\s*[:.]?\s*/i, "")
      .replace(/\s*(N\.?I\.?F|C\.?I\.?F|NIF|CIF)\b.*$/i, "").replace(/\s{2,}/g, " ").replace(/[\s,;:]+$/, "").trim() || null;
  }

  const iniClienteTmp = (p) => p.findIndex((l) => K.cliente.test(l));

  /** ¿Parece un nombre (de persona o empresa)? Varias palabras, sin cifras ni etiquetas. */
  const pareceNombre = (l) => /^[\p{L}&.,'\s-]+$/u.test(l.trim()) && (l.trim().match(/\p{L}{2,}/gu) || []).length >= 2 &&
    !esResumen(l) && !K.direccion.test(plano(l));

  function cabecera(lineas, avisos) {
    letraCalculada.clear();
    const d = {};
    const p = lineas.map(plano);

    // NIF del emisor y del cliente
    const nifs = buscarNifs(lineas);
    const esCliente = (n) => [0, 1, 2, 3].some((k) => n.linea - k >= 0 && K.cliente.test(p[n.linea - k]));
    const validos = nifs.filter((n) => n.valido);
    let cli = validos.find(esCliente);
    let emi = validos.find((n) => n !== cli && !esCliente(n));
    if (!cli && emi) cli = validos.find((n) => n !== emi);
    d.emisor_nif = emi ? emi.valor : null;
    if (emi && validos.length === 1 && iniClienteTmp(p) < 0 && !nombreCerca(lineas, emi.linea - 7, emi.linea + 3))
      avisos.push(`Solo aparece un NIF (${emi.valor}) y no se sabe si es del emisor o del cliente: revísalo.`);
    d.cliente_nif = cli ? cli.valor : null;
    for (const n of [emi, cli]) if (n && letraCalculada.has(n.valor))
      avisos.push(`El NIF ${n.valor} se leyó sin letra y la letra se ha calculado: revísalo.`);
    nifs.filter((n) => !n.valido).forEach((n) =>
      avisos.push(`Parece un NIF/CIF (${n.valor}) pero su letra de control no es válida; puede estar mal leído.`));

    // Nombres
    const iniCliente = p.findIndex((l) => K.cliente.test(l));
    const finEmisor = iniCliente > 0 ? iniCliente : Math.min(lineas.length, emi ? emi.linea + 3 : 8);
    // nombre con forma jurídica (S.L., S.A...) cerca del CIF del emisor; si no, en cualquier
    // sitio fuera del bloque del cliente; si no, la primera línea con texto que no sea una etiqueta
    const enBloqueCliente = (i) => iniCliente >= 0 && i >= iniCliente && i <= iniCliente + 4;
    d.emisor_nombre = (emi && nombreCerca(lineas, emi.linea - 3, emi.linea + 3)) ||
      (emi && nombreCerca(lineas, emi.linea - 7, emi.linea + 3)) ||
      limpiarNombre(lineas.find((l, i) => !enBloqueCliente(i) && K.nombreEmpresa.test(plano(l).trim().replace(/,/g, ""))) || "") ||
      limpiarNombre(lineas.find((l, i) => i < finEmisor && /[a-zñ]{3,}/i.test(l) && !/:/.test(l) &&
        !/factura|ticket|tique|fecha|n[º°]|nif|cif|tel|@|www|albar/i.test(l)) || "");
    if (iniCliente >= 0) {
      const enLinea = limpiarNombre(lineas[iniCliente].replace(/^.*?(cliente|destinatario|facturar a|\bcli\.|\bcli:|\bdest\.)\s*[:.]?/i, ""));
      d.cliente_nombre = (enLinea && /[a-z]{3,}/i.test(enLinea) ? enLinea : null) ||
        nombreCerca(lineas, iniCliente, iniCliente + 4) ||
        limpiarNombre(lineas.slice(iniCliente + 1, iniCliente + 3).find((l) => /[a-zñ]{3,}/i.test(l) && !K.direccion.test(plano(l))) || "");
    } else {
      d.cliente_nombre = cli ? (nombreCerca(lineas, cli.linea - 3, cli.linea + 2) ||
        limpiarNombre([1, 2].map((k) => lineas[cli.linea - k] || "").find(pareceNombre) || "")) : null;
    }
    // Dirección del emisor: líneas con calle / código postal cerca del principio
    const dir = [];
    for (let i = 0; i < finEmisor && dir.length < 2; i++) {
      if (K.direccion.test(p[i]) && !/\b(nif|cif|tel|telefono|fecha|factura)\b/.test(p[i])) dir.push(lineas[i].trim());
    }
    d.emisor_direccion = dir.length ? dir.join(", ") : null;

    // Número, fechas
    d.numero_factura = numeroFactura(lineas);
    let fecha = null, venc = null;
    lineas.forEach((l, i) => {
      const f = fechaDe(l) || (/(fecha|\bfec\b|venc|\bvto\b)/.test(p[i]) && !fechaDe(l) && lineas[i + 1] ? fechaDe(lineas[i + 1]) : null);
      if (!f) return;
      if (/venc|\bvto\b/.test(p[i])) venc = venc || f;
      else if (/fecha|\bfec\b|\bf\.? ?(emision|fra|factura)\b/.test(p[i]) && !/fecha\s*(de\s*)?(venc|entrega|pedido|operacion)/.test(p[i])) fecha = fecha || f;
    });
    if (!fecha) fecha = lineas.map(fechaDe).find(Boolean) || null;
    d.fecha = fecha;
    d.vencimiento = venc;

    // Importes
    const sumaClave = (re, excluir) => {
      const vals = [];
      p.forEach((l, i) => {
        if (re.test(l) && !(excluir && excluir.test(l))) {
          const v = importeTrasClave(lineas, i, re);
          if (v !== null) vals.push(v);
        }
      });
      return vals;
    };
    const totales = sumaClave(K.total, K.noTotal);
    // el mayor en valor absoluto (en un abono los importes son negativos)
    d.total = totales.length ? totales.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;

    let bases = sumaClave(K.base);
    if (!bases.length) bases = sumaClave(/\bsub-?\s?total\b/);   // "Subtotal" = base cuando no pone "Base imponible"
    const totalBase = p.findIndex((l) => /\b(total base|base imponible total|suma bases|total b\.? ?imp)/.test(l));
    d.base_imponible = totalBase >= 0 ? importeTrasClave(lineas, totalBase)
      : bases.length ? red2([...new Set(bases)].reduce((a, b) => a + b, 0)) : null;

    // Cuota de IVA: "Total IVA" o la suma de las líneas "IVA xx%"
    const lineasIva = p.map((l, i) => i).filter((i) => K.iva.test(p[i]) && !lineaProducto(lineas[i]) && !/\b(incluido|incl\.?|inc\.)\b/.test(p[i]) &&
      !K.base.test(p[i].replace(/\b(cuota|iva)\b.*$/, "")) && !/\bnif|cif\b/.test(p[i]));
    const totalIva = lineasIva.find((i) => /\b(total|cuota total|total cuota)\b/.test(p[i]));
    if (totalIva !== undefined) d.cuota_iva = importeTrasClave(lineas, totalIva, /\b(cuota|i\.?v\.?a\.?)\b/);
    else {
      const vals = lineasIva.map((i) => importeTrasClave(lineas, i, /\bcuota\b/.test(p[i]) ? /\bcuota\b/ : null)).filter((v) => v !== null);
      d.cuota_iva = vals.length ? red2([...new Set(vals)].reduce((a, b) => a + b, 0)) : null;
    }
    const tipos = [...new Set(p.filter((l) => K.iva.test(l) || /\btipo\b/.test(l)).flatMap(porcentajes))];   // incluye "IVA 21%" de las líneas
    d.tipo_iva = tipos.length ? tipos.sort((a, b) => a - b).map((t) => String(t).replace(".", ",")).join(" / ") : null;

    const uno = (re) => { const v = sumaClave(re); return v.length ? v[v.length - 1] : null; };
    const unoAbs = (re) => { const v = uno(re); return v === null ? null : Math.abs(v); };
    d.recargo_equivalencia = uno(K.recargo);
    d.irpf = unoAbs(K.irpf);
    d.descuento = (() => { const i = p.findIndex((l) => /^\s*(total\s*)?(descuento|dto)/.test(l)); return i >= 0 ? importeTrasClave(lineas, i) : null; })();
    d.otros_impuestos = uno(/\b(igic|ipsi|tasa|impuesto especial)\b/);

    p.forEach((l, i) => {
      const cols = [["base_imponible", K.base], ["cuota_iva", /\b(cuota|importe iva|iva)\b/], ["total", /\btotal\b/]]
        .map(([c, re]) => [c, l.search(re)]).filter(([, pos]) => pos >= 0).sort((a, b) => a[1] - b[1]);
      const sig = lineas[i + 1] ? importes(lineas[i + 1]) : [];
      if (cols.length >= 2 && !importes(lineas[i]).length && sig.length === cols.length && !/[a-z]{4,}/i.test(lineas[i + 1])) {
        cols.forEach(([c], k) => { d[c] = sig[k]; });
        const pc = porcentajes(lineas[i + 1]);
        if (pc.length && !d.tipo_iva) d.tipo_iva = [...new Set(pc)].map((t) => String(t).replace(".", ",")).join(" / ");
      }
    });

    // Tabla de impuestos en columnas: títulos "Base. | %IVA | IVA | %Rec. | Rec. | Imp." y debajo
    // los valores en el mismo orden (los ilegibles se ignoran)
    const clase = (t) => {
      const n = normEtiqueta(t);
      if (RESUMEN.has(n)) return RESUMEN.get(n);
      const x = plano(t).replace(/[^a-z%]/g, "");
      if (/^[%y]rec|^%re$|^tiporec/.test(x)) return "prec";
      if (/^%iva|^%$|^tipo/.test(x)) return "tipo";
      if (/^base|^bimp/.test(x)) return "base";
      if (/^rec/.test(x)) return "rec";
      if (/^(iva|cuota)/.test(x)) return "cuota";
      if (/^total/.test(x)) return "total";
      return null;
    };
    let pRec = null;
    lineas.forEach((l, i) => {
      const tit = l.trim().split(/\s{2,}/), vals = (lineas[i + 1] || "").trim().split(/\s{2,}/);
      if (tit.length < 3 || importes(l).length || vals.length !== tit.length) return;
      const clases = tit.map(clase);
      if (!clases.includes("base") || clases.filter(Boolean).length < 3) return;
      clases.forEach((c, k) => {
        const v = /^-?\d[\d.,]*\s*%?$/.test(vals[k]) ? parsearImporte(vals[k].replace("%", "")) : null;
        if (v === null || !c) return;
        if (c === "base") d.base_imponible = v;
        else if (c === "tipo") d.tipo_iva = String(v).replace(".", ",");
        else if (c === "cuota") d.cuota_iva = v;
        else if (c === "rec") d.recargo_equivalencia = v;
        else if (c === "prec") pRec = v;
        else if (c === "total" && d.total === null) d.total = v;
        else if (c === "irpf") d.irpf = Math.abs(v);
      });
    });
    if (pRec && d.recargo_equivalencia === null && d.base_imponible !== null) {
      d.recargo_equivalencia = red2(d.base_imponible * pRec / 100);
      avisos.push(`El recargo de equivalencia no se leía; se ha calculado como base × ${String(pRec).replace(".", ",")} %.`);
    }

    // Desglose de IVA de tiques: filas "4%  17,60  0,70" y una fila "TOTAL  42,40  3,36" debajo
    const desglose = [];
    let filaTotal = null;
    lineas.forEach((l, i) => {
      const m = l.match(/^\s*(?:i\.?v\.?a\.?\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s+(-?\d[\d.,]*)(?:\s+(-?\d[\d.,]*))?(?:\s+(-?\d[\d.,]*))?(?:\s+\S{1,4})?\s*$/i);
      if (m && TIPOS_IVA.includes(parsearImporte(m[1]))) {
        desglose.push({ i, tipo: parsearImporte(m[1]), base: parsearImporte(m[2]), cuota: m[3] ? parsearImporte(m[3]) : null });
        return;
      }
      const ult = desglose[desglose.length - 1];
      if (ult && i - ult.i <= 3 && /^\s*total/i.test(l)) {
        const v = importes(l);
        if (v.length >= 2) filaTotal = { i, base: v[0], cuota: v[1] };
      }
    });
    // es una tabla de desglose solo si alguna fila trae base y cuota ("IVA 21%  17,35" suelto es la cuota)
    if (!desglose.some((r) => r.cuota !== null)) desglose.length = 0;
    if (desglose.length) {
      d.tipo_iva = [...new Set(desglose.map((r) => r.tipo))].sort((a, b) => a - b).map((t) => String(t).replace(".", ",")).join(" / ");
      const sb = red2(desglose.reduce((a, r) => a + (r.base || 0), 0)), sc = red2(desglose.reduce((a, r) => a + (r.cuota || 0), 0));
      d.base_imponible = filaTotal ? filaTotal.base : sb;
      d.cuota_iva = filaTotal ? filaTotal.cuota : sc;
      // comprobación: la cuota de cada fila es base x tipo; si lo leído no cuadra, se usa lo calculado
      if (desglose.every((r) => r.base !== null) && cerca(sb, d.base_imponible, 0.02)) {
        const calculada = red2(desglose.reduce((a, r) => a + red2(r.base * r.tipo / 100), 0));
        if (d.cuota_iva === null || !cerca(calculada, d.cuota_iva, 0.03)) {
          if (d.cuota_iva !== null) avisos.push(`La cuota de IVA leída (${d.cuota_iva.toFixed(2)}) no cuadra con base × tipo; se usa ${calculada.toFixed(2)}.`);
          d.cuota_iva = calculada;
        }
      }
      if (filaTotal && desglose.every((r) => r.base !== null) && !cerca(sb, filaTotal.base, 0.02))
        avisos.push(`La suma de las bases del desglose (${sb.toFixed(2)}) no coincide con su total (${filaTotal.base.toFixed(2)}).`);
      // la fila TOTAL del desglose no es el total de la factura
      if (filaTotal && d.total !== null && cerca(d.total, filaTotal.base, 0.001)) {
        const otros = p.map((l, i) => i).filter((i) => i !== filaTotal.i && K.total.test(p[i]) && !K.noTotal.test(p[i]))
          .map((i) => importeTrasClave(lineas, i, K.total)).filter((v) => v !== null);
        d.total = otros.length ? Math.max(...otros) : null;
      }
      // total en letra grande mal leído: si no cuadra con base + IVA del desglose, se calcula
      const calc = red2(d.base_imponible + d.cuota_iva);
      if (d.base_imponible !== null && d.cuota_iva !== null && (d.total === null || !cerca(d.total, calc, 0.05))) {
        if (d.total !== null) avisos.push(`El total leído (${d.total.toFixed(2)}) no cuadra con base + IVA del desglose; se usa ${calc.toFixed(2)}: revísalo.`);
        d.total = calc;
      }
    }

    // Cuadrar base + IVA = total, completando el dato que falte
    const { base_imponible: b, cuota_iva: c, total: t } = d;
    const extra = (d.recargo_equivalencia || 0) + (d.otros_impuestos || 0) - (d.irpf || 0);
    if (b !== null && t !== null && c === null && Math.abs(t - b - extra) > 0 && Math.sign(t - b - extra) === Math.sign(t)) {
      d.cuota_iva = red2(t - b - extra); avisos.push("La cuota de IVA se ha calculado como total − base.");
    } else if (b === null && c !== null && t !== null) {
      d.base_imponible = red2(t - c - extra); avisos.push("La base imponible se ha calculado como total − IVA.");
    } else if (t === null && b !== null && c !== null) {
      d.total = red2(b + c + extra); avisos.push("El total se ha calculado como base + IVA.");
    }

    // Moneda, forma de pago, IBAN
    const todo = p.join("\n");
    d.moneda = /€|\beur\b|euro/.test(todo) ? "EUR" : /\busd\b|\$/.test(todo) ? "USD" : /£|\bgbp\b/.test(todo) ? "GBP"
      : (d.total !== null ? "EUR" : null);
    d.forma_pago = (FORMAS_PAGO.find(([re]) => re.test(todo)) || [])[1] || null;
    d.iban = null;
    for (const l of lineas) {
      const m = l.toUpperCase().match(/\b([A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/);
      if (m) {
        const iban = m[1].replace(/\s/g, "");
        if (ibanValido(iban)) { d.iban = iban; break; }
        avisos.push(`Hay un IBAN (${iban}) cuyo dígito de control no cuadra; revísalo.`);
      }
    }
    return d;
  }

  // ---------- líneas de producto ----------
  const RE_NUM_FINAL = /(\s+|^)(-?\d{1,3}(?:[.]\d{3})*(?:[.,]\d{1,4})?|-?\d+(?:[.,]\d{1,4})?)(\s*%)?\s*(?:€|eur)?\s*$/i;

  // Palabras de totales, pagos, cabeceras de tabla y datos de la factura. Una línea solo se
  // descarta si, quitando estas palabras, no le queda ninguna otra ("Cambio 5,00" sí se
  // descarta; "Cambio de aceite 45,00" no).
  const VOCAB_RESUMEN = new Set((
    "total totales subtotal sub base bases imponible imp iva cuota cuotas nif cif dni nie fecha hora factura " +
    "ticket tique simplificada numero num cambio entregado entrega efectivo tarjeta visa mastercard maestro " +
    "amex credito debito contactless datafono bizum transferencia banco bancaria cuenta telefono tel tlf movil " +
    "fax email mail web www http iban swift bic vencimiento forma pago pagar pagado pendiente gracias compra " +
    "visita vuelva pronto recargo equivalencia irpf retencion pagina cliente domicilio direccion postal codigo " +
    "importe importes operacion autorizacion aid arc terminal comercio devolver devolucion saldo redondeo eur " +
    "euro euros articulos articulo unidades uds lineas items impuesto impuestos exento exenta incluido incl " +
    "descuento descuentos dto ahorro ahorrado puntos tipo neto bruto liquido ref referencia descripcion concepto " +
    "conceptos cant cantidad precio precios unidad unitario unit pvp calle avda avenida plaza paseo ctra carretera " +
    "rec req ret tot fra fact imp desc cod ctd cdad dcto bonif vto venc fec cli dest transf banc pago b.i bi " +
    "cajas promos promo prom bienes servicios orden comercial plazo und lote caducidad cad dtos lineas peso kg transportista agente zona albaran pedido cajero cajera atendido vendedor tienda caja establecimiento observaciones notas registro mercantil tomo folio hoja"
  ).split(" "));
  const PALABRAS_VACIAS = new Set("por para del las los con sin que una uno sus les nos ese esa este esta".split(" "));

  function esResumen(texto) {
    const palabras = plano(texto).replace(/[^a-zñ]+/g, " ").split(" ")
      .filter((w) => w.length >= 3 && !VOCAB_RESUMEN.has(w) && !PALABRAS_VACIAS.has(w));
    return palabras.length === 0;
  }

  /** Números del final de la línea: importe, precio, (descuento), cantidad y % de IVA. */
  function numerosFinales(linea) {
    let resto = linea, m, tipo = null;
    const nums = [];
    while (nums.length < 6 && (m = resto.match(RE_NUM_FINAL))) {
      const n = parsearImporte(m[2]);
      if (n === null) break;
      const decimales = /[.,]\d{1,4}$/.test(m[2]) && !/^\d{1,3}\.\d{3}$/.test(m[2].replace("-", ""));
      const columna = m[1].length >= 2 || m.index === 0;   // separado por varios espacios = otra columna
      if (m[3]) { tipo = n; resto = resto.slice(0, m.index).trimEnd(); continue; }
      if (!decimales) {
        if (!nums.length) {
          // importe final sin decimales: solo si va en su columna y es un importe razonable
          const cifras = m[2].replace(/\D/g, "");
          if (!columna || cifras.length > 6) break;
          if (/^\d{5}$/.test(m[2]) || /^(19|20)\d{2}$/.test(m[2])) break;   // código postal o año, no un importe
        } else {
          // un entero a la izquierda es la cantidad si va en columna o si cantidad x precio = importe;
          // si no, es parte de la descripción ("Tornillos caja 100", "ACEITE OLIVA 1L" leído "11")
          const cuadra = nums.length >= 2 && cerca(n * nums[0].n, nums[nums.length - 1].n, 0.02);
          if (!columna && !cuadra) break;
          nums.unshift({ n, decimales, columna });
          resto = resto.slice(0, m.index).trimEnd();
          if (!columna) break;
          continue;
        }
      }
      nums.unshift({ n, decimales, columna });
      resto = resto.slice(0, m.index).trimEnd();
    }
    return { nums, tipo, resto };
  }

  function lineaProducto(l, columnas = null) {
    if (!/[a-zñ]{3,}/i.test(l) || /@|www\.|https?:/i.test(l)) return null;
    const limpia = l.replace(/\s*€\s*/g, "  ").replace(/\s+[A-E]\s*$/, "")   // códigos de IVA tipo "A" al final
      .replace(/(\s\d+[.,]\d+)\s+(?:und|uds|ud|un|u|cjs?)\.?(?=\s|$)/gi, "$1")   // "1,0000 Und" -> "1,0000" ("CAJA 15 UD" se queda)
      .replace(/\b(?:iva|igic|ipsi)\s+(?=\d{1,2}(?:[.,]\d+)?\s*%)/gi, "")                  // "IVA 21%" -> "21%"
      .replace(/\s*\((?:bienes|servicios)\)/gi, "")
      .replace(/(\d)(?:\s+[^\d\s]{1,2})+\s*$/, "$1")                    // "1,85    E": marcas detrás del importe
      .replace(/\s(?:(?=\S*[=—_;|~])[=\-—_:;|.,'"~]+|[-.,:]{2,})(?=\s|$)/g, " ")   // "==", "-=-": manchas leídas como signos
      .replace(/(\s\d{1,4})-(\d{2})(?=\s|$)/g, "$1,$2")              // "3-75": coma leída como guion
      .trimEnd();
    let { nums, tipo, resto } = numerosFinales(limpia);
    let importeIlegible = false;
    if (!nums.length || !nums[nums.length - 1].decimales) {
      // "1   13,75   3-5": el importe no se ha leído bien pero cantidad y precio sí
      const basura = limpia.match(/\s{2,}(?=[^\s]*\d)[^\s]{1,6}\s*$/);
      if (basura && parsearImporte(basura[0]) === null || basura && /[^\d.,\s€-]|\d-\d/.test(basura[0])) {
        const otra = numerosFinales(limpia.slice(0, basura.index));
        if (otra.nums.length >= 2 && otra.nums[otra.nums.length - 1].decimales) {
          ({ nums, tipo, resto } = otra);
          importeIlegible = true;
        }
      }
    }
    if (!nums.length) return null;
    // con un único número sin decimales hace falta algo más que lo confirme (p. ej. "Mano de obra   300")
    const final = nums[nums.length - 1];
    if (!final.decimales && nums.length === 1 && !final.columna) return null;
    resto = resto.trim().replace(/^(?!\[[^\]]{1,20}\])(?:[|\]\[!}{¡]\s*|[lI]\s+(?=\d))(?=[A-ZÁÉÍÓÚÑ0-9])/, "");
    let cantidad = null, referencia = null;
    // código numérico de 4 o más cifras al principio ("1261  GIR. AGUASAL..."): es la referencia
    // marcas del margen de la foto delante del código: "S 340069480 …", "EA 340…", "=1 340…"
    resto = resto.replace(/^(?:[A-Za-z]{1,2}|\S?[^\s\w]\S?)\s+(?=\d{4,}\s)/, "");
    const cod = resto.match(/^(\d{4,})\s+(?=[*A-Za-zÁÉÍÓÚÑ])/);
    if (cod) { referencia = cod[1]; resto = resto.slice(cod[0].length); }
    // si la tabla tiene columna de cantidad después de la descripción, un número al principio no es la cantidad
    const qAlPrincipio = !columnas || !columnas.includes("cantidad") || columnas.indexOf("cantidad") < columnas.indexOf("descripcion");
    const q = cod || !qAlPrincipio ? null : resto.match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:x|uds?\.?|u\.|ud\.|kg|und\.?)?\s+(?=\D|\d+\s+[A-Za-zÁÉÍÓÚÑ])/i);
    if (q) { cantidad = parsearImporte(q[1]); resto = resto.slice(q[0].length); }
    // código de artículo al principio: "[MB670]", "TOR-440", "GR-2910201", "BE - BE0012-C545"
    const rc = resto.match(/^\[([^\]]{1,20})\]\s*/);
    if (rc) { referencia = rc[1].trim(); resto = resto.slice(rc[0].length); }
    const r = rc ? null : resto.match(/^([A-Z0-9]{1,6}(?:\s?[-\/]\s?[A-Z0-9]+)+|[A-Z0-9][A-Z0-9\-.\/]{3,})\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/i);
    if (r && /\d/.test(r[1])) { referencia = r[1]; resto = resto.slice(r[0].length); }
    // con columnas: si la primera es el código, es el primer trozo separado por espacios ("A12     Tornillos M6")
    if (!referencia && columnas && columnas[0] === "referencia") {
      const t0 = resto.match(/^(\S{1,20})\s{2,}(?=\S)/);
      if (t0) { referencia = t0[1]; resto = resto.slice(t0[0].length); }
    }
    // "2 x 1,05" dentro de la descripción
    const x = resto.match(/\s(\d+(?:[.,]\d{1,3})?)\s*[xX*]\s*$/);
    if (x && cantidad === null) { cantidad = parsearImporte(x[1]); resto = resto.slice(0, x.index); }
    // columnas de lote y caducidad entre la descripción y los números: "… Cx12  202609  17-02-2027"
    const cad = resto.match(/\s+\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2})?\s*$/);
    if (cad) {
      resto = resto.slice(0, cad.index);
      const lote = resto.match(/\s+(?=\S*\d{3})[A-Z0-9\/\-.]{3,}\s*$/i);
      if (lote && !/[a-z]{2,}/.test(lote[0])) resto = resto.slice(0, lote.index);
    }
    const descripcion = resto.replace(/[\s.:\-_|]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (!/[a-zñ]{3,}/i.test(descripcion) || esResumen(descripcion)) return null;
    if (buscarNifs([descripcion]).some((n) => n.valido)) return null;   // datos del cliente/emisor

    // con la cabecera de la tabla, cada número va a su columna
    const asg = columnas && !importeIlegible ? asignarColumnas(nums.map((o) => o.n), columnas, tipo) : null;
    // última columna = % de IVA sin el símbolo ("… -6,45   10,0"): si con el penúltimo como importe
    // cuadra cantidad x precio (o es un importe con céntimos y el último no), el último es el tipo
    if (!asg && !importeIlegible && nums.length >= 3 && tipo === null) {
      const ult = nums[nums.length - 1], pen = nums[nums.length - 2];
      const pareceTipo = TIPOS_IVA.includes(ult.n) && ult.n > 0;
      const resto2 = nums.slice(0, -2).map((o) => o.n);
      if (pareceTipo && (buscarCantidadPrecio(resto2, pen.n) || (pen.decimales && Math.abs(pen.n) !== ult.n && nums.length >= 4))) {
        tipo = ult.n; nums = nums.slice(0, -1);
      }
    }
    const v = nums.map((o) => o.n);
    if (importeIlegible) v.push(null);
    let importe = v[v.length - 1];
    let precio = null, descuento = null, revisar = importeIlegible;
    let kilosCol = null, precioKiloCol = null;
    if (asg) {
      importe = asg.importe;
      precio = asg.precio ?? (asg.precio_kilo === undefined ? null : asg.precio_kilo);
      cantidad = asg.cantidad ?? asg.kilos ?? cantidad ?? (precio !== null ? 1 : null);
      if (asg.tipo !== undefined) tipo = asg.tipo;
      if (asg.dto && cantidad !== null && precio !== null) descuento = red2(cantidad * precio - importe);
      if (asg.kilos !== undefined) kilosCol = asg.kilos;
      if (asg.precio_kilo !== undefined) precioKiloCol = asg.precio_kilo;
    } else if (importeIlegible) {
      precio = v[v.length - 2];
      if (cantidad === null) cantidad = v.length >= 3 ? v[v.length - 3] : 1;
      importe = red2(cantidad * precio);
    } else if (cantidad !== null) {
      precio = v.length >= 2 ? v[v.length - 2] : red2(importe / (cantidad || 1));
    } else {
      const par = buscarCantidadPrecio(v.slice(0, -1), importe);
      if (par) {
        ({ cantidad, precio, descuento } = par);
        if (tipo === null && par.tipo !== null) tipo = par.tipo;
      } else if (v.length >= 4) {
        // no cuadra ninguna combinación: el precio es el número cuya división da una cantidad entera
        const p = v.slice(0, -1).reverse().find((n) => n > 0 && n !== importe && cerca(importe / n, Math.round(importe / n), 0.01) && importe / n <= 999);
        if (p) { precio = p; cantidad = Math.round(importe / p); } else revisar = true;
      } else if (v.length === 3) {
        [cantidad, precio] = v;
        // "15  10,23  10,23": el 15 son unidades por caja; la cantidad es importe / precio
        const r = importe / v[1];
        if (!cerca(v[0] * v[1], importe, 0.02) && nums[2].decimales && v[1] > 0 && cerca(r, Math.round(r), 0.002) && Math.round(r) >= 1 && r <= 999) {
          cantidad = Math.round(r); precio = v[1];
        }
      } else if (v.length === 2) {
        if (!nums[0].decimales && Number.isInteger(v[0]) && v[0] <= 999 && !cerca(v[0], importe, 0.001)) {
          cantidad = v[0]; precio = red2(importe / (cantidad || 1));
        } else { precio = v[0]; const c = importe / precio; cantidad = cerca(c, Math.round(c), 0.02) ? Math.round(c) : null; }
      } else { cantidad = 1; precio = importe; }
    }

    // Comprobación cantidad x precio = importe: corrige la coma perdida por el OCR
    // ("2,25" leído "225") y marca para revisar lo que no cuadre.
    const bruto = cantidad !== null && precio !== null ? cantidad * precio - (descuento || 0) : null;
    if (bruto !== null && !revisar && !cerca(bruto, importe, 0.021 + Math.abs(cantidad) * 0.00006)) {
      if (Number.isInteger(importe) && cerca(cantidad * precio, importe / 100, 0.02)) importe = red2(importe / 100);
      else if (Number.isInteger(importe) && cerca(cantidad * precio, importe / 10, 0.02)) importe = red2(importe / 10);
      else if (Number.isInteger(precio) && cerca(cantidad * precio / 100, importe, 0.02)) precio = red2(precio / 100);
      else revisar = true;
    }
    const enteroSuelto = !importeIlegible && !nums[nums.length - 1].decimales && Number.isInteger(importe);
    // solo es sospechoso si no hay cantidad x precio que lo confirme ("Mano de obra  2  150  300" está bien)
    const sinComa = enteroSuelto && (nums.length === 1 || revisar) ? String(importe) : null;
    // al peso en la misma línea: "PATATA  2,350 kg x 1,20 €/kg   2,82" o "1,5 kg ... 3,40 €/kg"
    let kilos = null, precioKilo = null;
    const pk = l.match(/(\d+[.,]\d{1,3})\s*kgs?\b.*?(\d+[.,]\d{1,4})\s*[€e]?\s*\/\s*kg/i);
    const solo = l.match(/(\d+[.,]\d{1,4})\s*[€e]?\s*\/\s*kg/i);
    if (pk) { kilos = parsearImporte(pk[1]); precioKilo = parsearImporte(pk[2]); }
    else if (solo) precioKilo = parsearImporte(solo[1]);
    if (kilosCol !== null) kilos = kilosCol;
    if (precioKiloCol !== null) precioKilo = precioKiloCol;
    return { descripcion, referencia, cantidad, precio, descuento, importe, tipo_iva: tipo, revisar, sinComa, kilos, precioKilo };
  }

  // Productos al peso: "Salmon Entero" y debajo "1,352 kg   10,95 €/kg   14,80"
  const RE_PESO = /^\s*[|\]!]?\s*(\d+[.,]\d{1,3})\s*kgs?\.?\s*[x*]?\s+(\d+[.,]\d{1,4})\s*[€e]?\s*\/\s*kg\.?\s*=?\s+(\d+[.,]\d{2})\s*€?(?:\s+\S{1,2})*\s*$/i;

  const TIPOS_IVA = [0, 3, 4, 5, 7, 9.5, 10, 13.5, 15, 21];   // IVA, IGIC e IPSI

  /** Entre los números de la línea (sin el importe), busca cantidad x precio (- % dto) = importe.
   *  Lo que queda detrás del precio puede ser el % de descuento y el % de IVA. */
  function buscarCantidadPrecio(nums, importe) {
    for (let i = 0; i < nums.length; i++) {
      const tol = 0.021 + Math.abs(nums[i]) * 0.00006;
      for (let j = i + 1; j < nums.length; j++) {
        const bruto = nums[i] * nums[j];
        const resto = nums.slice(j + 1);
        let descuento = null, ok = cerca(bruto, importe, tol);
        if (!ok) {
          const k = resto.findIndex((d) => d > 0 && d < 100 && cerca(bruto * (1 - d / 100), importe, tol));
          if (k < 0) continue;
          descuento = red2(bruto - importe);
          resto.splice(k, 1);
        } else {
          const k = resto.findIndex((d) => d === 0);   // "0,00" en la columna de % dto
          if (k >= 0 && resto.length > 1) resto.splice(k, 1);
        }
        const tipo = resto.find((t) => TIPOS_IVA.includes(t)) ?? null;
        return { cantidad: nums[i], precio: nums[j], descuento, tipo };
      }
    }
    return null;
  }

  const RE_CODIGO = /^([A-Z0-9]{1,6}(?:\s?[-\/]\s?[A-Z0-9]+)+)\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/i;

  /** Recorre el texto: cada línea de producto, más los renglones sin importe que la siguen
   *  (descripciones partidas en dos o más renglones). */
  function buscarProductos(lineasTexto) {
    const res = [];
    let ultimo = null, extra = 0, previa = null, columnas = null;
    const esPeso = (i) => RE_PESO.test(lineasTexto[i] || "");
    const esTique = lineasTexto.some((l) => /\b([fh]a[cl]?tura simplificada|ticket|tique)\b/i.test(quitarTildes(l)));
    for (let n = 0; n < lineasTexto.length; n++) {
      const l = lineasTexto[n];
      // en un tique, a partir del TOTAL vienen el pago, el cambio y el desglose: no hay más productos
      if (esTique && res.length && /^\s*total\b/i.test(l) && !/\b(art|uds|unidades|lineas)/i.test(l)) break;
      if (!RE_PESO.test(l) && (esPeso(n + 1) || (esPeso(n + 2) && !importes(lineasTexto[n + 1] || "").length))) {
        ultimo = null;   // es el nombre (o la categoría) de un producto al peso
        if (esPeso(n + 1)) previa = l.trim().replace(/(?:\s+[^\w\s]{1,2})+$/, "");
        continue;
      }
      const peso = l.match(RE_PESO);
      if (peso && previa) {
        let [cantidad, precio, leido] = [peso[1], peso[2], peso[3]].map(parsearImporte);
        // precio por kilo con 3 decimales ("2,930"): sobra una cifra; se busca la que cuadra con el importe
        if (/[.,]\d{3,}$/.test(peso[2]) && !cerca(red2(cantidad * precio), leido, 0.006)) {
          const cifras = peso[2].replace(/\D/g, ""), ent = peso[2].split(/[.,]/)[0].length;
          for (let k = ent; k < cifras.length; k++) {
            const alt = +(cifras.slice(0, ent) + "." + (cifras.slice(ent, k) + cifras.slice(k + 1)));
            if (cerca(red2(cantidad * alt), leido, 0.006)) { precio = alt; break; }
          }
        }
        const calc = red2(cantidad * precio), ok = cerca(calc, leido, 0.006);
        ultimo = { descripcion: previa.replace(/^\s*[|\]1]\s+/, "").replace(/\s{2,}/g, " ").trim(), referencia: null,
          cantidad, precio, descuento: null, importe: ok ? leido : calc, tipo_iva: null, revisar: !ok,
          kilos: cantidad, precioKilo: precio };
        res.push(ultimo); extra = 0; previa = null; continue;
      }
      const cols = columnasTabla(l);
      if (cols) { columnas = cols; ultimo = null; previa = null; continue; }   // cabecera de la tabla
      const prod = lineaProducto(l, columnas);
      // posible descripción de un producto al peso (la línea de los kg va debajo)
      previa = !prod && /[a-zñ]{3,}/i.test(l) && !importes(l).length && !esResumen(l) ? l.trim().replace(/(?:\s+[^\w\s]{1,2})+$/, "") : null;
      if (prod) { res.push(prod); ultimo = prod; extra = 0; continue; }
      const t = l.trim().replace(/(^|\s)(?:und|uds|ud)\.?(?=\s|$)/gi, " ").trim();
      if (ultimo && /^\d{1,4}$/.test(t) && /\s[xX]$/.test(ultimo.descripcion)) { ultimo.descripcion += " " + t; continue; }   // "… X" + "24"
      // fila de producto sin importe legible: "1 FILM TRANSPARENTE  KC —" (o, en un tique, cualquier
      // nombre en mayúsculas entre los productos: en los tiques las descripciones no ocupan dos renglones)
      const filaTique = res.length && !importes(t).length && !esResumen(t) && !/:/.test(t) &&
        (/^\s*[|\]]?\s*\d{1,3}\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]+(?:\s+[A-ZÁÉÍÓÚÑ0-9\/.-]+)*/.test(t) && /\s{2,}\S/.test(t) ||
         esTique && /^[|\]\s\d]*[A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ0-9\/.-]+)+/.test(t));
      if (filaTique) {
        const cant = t.match(/^\s*[|\]]?\s*(\d{1,3})\s+/);
        const desc = t.replace(/^\s*[|\]]?\s*\d{1,3}\s+/, "").replace(/^[|\]]\s*/, "").replace(/\s{2,}.*$/, "").trim();
        ultimo = { descripcion: desc, referencia: null, cantidad: cant ? +cant[1] : 1, precio: null, descuento: null, importe: null, tipo_iva: null, revisar: true };
        res.push(ultimo); extra = 0; continue;
      }
      const conCodigo = RE_CODIGO.test(t) && /[a-zñ]{3,}/i.test(t);
      if (conCodigo && res.length && /\d/.test(t.replace(RE_CODIGO, ""))) {
        // fila de la tabla que no se ha podido interpretar: se añade para revisar a mano
        const ref = t.match(RE_CODIGO)[1];
        const desc = t.slice(t.match(RE_CODIGO)[0].length).replace(/\s{2,}.*$/, "").trim();
        if (!esResumen(desc)) {
          ultimo = { descripcion: desc, referencia: ref, cantidad: null, precio: null, descuento: null, importe: null, tipo_iva: null, revisar: true };
          res.push(ultimo); extra = 0; continue;
        }
      }
      const continuacion = ultimo && extra < 3 && !conCodigo && /[a-zñ]{3,}/i.test(t) && !/[:@]/.test(t) &&
        !importes(t).length && !/\s{2,}[\d.,]+\s*$/.test(l) && !esResumen(t) && !buscarNifs([t]).length && !fechaDe(t);
      if (continuacion) { ultimo.descripcion += " " + t.replace(/\s{2,}/g, " "); extra++; }
      else ultimo = null;   // cualquier otra cosa corta la descripción
    }
    return res;
  }

  const x_cp = (l) => l.cantidad * l.precio - (l.descuento || 0);

  function lineas(lineasTexto, cab, avisos) {
    const res = buscarProductos(lineasTexto);
    if (!res.length) return res;
    const conDecimales = res.filter((l) => l.importe !== null && !l.sinComa).length;
    if (conDecimales >= res.length * 0.6) {
      for (const l of res.filter((x) => x.sinComa)) {
        // "195" en un tique donde todo lleva céntimos es "1,95": se corrige y se marca para revisar.
        // "50" puede ser "1,50" o "0,50": no se sabe, se deja sin importe (y se calcula si es el único)
        if (l.sinComa.length >= 3) l.importe = red2(l.importe / 100);
        else if (l.cantidad !== null && l.precio !== null) l.importe = red2(x_cp(l));   // "-8  0,740  5": vale -8 x 0,740
        else { l.importe = null; l.precio = null; }
        if (l.importe !== null && (l.cantidad === 1 || l.cantidad === null)) { l.precio = l.importe; l.cantidad = 1; }
        l.revisar = true;
      }
    }
    const dudosas = res.filter((l) => l.revisar).map((l) => `«${l.descripcion}»`);
    if (dudosas.length) avisos.push(`Revisa ${dudosas.length === 1 ? "esta línea" : "estas líneas"} (cantidad × precio no cuadra con el importe o no se leyó bien): ${dudosas.slice(0, 8).join(", ")}${dudosas.length > 8 ? "…" : ""}.`);
    // ¿Los importes de las líneas llevan IVA? Se deduce comparando con la base y el total.
    let suma = red2(res.reduce((a, l) => a + (l.importe || 0), 0));
    const sinImporte = res.filter((l) => l.importe === null);
    // solo es fiable si todas las demás líneas están bien (ninguna marcada para revisar)
    if (sinImporte.length === 1 && res.length > 2 && res.every((l) => l.importe === null || !l.revisar)) {
      // si solo falta uno, es lo que le falta a la suma para llegar al total (o a la base)
      const esTique = lineasTexto.some((l) => /\b([fh]a[cl]?tura simplificada|ticket|tique)\b/i.test(quitarTildes(l)));
      const objetivo = esTique ? cab.total : (cab.base_imponible ?? cab.total);
      if (objetivo !== null && objetivo - suma > 0) {
        const l = sinImporte[0];
        l.importe = red2(objetivo - suma);
        if (l.cantidad) l.precio = red2(l.importe / l.cantidad);
        suma = red2(objetivo);
      }
    }
    // Un importe sin coma mal leído ("1555" por "1,55"): si quitando una cifra repetida la suma
    // de las líneas cuadra con el total o la base, se corrige (y sigue marcado para revisar).
    for (const objetivo of [cab.total, cab.base_imponible]) {
      if (objetivo === null || cerca(suma, objetivo, 0.02)) continue;
      const arreglos = [];
      for (const l of res.filter((x) => x.revisar && x.importe !== null && x.cantidad && x.precio)) {
        const alt = red2(x_cp(l));
        if (alt !== l.importe && cerca(suma - l.importe + alt, objetivo, 0.02)) arreglos.push({ l, alt });
      }
      for (const l of res.filter((x) => x.sinComa && x.sinComa.length >= 4)) {
        for (let k = 0; k < l.sinComa.length; k++) {
          const alt = +(l.sinComa.slice(0, k) + l.sinComa.slice(k + 1)) / 100;
          if (cerca(suma - l.importe + alt, objetivo, 0.02) && !arreglos.some((a) => a.l === l && a.alt === alt)) arreglos.push({ l, alt });
        }
      }
      if (arreglos.length === 1) {
        const { l, alt } = arreglos[0];
        l.importe = alt; if (l.cantidad === 1) l.precio = alt;
        l.corregida = true;
        suma = red2(res.reduce((a, x) => a + (x.importe || 0), 0));
        break;
      }
    }
    const tipos = cab.tipo_iva ? cab.tipo_iva.split(" / ").map((t) => parsearImporte(t)) : [];
    const tipoUnico = tipos.length === 1 ? tipos[0] : null;
    let conIva = null;
    if (cab.base_imponible !== null && cerca(suma, cab.base_imponible, 0.1)) conIva = false;
    else if (cab.total !== null && cerca(suma, cab.total, 0.1)) conIva = true;
    else if (cab.total !== null && cab.base_imponible === null) conIva = true;  // típico de tiques
    else if (lineasTexto.some((l) => /\b([fh]a[cl]?tura simplificada|ticket|tique)\b/i.test(quitarTildes(l)))) conIva = true;
    if (conIva === null) avisos.push("No se ha podido saber si los importes de las líneas llevan IVA; se han puesto como «sin IVA».");
    else if (cab.total !== null && !cerca(suma, conIva ? cab.total : cab.base_imponible, 0.1))
      avisos.push(`La suma de las líneas (${suma.toFixed(2)}) no cuadra: puede faltar o sobrar alguna línea.`);

    if (conIva && tipos.length > 1 && res.some((l) => l.tipo_iva === null && l.importe))
      avisos.push(`Este tique lleva varios tipos de IVA (${cab.tipo_iva}) y no dice cuál es el de cada producto: ` +
        "la base imponible de cada línea no se puede calcular (la base total de la factura sí está).");
    return res.map((l) => {
      const t = l.tipo_iva !== null ? l.tipo_iva : tipoUnico;
      const f = t !== null ? 1 + t / 100 : null;
      const sin = (v) => (v === null ? null : conIva ? (f ? red2(v / f) : null) : v);
      const con = (v) => (v === null ? null : conIva ? v : (f ? red2(v * f) : null));
      return {
        descripcion: l.descripcion, referencia: l.referencia, cantidad: l.cantidad,
        precio_unitario: sin(l.precio), precio_unitario_iva: con(l.precio), descuento: sin(l.descuento),
        tipo_iva: t, importe: sin(l.importe), importe_iva: con(l.importe),
        kilos: l.kilos ?? null, precio_kilo: l.precioKilo ?? null,
      };
    });
  }

  // ---------- reconstruir renglones a partir de las posiciones del OCR ----------
  /** Tesseract a veces lee por columnas (todas las descripciones y luego todos los precios).
   *  Con la caja (bbox) de cada línea que devuelve, se vuelven a juntar los trozos que están
   *  a la misma altura, de izquierda a derecha, como renglones de la factura.
   *  lineas: [{ palabras: [{ texto, x0, y0, x1, y1, confianza }] }] */
  function renglonesOcr(lineas) {
    const mediana = (v) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const trozos = [];
    for (const l of lineas) {
      const ps = l.palabras.filter((w) => /[\p{L}\p{N}€%]/u.test(w.texto) || w.confianza >= 60)
        .sort((a, b) => a.x0 - b.x0);
      if (!ps.length) continue;
      const h = Math.max(4, mediana(ps.map((w) => w.y1 - w.y0)));
      let texto = ps[0].texto;
      for (let i = 1; i < ps.length; i++) texto += (ps[i].x0 - ps[i - 1].x1 > h * 1.2 ? "    " : " ") + ps[i].texto;
      // inclinación de la línea: de la primera a la última palabra (si la línea es larga)
      const a0 = ps[0], a1 = ps[ps.length - 1];
      const pend = ps.length >= 3 && a1.x0 - a0.x0 > h * 8 ? ((a1.y0 + a1.y1) - (a0.y0 + a0.y1)) / 2 / (a1.x0 - a0.x0) : null;
      trozos.push({ texto, x0: ps[0].x0, x1: ps[ps.length - 1].x1, yc: mediana(ps.map((w) => (w.y0 + w.y1) / 2)), h, pend });
    }
    // foto algo torcida: los renglones suben o bajan hacia la derecha; se corrige la altura de cada
    // trozo con la inclinación típica de las líneas largas antes de agruparlos
    const pends = trozos.map((t) => t.pend).filter((v) => v !== null && Math.abs(v) < 0.1);
    const pend = pends.length >= 3 ? mediana(pends) : 0;
    for (const t of trozos) t.yc -= pend * (t.x0 + t.x1) / 2;
    trozos.sort((a, b) => a.yc - b.yc);
    const filas = [];
    for (const t of trozos) {
      // misma altura (con margen por si la foto está algo torcida) y sin pisarse en horizontal
      const f = filas.find((r) => Math.abs(r.yc - t.yc) < 0.6 * Math.min(r.h, t.h) &&
        !r.trozos.some((o) => o.x0 < t.x1 && t.x0 < o.x1));
      if (f) f.trozos.push(t); else filas.push({ yc: t.yc, h: t.h, trozos: [t] });
    }
    return filas.sort((a, b) => a.yc - b.yc)
      .map((r) => r.trozos.sort((a, b) => a.x0 - b.x0).map((t) => t.texto).join("    ")).join("\n");
  }

  /** Puntúa lo bien que se ha leído un texto, para elegir entre dos pasadas del OCR.
   *  cuadra = la suma de las líneas coincide con la base o con el total. */
  function puntuar(texto) {
    const todos = { cabecera: ["numero_factura", "fecha", "emisor_nombre", "emisor_nif", "base_imponible", "cuota_iva", "total"],
      linea: ["descripcion", "cantidad", "precio_unitario", "importe", "importe_iva"] };
    const d = extraer(texto, todos);
    if (d.vacio) return { puntos: 0, cuadra: false };
    const ls = d.lineas || [];
    const buenas = ls.filter((l) => l.importe !== null || l.importe_iva !== null).length;
    const malas = (d.avisos.find((a) => a.startsWith("Revisa")) || "").split("«").length - 1;
    const suma = (k) => ls.reduce((a, l) => a + (l[k] || 0), 0);
    const cuadra = ls.length > 0 && [d.base_imponible, d.total].some((t) => t !== null &&
      (cerca(suma("importe"), t, 0.05) || cerca(suma("importe_iva"), t, 0.05)));
    const cab = todos.cabecera.filter((c) => d[c] !== null).length;
    const objetivos = [d.base_imponible, d.total].filter((t) => t > 0);
    const desvio = ls.length && objetivos.length ? Math.min(...objetivos.flatMap((t) =>
      [suma("importe"), suma("importe_iva")].map((sm) => Math.abs(sm - t) / t))) : 0;
    return { puntos: cab * 2 + buenas * 2 - malas * 2 + (cuadra ? 20 : 0) - Math.min(30, desvio * 30), cuadra };
  }

  // ---------- entrada principal ----------
  /** texto -> {campo: valor, lineas: [...], avisos: [...]} con solo los campos elegidos.
   *  etiquetas (opcional): {clave: "nombre visible"} para los avisos. */
  function extraer(texto, seleccion, etiquetas = {}) {
    const avisos = [];
    const todas = String(texto || "").split(/\r?\n/).map((l) => l.replace(/[|¦]/g, " ").replace(/\s+$/, "")).filter((l) => l.trim());
    if (todas.join("").replace(/\s/g, "").length < 20) {
      return { lineas: [], avisos: ["No se ha podido leer texto en la imagen. Prueba con más luz, la factura recta y sin sombras."], vacio: true };
    }
    const cab = cabecera(todas, avisos);
    // Si la tabla de impuestos no se lee pero todas las líneas llevan el mismo % de IVA, ese es el
    // de la factura, y con él se calculan la cuota y el total que falten
    const tiposLineas = [...new Set(buscarProductos(todas).map((l) => l.tipo_iva).filter((t) => t !== null))];
    if (cab.tipo_iva === null && tiposLineas.length === 1) {
      const t = tiposLineas[0];
      cab.tipo_iva = String(t).replace(".", ",");
      if (cab.cuota_iva === null && cab.base_imponible !== null) {
        cab.cuota_iva = red2(cab.base_imponible * t / 100);
        avisos.push("La cuota de IVA no se leía; se ha calculado como base × tipo de IVA de las líneas.");
      }
      if (cab.total === null && cab.base_imponible !== null && cab.cuota_iva !== null) {
        cab.total = red2(cab.base_imponible + cab.cuota_iva + (cab.recargo_equivalencia || 0) - (cab.irpf || 0));
        avisos.push("El total no se leía; se ha calculado como base + IVA: revísalo.");
      }
    }
    const salida = {};
    for (const c of seleccion.cabecera || []) salida[c] = c in cab ? cab[c] : null;
    if ((seleccion.linea || []).length) {
      const ls = lineas(todas, cab, avisos);
      salida.lineas = ls.map((l) => Object.fromEntries(seleccion.linea.map((c) => [c, c in l ? l[c] : null])));
      if (!ls.length) avisos.push("No se han reconocido líneas de producto.");
    }
    // Avisos sobre lo que no se ha encontrado y sobre totales que no cuadran
    const faltan = (seleccion.cabecera || []).filter((c) => salida[c] === null || salida[c] === undefined);
    if (faltan.length) avisos.push(`No encontrado: ${faltan.map((c) => etiquetas[c] || c.replace(/_/g, " ")).join(", ")}.`);
    const { base_imponible: b, cuota_iva: c, total: t } = cab;
    if ([b, c, t].every((v) => typeof v === "number")) {
      const extra = (cab.recargo_equivalencia || 0) + (cab.otros_impuestos || 0) - (cab.irpf || 0);
      if (!cerca(b + c + extra, t)) avisos.push(`Base + IVA (${(b + c + extra).toFixed(2)}) no coincide con el total (${t.toFixed(2)}): revisa los importes.`);
    }
    salida.avisos = [...new Set(avisos)];
    return salida;
  }

  return { extraer, puntuar, renglonesOcr, columnasTabla, parsearImporte, nifValido, ibanValido, importes, lineaProducto, buscarProductos, esResumen, fechaDe };
});
