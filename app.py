"""
Aplicación web Flask para GMalla - Gestión de Calendario de Asignación de Incidencias
"""
import sys
import logging
from pathlib import Path
from flask import Flask, render_template, jsonify, request
from datetime import date, datetime, timedelta
import pyodbc

logger = logging.getLogger(__name__)

# Agregar el directorio raíz al path para importaciones
sys.path.insert(0, str(Path(__file__).parent))

from business_central.client import BusinessCentralClient
from calendario.gestor import GestorCalendario
from models.incidencia import Incidencia, EstadoIncidencia
from gtask.client import GTaskClient
from llm.client import LLMClient
from asignacion_automatica.asignador import AsignadorAutomatico
from config import (
    BUSINESS_CENTRAL_BASE_URL, 
    BUSINESS_CENTRAL_API_KEY,
    GTASK_API_URL,
    GTASK_USERNAME,
    GTASK_PASSWORD,
    LLM_BASE_URL,
    ADMINISTRADORES,
    PERMISOS_FILE,
)
from apiwhats_client import notificar_whatsapp_asignacion_incidencia

app = Flask(__name__)

# Inicializar clientes globales
bc_client = BusinessCentralClient(
    base_url=BUSINESS_CENTRAL_BASE_URL,
    api_key=BUSINESS_CENTRAL_API_KEY
)

gtask_client = GTaskClient(api_url=GTASK_API_URL)

# Realizar login automático con credenciales por defecto para la API
# try:
#     login_result = gtask_client.login(GTASK_USERNAME, GTASK_PASSWORD)
#     if login_result['success']:
#         print(f"✅ Login automático en GTask API exitoso para usuario: {GTASK_USERNAME}")
#     else:
#         print(f"⚠️ No se pudo hacer login automático en GTask API: {login_result.get('error', 'Error desconocido')}")
# except Exception as e:
#     print(f"⚠️ Error en login automático de GTask API: {str(e)}")

# Inicializar gestor de calendario
gestor = GestorCalendario(bc_client=bc_client)

# Inicializar cliente LLM
llm_client = LLMClient(base_url=LLM_BASE_URL)

# Inicializar asignador automático
asignador_automatico = AsignadorAutomatico(
    bc_client=bc_client,
    gtask_client=gtask_client,
    llm_client=llm_client,
    gestor=gestor
)

# --- Permisos (permisos.json + administradores en .env) ---
import json

def _permisos_default():
    """Permisos por defecto: todo permitido."""
    return {
        "tipos_incidencia_visible": None,  # None = todos los tipos visibles
        "subtipos_incidencia_visible": None,  # None = todos los subtipos visibles
        "comunicado_por_emt_visible": True,
        "puede_modificar": True,
        "puede_asignar": True,
        "puede_imprimir": True,
    }

def _load_permisos():
    """Carga permisos.json. Si no existe o está vacío, devuelve {}."""
    try:
        if PERMISOS_FILE.exists():
            with open(PERMISOS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}

