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

// Factura real de un mayorista (foto de un usuario), transcrita como la daría una foto nítida.
const MAYORISTA = `
Factura No:     FV/2026/24583
Fecha Factura:  14-07-2026
Albarán:        PV/2026/26604
Cliente: CARLOS ENRIQUE
TORREZGALVEZ
CIF: 78105855V
DireccionC/SAN ANTONIO ABAD Nº 6 ESQ. A
Código postal: 41014
Localidad: Sevilla
LO QUE TE GUSTA, MÁS CERCA DE TI
RIZO & HERRERA SL
PLG.Calonge,C. Magnesio, 7,
41007 Sevilla
Tel: 954 876 066 - 649 123 923
Email: ventas@mibodeguita.es
C.I.F: B92411750
Nº RS: 40.072843/SE
FORMA DE PAGO: CONTADO
Vencimiento: 14/07/2026
Peso: 128.88 kg
CODIGO          DESCRIPCION                        LOTE      CADUCIDAD  CANTIDAD   PRECIO €/u  %DTOS  % IVA  TOTAL SIN IVA
BE - BE0012-C545  POSTOBON UVA 2Lt PQTx6           530406    20-09-2026   1,0000    13,0200     0,00   21,0     13,02 €
                                                                          Und
BE - BE0013-C544  POSTOBON COLOMBIANA 2Lt PQTx6    531266    15-12-2026   1,0000 Und  13,0200   0,00   21,0     13,02 €
DU-CHD00002-C532  PANELA REDONDA COEXITO 454g Cx24 LC2026    19-07-2027   4,0000    1,4800      0,00   10,0      5,92 €
G - 7200-C398     SALTIN NOEL 300g Cx12            202609    17-02-2027   2,0000    1,8000      0,00   10,0      3,60 €
GR-2910201        FRIJOL ROJO SEDA DE MI PAIS SACO 22.7Kg  20260606  16-04-2028  1,0000  70,0000  0,00  4,0  70,00 €
M-VA011-C265      SALSA VALENTINA NEGRA (MUY PICANTE) 370ml  300930  29-09-2030  2,0000  1,9000  0,00  10,0  3,80 €
SN-93-000-C486    DIANA TORTILLA JALAPEÑO 150g Cx45  3814-   13-04-2027  10,0000   1,6900     0,00   10,0     16,90 €
Z - EP2000-C705   HAPPY EMPANADA POLLO x5und Cx24  055       08-06-2027   5,0000    4,5000      0,00   10,0     22,50 €
Página 1 de 2
`;

test("factura de mayorista: 4 decimales, lote, caducidad, %dto y %IVA", () => {
  const d = R.extraer(MAYORISTA, TODO);
  assert.equal(d.numero_factura, "FV/2026/24583");
  assert.equal(d.fecha, "2026-07-14");
  assert.equal(d.vencimiento, "2026-07-14");
  assert.equal(d.emisor_nombre, "RIZO & HERRERA SL");
  assert.equal(d.emisor_nif, "B92411750");
  assert.equal(d.cliente_nombre, "CARLOS ENRIQUE");
  assert.equal(d.cliente_nif, "78105855V");
  assert.equal(d.forma_pago, "Efectivo");
  assert.deepEqual(d.lineas.map((l) => [l.referencia, l.descripcion, l.cantidad, l.precio_unitario, l.tipo_iva, l.importe]), [
    ["BE - BE0012-C545", "POSTOBON UVA 2Lt PQTx6", 1, 13.02, 21, 13.02],
    ["BE - BE0013-C544", "POSTOBON COLOMBIANA 2Lt PQTx6", 1, 13.02, 21, 13.02],
    ["DU-CHD00002-C532", "PANELA REDONDA COEXITO 454g Cx24", 4, 1.48, 10, 5.92],
    ["G - 7200-C398", "SALTIN NOEL 300g Cx12", 2, 1.8, 10, 3.6],
    ["GR-2910201", "FRIJOL ROJO SEDA DE MI PAIS SACO 22.7Kg", 1, 70, 4, 70],
    ["M-VA011-C265", "SALSA VALENTINA NEGRA (MUY PICANTE) 370ml", 2, 1.9, 10, 3.8],
    ["SN-93-000-C486", "DIANA TORTILLA JALAPEÑO 150g Cx45", 10, 1.69, 10, 16.9],
    ["Z - EP2000-C705", "HAPPY EMPANADA POLLO x5und Cx24", 5, 4.5, 10, 22.5],
  ]);
  assert.equal(d.lineas[0].importe_iva, 15.75);   // 13,02 + 21 %
  assert.ok(!d.avisos.some((a) => /Revisa/.test(a)), d.avisos.join(" | "));
});

