"""Catálogo de datos que se pueden copiar de una factura (se define en web/campos.json).

Cada campo tiene: clave, etiqueta (lo que ve el usuario), tipo ("texto", "numero" o
"fecha") y una pista para el modelo. Los campos de "cabecera" salen una vez por factura;
los de "linea" salen una vez por cada concepto/producto facturado.
"""
from __future__ import annotations

import json
from pathlib import Path

_RUTA = Path(__file__).resolve().parent.parent / "web" / "campos.json"
_DATOS = json.loads(_RUTA.read_text(encoding="utf-8"))  # misma lista que usa la página web

CABECERA = [(c["clave"], c["etiqueta"], c["tipo"], c["pista"]) for c in _DATOS["cabecera"]]
LINEA = [(c["clave"], c["etiqueta"], c["tipo"], c["pista"]) for c in _DATOS["linea"]]
POR_DEFECTO = _DATOS["por_defecto"]


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
