"""
Modelo de emplazamiento para calendario de mantenimiento preventivo.
"""
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

try:
    from models.mantenimiento_parse import get_field, parse_bool, parse_date
except ImportError:
    from .mantenimiento_parse import get_field, parse_bool, parse_date


@dataclass
class EmplazamientoMantenimiento:
    tipo_emplazamiento: str
    no_emplazamiento: str
    descripcion: str
    ubicacion: str
    municipio: str
    zona: str
    fecha_proximo_mantenimiento: Optional[date]
    bajo_mantenimiento: bool
    ultimo_mantenimiento: Optional[date]
    periodicidad: str
    tipos_recurso: str

    @classmethod
    def desde_odata(cls, data: Dict[str, Any]) -> "EmplazamientoMantenimiento":
        tipo = get_field(
            data,
            "Tipo_Emplazamiento",
            "tipo_emplazamiento",
            "Tipo",
            "tipo",
        ) or ""
        if isinstance(tipo, dict):
            tipo = tipo.get("value") or tipo.get("Value") or ""

        return cls(
            tipo_emplazamiento=str(tipo).strip(),
            no_emplazamiento=str(
                get_field(
                    data,
                    "N_Emplazamiento",
                    "Nº_Emplazamiento",
                    "n_emplazamiento",
                    "No_Emplazamiento",
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
            tipos_recurso=str(
                get_field(data, "Tipos_Recurso", "tipos_recurso") or ""
            ).strip(),
        )

    def codigo_display(self) -> str:
        if self.no_emplazamiento:
            return self.no_emplazamiento
        if self.descripcion:
            return self.descripcion.split(" -", 1)[0].strip() or self.descripcion
        return self.ubicacion or ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "origen": "emplazamiento",
            "tipo_emplazamiento": self.tipo_emplazamiento,
            "no_emplazamiento": self.no_emplazamiento,
            "codigo": self.codigo_display(),
            "descripcion": self.descripcion,
            "ubicacion": self.ubicacion,
            "municipio": self.municipio,
            "zona": self.zona,
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
            "tipos_recurso": self.tipos_recurso,
            "tipos_recurso_lista": [
                t.strip() for t in self.tipos_recurso.split(";") if t.strip()
            ],
            "categoria": self.categoria_ui(),
        }

    def categoria_ui(self) -> str:
        t = self.tipo_emplazamiento.lower()
        if t == "opis":
            return "paradas_bus"
        if t == "vallas":
            return "vallas"
        if t == "otros":
            return "otros"
        return "otros"
