// Tests de las reglas del modo gratuito:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../web/reglas.js");

const TODO = {
  cabecera: ["numero_factura", "fecha", "emisor_nombre", "emisor_nif", "emisor_direccion", "cliente_nombre",
    "cliente_nif", "base_imponible", "tipo_iva", "cuota_iva", "irpf", "total", "moneda", "forma_pago", "iban", "vencimiento"],
  linea: ["descripcion", "referencia", "cantidad", "precio_unitario", "precio_unitario_iva", "tipo_iva", "importe", "importe_iva"],
};

const FACTURA = `
FERRETERIA LOPEZ S.L.
C/ Mayor, 12
28013 Madrid
CIF: B-12345674   Tel. 912 345 678

FACTURA Nº: F-2026/0153
Fecha: 12/11/2026

Cliente: Talleres Ruiz
NIF: 12345678Z
Avda. de la Paz 4, 41001 Sevilla

Ref.     Descripción                    Cant.   Precio    Importe
TOR-440  Tornillos 4x40 caja 100          2      6,30      12,60
TAL-600  Taladro percutor 600W            1     70,00      70,00

Base imponible                                             82,60
IVA 21%                                                    17,35
TOTAL FACTURA                                          99,95 €

Forma de pago: Transferencia bancaria
IBAN: ES91 2100 0418 4502 0005 1332
Vencimiento: 12/12/2026
`;

const TIQUE = `
SUPERMERCADOS EL SOL S.A.
CIF A08000002
FACTURA SIMPLIFICADA 2026-001234
17/11/2026 10:32
2 LECHE ENTERA 1L        1,05   2,10
PAN BARRA                       0,90
ACEITE OLIVA 1L                 8,49
TOTAL                          11,49 €
IVA 10%   BASE 10,45   CUOTA 1,04
TARJETA VISA                   11,49
`;

test("importes en formato español e inglés", () => {
  assert.equal(R.parsearImporte("1.234,56 €"), 1234.56);
  assert.equal(R.parsearImporte("1,234.56"), 1234.56);
  assert.equal(R.parsearImporte("99,95"), 99.95);
  assert.equal(R.parsearImporte("99.95"), 99.95);
  assert.equal(R.parsearImporte("1.234"), 1234);
  assert.deepEqual(R.importes("IVA 21%   17,35"), [17.35]);
});

test("NIF, CIF, NIE e IBAN", () => {
  assert.equal(R.nifValido("12345678Z"), true);
  assert.equal(R.nifValido("B12345674"), true);
  assert.equal(R.nifValido("B12345675"), false);
  assert.equal(R.nifValido("X1234567L"), true);
  assert.equal(R.ibanValido("ES9121000418450200051332"), true);
});

test("factura completa", () => {
  const d = R.extraer(FACTURA, TODO);
  assert.equal(d.emisor_nombre, "FERRETERIA LOPEZ S.L.");
  assert.equal(d.emisor_nif, "B12345674");
  assert.equal(d.emisor_direccion, "C/ Mayor, 12, 28013 Madrid");
  assert.equal(d.cliente_nombre, "Talleres Ruiz");
  assert.equal(d.cliente_nif, "12345678Z");
  assert.equal(d.numero_factura, "F-2026/0153");
  assert.equal(d.fecha, "2026-11-12");
  assert.equal(d.vencimiento, "2026-12-12");
  assert.equal(d.base_imponible, 82.6);
  assert.equal(d.tipo_iva, "21");
  assert.equal(d.cuota_iva, 17.35);
  assert.equal(d.total, 99.95);
  assert.equal(d.moneda, "EUR");
  assert.equal(d.forma_pago, "Transferencia");
  assert.equal(d.iban, "ES9121000418450200051332");
  assert.equal(d.irpf, null);
  assert.deepEqual(d.lineas, [
    { descripcion: "Tornillos 4x40 caja 100", referencia: "TOR-440", cantidad: 2, precio_unitario: 6.3,
      precio_unitario_iva: 7.62, tipo_iva: 21, importe: 12.6, importe_iva: 15.25 },
    { descripcion: "Taladro percutor 600W", referencia: "TAL-600", cantidad: 1, precio_unitario: 70,
      precio_unitario_iva: 84.7, tipo_iva: 21, importe: 70, importe_iva: 84.7 },
  ]);
  assert.ok(!d.avisos.some((a) => /no coincide|no cuadra/.test(a)), d.avisos.join(" | "));
});