test("importes con 4 decimales y descuento en %", () => {
  assert.equal(R.parsearImporte("13,0200"), 13.02);
  assert.equal(R.parsearImporte("1,0000"), 1);
  assert.equal(R.parsearImporte("1.234"), 1234);
  const l = R.lineaProducto("Caja de tornillos     10,0000    2,5000    10,00    21,0    22,50 €");
  assert.deepEqual([l.cantidad, l.precio, l.descuento, l.tipo_iva, l.importe], [10, 2.5, 2.5, 21, 22.5]);
});

test("basura del OCR en las columnas de números", () => {
  const t = (l) => { const r = R.lineaProducto(l); return r && [r.descripcion, r.cantidad, r.precio, r.importe, r.revisar]; };
  assert.deepEqual(t("B-202 Tornillo modelo M3                 1     ==:     2,25"), ["Tornillo modelo M3", 1, 2.25, 2.25, false]);
  assert.deepEqual(t("B-205 Tornillo modelo M6                 1     3-75     =="), ["Tornillo modelo M6", 1, 3.75, 3.75, false]);
  assert.deepEqual(t("A-110 Mantenimiento anual caldera        1 120,080 120,00").slice(3), [120, true]);
  // una fila ilegible no se pega a la anterior: se añade para revisar
  const ls = R.buscarProductos(["B-204 Tornillo modelo M5    1   3,25   3,25", "B-205 Tornillo modelo M6    1   3#7   ##"]);
  assert.deepEqual(ls.map((l) => [l.referencia, l.descripcion, l.importe, l.revisar]),
    [["B-204", "Tornillo modelo M5", 3.25, false], ["B-205", "Tornillo modelo M6", null, true]]);
});

// Pro-forma en PDF de un usuario (texto tal como lo da pdf.js, ya sin duplicados).
const PROFORMA = `(LOCT. EXPRESS) CARLOS ENRIQUE
TORREZGALVEZ
C/SAN ANTONIO ABAD Nº 6 ESQ. A
41014 Sevilla
España
NIF: 78105855V
Factura Pro-Forma # PV/2025/01517
Fecha orden:    Comercial:
15/01/2025 13:06:49    LOURDES CARBONERO PACHECO
Precio
Descripción    Cantidad    unitario    Impuestos Importe
[MB670] CHORIZO X 5 SANTA ROSANO X 10 caja    7,0000    5,3900    10% 37,73 €
Und
[0360] THIERE KUMBA COUSCOUS MIL 500g    8,0000    1,6200    10% 12,96 €
Und
[DOS011] PANELA FRACCIONADA DORADO 454 g X    3,0000    1,4300    10%    4,29 €
24    Und
[DOS002] PLATANITOS CHILE LIMON 100g X 30    15,0000    0,8400    10% 12,60 €
DORADO    Und
[212] DISPLEY ALFAJOR NEGRO X 24 MARDEL    1,0000 Und    16,3000    10% 16,30 €
[390-301 00] CLUB ROJITA GRANDE 2LT X 6    1,0000 Und    13,9600    IVA 21% 13,96 €
(Bienes)
[010002] LATA GUARANA X 24 ( ANTARTICA)    1,0000 Und    14,4000    IVA 21% 14,40 €
(Bienes)
[DOS000] PLATANITOS SAL DORADO 100g X 30 UNI    15,0000    0,8400    10% 12,60 €
Und
Subtotal    124,84 €
IVA 10%    9,65 €
IVA 21%    5,95 €
Total    140,44 €
ENVIAR BUÑUELO CONGELADO (2)
DESCUENTO PAPA RELLENA
Plazo de pago: Pago inmediato
 954876066 - 649402070  INFO@MIBODEGUITA.ES  https://WWW.MIBODEGUITA.ES`;

