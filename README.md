# 🧾 Lector de facturas

App web para el móvil: **eliges qué datos quieres copiar**, haces una **foto** a la factura
(o subes fotos/PDF) y la app te devuelve esos datos listos para pegar en Excel.

1. **Elige qué datos copiar**. Por factura: nº de factura, fecha, emisor, NIF/CIF de emisor y
   cliente, base imponible, % IVA, cuota de IVA, recargo de equivalencia, IRPF, descuento,
   total, moneda, forma de pago, IBAN y vencimiento. Por cada producto o línea: descripción,
   referencia, cantidad, precio sin IVA y con IVA, descuento, % IVA e importe sin IVA y con IVA.
   La elección se recuerda (atajos «Básico», «Todo», «Ninguno»).
2. **Haz una foto** con la cámara o elige fotos/PDF. Si la factura tiene varias páginas,
   añádelas todas y pulsa **Leer factura**.
3. **Revisa** los datos: se pueden corregir a mano. La app avisa si un **NIF/CIF/NIE no es
   válido**, si **base + IVA no cuadra con el total** o si algo no se lee bien.
4. Lee más facturas (se acumulan) y exporta: **Copiar (para Excel)**, **CSV** (con `;` y coma
   decimal, se abre directamente en Excel en español) o **JSON**.

## Dos modos de lectura

