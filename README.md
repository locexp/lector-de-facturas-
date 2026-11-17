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

La lectura la hace la IA de Claude (visión + salida estructurada), así que hace falta una
**clave de API**: créala en https://console.anthropic.com → *API Keys* (pago por uso; cada
factura cuesta unos céntimos) y ponla en `.env` (ver `.env.ejemplo`).

## 📱 Instalación

### En el móvil Android con Termux
1. Instala **Termux** desde F-Droid (https://f-droid.org/packages/com.termux/).
2. En Termux:
   ```bash
   pkg install -y git
   git clone https://github.com/locexp/lector-de-facturas-.git
   cd lector-de-facturas-
   cp .env.ejemplo .env && nano .env      # pega tu ANTHROPIC_API_KEY
   ./iniciar.sh
   ```
   La primera instalación puede tardar un rato (se compilan algunas dependencias).
3. Abre **http://localhost:8000** en el navegador → menú → «Añadir a pantalla de inicio».

### En tu PC y abrirla desde el móvil (Android o iPhone)
```bash
pip install -r requirements.txt
cp .env.ejemplo .env      # y pon tu ANTHROPIC_API_KEY
./iniciar.sh              # o: ANTHROPIC_API_KEY=... python app.py
```
La consola muestra una dirección del tipo `http://192.168.1.20:8000`: ábrela en el móvil
conectado a la **misma wifi**.

### En un servidor (Render, Railway, un VPS...)
Comando de inicio `python app.py` (usa la variable `PORT`). Pon `ANTHROPIC_API_KEY` y
**`APP_CLAVE`** para que nadie más pueda usarla (gastaría de tu clave).

| Variable | Qué hace |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API de Claude (obligatoria) |
| `APP_CLAVE` | Pide esta clave para leer facturas |
| `FACTURAS_MODELO` | Modelo de Claude (por defecto `claude-opus-5-5`) |
| `PORT` | Puerto (8000 por defecto) |

## Privacidad
Las fotos solo se envían a la API de Claude para leerlas; la app no las guarda. Los datos
leídos se quedan en el navegador del móvil hasta que pulses «Borrar todo».

## Notas
- Fotos HEIC no soportadas (el iPhone normalmente las convierte a JPG al subirlas desde el
  navegador). Se admiten JPG, PNG, WEBP y PDF.
- Para añadir o cambiar los datos que se pueden elegir, edita `facturas/campos.py`.

## Tests
```bash
pip install pytest && python -m pytest tests
```
