#!/usr/bin/env python3
"""Lector de facturas: app web pensada para el móvil.

  python app.py                      -> http://localhost:8000
  APP_CLAVE=secreta python app.py    (pide clave; recomendable si la publicas en Internet)

Necesita ANTHROPIC_API_KEY (ver .env.ejemplo).
"""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

from facturas import campos as C
from facturas.lector import ErrorFactura, leer_factura

BASE = Path(__file__).parent
CLAVE = os.environ.get("APP_CLAVE")

app = Flask(__name__, static_folder=str(BASE / "web"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # fotos/PDF


def comprobar_clave():
    if CLAVE and request.headers.get("X-Clave") != CLAVE:
        abort(401)


@app.get("/")
def inicio():
    return send_from_directory(BASE / "web", "index.html")


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(BASE / "web", "manifest.webmanifest",
                               mimetype="application/manifest+json")


@app.get("/api/estado")
def estado():
    return jsonify(clave=bool(CLAVE),
                   facturas=bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")))


@app.get("/api/facturas/campos")
def campos():
    return jsonify(C.catalogo())


@app.post("/api/facturas/leer")
def leer():
    comprobar_clave()
    ficheros = [(f.filename or "", f.read()) for f in request.files.getlist("ficheros")]
    ficheros = [(n, d) for n, d in ficheros if d]
    if len(ficheros) > 10:
        return jsonify(error="Máximo 10 páginas por factura"), 400
    try:
        seleccion = json.loads(request.form.get("campos") or "{}")
        return jsonify(leer_factura(ficheros, seleccion))
    except ErrorFactura as e:
        return jsonify(error=str(e)), 400
    except json.JSONDecodeError:
        return jsonify(error="Selección de campos no válida"), 400


if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", "8000"))
    try:
        ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        ip = "TU-IP"
    print(f"\n  Abre en este dispositivo:   http://localhost:{puerto}")
    print(f"  Desde otro móvil en tu wifi: http://{ip}:{puerto}\n")
    app.run(host="0.0.0.0", port=puerto, threaded=True)
