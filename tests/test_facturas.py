import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from facturas import campos as C
from facturas.lector import ErrorFactura, leer_factura, nif_valido, preparar_ficheros


def foto(ancho=3000, alto=4000):
    b = io.BytesIO()
    Image.new("RGB", (ancho, alto), "white").save(b, "JPEG")
    return b.getvalue()


class ClienteFalso:
    """Imita client.beta.messages.create y guarda la petición."""

    def __init__(self, respuesta, stop="end_turn"):
        self.peticion = None
        bloque = SimpleNamespace(type="text", text=json.dumps(respuesta))
        res = SimpleNamespace(content=[bloque], stop_reason=stop)
        crear = lambda **kw: (setattr(self, "peticion", kw), res)[1]
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=crear))


def test_esquema_solo_campos_elegidos():
    cab, lin = C.filtrar({"cabecera": ["total", "emisor_nif", "inventado"], "linea": ["descripcion"]})
    esq = C.esquema(cab, lin)
    assert [c for c, *_ in cab] == ["emisor_nif", "total"]  # orden del catálogo, sin desconocidos
    assert set(esq["properties"]) == {"emisor_nif", "total", "lineas", "avisos"}
    assert esq["required"] == ["emisor_nif", "total", "lineas", "avisos"]
    assert esq["properties"]["total"]["type"] == ["number", "null"]
    assert esq["properties"]["lineas"]["items"]["required"] == ["descripcion"]
    assert esq["additionalProperties"] is False


def test_sin_lineas_no_pide_lineas():
    esq = C.esquema(*C.filtrar({"cabecera": ["fecha"]}))
    assert "lineas" not in esq["properties"]


def test_nif():
    assert nif_valido("12345678Z") is True
    assert nif_valido("12345678A") is False
    assert nif_valido("X1234567L") is True
    assert nif_valido("B-12345674") is True     # CIF con dígito de control
    assert nif_valido("B12345675") is False
    assert nif_valido("ESB12345674") is True    # NIF-IVA intracomunitario
    assert nif_valido("FR12345678901") is None


def test_imagen_se_reduce():
    [bloque] = preparar_ficheros([("foto.jpg", foto())])
    import base64
    img = Image.open(io.BytesIO(base64.b64decode(bloque["source"]["data"])))
    assert max(img.size) == 2000 and bloque["source"]["media_type"] == "image/jpeg"


def test_pdf_va_como_documento():
    [bloque] = preparar_ficheros([("f.pdf", b"%PDF-1.4 ...")])
    assert bloque["type"] == "document"


def test_leer_factura_y_revisiones():
    respuesta = {"emisor_nif": "B12345675", "base_imponible": 100.0, "cuota_iva": 21.0, "total": 130.0,
                 "lineas": [{"descripcion": "Tornillos", "importe": 100.0}], "avisos": []}
    cliente = ClienteFalso(respuesta)
    sel = {"cabecera": ["emisor_nif", "base_imponible", "cuota_iva", "total"], "linea": ["descripcion", "importe"]}
    datos = leer_factura([("f.jpg", foto(800, 600))], sel, cliente=cliente)
    assert datos["lineas"] == [{"descripcion": "Tornillos", "importe": 100.0}]
    assert any("NIF del emisor" in a for a in datos["avisos"])
    assert any("no coincide con el total" in a for a in datos["avisos"])
    p = cliente.peticion
    assert p["model"] == "claude-opus-5-5"
    assert p["output_config"]["format"]["type"] == "json_schema"
    assert p["messages"][0]["content"][0]["type"] == "image"


def test_total_que_cuadra_no_avisa():
    respuesta = {"base_imponible": 100.0, "cuota_iva": 21.0, "irpf": 15.0, "total": 106.0, "avisos": []}
    sel = {"cabecera": ["base_imponible", "cuota_iva", "irpf", "total"]}
    datos = leer_factura([("f.jpg", foto(800, 600))], sel, cliente=ClienteFalso(respuesta))
    assert datos["avisos"] == []


def test_errores():
    with pytest.raises(ErrorFactura):
        leer_factura([("f.jpg", foto(10, 10))], {}, cliente=ClienteFalso({}))
    with pytest.raises(ErrorFactura):
        leer_factura([], {"cabecera": ["total"]}, cliente=ClienteFalso({}))
    with pytest.raises(ErrorFactura):
        leer_factura([("f.jpg", foto(10, 10))], {"cabecera": ["total"]},
                     cliente=ClienteFalso({}, stop="refusal"))
