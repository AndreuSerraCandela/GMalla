"""
Modelo de datos para Incidencias de Business Central
"""
from datetime import datetime, date
from typing import Optional
from enum import Enum
from dataclasses import dataclass, field


class EstadoIncidencia(Enum):
    """Estados posibles de una incidencia"""
    ABIERTA = "Abierta"
    EN_PROGRESO = "EnProgreso"
    CERRADA = "Cerrada"


class TipoElemento(Enum):
    """Tipos de elemento"""
    RECURSO = "Recurso"
    PARADA = "Parada"


@dataclass
class Incidencia:
    """Modelo de datos para una incidencia"""
    no: str = ""  # Code[20]
    descripcion: str = ""  # Text[100]
    fecha: Optional[date] = None  # Date
    estado: EstadoIncidencia = EstadoIncidencia.ABIERTA  # Option
    n_orden: Optional[int] = None  # Integer
    no_series: str = ""  # Code[20]
    id_gtask: str = ""  # Text[30]
    tipo_incidencia: Optional[str] = None  # Enum "Tipo Incidencia"
    recurso: str = ""  # Code[20]
    tipo_elemento: TipoElemento = TipoElemento.RECURSO  # Option
    fecha_hora: Optional[datetime] = None  # DateTime
    work_description: Optional[bytes] = None  # Blob
    usuario: Optional[str] = None  # Guid
    archivos_imagen: list[str] = field(default_factory=list)  # Archivos de imagen asociados
    url_primera_imagen: Optional[str] = None  # URL de la primera imagen para miniatura
    
    def to_dict(self) -> dict:
        """Convierte la incidencia a un diccionario"""
        return {
            "No.": self.no,
            "Descripción": self.descripcion,
            "Fecha": self.fecha.isoformat() if self.fecha else None,
            "Estado": self.estado.value,
            "Nº Orden": self.n_orden,
            "No. Series": self.no_series,
            "Id_Gtask": self.id_gtask,
            "Tipo Incidencia": self.tipo_incidencia,
            "Recurso": self.recurso,
            "Tipo Elemento": self.tipo_elemento.value,
            "FechaHora": self.fecha_hora.isoformat() if self.fecha_hora else None,
            "Usuario": self.usuario,
            "ArchivosImagen": self.archivos_imagen,
            "URL_Primera_Imagen": self.url_primera_imagen
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Incidencia':
        """Crea una incidencia desde un diccionario"""
        incidencia = cls()
        # Manejar tanto "No." como "No" (formato OData)
        incidencia.no = data.get("No.", data.get("No", ""))
        incidencia.descripcion = data.get("Descripción", "")
        if data.get("Fecha"):
            incidencia.fecha = datetime.fromisoformat(data["Fecha"]).date() if isinstance(data["Fecha"], str) else data["Fecha"]
        if data.get("Estado"):
            estado_str = data["Estado"]
            if estado_str == "Abierta":
                incidencia.estado = EstadoIncidencia.ABIERTA
            elif estado_str == "EnProgreso":
                incidencia.estado = EstadoIncidencia.EN_PROGRESO
            elif estado_str == "Cerrada":
                incidencia.estado = EstadoIncidencia.CERRADA
        incidencia.n_orden = data.get("Nº Orden")
        incidencia.no_series = data.get("No. Series", "")
        incidencia.id_gtask = data.get("Id_Gtask", "")
        # Manejar tanto "Tipo Incidencia" como "Tipo_Incidencia" (formato OData)
        incidencia.tipo_incidencia = data.get("Tipo Incidencia") or data.get("Tipo_Incidencia")
        incidencia.recurso = data.get("Recurso", "")
        if data.get("Tipo Elemento"):
            tipo_elem = data["Tipo Elemento"]
            incidencia.tipo_elemento = TipoElemento.PARADA if tipo_elem == "Parada" else TipoElemento.RECURSO
        if data.get("FechaHora"):
            fecha_hora = data["FechaHora"]
            if isinstance(fecha_hora, str) and fecha_hora != "0001-01-01T00:00:00Z":
                try:
                    incidencia.fecha_hora = datetime.fromisoformat(fecha_hora.replace('Z', '+00:00'))
                except:
                    pass
            else:
                incidencia.fecha_hora = fecha_hora
        # Usuario: puede venir como "Usuario" o ya procesado desde OData
        incidencia.usuario = data.get("Usuario")
        # Si hay fecha en el diccionario, usarla (ya procesada desde Fecha_Hora)
        if data.get("Fecha"):
            fecha_str = data["Fecha"]
            if isinstance(fecha_str, str):
                incidencia.fecha = datetime.fromisoformat(fecha_str).date()
            else:
                incidencia.fecha = fecha_str
        incidencia.archivos_imagen = data.get("ArchivosImagen", [])
        # Manejar URL_Primera_Imagen (puede venir de OData)
        incidencia.url_primera_imagen = data.get("URL_Primera_Imagen") or data.get("url_primera_imagen")
        return incidencia