test("tique de supermercado (precios con IVA)", () => {
  const d = R.extraer(TIQUE, TODO);
  assert.equal(d.emisor_nombre, "SUPERMERCADOS EL SOL S.A.");
  assert.equal(d.numero_factura, "2026-001234");
  assert.equal(d.fecha, "2026-11-17");
  assert.equal(d.total, 11.49);
  assert.equal(d.forma_pago, "Tarjeta");
  assert.deepEqual(d.lineas.map((l) => [l.descripcion, l.cantidad, l.precio_unitario_iva, l.importe_iva]), [
    ["LECHE ENTERA 1L", 2, 1.05, 2.1], ["PAN BARRA", 1, 0.9, 0.9], ["ACEITE OLIVA 1L", 1, 8.49, 8.49]]);
  assert.equal(d.lineas[0].importe, 1.91);  // 2,10 / 1,10
});

test("solo devuelve los campos elegidos", () => {
  const d = R.extraer(FACTURA, { cabecera: ["total"], linea: [] });
  assert.deepEqual(Object.keys(d).sort(), ["avisos", "total"]);
});

test("texto vacío avisa", () => {
  const d = R.extraer("   \n  ", TODO);
  assert.ok(d.vacio && d.avisos.length);
});

test("errores típicos de OCR en el NIF (I por 1)", () => {
  const d = R.extraer(FACTURA.replace("B-12345674", "B-I2345674"), TODO);
  assert.equal(d.emisor_nif, "B12345674");
});

test("fallos reales del OCR: N*, Z leída como 7, 1L leído como 11", () => {
  const ocr = FACTURA.replace("FACTURA Nº:", "FACTURA N*:").replace("NIF: 12345678Z", "NIF: 123456787");
  const d = R.extraer(ocr, TODO);
  assert.equal(d.numero_factura, "F-2026/0153");
  assert.equal(d.cliente_nif, "12345678Z");
  const l = R.lineaProducto("ACEITE OLIVA 11               8,49");
  assert.equal(l.descripcion, "ACEITE OLIVA 11");
  assert.equal(l.importe, 8.49);
  assert.equal(R.lineaProducto("ToR-440 Tornillos 4x40 caja 100        2        6,30       12,60").referencia, "ToR-440");
});

test("base y cuota en la misma línea", () => {
  const d = R.extraer(TIQUE, TODO);
  assert.equal(d.base_imponible, 10.45);
  assert.equal(d.cuota_iva, 1.04);
  assert.ok(!d.avisos.some((a) => /calculado/.test(a)), d.avisos.join(" | "));
});

test("tabla resumen con los importes debajo", () => {
  const texto = `TALLER PEREZ S.L.\nCIF B12345674\nFactura 77/2026  Fecha 03/02/2026\n` +
    `Reparación de motor            1    300,00     300,00\n` +
    `Base imponible    % IVA    Cuota IVA    Total\n   300,00        21%       63,00      363,00\n`;
  const d = R.extraer(texto, { cabecera: ["numero_factura", "base_imponible", "tipo_iva", "cuota_iva", "total"], linea: ["descripcion", "importe"] });
  assert.equal(d.numero_factura, "77/2026");
  assert.deepEqual([d.base_imponible, d.tipo_iva, d.cuota_iva, d.total], [300, "21", 63, 363]);
  assert.deepEqual(d.lineas, [{ descripcion: "Reparación de motor", importe: 300 }]);
});

test("Nº leído como N*2", () => {
  assert.equal(R.extraer(FACTURA.replace("FACTURA Nº:", "FACTURA N*2:"), TODO).numero_factura, "F-2026/0153");
});

