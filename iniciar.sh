#!/usr/bin/env bash
# Instala dependencias (la primera vez) y arranca la app (http://localhost:8000).
# Pensado para Termux en Android, pero sirve en Linux/Mac.
# El modo gratuito solo necesita Flask; lo del modo IA se instala si hay ANTHROPIC_API_KEY.
set -e
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
termux() { [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ] && command -v pkg >/dev/null 2>&1; }
if termux; then
  command -v python >/dev/null || pkg install -y python
fi
python -m pip install -q -r requirements.txt
if [ -n "$ANTHROPIC_API_KEY" ]; then
  if termux; then
    python -c "import PIL" 2>/dev/null || pkg install -y python-pillow
    # el SDK de Claude usa pydantic, que en Termux se compila con Rust
    python -c "import pydantic_core" 2>/dev/null || pkg install -y rust binutils
  fi
  python -m pip install -q -r requirements-ia.txt
fi
exec python app.py
