"""Lee una factura (fotos o PDF) con la API de Claude y devuelve los campos pedidos.

Necesita la variable de entorno ANTHROPIC_API_KEY (https://console.anthropic.com).
"""
from __future__ import annotations

import base64
import io
import json
import os
import re

from . import campos as C

MODELO = os.environ.get("FACTURAS_MODELO", "claude-opus-5-5")
LADO_MAX = 2000          # px: suficiente para leer la letra pequeña y por debajo del límite de la API
MAX_PDF = 25 * 1024 * 1024

INSTRUCCIONES = """Eres un asistente que copia datos de facturas y tiques de compra (normalmente españoles).
Te paso las imágenes o el PDF de UNA factura (si hay varias imágenes, son páginas de la misma).
Rellena solo los campos del esquema. Reglas:
- Copia los datos tal cual aparecen; no inventes nada. Si un dato no aparece o no se lee, pon null.
- Importes como número con punto decimal (1.234,56 € -> 1234.56), sin símbolo de moneda.
- Fechas en formato AAAA-MM-DD.
- NIF/CIF/NIE en mayúsculas, sin espacios, puntos ni guiones.
- El emisor es quien vende y cobra; el cliente es quien compra.
- Los títulos de columnas y datos pueden venir abreviados: Desc./Concepto = descripción,
  Cód./Ref./Art. = referencia, Cant./Ctd./Uds./U/V = cantidad, P.U./PVP = precio unitario,
  Dto./Dcto. = descuento, Imp./Suma/Total = importe, B.I./Base imp. = base imponible,
  Rec./R.E. = recargo de equivalencia, Ret. = retención IRPF, Fra./Fact. = factura, Vto. = vencimiento.
- Si te piden un dato derivado que no aparece escrito pero se puede calcular sin ambigüedad
  (por ejemplo precio con IVA = precio x (1 + %IVA)), calcúlalo y redondea a 2 decimales.
- En "avisos" explica en español, brevemente, cualquier duda (texto borroso, factura cortada,
  totales que no cuadran, varias facturas en la misma foto...). Si todo está bien, deja la lista vacía."""


class ErrorFactura(Exception):
    """Error que se puede mostrar tal cual al usuario."""


def _preparar_imagen(datos: bytes) -> dict:
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(datos))
        img = ImageOps.exif_transpose(img)  # las fotos del móvil vienen giradas por EXIF
    except Exception as e:  # noqa: BLE001
        raise ErrorFactura("No se pudo abrir la imagen. Usa JPG, PNG o WEBP (HEIC no está soportado).") from e
    img = img.convert("RGB")
    img.thumbnail((LADO_MAX, LADO_MAX))
    salida = io.BytesIO()
    img.save(salida, "JPEG", quality=88)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.standard_b64encode(salida.getvalue()).decode()}}


def preparar_ficheros(ficheros: list[tuple[str, bytes]]) -> list[dict]:
    """[(nombre, bytes)] -> bloques de contenido para la API."""
    bloques = []
    for nombre, datos in ficheros:
        if datos[:5] == b"%PDF-" or nombre.lower().endswith(".pdf"):
            if len(datos) > MAX_PDF:
                raise ErrorFactura(f"El PDF {nombre} es demasiado grande (máx. 25 MB).")
            bloques.append({"type": "document", "source": {
                "type": "base64", "media_type": "application/pdf",
                "data": base64.standard_b64encode(datos).decode()}})
        else:
            bloques.append(_preparar_imagen(datos))
    if not bloques:
        raise ErrorFactura("Añade al menos una foto o PDF de la factura.")
    return bloques


def _cliente():
    import anthropic

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise ErrorFactura("Falta la clave de la API de Claude: pon ANTHROPIC_API_KEY en el fichero .env "
                           "(ver README) y reinicia la app.")
    return anthropic.Anthropic()