test("pro-forma en PDF: 8 líneas, IVA 10 y 21 %, subtotal como base", () => {
  const d = R.extraer(PROFORMA, TODO);
  assert.equal(d.numero_factura, "PV/2025/01517");
  assert.equal(d.fecha, "2025-01-15");
  assert.deepEqual([d.base_imponible, d.tipo_iva, d.cuota_iva, d.total], [124.84, "10 / 21", 15.6, 140.44]);
  assert.deepEqual(d.lineas.map((l) => [l.referencia, l.descripcion, l.cantidad, l.precio_unitario, l.tipo_iva, l.importe, l.importe_iva]), [
    ["MB670", "CHORIZO X 5 SANTA ROSANO X 10 caja", 7, 5.39, 10, 37.73, 41.5],
    ["0360", "THIERE KUMBA COUSCOUS MIL 500g", 8, 1.62, 10, 12.96, 14.26],
    ["DOS011", "PANELA FRACCIONADA DORADO 454 g X 24", 3, 1.43, 10, 4.29, 4.72],
    ["DOS002", "PLATANITOS CHILE LIMON 100g X 30 DORADO", 15, 0.84, 10, 12.6, 13.86],
    ["212", "DISPLEY ALFAJOR NEGRO X 24 MARDEL", 1, 16.3, 10, 16.3, 17.93],
    ["390-301 00", "CLUB ROJITA GRANDE 2LT X 6", 1, 13.96, 21, 13.96, 16.89],
    ["010002", "LATA GUARANA X 24 ( ANTARTICA)", 1, 14.4, 21, 14.4, 17.42],
    ["DOS000", "PLATANITOS SAL DORADO 100g X 30 UNI", 15, 0.84, 10, 12.6, 13.86],
  ]);
  assert.ok(d.avisos.some((a) => /Solo aparece un NIF/.test(a)), d.avisos.join(" | "));
  assert.ok(!d.avisos.some((a) => /no cuadra|Revisa|no coincide/.test(a)), d.avisos.join(" | "));
});

// Tique de Mercadona (foto de un usuario) tal como lo lee Tesseract, con sus errores reales:
// "195" y "591" sin coma, "1555" por "1,55", "14,90" por "14,80", total "15,16" y cuota "3,46".
const MERCADONA = `MERCADONA, S.A.
A-46103834
AV REINO UNIDO, 3
41012 SEVILLA
TELÉFONO:    954619421
17/11/2026 15:33 OP:1343100
HACTURA SIMPLIFICADA:    3501-015-506212
|    Descripción    P, Unit    Imp.(e)
| CEBOLLA TUBO    1,50
1 ESPINACA BABY    1,15
1 CANÓNIGOS    1,20
1 FILM TRANSPARENTE    195
1 FILETE LOMO FAM    591
| YOGUR NATURAL X6    1.00
2 BARRA RÚSTICA    0,70    1,40
1 12 HUEVOS GRANDES-L    3,05
1 CHAMPIÑÓN BLAN    1,45
1 ALMENDRA TOST S/PIEL    2,90
1 GUISANTE FINO    1555
1 AJO SECO 250 G    1,85
FILETE MELVA OLIVA    1,90
1 ZANAHORIA BOLSA    1,20
PESCADO
Salmon Entero
1,352 kg    10,95 €/kg    14,90
1 PIMIENTO ROJO
0,252 kg    2,90 €/kg    0,73
1 CALABACIN VERDE
0,378 kg    1,90 €/kg    0,72
1 BANANA
0,968 kg    1,55 €/kg    1,50
1 PARKING    0,00
ENTRADA 15:16 SALIDA 15:33
TOTAL    15,16
ENTREGA EFECTIVO    30,00
DEVOLUCIÓN    4,4
YA    BASE IMPONIBLE (€)    CUOTA (€)
4%    17,60    0,70
10%    23,19    4.
21%    1,61    "Ea
TOTAL    42,40    3,46
DISPONE DE 20 MINUTOS`;

test("tique de supermercado con errores del OCR, productos al peso y desglose de IVA", () => {
  const d = R.extraer(MERCADONA, TODO);
  assert.deepEqual([d.emisor_nombre, d.emisor_nif, d.numero_factura, d.fecha, d.forma_pago],
    ["MERCADONA, S.A.", "A46103834", "3501-015-506212", "2026-11-17", "Efectivo"]);
  assert.deepEqual([d.base_imponible, d.tipo_iva, d.cuota_iva, d.total], [42.4, "4 / 10 / 21", 3.36, 45.76]);
  assert.deepEqual(d.lineas.map((l) => [l.descripcion, l.cantidad, l.precio_unitario_iva, l.importe_iva]), [
    ["CEBOLLA TUBO", 1, 1.5, 1.5], ["ESPINACA BABY", 1, 1.15, 1.15], ["CANÓNIGOS", 1, 1.2, 1.2],
    ["FILM TRANSPARENTE", 1, 1.95, 1.95], ["FILETE LOMO FAM", 1, 5.91, 5.91], ["YOGUR NATURAL X6", 1, 1, 1],
    ["BARRA RÚSTICA", 2, 0.7, 1.4], ["12 HUEVOS GRANDES-L", 1, 3.05, 3.05], ["CHAMPIÑÓN BLAN", 1, 1.45, 1.45],
    ["ALMENDRA TOST S/PIEL", 1, 2.9, 2.9], ["GUISANTE FINO", 1, 1.55, 1.55], ["AJO SECO 250 G", 1, 1.85, 1.85],
    ["FILETE MELVA OLIVA", 1, 1.9, 1.9], ["ZANAHORIA BOLSA", 1, 1.2, 1.2],
    ["Salmon Entero", 1.352, 10.95, 14.8], ["PIMIENTO ROJO", 0.252, 2.9, 0.73], ["CALABACIN VERDE", 0.378, 1.9, 0.72],
    ["BANANA", 0.968, 1.55, 1.5], ["PARKING", 1, 0, 0],
  ]);
  assert.equal(d.lineas.reduce((a, l) => a + l.importe_iva, 0).toFixed(2), "45.76");   // cuadra con el total
  assert.ok(d.avisos.some((a) => /Revisa estas líneas/.test(a)));   // las corregidas quedan marcadas
});

