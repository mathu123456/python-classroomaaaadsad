"""Comprobador de sintaxis de Python Classroom.

Lee codigo fuente por stdin y devuelve por stdout un JSON con los errores de
sintaxis reales que reporta el propio compilador de CPython.

Salida:
    {"ok": true,  "diagnostics": []}
    {"ok": false, "diagnostics": [{"line":3,"col":5,"endLine":3,"endCol":9,
                                   "message":"...","severity":"error","type":"SyntaxError"}]}
"""

import io
import json
import sys

# El proceso se lanza en modo aislado (-I), asi que fijamos UTF-8 a mano.
try:
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover - entornos sin buffer real
    pass


def main() -> None:
    filename = sys.argv[1] if len(sys.argv) > 1 else "<editor>"
    source = sys.stdin.read()

    if not source.strip():
        print(json.dumps({"ok": True, "diagnostics": []}))
        return

    try:
        compile(source, filename, "exec")
    except SyntaxError as exc:
        line = exc.lineno or 1
        col = exc.offset or 1
        end_line = getattr(exc, "end_lineno", None) or line
        end_col = getattr(exc, "end_offset", None) or (col + 1)
        # CPython usa columnas 1-based; el editor las quiere 1-based tambien.
        if end_line == line and end_col <= col:
            end_col = col + 1
        diagnostic = {
            "line": line,
            "col": max(1, col),
            "endLine": end_line,
            "endCol": max(2, end_col),
            "message": exc.msg or "Error de sintaxis",
            "severity": "error",
            "type": type(exc).__name__,
            "text": (exc.text or "").rstrip("\n"),
        }
        print(json.dumps({"ok": False, "diagnostics": [diagnostic]}))
        return
    except ValueError as exc:
        # p. ej. codigo con caracteres nulos
        print(json.dumps({
            "ok": False,
            "diagnostics": [{
                "line": 1, "col": 1, "endLine": 1, "endCol": 2,
                "message": str(exc), "severity": "error", "type": "ValueError",
            }],
        }))
        return

    print(json.dumps({"ok": True, "diagnostics": []}))


if __name__ == "__main__":
    main()
