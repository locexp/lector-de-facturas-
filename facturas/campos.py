"""Catálogo de datos que se pueden copiar de una factura.

Cada campo tiene: clave, etiqueta (lo que ve el usuario), tipo ("texto", "numero" o
"fecha") y una pista para el modelo. Los campos de "cabecera" salen una vez por factura;
los de "linea" salen una vez por cada concepto/producto facturado.
"""
from __future__ import annotations

CABECERA = [
    ("numero_factura", "Nº de factura", "texto", "Número o código de la factura"),
    ("fecha", "Fecha", "fecha", "Fecha de emisión, en formato AAAA-MM-DD"),
    ("emisor_nombre", "Emisor (nombre)", "texto", "Razón social o nombre de quien emite la factura (el vendedor)"),
    ("emisor_nif", "NIF / CIF emisor", "texto", "NIF, CIF o NIE del emisor, sin espacios ni guiones"),
    ("emisor_direccion", "Dirección emisor", "texto", "Dirección completa del emisor"),
    ("cliente_nombre", "Cliente (nombre)", "texto", "Nombre o razón social del cliente/destinatario"),
    ("cliente_nif", "NIF / CIF cliente", "texto", "NIF, CIF o NIE del cliente, sin espacios ni guiones"),
    ("base_imponible", "Base imponible", "numero", "Suma de bases imponibles (total sin impuestos)"),
    ("tipo_iva", "% IVA", "texto", "Tipo o tipos de IVA aplicados, p. ej. \"21\" o \"10 / 21\""),
    ("cuota_iva", "Cuota IVA", "numero", "Importe total del IVA"),
    ("recargo_equivalencia", "Recargo de equivalencia", "numero", "Importe total del recargo de equivalencia"),
    ("irpf", "Retención IRPF", "numero", "Importe de la retención de IRPF (positivo aunque reste)"),
    ("otros_impuestos", "Otros impuestos", "numero", "Importe de otros impuestos (IGIC, IPSI, tasas...)"),
    ("descuento", "Descuento", "numero", "Descuento total aplicado a la factura"),
    ("total", "Total factura", "numero", "Importe total a pagar"),
    ("moneda", "Moneda", "texto", "Código ISO de la moneda, p. ej. EUR"),
    ("forma_pago", "Forma de pago", "texto", "Forma de pago (efectivo, tarjeta, transferencia...)"),
    ("iban", "IBAN", "texto", "IBAN o cuenta bancaria para el pago, sin espacios"),
    ("vencimiento", "Vencimiento", "fecha", "Fecha de vencimiento, en formato AAAA-MM-DD"),
]

LINEA = [
    ("descripcion", "Descripción", "texto", "Descripción del producto o servicio"),
    ("referencia", "Referencia / código", "texto", "Código o referencia del artículo"),
    ("cantidad", "Cantidad", "numero", "Unidades, kilos, horas..."),
    ("precio_unitario", "Precio unitario (sin IVA)", "numero", "Precio por unidad antes de impuestos"),
    ("precio_unitario_iva", "Precio unitario con IVA", "numero", "Precio por unidad con impuestos incluidos"),
    ("descuento", "Descuento línea", "numero", "Descuento aplicado a la línea (importe)"),
    ("tipo_iva", "% IVA línea", "numero", "Porcentaje de IVA de la línea, p. ej. 21"),
    ("importe", "Importe (sin IVA)", "numero", "Importe de la línea antes de impuestos"),
    ("importe_iva", "Importe con IVA", "numero", "Importe de la línea con impuestos incluidos"),
]

POR_DEFECTO = {
    "cabecera": ["numero_factura", "fecha", "emisor_nombre", "emisor_nif",
                 "base_imponible", "cuota_iva", "total"],
    "linea": ["descripcion", "cantidad", "precio_unitario", "importe"],
}


def catalogo() -> dict:
    conv = lambda lista: [{"clave": c, "etiqueta": e, "tipo": t} for c, e, t, _ in lista]
    return {"cabecera": conv(CABECERA), "linea": conv(LINEA), "por_defecto": POR_DEFECTO}


def filtrar(seleccion: dict) -> tuple[list, list]:
    """Devuelve (campos_cabecera, campos_linea) válidos y en el orden del catálogo."""
    cab = set(seleccion.get("cabecera") or [])
    lin = set(seleccion.get("linea") or [])
    return [c for c in CABECERA if c[0] in cab], [c for c in LINEA if c[0] in lin]


def _tipo_json(tipo: str) -> dict:
    return {"type": ["number", "null"]} if tipo == "numero" else {"type": ["string", "null"]}


def esquema(cabecera: list, linea: list) -> dict:
    """Esquema JSON para la salida estructurada, solo con los campos elegidos."""
    props: dict = {c: {**_tipo_json(t), "description": d} for c, _, t, d in cabecera}
    req = [c for c, *_ in cabecera]
    if linea:
        props["lineas"] = {
            "type": "array",
            "description": "Una entrada por cada concepto/producto facturado, en el orden del documento",
            "items": {
                "type": "object",
                "properties": {c: {**_tipo_json(t), "description": d} for c, _, t, d in linea},
                "required": [c for c, *_ in linea],
                "additionalProperties": False,
            },
        }
        req.append("lineas")
    props["avisos"] = {
        "type": "array", "items": {"type": "string"},
        "description": "Dudas o problemas: datos ilegibles, factura cortada, importes que no cuadran...",
    }
    req.append("avisos")
    return {"type": "object", "properties": props, "required": req, "additionalProperties": False}