| | **Gratis** (por defecto) | **Precisa (IA)** |
|---|---|---|
| Cómo lee | En el propio móvil, con [Tesseract](https://github.com/naptha/tesseract.js) + reglas | Con la IA de Claude |
| Coste | Gratis | Unos céntimos por factura (necesita clave de API) |
| Internet | Solo la primera vez (descarga ~6 MB) | Siempre |
| Privacidad | La foto no sale del móvil | La foto se envía a la API de Claude |
| Funciona bien con | Facturas y tiques impresos, foto recta y con luz | Cualquier formato, letra pequeña, fotos regulares |
| Líneas de producto | Aproximadas: revísalas | Fiables |

En el modo gratuito los datos se sacan con reglas: NIF/CIF/NIE (comprobando la letra de
control y corrigiendo fallos típicos del OCR como `O`→`0` o `Z`→`7`), fechas, nº de factura,
IBAN, y los importes que van junto a «Base imponible», «IVA 21%», «Total»... Si falta uno
de base, IVA o total, lo calcula con los otros dos, y averigua si los precios de las líneas
llevan IVA comparando su suma con la base y el total. Lo que no encuentra, lo avisa; y con
«Ver el texto leído» puedes copiar el texto completo. Si un PDF tiene texto (no escaneado),
se lee directamente, sin OCR, y es casi perfecto.

Para el modo IA crea una clave en https://console.anthropic.com → *API Keys* y ponla en
`.env` (ver `.env.ejemplo`). Sin clave, la app funciona igual en modo gratuito.

**¿Cuántas líneas lee?** No hay tope de líneas de producto. En modo gratuito se
coge cada renglón con forma de producto (descripción + importes), aunque la descripción
tenga palabras como «cambio» o «tarjeta»; los renglones sin importe que van debajo se
unen a la descripción, y se admiten importes sin decimales si van en su columna. Cada
línea se comprueba con cantidad × precio = importe: si el OCR se ha comido una coma
(«2,25» → «225») se corrige, y si no cuadra o el importe no se lee, la app te dice qué
líneas revisar. Límites: PDF hasta 10 páginas; en modo IA, 10 fotos/PDF por factura y
unas 250-400 líneas. Para tiques muy largos, haz varias fotos por tramos y añádelas como
páginas de la misma factura.

**Fotos de tiques y facturas:** la app recorta el papel (aunque esté sobre una mesa oscura),
iguala la luz (sombras y reflejos) y reconstruye los renglones con la posición de cada palabra.
Como el OCR cambia mucho con pequeños detalles de la imagen, prueba hasta 3 lecturas
distintas y se queda con la primera en la que la suma de las líneas cuadra con el total. Entiende
productos al peso («1,352 kg 10,95 €/kg»), el desglose de IVA por tipos de los tiques y
comprueba la cuota con base × tipo. Lo que no se lee bien se deja vacío y se marca para revisar.

**Nombres abreviados:** la app entiende los títulos de columnas y datos completos o abreviados
(«Descripción / Desc. / Concepto», «Cantidad / Cant. / Ctd. / Uds.», «Precio / P.U. / PVP»,
«Importe / Imp. / Suma», «Dto. / Dcto.», «B.I. / Base imp.», «Rec. / R.E.», «Ret.», «Tot.»,
«Fra. / Fact.», «Fec.», «Vto.», «Cli.», «F. pago»...). Con la cabecera de la tabla sabe qué columna
es cada número, aunque haya columnas vacías. La lista está en `web/reglas.js` (`COLUMNAS` y
`RESUMEN`): para añadir una abreviatura nueva basta con escribirla ahí.

**Consejos para el modo gratuito:** foto de frente, con buena luz, sin sombras y que la
factura ocupe toda la imagen. Si una factura sale mal, prueba el modo IA.

## 📱 Instalación

### En el móvil Android con Termux
1. Instala **Termux** desde F-Droid (https://f-droid.org/packages/com.termux/).
2. En Termux:
   ```bash
   pkg install -y git
   git clone https://github.com/locexp/lector-de-facturas-.git
   cd lector-de-facturas-
   cp .env.ejemplo .env && nano .env      # (opcional) tu ANTHROPIC_API_KEY para el modo IA
   ./iniciar.sh
   ```
   Si pones la clave del modo IA, la primera instalación tarda un rato (se compilan
   algunas dependencias). Solo para el modo gratuito es rápida.
3. Abre **http://localhost:8000** en el navegador → menú → «Añadir a pantalla de inicio».

### En tu PC y abrirla desde el móvil (Android o iPhone)
```bash
pip install -r requirements-ia.txt   # o requirements.txt si solo usas el modo gratuito
cp .env.ejemplo .env      # (opcional) ANTHROPIC_API_KEY para el modo IA
./iniciar.sh              # o: ANTHROPIC_API_KEY=... python app.py
```
La consola muestra una dirección del tipo `http://192.168.1.20:8000`: ábrela en el móvil
conectado a la **misma wifi**.

### Sin instalar nada: https://locexp.github.io/lector-de-facturas-/
La carpeta `web/` está publicada en **GitHub Pages**: abre esa dirección en el móvil y
«Añadir a pantalla de inicio». Solo tiene el modo gratuito (el modo IA necesita el servidor).
Cada cambio en `web/` se vuelve a publicar solo (`.github/workflows/pages.yml`).

### En un servidor (Render, Railway, un VPS...)
Comando de inicio `python app.py` (usa la variable `PORT`). Pon `ANTHROPIC_API_KEY` y
**`APP_CLAVE`** para que nadie más pueda usar el modo IA (gastaría de tu clave).

| Variable | Qué hace |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API de Claude (solo para el modo IA) |
| `APP_CLAVE` | Pide esta clave para leer facturas |
| `FACTURAS_MODELO` | Modelo de Claude (por defecto `claude-opus-5-5`) |
| `PORT` | Puerto (8000 por defecto) |

## Privacidad
En modo gratuito las fotos no salen del móvil. En modo IA se envían a la API de Claude
solo para leerlas; la app no las guarda. Los datos
leídos se quedan en el navegador del móvil hasta que pulses «Borrar todo».

## Notas
- Fotos HEIC no soportadas (el iPhone normalmente las convierte a JPG al subirlas desde el
  navegador). Se admiten JPG, PNG, WEBP y PDF.
- Los datos que se pueden elegir están en `web/campos.json`; las reglas del modo gratuito,
  en `web/reglas.js`.

## Tests
```bash
pip install pytest && python -m pytest tests     # servidor y modo IA
node --test tests/reglas.test.js                 # reglas del modo gratuito
```