test("productos con palabras de totales o pagos en la descripción", () => {
  const texto = `TALLER PEREZ S.L.\nCIF B12345674\n` +
    `Cambio de aceite 5W30                1     45,00     45,00\n` +
    `Tarjeta de memoria 64GB              2     12,99     25,98\n` +
    `Cuota mensual de mantenimiento       1     30,00     30,00\n` +
    `Cambio                                          5,00\n` +
    `TARJETA VISA                                  100,98\n` +
    `Entregado                                     120,00\n` +
    `Total a pagar                                 100,98\n`;
  const ls = R.buscarProductos(texto.split("\n"));
  assert.deepEqual(ls.map((l) => [l.descripcion, l.cantidad, l.importe]), [
    ["Cambio de aceite 5W30", 1, 45], ["Tarjeta de memoria 64GB", 2, 25.98], ["Cuota mensual de mantenimiento", 1, 30]]);
});

test("descripciones en varios renglones", () => {
  const texto = `Ref.   Descripción                    Cant.   Precio   Importe\n` +
    `A-100  Mantenimiento anual caldera      1     120,00    120,00\n` +
    `       incluye revisión de gases y\n` +
    `       limpieza del quemador\n` +
    `A-200  Termostato digital               1      45,50     45,50\n` +
    `\n` +
    `Base imponible                                          165,50\n` +
    `Observaciones: entregar por la mañana\n`;
  const ls = R.buscarProductos(texto.split("\n"));
  assert.deepEqual(ls.map((l) => l.descripcion), [
    "Mantenimiento anual caldera incluye revisión de gases y limpieza del quemador", "Termostato digital"]);
});

test("importes sin decimales en columna", () => {
  const texto = `Mano de obra          2      150      300\nDesplazamiento                         40\n` +
    `Madrid                               28013\nTeléfono                         912345678\nEjercicio                             2026\n` +
    `Tornillos caja 100 2 6,30 12,60\nPágina 1 de 2\nTotal artículos                        3\n`;
  const ls = R.buscarProductos(texto.split("\n"));
  assert.deepEqual(ls.map((l) => [l.descripcion, l.cantidad, l.precio, l.importe]), [
    ["Mano de obra", 2, 150, 300], ["Desplazamiento", 1, 40, 40], ["Tornillos caja 100", 2, 6.3, 12.6]]);
});

test("muchas líneas: no hay tope", () => {
  const filas = Array.from({ length: 300 }, (_, i) => `Tornillo modelo M${i + 1}          1      2,50      2,50`);
  const d = R.extraer(`TIENDA PRUEBA S.L.\nCIF B12345674\n${filas.join("\n")}\nTotal  750,00\n`,
    { cabecera: ["total"], linea: ["descripcion", "importe"] });
  assert.equal(d.lineas.length, 300);
  assert.ok(!d.avisos.some((a) => /no cuadra/.test(a)), d.avisos.join(" | "));
});

test("errores del OCR en los importes se corrigen con cantidad x precio", () => {
  const t = (l) => { const r = R.lineaProducto(l); return [r.cantidad, r.precio, r.importe, r.revisar]; };
  assert.deepEqual(t("B-202 Tornillo modelo M3          1     2,25     225"), [1, 2.25, 2.25, false]);
  assert.deepEqual(t("B-224 Tornillo modelo M25         1     1325    13,25"), [1, 13.25, 13.25, false]);
  assert.deepEqual(t("B-225 Tornillo modelo M26         2    13,75    3-5"), [2, 13.75, 27.5, true]);
  assert.deepEqual(t("Bombilla LED                      3     2,00     5,00"), [3, 2, 5, true]);
  const d = R.extraer("TIENDA S.L.\nCIF B12345674\nFACTURA N?: T-88\nBombilla LED     3     2,00     5,00\nTotal   5,00\n",
    { cabecera: ["numero_factura"], linea: ["descripcion"] });
  assert.equal(d.numero_factura, "T-88");
  assert.ok(d.avisos.some((a) => a.includes("«Bombilla LED»")), d.avisos.join(" | "));
});
