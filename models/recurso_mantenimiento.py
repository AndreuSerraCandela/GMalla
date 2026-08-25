"""
Modelo de recurso para calendario de mantenimiento preventivo.
"""
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

try:
    from models.mantenimiento_parse import get_field, parse_bool, parse_date
except ImportError:
    from .mantenimiento_parse import get_field, parse_bool, parse_date


@dataclass
class RecursoMantenimiento:
    tipo_recurso: str
    no_recurso: str
    descripcion: str
    ubicacion: str
    municipio: str
    zona: str
    no_emplazamiento: str
    fecha_proximo_mantenimiento: Optional[date]
    bajo_mantenimiento: bool
    ultimo_mantenimiento: Optional[date]
    periodicidad: str

    @classmethod
    def desde_odata(cls, data: Dict[str, Any]) -> "RecursoMantenimiento":
        tipo = get_field(
            data,
            "Tipo_Recurso",
            "tipo_recurso",
            "Tipo",
            "tipo",
        ) or ""
        if isinstance(tipo, dict):
            tipo = tipo.get("value") or tipo.get("Value") or ""

        return cls(
            tipo_recurso=str(tipo).strip(),
            no_recurso=str(
                get_field(
                    data,
                    "N_Recurso",
                    "Nº_Recurso",
                    "No_Recurso",
                    "n_recurso",
                    "Recurso",
                    "recurso",
                )
                or ""
            ).strip(),
            descripcion=str(
                get_field(data, "Descripcion", "Descripción", "descripcion") or ""
            ).strip(),
            ubicacion=str(
                get_field(data, "Ubicacion", "Ubicación", "ubicacion") or ""
            ).strip(),
            municipio=str(get_field(data, "Municipio", "municipio") or "").strip(),
            zona=str(get_field(data, "Zona", "zona") or "").strip(),
            no_emplazamiento=str(
                get_field(
                    data,
                    "no_emplazamiento",
                    "N_Emplazamiento",
                    "Nº_Emplazamiento",
                )
                or ""
            ).strip(),
            fecha_proximo_mantenimiento=parse_date(
                get_field(
                    data,
                    "Fecha_Proximo_Mantenimiento",
                    "fecha_proximo_mantenimiento",
                    "FechaProximoMantenimiento",
                    "fechaProximoMantenimiento",
                )
            ),
            bajo_mantenimiento=parse_bool(
                get_field(data, "Bajo_Mantenimiento", "bajo_mantenimiento")
            ),
            ultimo_mantenimiento=parse_date(
                get_field(
                    data,
                    "Ultimo_Mantenimiento",
                    "ultimo_mantenimiento",
                    "UltimoMantenimiento",
                )
            ),
            periodicidad=str(
                get_field(
                    data,
                    "Periodicidad_Mantenimiento",
                    "periodicidad_mantenimiento",
                    "Periodicidad",
                )
                or ""
            ).strip(),
        )

    def codigo_display(self) -> str:
        if self.no_recurso:
            return self.no_recurso
        if self.descripcion:
            return self.descripcion
        return self.no_emplazamiento or self.ubicacion or ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "origen": "recurso",
            "tipo_emplazamiento": self.tipo_recurso,
            "codigo": self.codigo_display(),
            "no_recurso": self.no_recurso,
            "tipo_recurso": self.tipo_recurso,
            "descripcion": self.descripcion,
            "ubicacion": self.ubicacion,
            "municipio": self.municipio,
            "zona": self.zona,
            "no_emplazamiento": self.no_emplazamiento,
            "fecha_proximo_mantenimiento": (
                self.fecha_proximo_mantenimiento.isoformat()
                if self.fecha_proximo_mantenimiento
                else None
            ),
            "bajo_mantenimiento": self.bajo_mantenimiento,
            "ultimo_mantenimiento": (
                self.ultimo_mantenimiento.isoformat()
                if self.ultimo_mantenimiento
                else None
            ),
            "periodicidad": self.periodicidad,
            "tipos_recurso": self.tipo_recurso,
            "tipos_recurso_lista": [self.tipo_recurso] if self.tipo_recurso else [],
            "categoria": "recursos",
        }
