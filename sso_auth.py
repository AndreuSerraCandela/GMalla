"""Verificación de tokens SSO emitidos por appdesktop."""
from __future__ import annotations

import os
from typing import Any

import jwt

SSO_ISSUER = "appdesktop"
SSO_AUDIENCE = "taller"
MALLA_SSO_SECRET = (os.getenv("MALLA_SSO_SECRET") or "").strip()
SSO_LOGIN_ENABLED = os.getenv("SSO_LOGIN_ENABLED", "true").lower() in (
    "1",
    "true",
    "yes",
)
APPDESKTOP_URL = (os.getenv("APPDESKTOP_URL") or "https://apps.malla.es").strip().rstrip("/")


def is_sso_enabled() -> bool:
    return SSO_LOGIN_ENABLED and bool(MALLA_SSO_SECRET)


def sso_launch_url() -> str:
    return f"{APPDESKTOP_URL}/api/auth/sso/launch?app=taller"


def sso_status_payload() -> dict[str, Any]:
    return {
        "enabled": is_sso_enabled(),
        "sso_login_enabled": SSO_LOGIN_ENABLED,
        "secret_configured": bool(MALLA_SSO_SECRET),
        "appdesktop_url": APPDESKTOP_URL,
    }


def verify_exchange_token(token: str) -> dict[str, Any]:
    if not MALLA_SSO_SECRET:
        raise ValueError(
            "SSO no configurado en Taller. Añade MALLA_SSO_SECRET al .env del servidor "
            "(mismo valor que en apps.malla.es) y reinicia la app."
        )
    raw = (token or "").strip()
    if not raw:
        raise ValueError("Token SSO requerido")
    try:
        payload = jwt.decode(
            raw,
            MALLA_SSO_SECRET,
            algorithms=["HS256"],
            audience=SSO_AUDIENCE,
            issuer=SSO_ISSUER,
        )
    except jwt.InvalidSignatureError as exc:
        raise ValueError(
            "Token SSO rechazado: MALLA_SSO_SECRET de Taller no coincide con el del portal. "
            "Debe ser el mismo valor en ambos .env."
        ) from exc
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("Token SSO caducado. Vuelve a abrir Taller desde el portal.") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError(f"Token SSO invalido: {exc}") from exc
    username = (payload.get("gtask_username") or "").strip()
    access_token = (payload.get("access_token") or "").strip()
    if not username or not access_token:
        raise ValueError("Token SSO incompleto")
    return payload


def build_user_data_from_sso(payload: dict[str, Any]) -> dict[str, Any]:
    username = (payload.get("gtask_username") or "").strip()
    user_id = str(payload.get("sub") or username).strip()
    return {
        "_id": user_id,
        "id": user_id,
        "username": username,
    }
