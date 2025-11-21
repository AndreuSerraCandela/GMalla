"""
Módulo de asignación automática de incidencias usando LLM
"""
import json
from datetime import date, datetime, timedelta, time
from typing import List, Optional, Dict, Any, Tuple
import math

# Importar modelos y clientes
try:
    from ..models.incidencia import Incidencia
    from ..business_central.client import BusinessCentralClient
    from ..gtask.client import GTaskClient
    from ..llm.client import LLMClient
    from ..calendario.gestor import GestorCalendario
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from models.incidencia import Incidencia
    from business_central.client import BusinessCentralClient
    from gtask.client import GTaskClient
    from llm.client import LLMClient
    from calendario.gestor import GestorCalendario


class AsignadorAutomatico:
    """Gestiona la asignación automática de incidencias usando LLM"""
    
    # Constantes de configuración
    HORAS_TRABAJO_DIARIAS = 6  # 6 horas de trabajo por equipo
    TIEMPO_MINIMO_RESOLUCION = 20  # 20 minutos mínimo por incidencia
    HORA_INICIO = time(6, 30)  # 6:30 AM
    HORA_FIN = time(12, 30)  # 12:30 PM
    
    def __init__(self, bc_client: BusinessCentralClient, 
                 gtask_client: GTaskClient,
                 llm_client: LLMClient,
                 gestor: GestorCalendario):
        """
        Inicializa el asignador automático
        
        Args:
            bc_client: Cliente de Business Central
            gtask_client: Cliente de GTask
            llm_client: Cliente de LLM
            gestor: Gestor de calendario
        """
        self.bc_client = bc_client
        self.gtask_client = gtask_client
        self.llm_client = llm_client
        self.gestor = gestor
    
    def calcular_distancia_haversine(self, lat1: float, lon1: float, 
                                     lat2: float, lon2: float) -> float:
        """
        Calcula la distancia entre dos puntos geográficos usando la fórmula de Haversine
        
        Args:
            lat1, lon1: Coordenadas del primer punto (latitud, longitud)
            lat2, lon2: Coordenadas del segundo punto (latitud, longitud)
        
        Returns:
            Distancia en kilómetros
        """
        # Radio de la Tierra en kilómetros
        R = 6371.0
        
        # Convertir grados a radianes
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)
        
        # Diferencia de coordenadas
        dlat = lat2_rad - lat1_rad
        dlon = lon2_rad - lon1_rad
        
        # Fórmula de Haversine
        a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        
        distancia = R * c
        return distancia
    
    def calcular_tiempo_desplazamiento(self, distancia_km: float) -> int:
        """
        Calcula el tiempo de desplazamiento en minutos basado en la distancia
        
        Args:
            distancia_km: Distancia en kilómetros
        
        Returns:
            Tiempo de desplazamiento en minutos
        """
        # Velocidad promedio estimada: 40 km/h en ciudad
        velocidad_promedio = 40  # km/h
        tiempo_horas = distancia_km / velocidad_promedio
        tiempo_minutos = int(tiempo_horas * 60)
        
        # Mínimo 5 minutos de desplazamiento
        return max(5, tiempo_minutos)
    
    def es_dia_laboral(self, fecha: date) -> bool:
        """
        Verifica si una fecha es día laboral (excluye sábados y domingos)
        
        Args:
            fecha: Fecha a verificar
        
        Returns:
            True si es día laboral, False si es fin de semana
        """
        # 0 = lunes, 6 = domingo
        return fecha.weekday() < 5  # Lunes a viernes
    
    def obtener_siguiente_dia_laboral(self, fecha: date) -> date:
        """
        Obtiene el siguiente día laboral (excluyendo sábados y domingos)
        
        Args:
            fecha: Fecha de inicio
        
        Returns:
            Siguiente día laboral
        """
        siguiente = fecha + timedelta(days=1)
        while not self.es_dia_laboral(siguiente):
            siguiente += timedelta(days=1)
        return siguiente
    
    def obtener_coordenadas_incidencia(self, incidencia: Incidencia) -> Optional[Tuple[float, float]]:
        """
        Obtiene las coordenadas de una incidencia desde su detalle
        
        Args:
            incidencia: Incidencia
        
        Returns:
            Tupla (latitud, longitud) o None si no hay coordenadas
        """
        if not incidencia.id_gtask:
            return None
        
        try:
            detalle = self.bc_client.obtener_detalle_incidencia(incidencia.id_gtask)
            if detalle and 'puntoX' in detalle and 'puntoY' in detalle:
                # puntoX es longitud, puntoY es latitud
                lon = float(detalle['puntoX'])
                lat = float(detalle['puntoY'])
                if not (math.isnan(lat) or math.isnan(lon)):
                    return (lat, lon)
        except Exception as e:
            print(f"⚠️ Error al obtener coordenadas de incidencia {incidencia.no}: {str(e)}")
        
        return None
    
    
    def calcular_tiempo_total_incidencia(self, incidencia: Incidencia, 
                                        tiempo_desplazamiento: int = 0) -> int:
        """
        Calcula el tiempo total necesario para una incidencia
        
        Args:
            incidencia: Incidencia
            tiempo_desplazamiento: Tiempo de desplazamiento en minutos
        
        Returns:
            Tiempo total en minutos
        """
        return self.TIEMPO_MINIMO_RESOLUCION + tiempo_desplazamiento
    
    def obtener_incidencias_sin_asignar(self, incidencias: List[Incidencia], 
                                        usuarios_filtrados: Optional[List[str]] = None) -> List[Incidencia]:
        """
        Filtra incidencias sin asignar o asignadas a usuarios no filtrados
        
        Args:
            incidencias: Lista de incidencias
            usuarios_filtrados: Lista de IDs de usuarios a considerar (None = todos)
        
        Returns:
            Lista de incidencias sin asignar o asignadas a usuarios no filtrados
        """
        incidencias_sin_asignar = []
        
        for incidencia in incidencias:
            # Si no tiene usuario asignado
            if not incidencia.usuario:
                incidencias_sin_asignar.append(incidencia)
            # Si tiene usuario pero no está en la lista filtrada
            elif usuarios_filtrados and incidencia.usuario not in usuarios_filtrados:
                incidencias_sin_asignar.append(incidencia)
        
        return incidencias_sin_asignar
    
    def preparar_datos_para_llm(self, incidencias: List[Incidencia], 
                                usuarios: List[Dict[str, Any]],
                                usuarios_filtrados: Optional[List[str]] = None,
                                fecha_inicio: Optional[date] = None,
                                fecha_fin: Optional[date] = None) -> Dict[str, Any]:
        """
        Prepara los datos para enviar al LLM
        
        Args:
            incidencias: Lista de incidencias a asignar
            usuarios: Lista de usuarios disponibles
            usuarios_filtrados: Lista de IDs de usuarios a considerar (None = todos)
        
        Returns:
            Diccionario con datos estructurados para el LLM
        """
        # Filtrar usuarios si es necesario
        usuarios_disponibles = usuarios
        if usuarios_filtrados:
            usuarios_disponibles = [
                u for u in usuarios 
                if u.get('id') in usuarios_filtrados or 
                   u.get('_id') in usuarios_filtrados or
                   u.get('user_id') in usuarios_filtrados
            ]
        
        # Preparar datos de incidencias con coordenadas
        incidencias_data = []
        for incidencia in incidencias:
            coords = self.obtener_coordenadas_incidencia(incidencia)
            incidencia_dict = {
                'id': incidencia.id_gtask or incidencia.no,
                'no': incidencia.no,
                'recurso': incidencia.recurso,
                'tipo_incidencia': incidencia.tipo_incidencia,
                'descripcion': incidencia.descripcion[:200] if incidencia.descripcion else '',
                'fecha_original': incidencia.fecha.isoformat() if incidencia.fecha else None,
                'coordenadas': {
                    'latitud': coords[0] if coords else None,
                    'longitud': coords[1] if coords else None
                } if coords else None
            }
            incidencias_data.append(incidencia_dict)
        
        # Preparar datos de usuarios
        # Nota: Los usuarios son personas, no tienen coordenadas fijas.
        # La proximidad se calcula basándose en las coordenadas de las incidencias.
        usuarios_data = []
        for usuario in usuarios_disponibles:
            usuario_id = usuario.get('id') or usuario.get('_id') or usuario.get('user_id')
            usuario_dict = {
                'id': usuario_id,
                'nombre': usuario.get('name') or usuario.get('username') or usuario.get('nombre', '')
            }
            usuarios_data.append(usuario_dict)
        
        # Obtener calendario actual de usuarios para ver disponibilidad
        calendario_usuarios = {}
        fecha_actual = date.today()
        fecha_fin = fecha_actual + timedelta(days=30)  # Próximos 30 días
        
        for usuario in usuarios_disponibles:
            usuario_id = usuario.get('id') or usuario.get('Id') or usuario.get('user_id')
            if usuario_id:
                calendario = self.gestor.obtener_calendario_usuario(usuario_id, fecha_actual, fecha_fin)
                calendario_usuarios[usuario_id] = {
                    fecha.isoformat(): len(incidencias) 
                    for fecha, incidencias in calendario.items()
                }
        
        return {
            'incidencias': incidencias_data,
            'usuarios': usuarios_data,
            'calendario_usuarios': calendario_usuarios,
            'configuracion': {
                'horas_trabajo_diarias': self.HORAS_TRABAJO_DIARIAS,
                'tiempo_minimo_resolucion': self.TIEMPO_MINIMO_RESOLUCION,
                'hora_inicio': self.HORA_INICIO.strftime('%H:%M'),
                'hora_fin': self.HORA_FIN.strftime('%H:%M'),
                'excluir_fines_semana': True,
                'fecha_inicio': fecha_inicio.isoformat() if fecha_inicio else None,
                'fecha_fin': fecha_fin.isoformat() if fecha_fin else None
            }
        }
    
    def generar_prompt_llm(self, datos: Dict[str, Any]) -> str:
        """
        Genera el prompt para el LLM
        
        Args:
            datos: Datos preparados para el LLM
        
        Returns:
            Prompt formateado
        """
        # Obtener ejemplos reales de IDs para el prompt
        ejemplo_incidencia = datos['incidencias'][0] if datos['incidencias'] else None
        ejemplo_usuario = datos['usuarios'][0] if datos['usuarios'] else None
        
        ejemplo_incidencia_id = ejemplo_incidencia.get('id') or ejemplo_incidencia.get('no', '') if ejemplo_incidencia else ''
        ejemplo_usuario_id = ejemplo_usuario.get('id', '') if ejemplo_usuario else ''
        ejemplo_usuario_nombre = ejemplo_usuario.get('nombre', '') if ejemplo_usuario else ''
        
        # Obtener rango de fechas
        fecha_inicio_str = datos['configuracion'].get('fecha_inicio')
        fecha_fin_str = datos['configuracion'].get('fecha_fin')
        fecha_actual = date.today()
        año_actual = fecha_actual.year
        
        # Calcular fechas de ejemplo dentro del rango
        if fecha_inicio_str and fecha_fin_str:
            fecha_inicio_ejemplo = date.fromisoformat(fecha_inicio_str)
            fecha_fin_ejemplo = date.fromisoformat(fecha_fin_str)
            # Usar la fecha de inicio como ejemplo, pero asegurar que sea día laboral
            fecha_ejemplo = fecha_inicio_ejemplo
            while not self.es_dia_laboral(fecha_ejemplo) and fecha_ejemplo <= fecha_fin_ejemplo:
                fecha_ejemplo = self.obtener_siguiente_dia_laboral(fecha_ejemplo)
            if fecha_ejemplo > fecha_fin_ejemplo:
                fecha_ejemplo = fecha_inicio_ejemplo  # Fallback
            fecha_ejemplo_str = fecha_ejemplo.isoformat()
            rango_fechas_info = f"\n⚠️ IMPORTANTE: Las fechas DEBEN estar en el rango {fecha_inicio_str} a {fecha_fin_str} (año {año_actual})"
        else:
            # Si no hay rango, usar fecha actual como ejemplo
            fecha_ejemplo = fecha_actual
            if not self.es_dia_laboral(fecha_ejemplo):
                fecha_ejemplo = self.obtener_siguiente_dia_laboral(fecha_ejemplo)
            fecha_ejemplo_str = fecha_ejemplo.isoformat()
            rango_fechas_info = f"\n⚠️ IMPORTANTE: Usa el año {año_actual} (año actual). NO uses 2024."
        
        # Lista de IDs de usuarios disponibles para referencia
        lista_ids_usuarios = [f"  - {u.get('id')} ({u.get('nombre', 'Sin nombre')})" 
                             for u in datos['usuarios'][:10]]  # Primeros 10 para no hacer el prompt muy largo
        
        # Calcular horas disponibles para distribuir
        hora_inicio = self.HORA_INICIO
        hora_fin = self.HORA_FIN
        horas_disponibles = []
        hora_actual = hora_inicio
        while hora_actual < hora_fin:
            horas_disponibles.append(hora_actual.strftime('%H:%M'))
            # Incrementar en intervalos de 30 minutos
            from datetime import timedelta
            hora_actual = (datetime.combine(date.today(), hora_actual) + timedelta(minutes=30)).time()
        
        prompt = f"""Eres un asistente experto en asignación automática de incidencias de mantenimiento.

TAREA:
Asignar {len(datos['incidencias'])} incidencias a {len(datos['usuarios'])} usuarios disponibles, considerando:

RESTRICCIONES:
1. Cada equipo tiene {datos['configuracion']['horas_trabajo_diarias']} horas de trabajo diarias ({datos['configuracion']['hora_inicio']} a {datos['configuracion']['hora_fin']})
2. ⚠️ CRÍTICO: Debes asignar TODAS las incidencias, pero CADA incidencia SOLO UNA VEZ. No dupliques asignaciones.
3. Tiempo mínimo para resolver cada incidencia: {datos['configuracion']['tiempo_minimo_resolucion']} minutos
4. Debes considerar el tiempo de desplazamiento entre incidencias (calcular basado en distancia geográfica)
5. Excluir sábados y domingos (solo días laborales)
6. Puedes adelantar la fecha de una incidencia para agruparlas en el mismo día si es eficiente
7. Puedes atrasar la fecha si todos los equipos están ocupados
8. Ordenar incidencias por proximidad geográfica para minimizar desplazamientos. Si no hay coordenadas, asignar la incidencia al usuario más cercano.
{rango_fechas_info}


INCIDENCIAS A ASIGNAR:
{json.dumps(datos['incidencias'], indent=2, ensure_ascii=False)}

USUARIOS DISPONIBLES:
{json.dumps(datos['usuarios'], indent=2, ensure_ascii=False)}

CALENDARIO ACTUAL (incidencias ya asignadas por usuario y fecha):
{json.dumps(datos['calendario_usuarios'], indent=2, ensure_ascii=False)}

INSTRUCCIONES:
1. Analiza las coordenadas de cada incidencia (las incidencias tienen ubicación geográfica)
2. Calcula distancias y tiempos de desplazamiento entre incidencias basándote en sus coordenadas
3. Agrupa incidencias cercanas geográficamente para el mismo usuario en el mismo día
4. Considera la carga de trabajo actual de cada usuario (ver CALENDARIO ACTUAL)
5. Asigna fechas considerando días laborales y horario de trabajo
6. Optimiza para minimizar desplazamientos entre incidencias y maximizar eficiencia
7. Si una incidencia no tiene coordenadas, distribúyela equitativamente entre los usuarios disponibles

RESPUESTA REQUERIDA (JSON):
⚠️ CRÍTICO: Debes usar SOLO los IDs REALES que aparecen en la lista de USUARIOS DISPONIBLES arriba.
⚠️ CRÍTICO: Debes asignar TODAS las {len(datos['incidencias'])} incidencias, pero CADA incidencia SOLO UNA VEZ en el array de asignaciones.
NO inventes IDs, NO uses UUIDs de ejemplo, NO uses texto descriptivo.
NO dupliques la misma incidencia_id en múltiples asignaciones.

IDs de usuarios disponibles (primeros 10):
{chr(10).join(lista_ids_usuarios) if lista_ids_usuarios else '  (ninguno disponible)'}

Formato de respuesta:
{{
  "asignaciones": [
    {{
      "incidencia_id": "valor_real_del_campo_id_o_no_de_la_incidencia",
      "usuario_id": "valor_real_del_campo_id_del_usuario",
      "fecha": "YYYY-MM-DD",
      "hora_inicio": "HH:MM",
      "razon": "Breve explicación de por qué se asignó así"
    }}
  ]
}}

EJEMPLO REAL usando datos de arriba:
{{
  "asignaciones": [
    {{
      "incidencia_id": "{ejemplo_incidencia_id}",
      "usuario_id": "{ejemplo_usuario_id}",
      "fecha": "{fecha_ejemplo_str}",
      "hora_inicio": "{horas_disponibles[0] if horas_disponibles else '06:30'}",
      "razon": "Incidencia cercana a otras asignadas al mismo usuario"
    }}
  ]
}}

REGLAS CRÍTICAS PARA FECHAS Y HORAS:
- fecha: Formato YYYY-MM-DD. DEBE usar el año {año_actual} (año actual). {f'DEBE estar entre {fecha_inicio_str} y {fecha_fin_str}' if fecha_inicio_str and fecha_fin_str else ''}
- hora_inicio: Formato HH:MM. DEBE distribuirse a lo largo del día entre {datos['configuracion']['hora_inicio']} y {datos['configuracion']['hora_fin']}
  ⚠️ NO asignes todas las incidencias a la misma hora (06:30)
  ⚠️ Distribuye las horas: primera incidencia a {horas_disponibles[0] if horas_disponibles else '06:30'}, segunda a {horas_disponibles[1] if len(horas_disponibles) > 1 else '07:00'}, etc.
  ⚠️ Considera el tiempo de desplazamiento: si un usuario tiene múltiples incidencias el mismo día, espacia las horas (mínimo {datos['configuracion']['tiempo_minimo_resolucion']} minutos entre incidencias)
- Solo asigna fechas en días laborales (lunes a viernes, NO sábados ni domingos)

REGLAS CRÍTICAS PARA IDs:
- incidencia_id: DEBE ser el valor exacto del campo "id" o "no" de alguna incidencia de la lista arriba
- usuario_id: DEBE ser el valor exacto del campo "id" de algún usuario de la lista USUARIOS DISPONIBLES arriba
  ⚠️ NO uses UUIDs inventados como "550e8400-e29b-41d4-a716-446655440000"
  ⚠️ NO uses IDs que no estén en la lista de usuarios proporcionada

Responde SOLO con el JSON válido, sin texto adicional antes o después."""
        print("Prompt: " + prompt)
        
        return prompt
    
    def asignar_automaticamente(self, incidencias: List[Incidencia],
                                usuarios_filtrados: Optional[List[str]] = None,
                                aplicar_cambios: bool = False,
                                solo_sin_asignar: bool = True,
                                reasignar: bool = False,
                                fecha_inicio: Optional[date] = None,
                                fecha_fin: Optional[date] = None) -> Dict[str, Any]:
        """
        Ejecuta la asignación automática de incidencias
        
        Args:
            incidencias: Lista de incidencias a asignar
            usuarios_filtrados: Lista de IDs de usuarios a considerar (None = todos)
            aplicar_cambios: Si es True, aplica los cambios en BC. Si es False, solo simula
            solo_sin_asignar: Si es True, solo asigna incidencias sin asignar
            reasignar: Si es True, reasigna todas las incidencias (incluidas las ya asignadas)
            fecha_inicio: Fecha de inicio del rango visible (opcional)
            fecha_fin: Fecha de fin del rango visible (opcional)
        
        Returns:
            Diccionario con resultados de la asignación
        """
        try:
            print("=" * 60)
            if reasignar:
                print("🔄 INICIANDO REASIGNACIÓN AUTOMÁTICA")
            else:
                print("🤖 INICIANDO ASIGNACIÓN AUTOMÁTICA")
            print("=" * 60)
            
            # Obtener usuarios disponibles
            resultado_usuarios = self.gtask_client.obtener_usuarios()
            if not resultado_usuarios['success']:
                return {
                    'success': False,
                    'error': f"No se pudieron obtener usuarios: {resultado_usuarios.get('error')}"
                }
            
            usuarios = resultado_usuarios['users']
            
            # Filtrar incidencias según el modo
            if reasignar:
                # En modo reasignación, incluir todas las incidencias
                incidencias_a_asignar = incidencias
                print(f"🔄 Modo REASIGNACIÓN: {len(incidencias_a_asignar)} incidencias (incluidas ya asignadas)")
            elif solo_sin_asignar:
                # Solo incidencias sin asignar
                incidencias_a_asignar = self.obtener_incidencias_sin_asignar(incidencias, usuarios_filtrados)
                print(f"📋 Modo ASIGNACIÓN: {len(incidencias_a_asignar)} incidencias sin asignar")
            else:
                # Todas las incidencias (pero no es reasignación, solo para procesar)
                incidencias_a_asignar = incidencias
                print(f"📋 Modo ASIGNACIÓN: {len(incidencias_a_asignar)} incidencias")
            
            if not incidencias_a_asignar:
                return {
                    'success': True,
                    'message': 'No hay incidencias para asignar',
                    'asignaciones': []
                }
            
            print(f"👥 {len(usuarios)} usuarios disponibles")
            
            # Preparar datos para LLM
            datos = self.preparar_datos_para_llm(
                incidencias_a_asignar, 
                usuarios, 
                usuarios_filtrados,
                fecha_inicio=fecha_inicio,
                fecha_fin=fecha_fin
            )
            
            # Generar prompt
            prompt = self.generar_prompt_llm(datos)
            
            # Obtener respuesta del LLM
            system_prompt = "Eres un experto en optimización de rutas y asignación de tareas de mantenimiento. Responde siempre en formato JSON válido."
            
            resultado_llm = self.llm_client.generar_respuesta(
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=4000,
                temperature=0.3  # Baja temperatura para respuestas más deterministas
            )
            
            if not resultado_llm['success']:
                return {
                    'success': False,
                    'error': f"Error al obtener respuesta del LLM: {resultado_llm.get('error')}"
                }
            
            # Parsear respuesta del LLM
            respuesta = resultado_llm['response']
            asignaciones_parseadas = self.llm_client.parsear_asignaciones(respuesta)
            
            if not asignaciones_parseadas:
                return {
                    'success': False,
                    'error': 'No se pudieron parsear las asignaciones del LLM',
                    'respuesta_llm': respuesta
                }
            
            # Validar y limpiar asignaciones parseadas
            asignaciones_validadas = []
            
            # Crear sets de IDs válidos (incluyendo todas las variantes)
            ids_incidencias_validos = set()
            for inc in incidencias_a_asignar:
                if inc.id_gtask:
                    ids_incidencias_validos.add(inc.id_gtask)
                if inc.no:
                    ids_incidencias_validos.add(inc.no)
            
            ids_usuarios_validos = set()
            for usuario in usuarios:
                usuario_id = usuario.get('id') or usuario.get('_id') or usuario.get('user_id')
                if usuario_id:
                    ids_usuarios_validos.add(str(usuario_id))
            
            # Validar fechas
            año_actual = date.today().year
            
            for asignacion in asignaciones_parseadas:
                incidencia_id = str(asignacion.get('incidencia_id', '')).strip()
                usuario_id = str(asignacion.get('usuario_id', '')).strip()
                fecha_str = asignacion.get('fecha', '')
                hora_inicio = asignacion.get('hora_inicio', '')
                
                # Validar que no sean texto descriptivo o UUIDs de ejemplo
                textos_invalidos = [
                    'id de la incidencia', 'id del usuario asignado',
                    'id del usuario', 'incidencia_id', 'usuario_id',
                    'id de incidencia', 'id usuario', 'valor_real',
                    'valor real', 'campo id', 'campo_id'
                ]
                
                incidencia_id_lower = incidencia_id.lower()
                usuario_id_lower = usuario_id.lower()
                
                if (incidencia_id_lower in textos_invalidos or 
                    usuario_id_lower in textos_invalidos or
                    'id del' in incidencia_id_lower or
                    'id del' in usuario_id_lower or
                    'valor_real' in incidencia_id_lower or
                    'valor_real' in usuario_id_lower):
                    print(f"⚠️ Asignación ignorada: contiene texto descriptivo o UUID de ejemplo")
                    print(f"   incidencia_id: '{incidencia_id}', usuario_id: '{usuario_id}'")
                    continue
                
                # Validar fecha
                if fecha_str:
                    try:
                        fecha_asignada = date.fromisoformat(fecha_str)
                        
                        # Validar año (debe ser el año actual, no 2024)
                        if fecha_asignada.year != año_actual:
                            print(f"⚠️ Asignación ignorada: fecha con año incorrecto ({fecha_asignada.year}, debe ser {año_actual})")
                            print(f"   incidencia_id: '{incidencia_id}', fecha: '{fecha_str}'")
                            continue
                        
                        # Validar rango de fechas si se proporcionó
                        if fecha_inicio and fecha_fin:
                            if not (fecha_inicio <= fecha_asignada <= fecha_fin):
                                print(f"⚠️ Asignación ignorada: fecha fuera del rango visible")
                                print(f"   incidencia_id: '{incidencia_id}', fecha: '{fecha_str}' (rango: {fecha_inicio} a {fecha_fin})")
                                continue
                        
                        # Validar que sea día laboral
                        if not self.es_dia_laboral(fecha_asignada):
                            print(f"⚠️ Asignación ignorada: fecha en fin de semana")
                            print(f"   incidencia_id: '{incidencia_id}', fecha: '{fecha_str}'")
                            # Ajustar automáticamente al siguiente día laboral
                            fecha_asignada = self.obtener_siguiente_dia_laboral(fecha_asignada)
                            asignacion['fecha'] = fecha_asignada.isoformat()
                            print(f"   ✅ Fecha ajustada a: {fecha_asignada.isoformat()}")
                    except ValueError:
                        print(f"⚠️ Asignación ignorada: fecha inválida '{fecha_str}'")
                        continue
                
                # Validar hora
                if hora_inicio:
                    try:
                        hora_parts = hora_inicio.split(':')
                        if len(hora_parts) != 2:
                            raise ValueError("Formato de hora inválido")
                        hora_int = int(hora_parts[0])
                        minuto_int = int(hora_parts[1])
                        
                        hora_asignada = time(hora_int, minuto_int)
                        
                        # Validar que esté en el rango de trabajo
                        if hora_asignada < self.HORA_INICIO or hora_asignada > self.HORA_FIN:
                            print(f"⚠️ Asignación: hora fuera del rango de trabajo, ajustando")
                            print(f"   incidencia_id: '{incidencia_id}', hora: '{hora_inicio}'")
                            # Ajustar a la hora de inicio
                            asignacion['hora_inicio'] = self.HORA_INICIO.strftime('%H:%M')
                            print(f"   ✅ Hora ajustada a: {self.HORA_INICIO.strftime('%H:%M')}")
                    except (ValueError, IndexError):
                        print(f"⚠️ Asignación: hora inválida '{hora_inicio}', usando hora por defecto")
                        asignacion['hora_inicio'] = self.HORA_INICIO.strftime('%H:%M')
                
                # Validar que los IDs existan
                incidencia_encontrada = False
                if incidencia_id in ids_incidencias_validos:
                    incidencia_encontrada = True
                else:
                    # Buscar por coincidencia parcial o variantes
                    for inc in incidencias_a_asignar:
                        if (str(inc.id_gtask) == incidencia_id or 
                            str(inc.no) == incidencia_id or
                            incidencia_id in str(inc.id_gtask) or
                            incidencia_id in str(inc.no)):
                            incidencia_encontrada = True
                            # Normalizar el ID al valor correcto
                            asignacion['incidencia_id'] = inc.id_gtask or inc.no
                            break
                
                if not incidencia_encontrada:
                    print(f"⚠️ Asignación ignorada: incidencia_id '{incidencia_id}' no encontrado")
                    print(f"   IDs válidos disponibles: {list(ids_incidencias_validos)[:5]}...")
                    continue
                
                usuario_encontrado = False
                if usuario_id in ids_usuarios_validos:
                    usuario_encontrado = True
                else:
                    # Buscar por coincidencia parcial
                    for usuario in usuarios:
                        usuario_id_real = str(usuario.get('id') or usuario.get('Id') or usuario.get('user_id') or '')
                        if usuario_id == usuario_id_real or usuario_id in usuario_id_real:
                            usuario_encontrado = True
                            # Normalizar el ID al valor correcto
                            asignacion['usuario_id'] = usuario_id_real
                            break
                
                if not usuario_encontrado:
                    print(f"⚠️ Asignación ignorada: usuario_id '{usuario_id}' no encontrado")
                    print(f"   IDs válidos disponibles: {list(ids_usuarios_validos)[:5]}...")
                    continue
                
                asignaciones_validadas.append(asignacion)
            
            if not asignaciones_validadas:
                return {
                    'success': False,
                    'error': 'No se encontraron asignaciones válidas después de la validación. El LLM puede haber devuelto texto descriptivo en lugar de IDs reales.',
                    'respuesta_llm': respuesta,
                    'asignaciones_originales': asignaciones_parseadas
                }
            
            print(f"✅ LLM generó {len(asignaciones_parseadas)} asignaciones, {len(asignaciones_validadas)} válidas")
            
            # Eliminar duplicados: mantener solo la primera asignación válida para cada incidencia
            asignaciones_sin_duplicados = []
            incidencias_asignadas = set()
            duplicados_eliminados = 0
            
            for asignacion in asignaciones_validadas:
                incidencia_id = str(asignacion.get('incidencia_id', '')).strip()
                
                # Normalizar el ID para comparación (usar el ID normalizado si se encontró)
                incidencia_id_normalizado = incidencia_id
                for inc in incidencias_a_asignar:
                    if (str(inc.id_gtask) == incidencia_id or 
                        str(inc.no) == incidencia_id or
                        incidencia_id in str(inc.id_gtask) or
                        incidencia_id in str(inc.no)):
                        incidencia_id_normalizado = inc.id_gtask or inc.no
                        break
                
                if incidencia_id_normalizado in incidencias_asignadas:
                    duplicados_eliminados += 1
                    print(f"⚠️ Asignación duplicada eliminada para incidencia '{incidencia_id_normalizado}'")
                    continue
                
                incidencias_asignadas.add(incidencia_id_normalizado)
                asignacion['incidencia_id'] = incidencia_id_normalizado  # Asegurar ID normalizado
                asignaciones_sin_duplicados.append(asignacion)
            
            if duplicados_eliminados > 0:
                print(f"🔄 Eliminados {duplicados_eliminados} duplicados. Quedan {len(asignaciones_sin_duplicados)} asignaciones únicas")
            
            # Verificar que todas las incidencias tengan asignación
            incidencias_sin_asignar = []
            for inc in incidencias_a_asignar:
                inc_id = inc.id_gtask or inc.no
                if inc_id not in incidencias_asignadas:
                    incidencias_sin_asignar.append(inc_id)
            
            if incidencias_sin_asignar:
                print(f"⚠️ {len(incidencias_sin_asignar)} incidencias no fueron asignadas por el LLM: {incidencias_sin_asignar[:5]}...")
            
            asignaciones_parseadas = asignaciones_sin_duplicados
            
            # Aplicar asignaciones si se solicita
            asignaciones_aplicadas = []
            errores = []
            
            if aplicar_cambios:
                for asignacion in asignaciones_parseadas:
                    try:
                        incidencia_id = asignacion.get('incidencia_id')
                        usuario_id = asignacion.get('usuario_id')
                        fecha_str = asignacion.get('fecha')
                        hora_inicio = asignacion.get('hora_inicio', '06:30')
                        
                        # Buscar la incidencia
                        incidencia = next(
                            (inc for inc in incidencias_a_asignar 
                             if (inc.id_gtask == incidencia_id or inc.no == incidencia_id)),
                            None
                        )
                        
                        if not incidencia:
                            errores.append(f"Incidencia {incidencia_id} no encontrada")
                            continue
                        
                        # Parsear fecha
                        fecha = date.fromisoformat(fecha_str) if fecha_str else date.today()
                        
                        # Actualizar incidencia
                        incidencia.usuario = usuario_id
                        incidencia.fecha = fecha
                        
                        # Actualizar fecha_hora si es necesario
                        if hora_inicio:
                            hora_parts = hora_inicio.split(':')
                            hora = time(int(hora_parts[0]), int(hora_parts[1]))
                            incidencia.fecha_hora = datetime.combine(fecha, hora)
                        
                        # Asignar en el gestor
                        self.gestor.asignar_incidencia(incidencia, usuario_id)
                        
                        # Sincronizar con BC
                        if self.bc_client:
                            exito = self.bc_client.actualizar_incidencia(incidencia)
                            if not exito:
                                errores.append(f"Error al sincronizar incidencia {incidencia.no} con BC")
                        
                        asignaciones_aplicadas.append({
                            'incidencia_id': incidencia_id,
                            'incidencia_no': incidencia.no,
                            'usuario_id': usuario_id,
                            'fecha': fecha_str,
                            'hora_inicio': hora_inicio
                        })
                        
                    except Exception as e:
                        errores.append(f"Error al aplicar asignación {asignacion}: {str(e)}")
            
            resultado = {
                'success': True,
                'asignaciones_propuestas': asignaciones_parseadas,
                'asignaciones_aplicadas': asignaciones_aplicadas if aplicar_cambios else [],
                'errores': errores,
                'respuesta_llm': respuesta
            }
            
            print(f"✅ Asignación automática completada")
            if aplicar_cambios:
                print(f"   - {len(asignaciones_aplicadas)} asignaciones aplicadas")
                if errores:
                    print(f"   - {len(errores)} errores")
            
            return resultado
            
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"❌ Error en asignación automática: {str(e)}")
            print(f"📋 Traceback:\n{error_trace}")
            return {
                'success': False,
                'error': str(e),
                'traceback': error_trace
            }