def leer_factura(ficheros: list[tuple[str, bytes]], seleccion: dict, cliente=None) -> dict:
    cab, lin = C.filtrar(seleccion)
    if not cab and not lin:
        raise ErrorFactura("Elige al menos un dato que copiar.")
    bloques = preparar_ficheros(ficheros)
    cliente = cliente or _cliente()

    import anthropic

    try:
        resp = cliente.beta.messages.create(
            model=MODELO,
            max_tokens=16000,
            system=INSTRUCCIONES,
            output_config={"effort": "medium",
                           "format": {"type": "json_schema", "schema": C.esquema(cab, lin)}},
            # Si el modelo rechaza la petición, la API la reintenta con otro modelo adecuado.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": bloques + [
                {"type": "text", "text": "Copia los datos de esta factura."}]}],
        )
    except anthropic.AuthenticationError as e:
        raise ErrorFactura("La clave ANTHROPIC_API_KEY no es válida.") from e
    except anthropic.RateLimitError as e:
        raise ErrorFactura("Demasiadas peticiones seguidas; espera un minuto y vuelve a probar.") from e
    except anthropic.BadRequestError as e:
        raise ErrorFactura(f"La API rechazó la petición: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ErrorFactura("No hay conexión con la API de Claude. Revisa Internet.") from e
    except anthropic.APIStatusError as e:
        raise ErrorFactura(f"Error de la API de Claude ({e.status_code}). Prueba otra vez.") from e

    if resp.stop_reason == "refusal":
        raise ErrorFactura("El modelo no ha querido procesar esta imagen.")
    if resp.stop_reason == "max_tokens":
        raise ErrorFactura("La factura es demasiado larga para leerla de una vez; prueba por páginas.")
    texto = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        datos = json.loads(texto)
    except json.JSONDecodeError as e:
        raise ErrorFactura("La respuesta no se pudo interpretar; prueba otra vez.") from e
    return revisar(datos, cab, lin)


# --- comprobaciones después de leer ---------------------------------------------------

_LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE"


def nif_valido(nif: str) -> bool | None:
    """True/False para NIF, NIE y CIF españoles; None si no parece un documento español."""
    n = re.sub(r"[\s.\-]", "", (nif or "").upper())
    if n.startswith("ES"):
        n = n[2:]
    if re.fullmatch(r"\d{8}[A-Z]", n):
        return _LETRAS_DNI[int(n[:8]) % 23] == n[8]
    if re.fullmatch(r"[XYZ]\d{7}[A-Z]", n):
        num = int(str("XYZ".index(n[0])) + n[1:8])
        return _LETRAS_DNI[num % 23] == n[8]
    if re.fullmatch(r"[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]", n):
        dig = n[1:8]
        pares = sum(int(d) for d in dig[1::2])
        impares = sum(sum(divmod(int(d) * 2, 10)) for d in dig[0::2])
        control = (10 - (pares + impares) % 10) % 10
        return n[8] in (str(control), "JABCDEFGHI"[control])
    return None


def revisar(datos: dict, cab: list, lin: list) -> dict:
    avisos = list(datos.get("avisos") or [])
    claves_cab = {c for c, *_ in cab}
    for clave in ("emisor_nif", "cliente_nif"):
        if clave in claves_cab and datos.get(clave):
            if nif_valido(datos[clave]) is False:
                avisos.append(f"El {'NIF del emisor' if clave == 'emisor_nif' else 'NIF del cliente'} "
                              f"({datos[clave]}) no tiene una letra de control válida: revísalo.")
    base, cuota, total = (datos.get(k) for k in ("base_imponible", "cuota_iva", "total"))
    if all(isinstance(v, (int, float)) for v in (base, cuota, total)):
        extra = sum(datos.get(k) or 0 for k in ("recargo_equivalencia", "otros_impuestos")
                    if isinstance(datos.get(k), (int, float)))
        irpf = datos.get("irpf") if isinstance(datos.get("irpf"), (int, float)) else 0
        if abs(base + cuota + extra - irpf - total) > 0.05:
            avisos.append(f"Base + IVA ({base + cuota + extra - irpf:.2f}) no coincide con el total "
                          f"({total:.2f}): puede haber otros cargos o un error de lectura.")
    salida = {c: datos.get(c) for c, *_ in cab}
    if lin:
        salida["lineas"] = [{c: (l or {}).get(c) for c, *_ in lin} for l in datos.get("lineas") or []]
    salida["avisos"] = list(dict.fromkeys(avisos))
    return salida