def _save_permisos(data):
    """Guarda permisos.json."""
    with open(PERMISOS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _user_identifier(user_data):
    """Identificador único del usuario (id o username en minúscula)."""
    if not user_data:
        return None
    uid = user_data.get("id") or user_data.get("_id") or user_data.get("user_id")
    if uid:
        return str(uid)
    uname = user_data.get("username") or user_data.get("email") or user_data.get("nombre") or user_data.get("name")
    if uname:
        return str(uname).strip().lower()
    return None

def is_admin(user_data):
    """True si el usuario está en ADMINISTRADORES (por username/email)."""
    if not user_data or not ADMINISTRADORES:
        return False
    # Probar todas las claves habituales (API puede devolver camelCase, etc.)
    raw = (
        user_data.get("username") or user_data.get("userName") or user_data.get("Username")
        or user_data.get("user")  # Algunas APIs devuelven "user" como string
        or user_data.get("email") or user_data.get("Email")
        or user_data.get("name") or user_data.get("nombre") or user_data.get("Name")
    )
    if not raw:
        return False
    s = str(raw).strip().lower()
    if s in ADMINISTRADORES:
        return True
    # Si es un email (usuario@dominio), comparar también la parte local
    if "@" in s:
        local = s.split("@")[0].strip()
        if local in ADMINISTRADORES:
            return True
    return False

def get_permisos_for_user(user_id_or_username):
    """Devuelve el dict de permisos para un usuario (merge con defaults)."""
    defaults = _permisos_default()
    if not user_id_or_username:
        return defaults
    key = str(user_id_or_username).strip().lower() if isinstance(user_id_or_username, str) else str(user_id_or_username)
    data = _load_permisos()
    user_perm = data.get(key) or data.get(user_id_or_username)
    if not user_perm or not isinstance(user_perm, dict):
        return defaults
    for k, v in defaults.items():
        if k not in user_perm:
            user_perm[k] = v
    return user_perm


@app.route('/')
def index():
    """Página principal con el calendario"""
    return render_template('calendario.html')


@app.route('/api/login', methods=['POST'])
def login():
    """API para realizar login en GTask"""
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({
                'success': False,
                'error': 'Faltan credenciales: username y password son requeridos'
            }), 400
        
        resultado = gtask_client.login(username, password)
        
        if resultado['success']:
            return jsonify({
                'success': True,
                'token': resultado.get('token'),
                'user_data': resultado.get('user_data'),
                'message': 'Login exitoso'
            })
        else:
            return jsonify({
                'success': False,
                'error': resultado.get('error', 'Error en el login')
            }), 401
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    """API para cerrar sesión en GTask"""
    try:
        gtask_client.logout()
        return jsonify({
            'success': True,
            'message': 'Sesión cerrada correctamente'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/auth-status', methods=['GET'])
def auth_status():
    """API para verificar el estado de autenticación"""
    try:
        return jsonify({
            'success': True,
            'authenticated': gtask_client.esta_autenticado(),
            'user_data': gtask_client.obtener_usuario_actual(),
            'token': gtask_client.obtener_token()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# --- Rutas de permisos ---
@app.route('/api/permisos', methods=['GET'])
def api_permisos():
    """Devuelve los permisos del usuario actual y si es admin."""
    try:
        user_data = gtask_client.obtener_usuario_actual()
        admin = is_admin(user_data)
        user_id = _user_identifier(user_data)
        permisos = get_permisos_for_user(user_id)
        return jsonify({
            'success': True,
            'permisos': permisos,
            'is_admin': admin,
            'user_identifier': user_id,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/permisos/admin/usuarios', methods=['GET'])
def api_permisos_admin_usuarios():
    """Lista de usuarios (desde GTask /users). Solo administradores."""
    try:
        user_data = gtask_client.obtener_usuario_actual()
        if not is_admin(user_data):
            return jsonify({'success': False, 'error': 'No autorizado. Solo administradores.'}), 403
        resultado = gtask_client.obtener_usuarios(usar_cache=False)
        if not resultado.get('success'):
            return jsonify({'success': False, 'error': resultado.get('error', 'Error al obtener usuarios')}), 500
        usuarios = resultado.get('users', [])
        return jsonify({'success': True, 'usuarios': usuarios})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/permisos/admin', methods=['GET'])
def api_permisos_admin_get():
    """Obtiene el contenido completo de permisos.json. Solo administradores."""
    try:
        user_data = gtask_client.obtener_usuario_actual()
        if not is_admin(user_data):
            return jsonify({'success': False, 'error': 'No autorizado. Solo administradores.'}), 403
        data = _load_permisos()
        return jsonify({'success': True, 'permisos': data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/permisos/admin', methods=['POST'])
def api_permisos_admin_save():
    """Guarda permisos.json. Solo administradores."""
    try:
        user_data = gtask_client.obtener_usuario_actual()
        if not is_admin(user_data):
            return jsonify({'success': False, 'error': 'No autorizado. Solo administradores.'}), 403
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Se esperaba un objeto JSON'}), 400
        _save_permisos(data)
        return jsonify({'success': True, 'message': 'Permisos guardados correctamente'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _obtener_nombres_recursos(codes):
    """Obtiene nombres de recursos/paradas desde ElementosMallorca para una lista de códigos. Devuelve dict code -> name."""
    if not codes:
        return {}
    codes = list(set(c for c in codes if c))
    if not codes:
        return {}
    try:
        server, database, username, password = '192.168.10.190', 'Malla2009', 'SA', 'SA1234sa'
        drivers_odbc = ['ODBC Driver 17 for SQL Server', 'ODBC Driver 18 for SQL Server', 'ODBC Driver 13 for SQL Server', 'SQL Server']
        conn = None
        for driver in drivers_odbc:
            try:
                cs = f'DRIVER={{{driver}}};SERVER={server};DATABASE={database};UID={username};PWD={password};'
                if '17' in driver or '18' in driver:
                    cs += 'TrustServerCertificate=yes;'
                conn = pyodbc.connect(cs)
                break
            except Exception:
                continue
        if not conn:
            return {}
        result = {}
        try:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(codes))
            cursor.execute(f"SELECT [No_], [Name] FROM [dbo].[ElementosMallorca] WHERE [No_] IN ({placeholders})", codes)
            for row in cursor:
                result[str(row[0] or '').strip()] = (row[1] or '').strip()
            cursor.close()
        finally:
            conn.close()
        return result
    except Exception as e:
        print(f"[WARN] No se pudieron obtener nombres de recursos: {e}")
        return {}


def _a_iso_fecha_o_datetime(val):
    """Serializa date/datetime a ISO; BC a veces deja ya un str."""
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return str(val)


@app.route('/api/incidencias', methods=['GET'])
def obtener_incidencias():
    """API para obtener todas las incidencias"""
    try:
        filtros = {}
        
        # Filtros opcionales desde query parameters
        estados = request.args.getlist('estado')
        if estados:
            filtros['estado'] = estados
        else:
            # Por defecto: Abierta y En Progreso (no Cerrada)
            filtros['estado'] = ['Abierta', 'EnProgreso']
        if request.args.get('recurso'):
            filtros['recurso'] = request.args.get('recurso')
        
        incidencias = bc_client.obtener_incidencias(filtros=filtros)
        
        # Resolver nombres de recursos desde ElementosMallorca
        codigos_recurso = [inc.recurso for inc in incidencias if inc.recurso]
        nombres_recursos = _obtener_nombres_recursos(codigos_recurso)
        
        # Convertir incidencias a formato JSON
        incidencias_json = []
        for inc in incidencias:
            recurso_code = inc.recurso or ''
            resource_name = nombres_recursos.get(recurso_code.strip(), recurso_code) if recurso_code else ''
            incidencias_json.append({
                'no': inc.no,
                'descripcion': inc.descripcion,
                'fecha': _a_iso_fecha_o_datetime(inc.fecha),
                'estado': inc.estado.value,
                'recurso': inc.recurso,
                'resource_name': resource_name or inc.recurso,
                'tipo_incidencia': inc.tipo_incidencia,
                'subtipo_incidencia': getattr(inc, 'subtipo_incidencia', None),
                'usuario': inc.usuario,
                'usuario_creador': getattr(inc, 'usuario_creador', None),
                'comunicado_por_emt': getattr(inc, 'comunicado_por_emt', None),
                'fecha_hora': _a_iso_fecha_o_datetime(inc.fecha_hora),
                'id_gtask': inc.id_gtask,
                'url_primera_imagen': inc.url_primera_imagen
            })
        
        return jsonify({
            'success': True,
            'incidencias': incidencias_json,
            'count': len(incidencias_json)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def _json_safe_valor(val):
    """Convierte estructuras de GTask/Mongo a tipos serializables en JSON (evita 500 en jsonify)."""
    from datetime import date, datetime

    if val is None or isinstance(val, (bool, int, float, str)):
        return val
    if isinstance(val, dict):
        return {str(k): _json_safe_valor(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_json_safe_valor(x) for x in val]
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return str(val)


@app.route('/api/usuarios', methods=['GET'])
def obtener_usuarios():
    """API para obtener lista de usuarios desde GTask (ordenados por nombre)."""
    try:
        resultado = gtask_client.obtener_usuarios()
        if not resultado.get('success'):
            err = resultado.get('error', 'Error desconocido')
            extra = resultado.get('response_text')
            suf = ''
            if extra:
                s = str(extra)
                suf = f" | respuesta: {s[:500]}..." if len(s) > 500 else f" | respuesta: {s}"
            logger.error("[GTask] Fallo al obtener usuarios: %s%s", err, suf)
            # 502 = fallo del servicio GTask; cuerpo JSON para que el front pueda mostrar el motivo
            return jsonify({
                'success': False,
                'error': err,
                'usuarios': [],
                'count': 0,
            }), 502

        usuarios = resultado.get('users') or []
        if not isinstance(usuarios, list):
            usuarios = []
        usuarios = [u for u in usuarios if isinstance(u, dict)]

        def obtener_nombre_usuario(user):
            return (
                user.get('name') or user.get('username') or user.get('nombre') or ''
            ).lower()

        usuarios_ordenados = sorted(usuarios, key=obtener_nombre_usuario)
        usuarios_json = [_json_safe_valor(u) for u in usuarios_ordenados]

        return jsonify({
            'success': True,
            'usuarios': usuarios_json,
            'count': len(usuarios_json)
        })
    except Exception as e:
        logger.exception("[GTask] Excepción en /api/usuarios: %s", e)
        return jsonify({
            'success': False,
            'error': str(e),
            'usuarios': [],
            'count': 0,
        }), 500


@app.route('/api/usuarios/limpiar-cache', methods=['POST'])
def limpiar_cache_usuarios():
    """Limpia el caché de usuarios de GTask para forzar una nueva carga con nombres actualizados"""
    try:
        gtask_client.limpiar_cache()
        return jsonify({'success': True, 'message': 'Caché de usuarios limpiado'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/calendario', methods=['GET'])
def obtener_calendario():
    """API para obtener el calendario de un usuario en un rango de fechas"""
    try:
        usuario_id = request.args.get('usuario_id')
        fecha_inicio_str = request.args.get('fecha_inicio')
        fecha_fin_str = request.args.get('fecha_fin')
        
        if not usuario_id or not fecha_inicio_str or not fecha_fin_str:
            return jsonify({
                'success': False,
                'error': 'Faltan parámetros requeridos: usuario_id, fecha_inicio, fecha_fin'
            }), 400
        
        fecha_inicio = date.fromisoformat(fecha_inicio_str)
        fecha_fin = date.fromisoformat(fecha_fin_str)
        
        calendario = gestor.obtener_calendario_usuario(usuario_id, fecha_inicio, fecha_fin)
        
        # Convertir a formato JSON
        calendario_json = {}
        for fecha, incidencias in calendario.items():
            calendario_json[fecha.isoformat()] = [
                {
                    'no': inc.no,
                    'descripcion': inc.descripcion,
                    'estado': inc.estado.value,
                    'recurso': inc.recurso,
                    'tipo_incidencia': inc.tipo_incidencia,
                    'subtipo_incidencia': getattr(inc, 'subtipo_incidencia', None),
                    'usuario': inc.usuario
                }
                for inc in incidencias
            ]
        
        return jsonify({
            'success': True,
            'calendario': calendario_json
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/mover-incidencia', methods=['POST'])
def mover_incidencia():
    """API para mover una incidencia (arrastrar)"""
    try:
        data = request.json
        
        no_incidencia = data.get('no')
        nuevo_usuario_id = data.get('nuevo_usuario_id')
        nueva_fecha_str = data.get('nueva_fecha')
        nueva_fecha_hora_str = data.get('nueva_fecha_hora')
        
        if not no_incidencia:
            return jsonify({
                'success': False,
                'error': 'Falta el número de incidencia'
            }), 400
        
        # Buscar la incidencia
        incidencia = gestor.buscar_incidencia_por_no(no_incidencia)
        
        if not incidencia:
            # Si no está en el gestor, obtenerla desde BC
            incidencias = bc_client.obtener_incidencias()
            incidencia = next((inc for inc in incidencias if inc.no == no_incidencia), None)
            
            if not incidencia:
                return jsonify({
                    'success': False,
                    'error': f'Incidencia {no_incidencia} no encontrada'
                }), 404
        
        usuario_anterior = incidencia.usuario
        
        # Preparar parámetros para mover
        nueva_fecha = None
        if nueva_fecha_str:
            nueva_fecha = date.fromisoformat(nueva_fecha_str)
        
        # Actualizar fecha_hora si se proporciona
        if nueva_fecha_hora_str:
            try:
                from datetime import datetime
                # Parsear fecha_hora desde formato ISO
                nueva_fecha_hora = datetime.fromisoformat(nueva_fecha_hora_str.replace('Z', '+00:00'))
                # Si hay zona horaria, convertir a local
                if nueva_fecha_hora.tzinfo:
                    nueva_fecha_hora = nueva_fecha_hora.replace(tzinfo=None)
                incidencia.fecha_hora = nueva_fecha_hora
                # También actualizar la fecha si no se proporcionó explícitamente
                if not nueva_fecha:
                    nueva_fecha = nueva_fecha_hora.date()
            except Exception as e:
                return jsonify({
                    'success': False,
                    'error': f'Error al parsear fecha_hora: {str(e)}'
                }), 400
        
        # Mover la incidencia
        exito = gestor.mover_incidencia(
            incidencia=incidencia,
            nuevo_usuario_id=nuevo_usuario_id,
            nueva_fecha=nueva_fecha,
            sincronizar_bc=True  # Sincronizar con Business Central
        )
        
        if exito:
            if nuevo_usuario_id is not None:
                nuevo = str(nuevo_usuario_id).strip()
                prev = (str(usuario_anterior).strip() if usuario_anterior else "") or ""
                if nuevo and nuevo != prev:
                    notificar_whatsapp_asignacion_incidencia(gtask_client, nuevo, incidencia, bc_client)
            return jsonify({
                'success': True,
                'message': f'Incidencia {no_incidencia} movida correctamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo mover la incidencia'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/buscar-elementos', methods=['GET'])
def buscar_elementos():
    """API para buscar elementos en la base de datos SQL Server"""
    try:
        busqueda = request.args.get('q', '').strip()
        
        if not busqueda:
            return jsonify({
                'success': True,
                'elementos': []
            })
        
        # Configuración de conexión SQL Server
        server = '192.168.10.190'
        database = 'Malla2009'
        username = 'SA'
        password = 'SA1234sa'
        
        # Intentar diferentes drivers ODBC
        drivers_odbc = [
            'ODBC Driver 17 for SQL Server',
            'ODBC Driver 18 for SQL Server',
            'ODBC Driver 13 for SQL Server',
            'SQL Server'
        ]
        
        conn = None
        for driver in drivers_odbc:
            try:
                connection_string = (
                    f'DRIVER={{{driver}}};'
                    f'SERVER={server};'
                    f'DATABASE={database};'
                    f'UID={username};'
                    f'PWD={password};'
                )
                # Agregar TrustServerCertificate solo para drivers 17 y 18
                if '17' in driver or '18' in driver:
                    connection_string += 'TrustServerCertificate=yes;'
                
                conn = pyodbc.connect(connection_string)
                break
            except Exception as e:
                print(f"[INFO] No se pudo conectar con {driver}: {str(e)}")
                continue
        
        if not conn:
            raise Exception('No se pudo conectar a la base de datos SQL Server. Verifique que pyodbc esté instalado y que haya un driver ODBC disponible.')
        
        try:
            cursor = conn.cursor()
            
            # Consulta SQL con filtro LIKE
            query = """
                SELECT TOP 20
                    [Empresa],
                    [No_],
                    [Name],
                    [Tipo]
                FROM [dbo].[ElementosMallorca]
                WHERE [No_] LIKE ? OR [Name] LIKE ?
                ORDER BY [No_]
            """
            
            # Usar % para búsqueda parcial
            busqueda_pattern = f'%{busqueda}%'
            cursor.execute(query, (busqueda_pattern, busqueda_pattern))
            
            elementos = []
            for row in cursor:
                elementos.append({
                    'empresa': row[0] or '',
                    'no': row[1] or '',
                    'name': row[2] or '',
                    'tipo': row[3] or ''
                })
            
            cursor.close()
        finally:
            if conn:
                conn.close()
        
        return jsonify({
            'success': True,
            'elementos': elementos
        })
        
    except Exception as e:
        print(f"[ERROR] Error al buscar elementos: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'elementos': []
        }), 500


@app.route('/api/actualizar-incidencia', methods=['POST'])
def actualizar_incidencia():
    """API para actualizar descripción, fecha/hora y recurso de una incidencia"""
    try:
        data = request.json
        
        id_gtask = data.get('id_gtask')
        nueva_descripcion = data.get('descripcion')
        nueva_fecha_hora = data.get('fecha_hora')
        nuevo_recurso = data.get('recurso')
        nuevo_estado = data.get('state') or data.get('estado')
        nuevo_usuario_id = data.get('usuario_id')  # Usuario asignado (None o '' = sin asignar)
        
        if not id_gtask:
            return jsonify({
                'success': False,
                'error': 'Falta el ID de la incidencia (id_gtask)'
            }), 400
        
        # Buscar la incidencia (primero por id_gtask, si no por No)
        incidencias = bc_client.obtener_incidencias()
        incidencia = next((inc for inc in incidencias if inc.id_gtask == id_gtask), None)
        if not incidencia:
            incidencia = next((inc for inc in incidencias if str(inc.no) == str(id_gtask)), None)
        
        if not incidencia:
            return jsonify({
                'success': False,
                'error': f'Incidencia con ID {id_gtask} no encontrada'
            }), 404
        
        usuario_previo = incidencia.usuario
        
        # Actualizar descripción si se proporciona
        if nueva_descripcion is not None:
            incidencia.descripcion = nueva_descripcion
        
        # Actualizar fecha/hora si se proporciona
        if nueva_fecha_hora:
            try:
                # Parsear fecha/hora desde formato datetime-local (YYYY-MM-DDTHH:mm)
                fecha_hora = datetime.fromisoformat(nueva_fecha_hora)
                incidencia.fecha = fecha_hora.date()
                incidencia.fecha_hora = fecha_hora
            except Exception as e:
                return jsonify({
                    'success': False,
                    'error': f'Error al parsear fecha/hora: {str(e)}'
                }), 400
        
        # Actualizar recurso si se proporciona
        if nuevo_recurso is not None:
            incidencia.recurso = nuevo_recurso
        
        # Actualizar estado si se proporciona (ej. "Cerrada" desde "Cerrar incidencia")
        if nuevo_estado is not None:
            estado_str = str(nuevo_estado).strip()
            if estado_str in ('0', '1', '2'):
                map_num = {'0': EstadoIncidencia.ABIERTA, '1': EstadoIncidencia.EN_PROGRESO, '2': EstadoIncidencia.CERRADA}
                incidencia.estado = map_num[estado_str]
            elif estado_str in ('Abierta', 'EnProgreso', 'Cerrada') or estado_str == 'En Progreso':
                normalizado = 'EnProgreso' if estado_str == 'En Progreso' else estado_str
                incidencia.estado = EstadoIncidencia(normalizado)
        
        # Actualizar usuario asignado si se proporciona (desde el modal de edición)
        if nuevo_usuario_id is not None:
            incidencia.usuario = (nuevo_usuario_id and str(nuevo_usuario_id).strip()) or None
        
        # Actualizar en Business Central
        exito, error_msg = bc_client.actualizar_incidencia(incidencia)
        
        if exito:
            if nuevo_usuario_id is not None:
                nuevo = (nuevo_usuario_id and str(nuevo_usuario_id).strip()) or None
                prev = (str(usuario_previo).strip() if usuario_previo else None) or None
                if nuevo and nuevo != prev:
                    notificar_whatsapp_asignacion_incidencia(gtask_client, nuevo, incidencia, bc_client)
            return jsonify({
                'success': True,
                'message': f'Incidencia {incidencia.no} actualizada correctamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': error_msg or 'No se pudo actualizar la incidencia en Business Central'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/asignar-incidencia', methods=['POST'])
def asignar_incidencia():
    """API para asignar una incidencia a un usuario"""
    try:
        data = request.json
        
        no_incidencia = data.get('no')
        usuario_id = data.get('usuario_id')
        
        if not no_incidencia or not usuario_id:
            return jsonify({
                'success': False,
                'error': 'Faltan parámetros: no, usuario_id'
            }), 400
        
        # Buscar la incidencia
        incidencia = gestor.buscar_incidencia_por_no(no_incidencia)
        
        if not incidencia:
            # Si no está en el gestor, obtenerla desde BC
            incidencias = bc_client.obtener_incidencias()
            incidencia = next((inc for inc in incidencias if inc.no == no_incidencia), None)
            
            if not incidencia:
                return jsonify({
                    'success': False,
                    'error': f'Incidencia {no_incidencia} no encontrada'
                }), 404
        
        usuario_anterior = incidencia.usuario
        
        # Asignar la incidencia
        exito = gestor.asignar_incidencia(incidencia, usuario_id)
        
        if exito:
            # Sincronizar con BC
            if bc_client:
                exito_bc, error_bc = bc_client.actualizar_incidencia(incidencia)
                if not exito_bc:
                    return jsonify({
                        'success': False,
                        'error': error_bc or 'No se pudo sincronizar la asignación con Business Central'
                    }), 500
            
            uid = str(usuario_id).strip()
            prev = (str(usuario_anterior).strip() if usuario_anterior else None) or None
            if uid and uid != prev:
                notificar_whatsapp_asignacion_incidencia(gtask_client, uid, incidencia, bc_client)
            return jsonify({
                'success': True,
                'message': f'Incidencia {no_incidencia} asignada correctamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo asignar la incidencia'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/diagnostico/whatsapp-bc', methods=['GET'])
def diagnostico_whatsapp_bc():
    """
    Solo lectura: comprueba si están configurados Apiwhats, notificación a BC y URL OData postRespuestaWhatsApp.
    Abre en el navegador /api/diagnostico/whatsapp-bc para depurar por qué no llegan registros a BC.
    """
    try:
        from config import (
            API_WHATS_URL,
            WHATSAPP_NOTIFICAR_BC,
            WHATSAPP_NOTIFICAR_ASIGNACION,
            get_bc_post_respuesta_whatsapp_url,
            BC_CONFIG,
        )

        return jsonify(
            {
                "success": True,
                "api_whatsapp_url_configurada": bool((API_WHATS_URL or "").strip()),
                "notificar_whatsapp_habilitado": WHATSAPP_NOTIFICAR_ASIGNACION,
                "notificar_business_central_tras_whatsapp": WHATSAPP_NOTIFICAR_BC,
                "bc_url_post_respuesta_whatsapp": get_bc_post_respuesta_whatsapp_url(),
                "bc_empresa_company_param": BC_CONFIG.get("company"),
                "bc_autenticacion": (
                    "bearer_api_key"
                    if (BUSINESS_CENTRAL_API_KEY or "").strip()
                    else "basic_usuario_password"
                ),
            }
        )
    except Exception as e:
        logger.exception("diagnostico whatsapp-bc")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/detalle-incidencia/<id_gtask>', methods=['GET'])
def obtener_detalle_incidencia(id_gtask):
    """API para obtener el detalle completo de una incidencia desde Business Central"""
    try:
        detalle = bc_client.obtener_detalle_incidencia(id_gtask)
        
        if detalle:
            return jsonify({
                'success': True,
                'detalle': detalle
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo obtener el detalle de la incidencia'
            }), 404
            
    except Exception as e:
        print(f"[ERROR] Error al obtener detalle de incidencia: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/incidencia/notificar-whatsapp-taller', methods=['POST'])
def incidencia_notificar_whatsapp_taller():
    """
    Envía por WhatsApp el aviso de la incidencia a todos los usuarios GTask del departamento Taller
    que tengan teléfono (campo phone). Misma integración BC que otros envíos (postRespuestaWhatsApp).
    """
    try:
        data = request.get_json() or {}
        id_gtask = data.get("id_gtask") or data.get("id")
        if not id_gtask:
            return jsonify({"success": False, "error": "Falta id_gtask"}), 400
        id_gtask = str(id_gtask).strip()
        detalle = bc_client.obtener_detalle_incidencia(id_gtask)
        if not detalle:
            return jsonify(
                {
                    "success": False,
                    "error": "No se pudo obtener el detalle de la incidencia en Business Central",
                }
            ), 404
        no_cliente = data.get("no")
        if no_cliente is not None and str(no_cliente).strip():
            detalle = dict(detalle)
            detalle["No"] = str(no_cliente).strip()
        from apiwhats_client import (
            enriquecer_detalle_con_no_lista_bc,
            notificar_whatsapp_taller_incidencia,
        )

        detalle = enriquecer_detalle_con_no_lista_bc(bc_client, id_gtask, detalle)
        resultado = notificar_whatsapp_taller_incidencia(
            gtask_client, bc_client, id_gtask, detalle
        )
        code = 200 if resultado.get("success") else 422
        return jsonify(resultado), code
    except Exception as e:
        logger.exception("notificar-whatsapp-taller: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/asignacion-automatica', methods=['POST'])
def ejecutar_asignacion_automatica():
    """API para ejecutar asignación automática de incidencias usando LLM"""
    try:
        data = request.json or {}
        
        # Obtener parámetros opcionales
        usuarios_filtrados = data.get('usuarios_filtrados')  # Lista de IDs de usuarios
        aplicar_cambios = data.get('aplicar_cambios', False)  # Si True, aplica cambios en BC
        solo_sin_asignar = data.get('solo_sin_asignar', True)  # Si True, solo asigna incidencias sin asignar
        reasignar = data.get('reasignar', False)  # Si True, reasigna todas las incidencias
        fecha_inicio_str = data.get('fecha_inicio')  # Fecha inicio del rango
        fecha_fin_str = data.get('fecha_fin')  # Fecha fin del rango
        
        # Obtener todas las incidencias (mismo filtro de estado que listado)
        filtros = {}
        estados = request.args.getlist('estado')
        if estados:
            filtros['estado'] = estados
        else:
            filtros['estado'] = ['Abierta', 'EnProgreso']
        if request.args.get('recurso'):
            filtros['recurso'] = request.args.get('recurso')
        
        incidencias = bc_client.obtener_incidencias(filtros=filtros)
        
        if not incidencias:
            return jsonify({
                'success': False,
                'error': 'No se encontraron incidencias'
            }), 404
        
        # Filtrar por rango de fechas si se proporciona
        if fecha_inicio_str and fecha_fin_str:
            try:
                fecha_inicio = date.fromisoformat(fecha_inicio_str)
                fecha_fin = date.fromisoformat(fecha_fin_str)
                
                # Filtrar incidencias que estén en el rango de fechas
                incidencias_filtradas = []
                for incidencia in incidencias:
                    # Si la incidencia tiene fecha, verificar si está en el rango
                    if incidencia.fecha:
                        if fecha_inicio <= incidencia.fecha <= fecha_fin:
                            incidencias_filtradas.append(incidencia)
                    # Si no tiene fecha pero está en el rango solicitado, incluirla
                    elif not incidencia.fecha:
                        incidencias_filtradas.append(incidencia)
                
                incidencias = incidencias_filtradas
                print(f"[INFO] Filtradas {len(incidencias)} incidencias en rango {fecha_inicio_str} a {fecha_fin_str}")
            except ValueError as e:
                return jsonify({
                    'success': False,
                    'error': f'Error al parsear fechas: {str(e)}'
                }), 400
        
        if not incidencias:
            return jsonify({
                'success': False,
                'error': 'No se encontraron incidencias en el rango de fechas especificado'
            }), 404
        
        # Parsear fechas si se proporcionan
        fecha_inicio = None
        fecha_fin = None
        if fecha_inicio_str and fecha_fin_str:
            try:
                fecha_inicio = date.fromisoformat(fecha_inicio_str)
                fecha_fin = date.fromisoformat(fecha_fin_str)
            except ValueError:
                pass  # Si hay error, usar None
        
        # Ejecutar asignación automática
        resultado = asignador_automatico.asignar_automaticamente(
            incidencias=incidencias,
            usuarios_filtrados=usuarios_filtrados,
            aplicar_cambios=aplicar_cambios,
            solo_sin_asignar=solo_sin_asignar,
            reasignar=reasignar,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin
        )
        
        if resultado['success']:
            return jsonify({
                'success': True,
                'asignaciones_propuestas': resultado.get('asignaciones_propuestas', []),
                'asignaciones_aplicadas': resultado.get('asignaciones_aplicadas', []),
                'errores': resultado.get('errores', []),
                'message': f'Asignación automática completada. {len(resultado.get("asignaciones_propuestas", []))} asignaciones propuestas.'
            })
        else:
            return jsonify({
                'success': False,
                'error': resultado.get('error', 'Error desconocido'),
                'traceback': resultado.get('traceback')
            }), 500
            
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[ERROR] Error al ejecutar asignacion automatica: {str(e)}")
        print(f"📋 Traceback:\n{error_trace}")
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': error_trace
        }), 500


if __name__ == '__main__':
    print("=" * 60)
    print("GMalla - Aplicación Web")
    print("=" * 60)
    print(f"Business Central: {BUSINESS_CENTRAL_BASE_URL}")
    print(f"GTask API: {GTASK_API_URL}")
    print(f"LLM Local: {LLM_BASE_URL}")
    print("\n[WEB] Iniciando servidor web...")
    print("[NAVEGADOR] Abre tu navegador en: http://localhost:5020")
    print("[API] Asignacion automatica disponible en: POST /api/asignacion-automatica")
    print("=" * 60)
    
    app.run(debug=True, host='127.0.0.1', port=5020)

