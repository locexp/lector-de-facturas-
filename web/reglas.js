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
      s = /,\d{1,2}$/.test(s) ? s.replace(/,/g, (m, i) => (i === coma ? "." : "")) : s.replace(/,/g, "");
    } else if (punto >= 0) {
      // un solo punto con 1-2 decimales = decimal; con 3 cifras detrás = miles (estilo español)
      if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
      else s = s.replace(/\.(?=.*\.)/g, "");
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

  function buscarNifs(lineas) {
    const res = [];
    lineas.forEach((l, i) => {
      const candidatos = [...l.matchAll(RE_NIF)].map((m) => m[0]);
      if (/\b(nif|dni|cif|nie|n\.i\.f|d\.n\.i)\b/i.test(quitarTildes(l))) {
        for (const m of l.matchAll(RE_DNI_SIN_LETRA)) {
          const d = m[0].replace(/\D/g, ""), letra = LETRA_COMO_NUMERO[d[8]];
          if (letra && nifValido(d.slice(0, 8) + letra)) candidatos.push(d.slice(0, 8) + letra);
        }
      }
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
    cliente: /\b(cliente|destinatario|facturar a|datos del cliente|comprador|receptor|sr\.?|sra\.?)\b/,
    emisor: /\b(emisor|proveedor|vendedor)\b/,
    total: /\b(total|importe total|a pagar|total factura|liquido)\b/,
    noTotal: /\b(subtotal|sub-total|total base|base|total iva|total impuestos|total cuota|total dto|total descuento|total lineas?|total articulos|total unidades|total uds|total items)\b/,
    base: /\b(base imponible|base imp\.?|b\. ?imponible|base)\b/,
    iva: /\b(i\.?v\.?a\.?|cuota)\b/,
    recargo: /\b(recargo|r\.? ?e\.? )\b/,
    irpf: /\b(irpf|retencion)\b/,
    descuento: /\b(descuento|dto\.?)\b/,
    nombreEmpresa: /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?|s\.?\s?l\.?\s?l\.?|c\.?\s?b\.?|sociedad|slne)$/,
    direccion: /(^|[^a-z])(c\/|calle|avda|avenida|av\.|plaza|pza|paseo|ctra|carretera|camino|ronda|poligono|pol\.|travesia|urb\.)(?![a-z])|\b\d{5}\b/,
    noProducto: /\b(total|subtotal|base|iva|i\.v\.a|cuota|nif|cif|n\.i\.f|c\.i\.f|fecha|factura|ticket|cambio|entregado|efectivo|tarjeta|visa|mastercard|telefono|tel\.|tlf|movil|email|e-mail|www|http|iban|vencimiento|forma de pago|gracias|recargo|irpf|retencion|pagina|cliente|domicilio|direccion|c\.p\.|codigo postal|importe|a pagar|pendiente|operacion|autorizacion|aid|arc|terminal|comercio)\b/,
  };

  const FORMAS_PAGO = [
    [/\btransferencia\b/, "Transferencia"], [/\bdomiciliaci[oó]n|recibo domiciliado|adeudo\b/, "Domiciliación"],
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
      /(?:factura|fra\.?|ticket|tique|recibo|albaran|n[º°o]\.?\s*(?:de\s*)?(?:factura|documento|doc\.?)|documento)\s*(?:simplificada\s*)?(?:n\s?[º°o*.]*(?:\d(?=\s*[:#]))?|num\.?|numero|nro\.?|#)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/.]*\d[A-Z0-9\-\/]*)/i,
      /^\s*(?:n[º°o*]\.?|num\.?|numero|nro\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]*\d[A-Z0-9\-\/]*)/i,
    ];
    for (const re of res) {
      for (const l of lineas) {
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
    return l.replace(/^\s*(cliente|emisor|proveedor|raz[oó]n social|nombre|destinatario|facturar a)\s*[:.]?\s*/i, "")
      .replace(/\s*(N\.?I\.?F|C\.?I\.?F|NIF|CIF)\b.*$/i, "").replace(/\s{2,}/g, " ").replace(/[\s,;:]+$/, "").trim() || null;
  }

  function cabecera(lineas, avisos) {
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
    d.cliente_nif = cli ? cli.valor : null;
    nifs.filter((n) => !n.valido).forEach((n) =>
      avisos.push(`Parece un NIF/CIF (${n.valor}) pero su letra de control no es válida; puede estar mal leído.`));

    // Nombres
    const iniCliente = p.findIndex((l) => K.cliente.test(l));
    const finEmisor = iniCliente > 0 ? iniCliente : Math.min(lineas.length, emi ? emi.linea + 3 : 8);
    d.emisor_nombre = nombreCerca(lineas, emi ? emi.linea - 3 : 0, emi ? emi.linea + 3 : finEmisor) ||
      limpiarNombre(lineas.find((l, i) => i < finEmisor && /[a-zñ]{3,}/i.test(l) &&
        !/factura|ticket|tique|fecha|n[º°]|nif|cif|tel|@|www/i.test(l)) || "");
    if (iniCliente >= 0) {
      const enLinea = limpiarNombre(lineas[iniCliente].replace(/^.*?(cliente|destinatario|facturar a)\s*[:.]?/i, ""));
      d.cliente_nombre = (enLinea && /[a-z]{3,}/i.test(enLinea) ? enLinea : null) ||
        nombreCerca(lineas, iniCliente, iniCliente + 4) ||
        limpiarNombre(lineas.slice(iniCliente + 1, iniCliente + 3).find((l) => /[a-zñ]{3,}/i.test(l) && !K.direccion.test(plano(l))) || "");
    } else {
      d.cliente_nombre = cli ? nombreCerca(lineas, cli.linea - 3, cli.linea + 2) : null;
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
      const f = fechaDe(l) || (/(fecha|venc)/.test(p[i]) && !fechaDe(l) && lineas[i + 1] ? fechaDe(lineas[i + 1]) : null);
      if (!f) return;
      if (/venc/.test(p[i])) venc = venc || f;
      else if (/fecha/.test(p[i]) && !/fecha\s*(de\s*)?(venc|entrega|pedido|operacion)/.test(p[i])) fecha = fecha || f;
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
          if (v !== null) vals.push(Math.abs(v));
        }
      });
      return vals;
    };
    const totales = sumaClave(K.total, K.noTotal);
    d.total = totales.length ? Math.max(...totales) : null;

    const bases = sumaClave(K.base);
    const totalBase = p.findIndex((l) => /\b(total base|base imponible total|suma bases|total b\.? ?imp)/.test(l));
    d.base_imponible = totalBase >= 0 ? importeTrasClave(lineas, totalBase)
      : bases.length ? red2([...new Set(bases)].reduce((a, b) => a + b, 0)) : null;

    // Cuota de IVA: "Total IVA" o la suma de las líneas "IVA xx%"
    const lineasIva = p.map((l, i) => i).filter((i) => K.iva.test(p[i]) && !/\b(incluido|incl\.?|inc\.)\b/.test(p[i]) &&
      !K.base.test(p[i].replace(/\b(cuota|iva)\b.*$/, "")) && !/\bnif|cif\b/.test(p[i]));
    const totalIva = lineasIva.find((i) => /\b(total|cuota total|total cuota)\b/.test(p[i]));
    if (totalIva !== undefined) d.cuota_iva = importeTrasClave(lineas, totalIva, /\b(cuota|i\.?v\.?a\.?)\b/);
    else {
      const vals = lineasIva.map((i) => importeTrasClave(lineas, i, /\bcuota\b/.test(p[i]) ? /\bcuota\b/ : null)).filter((v) => v !== null);
      d.cuota_iva = vals.length ? red2([...new Set(vals)].reduce((a, b) => a + b, 0)) : null;
    }
    const tipos = [...new Set(p.filter((l) => K.iva.test(l) || /\btipo\b/.test(l)).flatMap(porcentajes))];
    d.tipo_iva = tipos.length ? tipos.sort((a, b) => a - b).map((t) => String(t).replace(".", ",")).join(" / ") : null;

    const uno = (re) => { const v = sumaClave(re); return v.length ? v[v.length - 1] : null; };
    d.recargo_equivalencia = uno(K.recargo);
    d.irpf = uno(K.irpf);
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

    // Cuadrar base + IVA = total, completando el dato que falte
    const { base_imponible: b, cuota_iva: c, total: t } = d;
    const extra = (d.recargo_equivalencia || 0) + (d.otros_impuestos || 0) - (d.irpf || 0);
    if (b !== null && t !== null && c === null && t - b - extra > 0) {
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
  const RE_NUM_FINAL = /(\s+|^)(-?\d{1,3}(?:[.]\d{3})*(?:[.,]\d{1,3})?|-?\d+(?:[.,]\d{1,3})?)(\s*%)?\s*(?:€|eur)?\s*$/i;

  function lineaProducto(l) {
    const p = plano(l);
    if (K.noProducto.test(p) || !/[a-zñ]{3,}/i.test(l)) return null;
    let resto = l.replace(/\s*€\s*/g, " ").replace(/\s+[A-E]\s*$/, "").trim();  // códigos de IVA tipo "A" al final
    const nums = [];
    let tipo = null, m;
    // Números al final: importe, precio, (descuento)... y como mucho un entero (la cantidad) a la
    // izquierda; lo que quede antes es parte de la descripción ("Tornillos caja 100").
    while (nums.length < 4 && !(nums.length && !nums[0].decimales) && (m = resto.match(RE_NUM_FINAL))) {
      const n = parsearImporte(m[2]);
      if (n === null) break;
      const decimales = /[.,]\d{1,3}$/.test(m[2]);
      if (!decimales && !m[3] && nums.length) {
        // "ACEITE OLIVA 1L 8,49" leído como "11": un entero pegado al texto es parte de la descripción
        const cuadra = nums.length >= 2 && cerca(n * nums[0].n, nums[nums.length - 1].n, 0.02);
        if (m[1].length < 2 && !cuadra) break;
      }
      if (m[3]) tipo = n; else nums.unshift({ n, decimales });
      resto = resto.slice(0, m.index).trim();
    }
    if (!nums.length || !nums[nums.length - 1].decimales) return null;   // el importe final debe tener decimales
    let cantidad = null, referencia = null;
    const q = resto.match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:x|uds?\.?|u\.|ud\.|kg|und\.?)?\s+(?=\D)/i);
    if (q) { cantidad = parsearImporte(q[1]); resto = resto.slice(q[0].length); }
    const r = resto.match(/^([A-Z0-9][A-Z0-9\-.\/]{3,})\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/i);
    if (r && /\d/.test(r[1])) { referencia = r[1]; resto = resto.slice(r[0].length); }
    // "2 x 1,05" dentro de la descripción
    const x = resto.match(/\s(\d+(?:[.,]\d{1,3})?)\s*[xX*]\s*$/);
    if (x && cantidad === null) { cantidad = parsearImporte(x[1]); resto = resto.slice(0, x.index); }
    const descripcion = resto.replace(/[\s.:\-_|]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (!/[a-zñ]{3,}/i.test(descripcion)) return null;

    const v = nums.map((o) => o.n);
    const importe = v[v.length - 1];
    let precio = null;
    if (cantidad !== null) {
      precio = v.length >= 2 ? v[v.length - 2] : red2(importe / (cantidad || 1));
    } else if (v.length >= 3) {
      [cantidad, precio] = v;
    } else if (v.length === 2) {
      if (!nums[0].decimales) { cantidad = v[0]; precio = red2(importe / (cantidad || 1)); }
      else { precio = v[0]; const c = importe / precio; cantidad = cerca(c, Math.round(c), 0.02) ? Math.round(c) : null; }
    } else { cantidad = 1; precio = importe; }
    return { descripcion, referencia, cantidad, precio, importe, tipo_iva: tipo };
  }

  function lineas(lineasTexto, cab, avisos) {
    const res = lineasTexto.map(lineaProducto).filter(Boolean);
    if (!res.length) return res;
    // ¿Los importes de las líneas llevan IVA? Se deduce comparando con la base y el total.
    const suma = red2(res.reduce((a, l) => a + l.importe, 0));
    const tipos = cab.tipo_iva ? cab.tipo_iva.split(" / ").map((t) => parsearImporte(t)) : [];
    const tipoUnico = tipos.length === 1 ? tipos[0] : null;
    let conIva = null;
    if (cab.base_imponible !== null && cerca(suma, cab.base_imponible, 0.1)) conIva = false;
    else if (cab.total !== null && cerca(suma, cab.total, 0.1)) conIva = true;
    else if (cab.total !== null && cab.base_imponible === null) conIva = true;  // típico de tiques
    if (conIva === null) avisos.push("No se ha podido saber si los importes de las líneas llevan IVA; se han puesto como «sin IVA».");
    else if (cab.total !== null && !cerca(suma, conIva ? cab.total : cab.base_imponible, 0.1))
      avisos.push(`La suma de las líneas (${suma.toFixed(2)}) no cuadra: puede faltar o sobrar alguna línea.`);

    return res.map((l) => {
      const t = l.tipo_iva !== null ? l.tipo_iva : tipoUnico;
      const f = t !== null ? 1 + t / 100 : null;
      const sin = (v) => (v === null ? null : conIva ? (f ? red2(v / f) : null) : v);
      const con = (v) => (v === null ? null : conIva ? v : (f ? red2(v * f) : null));
      return {
        descripcion: l.descripcion, referencia: l.referencia, cantidad: l.cantidad,
        precio_unitario: sin(l.precio), precio_unitario_iva: con(l.precio), descuento: null,
        tipo_iva: t, importe: sin(l.importe), importe_iva: con(l.importe),
      };
    });
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

  return { extraer, parsearImporte, nifValido, ibanValido, importes, lineaProducto, fechaDe };
});