test("enteros en una factura con céntimos: los que cuadran no se tocan", () => {
  const texto = `TALLER S.L.\nCIF B12345674\nFactura 5/2026\n` +
    `Mano de obra          2      150      300\nFiltro de aceite      1    12,50    12,50\nJunta tapa            1     4,25     4,25\n` +
    `Base imponible                    316,75\n`;
  const d = R.extraer(texto, { cabecera: ["base_imponible"], linea: ["descripcion", "importe"] });
  assert.deepEqual(d.lineas.map((l) => l.importe), [300, 12.5, 4.25]);
});


// Factura-tique de un mayorista (foto de un usuario), texto real de Tesseract con sus errores:
// "CiF: 591413534" (B leída como 5), DNI sin letra, "SL" leído "Si", columnas U/V y U/C,
// y una tabla Base / %IVA / IVA / %Rec / Rec / Imp con valores ilegibles.
const REYES = "ko    a\nKC —o_——    We 7\nÁ eyes    |\nTa    N\nCono\nfOBX Jm.\nWww frutossecosrayes \"a\nDISTR    ai    us\nl    IBUTDORES DE FRUTOS SECOS REYES SEVILLA,    Si\nCiF: 591413534\n41309 -    SAN    JOS\nPG.    IND.    CAÑANO 1 CA RENCONADA, SEVILLA\n955704812    AV COMUNICACION, 341\nFACTURA 2026 / FV38 / 4397\n01/10/2026\nATENDIDO POR: EMILIO CALAHUCHE GARCIA\n23506\nCARLOS ENRIQUE TORRES GALVEZ\n78105855\nPC    SAN ANTONIO ABAD 6\nE    DOS HERMANAS\ny    41014 (SEVILLA)\nFORMA DE PAGO: EFECTIVO CONTADO\nCod.    Desc.    U/N    U/C PRECIO    Suma\n1261    GIR. AGUASAL CAJA 15 UD    15    10,23    10,23\n26A0525260\n1390    GIR. AGUASAL BOLSA 25 UD    1    25    7,95    7,98\n2640527258\nBase.    % IVA    IVA    YREC    en    us\n18,18    10    1,82    1,40    $    $\nTotal    20.25 *\n";

test("tique de mayorista: códigos, U/C, NIF sin letra y tabla de impuestos en columnas", () => {
  const d = R.extraer(REYES, TODO);
  assert.equal(d.numero_factura, "2026/FV38/4397");
  assert.equal(d.fecha, "2026-10-01");
  assert.equal(d.emisor_nif, "B91413534");
  assert.match(d.emisor_nombre, /FRUTOS SECOS REYES SEVILLA/);
  assert.equal(d.cliente_nif, "78105855V");
  assert.equal(d.cliente_nombre, "CARLOS ENRIQUE TORRES GALVEZ");
  assert.equal(d.forma_pago, "Efectivo");
  assert.deepEqual([d.base_imponible, d.tipo_iva, d.cuota_iva, d.total], [18.18, "10", 1.82, 20.25]);
  assert.deepEqual(d.lineas.map((l) => [l.referencia, l.descripcion, l.cantidad, l.precio_unitario, l.importe, l.tipo_iva]), [
    ["1261", "GIR. AGUASAL CAJA 15 UD", 1, 10.23, 10.23, 10],
    ["1390", "GIR. AGUASAL BOLSA 25 UD", 1, 7.95, 7.95, 10],
  ]);
});

test("recargo de equivalencia calculado con base x %Rec si no se lee", () => {
  const d = R.extraer(REYES, { cabecera: ["recargo_equivalencia", "total"], linea: [] });
  assert.equal(d.recargo_equivalencia, 0.25);
  assert.ok(!d.avisos.some((a) => /no coincide/.test(a)), d.avisos.join(" | "));
});
