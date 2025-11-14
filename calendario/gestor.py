"""
Gestor de calendario para asignación de incidencias a usuarios
"""
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from ..business_central.client import BusinessCentralClient

# Importar modelos con fallback
try:
    from ..models.incidencia import Incidencia, EstadoIncidencia
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from models.incidencia import Incidencia, EstadoIncidencia


class GestorCalendario:
    """Gestiona el calendario de asignación de incidencias a usuarios"""
    
    def __init__(self, bc_client: Optional['BusinessCentralClient'] = None):
        """
        Inicializa el gestor de calendario
        
        Args:
            bc_client: Cliente de Business Central opcional para sincronizar cambios
        """
        self.asignaciones: Dict[str, List[Incidencia]] = {}  # usuario_id -> lista de incidencias
        self.bc_client: Optional['BusinessCentralClient'] = bc_client
    
    def asignar_incidencia(self, incidencia: Incidencia, usuario_id: str) -> bool:
        """
        Asigna una incidencia a un usuario
        
        Args:
            incidencia: Incidencia a asignar
            usuario_id: ID del usuario (Guid)
        
        Returns:
            True si se asignó correctamente
        """
        if usuario_id not in self.asignaciones:
            self.asignaciones[usuario_id] = []
        
        # Verificar si la incidencia ya está asignada
        for usuario, incidencias in self.asignaciones.items():
            if incidencia in incidencias:
                incidencias.remove(incidencia)
                break
        
        incidencia.usuario = usuario_id
        self.asignaciones[usuario_id].append(incidencia)
        return True
    
    def desasignar_incidencia(self, incidencia: Incidencia) -> bool:
        """
        Desasigna una incidencia de su usuario actual
        
        Args:
            incidencia: Incidencia a desasignar
        
        Returns:
            True si se desasignó correctamente
        """
        for usuario, incidencias in self.asignaciones.items():
            if incidencia in incidencias:
                incidencias.remove(incidencia)
                incidencia.usuario = None
                return True
        return False
    
    def obtener_incidencias_usuario(self, usuario_id: str, 
                                    fecha_inicio: Optional[date] = None,
                                    fecha_fin: Optional[date] = None) -> List[Incidencia]:
        """
        Obtiene las incidencias asignadas a un usuario en un rango de fechas
        
        Args:
            usuario_id: ID del usuario
            fecha_inicio: Fecha de inicio del rango (opcional)
            fecha_fin: Fecha de fin del rango (opcional)
        
        Returns:
            Lista de incidencias asignadas al usuario
        """
        if usuario_id not in self.asignaciones:
            return []
        
        incidencias = self.asignaciones[usuario_id]
        
        if fecha_inicio or fecha_fin:
            incidencias_filtradas = []
            for incidencia in incidencias:
                if incidencia.fecha:
                    if fecha_inicio and incidencia.fecha < fecha_inicio:
                        continue
                    if fecha_fin and incidencia.fecha > fecha_fin:
                        continue
                incidencias_filtradas.append(incidencia)
            return incidencias_filtradas
        
        return incidencias
    
    def obtener_calendario_usuario(self, usuario_id: str, 
                                   fecha_inicio: date, 
                                   fecha_fin: date) -> Dict[date, List[Incidencia]]:
        """
        Obtiene el calendario de un usuario en un rango de fechas
        
        Args:
            usuario_id: ID del usuario
            fecha_inicio: Fecha de inicio
            fecha_fin: Fecha de fin
        
        Returns:
            Diccionario con fecha como clave y lista de incidencias como valor
        """
        calendario: Dict[date, List[Incidencia]] = {}
        incidencias = self.obtener_incidencias_usuario(usuario_id, fecha_inicio, fecha_fin)
        
        fecha_actual = fecha_inicio
        while fecha_actual <= fecha_fin:
            calendario[fecha_actual] = [
                inc for inc in incidencias 
                if inc.fecha and inc.fecha == fecha_actual
            ]
            fecha_actual += timedelta(days=1)
        
        return calendario
    
    def obtener_resumen_asignaciones(self) -> Dict[str, int]:
        """
        Obtiene un resumen de asignaciones por usuario
        
        Returns:
            Diccionario con usuario_id como clave y número de incidencias como valor
        """
        return {
            usuario_id: len(incidencias) 
            for usuario_id, incidencias in self.asignaciones.items()
        }
    
    def mover_incidencia_fecha(self, incidencia: Incidencia, nueva_fecha: date) -> bool:
        """
        Mueve una incidencia de una fecha a otra (arrastrar entre fechas)
        
        Args:
            incidencia: Incidencia a mover
            nueva_fecha: Nueva fecha para la incidencia
        
        Returns:
            True si se movió correctamente, False si la incidencia no existe
        """
        # Buscar la incidencia en las asignaciones
        encontrada = False
        for usuario_id, incidencias in self.asignaciones.items():
            if incidencia in incidencias:
                encontrada = True
                # Actualizar la fecha de la incidencia
                incidencia.fecha = nueva_fecha
                # Si también tiene fecha_hora, actualizarla manteniendo la hora
                if incidencia.fecha_hora:
                    # Mantener la hora original, solo cambiar la fecha
                    nueva_fecha_hora = datetime.combine(nueva_fecha, incidencia.fecha_hora.time())
                    incidencia.fecha_hora = nueva_fecha_hora
                break
        
        if encontrada:
            print(f"✅ Incidencia {incidencia.no} movida a fecha {nueva_fecha}")
            return True
        else:
            print(f"❌ No se encontró la incidencia {incidencia.no} en las asignaciones")
            return False
    
    def mover_incidencia_usuario(self, incidencia: Incidencia, nuevo_usuario_id: str) -> bool:
        """
        Mueve una incidencia de un usuario a otro (arrastrar entre usuarios)
        
        Args:
            incidencia: Incidencia a mover
            nuevo_usuario_id: ID del nuevo usuario
        
        Returns:
            True si se movió correctamente
        """
        # Buscar y remover de la asignación actual
        encontrada = False
        for usuario_id, incidencias in self.asignaciones.items():
            if incidencia in incidencias:
                incidencias.remove(incidencia)
                encontrada = True
                break
        
        # Asignar al nuevo usuario
        if nuevo_usuario_id not in self.asignaciones:
            self.asignaciones[nuevo_usuario_id] = []
        
        incidencia.usuario = nuevo_usuario_id
        self.asignaciones[nuevo_usuario_id].append(incidencia)
        
        if encontrada:
            print(f"✅ Incidencia {incidencia.no} movida al usuario {nuevo_usuario_id}")
        else:
            print(f"✅ Incidencia {incidencia.no} asignada al usuario {nuevo_usuario_id} (nueva asignación)")
        
        return True
    
    def mover_incidencia(self, incidencia: Incidencia, 
                       nuevo_usuario_id: Optional[str] = None,
                       nueva_fecha: Optional[date] = None,
                       sincronizar_bc: bool = True) -> bool:
        """
        Mueve una incidencia cambiando usuario y/o fecha (arrastrar completo)
        
        Args:
            incidencia: Incidencia a mover
            nuevo_usuario_id: ID del nuevo usuario (opcional, si es None no cambia)
            nueva_fecha: Nueva fecha (opcional, si es None no cambia)
            sincronizar_bc: Si es True, sincroniza los cambios con Business Central
        
        Returns:
            True si se movió correctamente
        """
        cambios = []
        
        # Cambiar usuario si se proporciona
        if nuevo_usuario_id is not None:
            self.mover_incidencia_usuario(incidencia, nuevo_usuario_id)
            cambios.append(f"usuario: {nuevo_usuario_id}")
        
        # Cambiar fecha si se proporciona
        if nueva_fecha is not None:
            self.mover_incidencia_fecha(incidencia, nueva_fecha)
            cambios.append(f"fecha: {nueva_fecha}")
        
        if cambios:
            print(f"✅ Incidencia {incidencia.no} movida - {', '.join(cambios)}")
            
            # Sincronizar con Business Central si está configurado
            if sincronizar_bc and self.bc_client:
                try:
                    exito = self.bc_client.actualizar_incidencia(incidencia)
                    if exito:
                        print(f"✅  sincronizados con Business Central")
                    else:
                        print(f"⚠️ No se pudieron sincronizar los cambios con Business Central")
                except Exception as e:
                    print(f"❌ Error al sincronizar con Business Central: {str(e)}")
            
            return True
        else:
            print(f"⚠️ No se especificaron cambios para la incidencia {incidencia.no}")
            return False
    
    def buscar_incidencia_por_no(self, no: str) -> Optional[Incidencia]:
        """
        Busca una incidencia por su número en todas las asignaciones
        
        Args:
            no: Número de la incidencia
        
        Returns:
            La incidencia encontrada o None si no existe
        """
        for usuario_id, incidencias in self.asignaciones.items():
            for incidencia in incidencias:
                if incidencia.no == no:
                    return incidencia
        return None

