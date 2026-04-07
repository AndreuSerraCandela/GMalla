"""Filtrado de usuarios GTask por departamento (ObjectId u otros formatos)."""
from __future__ import annotations

from typing import Any, Dict, List, Set


def _agregar_id_de_valor(out: Set[str], valor: Any) -> None:
    if valor is None:
        return
    if isinstance(valor, dict):
        for k in ("id", "_id", "Id", "$oid"):
            if valor.get(k) is not None:
                s = str(valor[k]).strip()
                if s:
                    out.add(s)
        return
    if isinstance(valor, list):
        for item in valor:
            _agregar_id_de_valor(out, item)
        return
    s = str(valor).strip()
    if s:
        out.add(s)


def ids_departamento_en_usuario(usuario: Dict[str, Any]) -> Set[str]:
    """Conjunto de identificadores de departamento asociados al usuario (todas las claves habituales)."""
    out: Set[str] = set()
    if not usuario or not isinstance(usuario, dict):
        return out
    for key in (
        "department",
        
    ):
        if key not in usuario:
            continue
        _agregar_id_de_valor(out, usuario[key])
    return out


def usuario_en_departamento(usuario: Dict[str, Any], departamento_id: str) -> bool:
    if not departamento_id or not departamento_id.strip():
        return False
    target = departamento_id.strip()
    return target in ids_departamento_en_usuario(usuario)


def usuarios_del_departamento(usuarios: List[Dict[str, Any]], departamento_id: str) -> List[Dict[str, Any]]:
    return [u for u in usuarios if isinstance(u, dict) and usuario_en_departamento(u, departamento_id)]
