"""
Cliente para notificaciones WhatsApp vía API Apiwhats (POST /enviar).
Tras respuesta OK, notifica a Business Central (postRespuestaWhatsApp) con id_mensaje,
telefono, texto e id_incidencia: el mismo valor que la columna «Nº» del listado (OData No / inc.no).
También se envía a Apiwhats en el POST /enviar como IdIncidencia (trazabilidad).
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

import requests

from config import (
    API_WHATS_SECRET_TOKEN,
    API_WHATS_URL,
    GTASK_DEPARTAMENTO_TALLER_ID,
    WHATSAPP_NOTIFICAR_ASIGNACION,
    WHATSAPP_NOTIFICAR_BC,
)

from gtask.departamento import usuario_en_departamento

_MAX_TEXTO_BC = 8000
_log = logging.getLogger(__name__)


def _log_bc(msg: str) -> None:
    """Consola + logger para ver en servidor si BC se notificó o no."""
    print(f"[GMalla→BC WhatsApp] {msg}")
    _log.info(msg)


def _digitos_prefijo_es_34(digits: str) -> str:
    """Misma lógica que Apiwhats: 8–9 dígitos sin 34 → prefijo España."""
    if not digits or digits.startswith("34"):
        return digits
    if 8 <= len(digits) <= 9:
        return "34" + digits
    return digits


def _notificaciones_habilitadas() -> bool:
    if not WHATSAPP_NOTIFICAR_ASIGNACION:
        return False
    return bool((API_WHATS_URL or "").strip())


def obtener_telefono_usuario(usuario: Optional[Dict[str, Any]]) -> Optional[str]:
    """Devuelve solo dígitos (mín. 8) o None si no hay teléfono usable."""
    if not usuario or not isinstance(usuario, dict):
        return None
    for key in (
        "phone",
        "Phone",
        "telefono",
        "Telefono",
        "telephone",
        "Telephone",
        "movil",
        "Movil",
        "mobile",
        "Mobile",
    ):
        v = usuario.get(key)
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        digits = "".join(c for c in s if c.isdigit())
        if len(digits) >= 8:
            return _digitos_prefijo_es_34(digits)
    return None


def _nombre_usuario(usuario: Optional[Dict[str, Any]]) -> str:
    if not usuario:
        return "equipo"
    return (
        (usuario.get("name") or usuario.get("username") or usuario.get("nombre") or "equipo") or "equipo"
    ).strip() or "equipo"


def wamid_desde_respuesta_apiwhats(data: Dict[str, Any]) -> Optional[str]:
    """Extrae el wamid (messages[0].id) del campo meta de la respuesta de Apiwhats /enviar."""
    meta = data.get("meta")
    if not isinstance(meta, dict):
        return None
    msgs = meta.get("messages")
    if not isinstance(msgs, list) or not msgs:
        return None
    first = msgs[0]
    if isinstance(first, dict) and first.get("id"):
        return str(first["id"]).strip()
    return None


def _log_si_respuesta_sin_wamid(resp: Dict[str, Any]) -> None:
    """Ayuda a diagnosticar por qué BC no recibe id_mensaje."""
    meta = resp.get("meta")
    if isinstance(meta, dict):
        keys = list(meta.keys())
        msgs = meta.get("messages")
        n = len(msgs) if isinstance(msgs, list) else 0
        _log.warning(
            "Apiwhats /enviar ok=true pero sin wamid: meta.keys=%s messages_len=%s",
            keys,
            n,
        )
        print(
            f"[GMalla→BC WhatsApp] Diagnóstico: sin wamid; meta.keys={keys} messages_len={n}"
        )
    else:
        print("[GMalla→BC WhatsApp] Diagnóstico: sin wamid; meta no es objeto")


def _notificar_bc_tras_envio(
    bc_client: Any,
    *,
    id_mensaje: str,
    telefono: str,
    texto: str,
    id_incidencia: str,
) -> Dict[str, Any]:
    """
    Notifica a BC postRespuestaWhatsApp. Devuelve dict para API/diagnóstico:
    business_central: exito | omitido | error
    detalle: texto explicativo (motivo omisión o error HTTP/BC)
    """
    tel = (telefono or "").strip()
    id_inc = (id_incidencia or "").strip()
    id_m = (id_mensaje or "").strip()
    base: Dict[str, Any] = {
        "telefono": tel,
        "id_incidencia": id_inc,
        "tiene_wamid": bool(id_m),
        "business_central": "omitido",
        "detalle": None,
    }
    if not WHATSAPP_NOTIFICAR_BC:
        base["detalle"] = "WHATSAPP_NOTIFICAR_BC=false en .env"
        _log_bc(f"Omitido (tel={tel[:6]}…): {base['detalle']}")
        return base
    if not bc_client:
        base["detalle"] = "Cliente BC no disponible"
        _log_bc(f"Omitido (tel={tel[:6]}…): {base['detalle']}")
        return base
    if not id_m:
        base["detalle"] = (
            "Sin id_mensaje (wamid): Apiwhats respondió OK pero meta.messages[0].id no viene; "
            "BC exige id_mensaje. Revisa versión de Apiwhats y la respuesta JSON de /enviar."
        )
        _log_bc(f"Omitido Nº incidencia={id_inc or '—'}: {base['detalle']}")
        return base
    if not id_inc:
        base["detalle"] = "Sin número de incidencia (No.); configure el No. en la incidencia"
        _log_bc(f"Omitido (hay wamid pero sin No.): tel={tel[:6]}…")
        return base
    texto_bc = (texto or "")[:_MAX_TEXTO_BC]
    inner: Dict[str, Any] = {
        "id_mensaje": id_m,
        "telefono": tel,
        "texto": texto_bc,
        "id_incidencia": id_inc,
    }
    try:
        ok, err = bc_client.notificar_respuesta_whatsapp(inner)
        if ok:
            base["business_central"] = "exito"
            base["detalle"] = "postRespuestaWhatsApp OK"
            _log_bc(f"OK Nº={id_inc} wamid={id_m[:24]}… tel={tel[:8]}…")
        else:
            base["business_central"] = "error"
            base["detalle"] = (err or "error")[:2000]
            _log.warning(
                "[GMalla→BC WhatsApp] ERROR Nº=%s: %s",
                id_inc,
                base["detalle"][:500],
            )
            print(f"[GMalla→BC WhatsApp] ERROR Nº={id_inc}: {base['detalle'][:800]}")
    except Exception as e:
        base["business_central"] = "error"
        base["detalle"] = str(e)
        _log.exception("[GMalla→BC WhatsApp] excepción Nº=%s", id_inc)
        print(f"[GMalla→BC WhatsApp] EXCEPCIÓN: {e}")
    return base


def _enviar_payload(
    telefono: str,
    mensaje: str,
    *,
    usuario_emisor: str = "asignacion",
    id_incidencia_no: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    base = (API_WHATS_URL or "").strip().rstrip("/")
    url = f"{base}/enviar"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    token = (API_WHATS_SECRET_TOKEN or "").strip()
    if token:
        headers["X-API-Key"] = token
    body: Dict[str, Any] = {
        "AppEmisora": "GMalla",
        "UsuarioEmisor": usuario_emisor,
        "TelefonoDestino": telefono,
        "Mensaje": mensaje,
    }
    no_inc = (id_incidencia_no or "").strip()
    if no_inc:
        body["IdIncidencia"] = no_inc
    try:
        r = requests.post(url, json=body, headers=headers, timeout=45)
        if r.status_code == 200:
            try:
                data = r.json()
                if isinstance(data, dict) and data.get("ok") is True:
                    return data
            except Exception:
                pass
            print(f"⚠️ WhatsApp API respuesta inesperada ({r.status_code}): {r.text[:500]}")
            return None
        print(f"⚠️ WhatsApp API error HTTP {r.status_code}: {r.text[:800]}")
        return None
    except requests.RequestException as e:
        print(f"⚠️ WhatsApp API error de red: {e}")
        return None


def numero_incidencia_columna_no(dato: Any) -> str:
    """
    Mismo valor que la columna Nº en vista lista (inc.no ← OData «No»).
    No usar _id ni Id_Gtask: son identificadores distintos del Nº de documento BC.
    """
    if isinstance(dato, dict):
        for k in (
            "No",
            "No_",
            "No.",
            "no",
            "Numero",
            "numero",
            "NUMERO",
            "incidenceNo",
            "noIncidencia",
            "NumeroIncidencia",
            "numeroIncidencia",
            "Number",
            "number",
        ):
            v = dato.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
        return ""
    no = getattr(dato, "no", None)
    if no is not None and str(no).strip():
        return str(no).strip()
    return ""


def enriquecer_detalle_con_no_lista_bc(
    bc_client: Any,
    id_gtask: str,
    detalle: Dict[str, Any],
) -> Dict[str, Any]:
    """
    DetalleIncidencia a veces no trae el «No» de BC; la lista OData sí (mismo que el calendario).
    Si falta el Nº en el detalle, lo copiamos desde la incidencia cuyo id_gtask coincide.
    """
    if not isinstance(detalle, dict) or not bc_client:
        return detalle
    if numero_incidencia_columna_no(detalle):
        return detalle
    gid = (id_gtask or "").strip()
    if not gid:
        return detalle
    try:
        # $filter por Id_Gtask / ID_Tarea_Gtask: no limitado a la primera página del listado
        filtradas = bc_client.obtener_incidencias(filtros={"id_gtask": gid})
        for inc in filtradas or []:
            no = getattr(inc, "no", None)
            if no is not None and str(no).strip():
                d = dict(detalle)
                d["No"] = str(no).strip()
                _log.info(
                    "Detalle BC enriquecido con No=%s desde OData filtrado (id_gtask=%s…)",
                    d["No"],
                    gid[:12],
                )
                return d
    except Exception as e:
        _log.warning("enriquecer_detalle_con_no_lista_bc: %s", e)
    return detalle


def notificar_whatsapp_asignacion_incidencia(
    gtask_client: Any,
    usuario_id: str,
    incidencia: Any,
    bc_client: Any = None,
) -> None:
    """Aviso por una incidencia asignada o reasignada (mejor esfuerzo, no lanza)."""
    if not _notificaciones_habilitadas():
        return
    uid = (usuario_id or "").strip()
    if not uid:
        return
    try:
        u = gtask_client.obtener_usuario_por_id(uid)
        tel = obtener_telefono_usuario(u)
        if not tel:
            print(f"⚠️ WhatsApp: usuario {uid} sin teléfono válido (campo phone en GTask)")
            return
        nombre = _nombre_usuario(u)
        no = numero_incidencia_columna_no(incidencia) or getattr(
            incidencia, "id_gtask", ""
        ) or ""
        fecha = getattr(incidencia, "fecha", None)
        fecha_s = fecha.isoformat() if fecha else ""
        fh = getattr(incidencia, "fecha_hora", None)
        hora_s = fh.strftime("%H:%M") if fh else ""
        tipo = (getattr(incidencia, "tipo_incidencia", None) or "").strip()
        tipo_part = f" ({tipo})" if tipo else ""
        msg = (
            f"Hola {nombre}, se te ha asignado la incidencia nº {no}{tipo_part}"
            f" para el {fecha_s}"
            + (f" a las {hora_s}" if hora_s else "")
            + ". — GMalla"
        )
        if len(msg) > 4000:
            msg = msg[:3997] + "..."
        id_inc = numero_incidencia_columna_no(incidencia)
        resp = _enviar_payload(tel, msg, id_incidencia_no=id_inc or None)
        if resp:
            wid = wamid_desde_respuesta_apiwhats(resp) or ""
            if not wid:
                _log_si_respuesta_sin_wamid(resp)
            _notificar_bc_tras_envio(
                bc_client,
                id_mensaje=wid,
                telefono=tel,
                texto=msg,
                id_incidencia=id_inc,
            )
    except Exception as e:
        print(f"⚠️ WhatsApp asignación incidencia: {e}")


def notificar_whatsapp_asignaciones_automaticas(
    gtask_client: Any,
    asignaciones_aplicadas: List[Dict[str, Any]],
    bc_client: Any = None,
) -> None:
    """Un mensaje por técnico tras asignación automática (agrupa varias incidencias)."""
    if not _notificaciones_habilitadas() or not asignaciones_aplicadas:
        return
    try:
        from collections import defaultdict

        por_usuario: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for a in asignaciones_aplicadas:
            uid = str(a.get("usuario_id") or "").strip()
            if uid:
                por_usuario[uid].append(a)
        for uid, items in por_usuario.items():
            u = gtask_client.obtener_usuario_por_id(uid)
            tel = obtener_telefono_usuario(u)
            if not tel:
                print(f"⚠️ WhatsApp: usuario {uid} sin teléfono válido (campo phone en GTask)")
                continue
            nombre = _nombre_usuario(u)
            lines = [
                f"Hola {nombre}, se te han asignado {len(items)} incidencia(s) desde GMalla "
                "(asignación automática):"
            ]
            ids_inc: List[str] = []
            for it in items:
                num_bc = it.get("incidencia_no")
                if num_bc is not None and str(num_bc).strip():
                    s = str(num_bc).strip()
                    if s not in ids_inc:
                        ids_inc.append(s)
                no_linea = (
                    it.get("incidencia_no") or it.get("incidencia_id") or ""
                )
                fecha = it.get("fecha") or ""
                hora = it.get("hora_inicio") or ""
                lines.append(f"• Nº {no_linea} — {fecha} {hora}".strip())
            msg = "\n".join(lines)
            if len(msg) > 4000:
                msg = msg[:3997] + "..."
            id_inc_join = ",".join(ids_inc) if ids_inc else ""
            resp = _enviar_payload(tel, msg, id_incidencia_no=id_inc_join or None)
            if resp:
                wid = wamid_desde_respuesta_apiwhats(resp) or ""
                if not wid:
                    _log_si_respuesta_sin_wamid(resp)
                _notificar_bc_tras_envio(
                    bc_client,
                    id_mensaje=wid,
                    telefono=tel,
                    texto=msg,
                    id_incidencia=id_inc_join,
                )
    except Exception as e:
        print(f"⚠️ WhatsApp asignación automática: {e}")


def _descripcion_plana(html_o_texto: str, max_len: int = 500) -> str:
    if not html_o_texto:
        return ""
    t = re.sub(r"<[^>]+>", " ", str(html_o_texto))
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > max_len:
        t = t[: max_len - 3] + "..."
    return t


def construir_mensaje_whatsapp_taller(detalle: Dict[str, Any], id_gtask: str) -> str:
    """Texto único del aviso a todo el Taller (misma incidencia)."""
    no_bc = numero_incidencia_columna_no(detalle)
    lines = ["📋 GMalla — Aviso Taller"]
    if no_bc:
        lines.append(f"Incidencia nº {no_bc}")
    else:
        lines.append(
            "Incidencia: sin Nº BC en datos cargados (el Id GTask figura al final del mensaje)."
        )
    tipo = (detalle.get("incidenceType") or "").strip()
    if tipo:
        lines.append(f"Tipo: {tipo}")
    rec = (detalle.get("resource") or detalle.get("recurso") or "").strip()
    rn = (detalle.get("resource_name") or "").strip()
    if rn or rec:
        lines.append(f"Elemento: {rn or rec}")
    estado = detalle.get("state")
    if estado is not None and str(estado).strip() != "":
        lines.append(f"Estado: {estado}")
    fecha = detalle.get("fecha")
    if fecha:
        lines.append(f"Fecha: {fecha}")
    desc = _descripcion_plana(detalle.get("description") or "", 500)
    if desc:
        lines.append(f"Descripción: {desc}")
    lines.append(f"Id GTask: {id_gtask}")
    msg = "\n".join(lines)
    if len(msg) > 3800:
        msg = msg[:3797] + "..."
    return msg


def notificar_whatsapp_taller_incidencia(
    gtask_client: Any,
    bc_client: Any,
    id_gtask: str,
    detalle: Dict[str, Any],
    *,
    departamento_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Envía por WhatsApp el mismo aviso de incidencia a todos los usuarios GTask del departamento
    Taller (por defecto) que tengan teléfono. Tras cada envío OK, notifica a BC como el resto de envíos.
    """
    dept = (departamento_id or GTASK_DEPARTAMENTO_TALLER_ID or "").strip()
    out: Dict[str, Any] = {
        "success": False,
        "enviados": 0,
        "errores": [],
        "en_departamento": 0,
        "con_telefono": 0,
        "omitidos_duplicado_telefono": 0,
        "departamento_id": dept,
        "bc_notificaciones": [],
    }
    if not _notificaciones_habilitadas():
        out["error"] = "WhatsApp no configurado (API_WHATS_URL) o notificaciones desactivadas"
        return out
    if not dept:
        out["error"] = "Departamento no configurado"
        return out
    if not detalle or not isinstance(detalle, dict):
        out["error"] = "Detalle de incidencia inválido"
        return out

    res_u = gtask_client.obtener_usuarios()
    if not res_u.get("success"):
        out["error"] = res_u.get("error") or "No se pudieron obtener usuarios"
        return out
    users = res_u.get("users") or []
    if not isinstance(users, list):
        users = []

    en_dept = [u for u in users if isinstance(u, dict) and usuario_en_departamento(u, dept)]
    out["en_departamento"] = len(en_dept)
    out["con_telefono"] = sum(1 for u in en_dept if obtener_telefono_usuario(u))

    msg = construir_mensaje_whatsapp_taller(detalle, id_gtask)
    id_inc = numero_incidencia_columna_no(detalle)
    vistos: set[str] = set()

    for u in en_dept:
        tel = obtener_telefono_usuario(u)
        if not tel:
            continue
        if tel in vistos:
            out["omitidos_duplicado_telefono"] += 1
            continue
        vistos.add(tel)
        resp = _enviar_payload(
            tel, msg, usuario_emisor="taller", id_incidencia_no=id_inc or None
        )
        if resp:
            out["enviados"] += 1
            wid = wamid_desde_respuesta_apiwhats(resp) or ""
            if not wid:
                _log_si_respuesta_sin_wamid(resp)
            bc_res = _notificar_bc_tras_envio(
                bc_client,
                id_mensaje=wid,
                telefono=tel,
                texto=msg,
                id_incidencia=id_inc,
            )
            out["bc_notificaciones"].append(bc_res)
        else:
            nom = _nombre_usuario(u)
            out["errores"].append(f"No enviado a {nom} ({tel})")

    if out["enviados"] > 0:
        out["success"] = True
    elif not en_dept:
        out["error"] = "No hay usuarios del departamento Taller en GTask (revisar department / id)"
    elif out["con_telefono"] == 0:
        out["error"] = (
            "Hay usuarios en Taller pero ninguno tiene teléfono válido (campo phone en GTask)"
        )
    else:
        out["error"] = "No se pudo enviar ningún WhatsApp; revisar Apiwhats y la consola del servidor"

    return out

