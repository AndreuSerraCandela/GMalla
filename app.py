"""
Aplicación web Flask para GMalla - Gestión de Calendario de Asignación de Incidencias
"""
import sys
from pathlib import Path
from flask import Flask, render_template, jsonify, request
from datetime import date, datetime, timedelta

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
    LLM_BASE_URL
)

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


@app.route('/api/incidencias', methods=['GET'])
def obtener_incidencias():
    """API para obtener todas las incidencias"""
    try:
        filtros = {}
        
        # Filtros opcionales desde query parameters
        if request.args.get('estado'):
            filtros['estado'] = request.args.get('estado')
        if request.args.get('recurso'):
            filtros['recurso'] = request.args.get('recurso')
        
        incidencias = bc_client.obtener_incidencias(filtros=filtros if filtros else None)
        
        # Convertir incidencias a formato JSON
        incidencias_json = []
        for inc in incidencias:
            incidencias_json.append({
                'no': inc.no,
                'descripcion': inc.descripcion,
                'fecha': inc.fecha.isoformat() if inc.fecha else None,
                'estado': inc.estado.value,
                'recurso': inc.recurso,
                'tipo_incidencia': inc.tipo_incidencia,
                'usuario': inc.usuario,
                'fecha_hora': inc.fecha_hora.isoformat() if inc.fecha_hora else None,
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


@app.route('/api/usuarios', methods=['GET'])
def obtener_usuarios():
    """API para obtener lista de usuarios (ordenados por nombre)"""
    try:
        resultado = gtask_client.obtener_usuarios()
        
        if resultado['success']:
            # Asegurar que estén ordenados por nombre (por si acaso)
            usuarios = resultado['users']
            def obtener_nombre_usuario(user):
                """Obtiene el nombre del usuario para ordenación"""
                return (user.get('name') or user.get('username') or user.get('nombre') or '').lower()
            
            usuarios_ordenados = sorted(usuarios, key=obtener_nombre_usuario)
            
            return jsonify({
                'success': True,
                'usuarios': usuarios_ordenados,
                'count': len(usuarios_ordenados)
            })
        else:
            return jsonify({
                'success': False,
                'error': resultado.get('error', 'Error desconocido')
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


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
        
        # Preparar parámetros para mover
        nueva_fecha = None
        if nueva_fecha_str:
            nueva_fecha = date.fromisoformat(nueva_fecha_str)
        
        # Mover la incidencia
        exito = gestor.mover_incidencia(
            incidencia=incidencia,
            nuevo_usuario_id=nuevo_usuario_id,
            nueva_fecha=nueva_fecha,
            sincronizar_bc=True  # Sincronizar con Business Central
        )
        
        if exito:
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


@app.route('/api/actualizar-incidencia', methods=['POST'])
def actualizar_incidencia():
    """API para actualizar descripción y fecha/hora de una incidencia"""
    try:
        data = request.json
        
        id_gtask = data.get('id_gtask')
        nueva_descripcion = data.get('descripcion')
        nueva_fecha_hora = data.get('fecha_hora')
        
        if not id_gtask:
            return jsonify({
                'success': False,
                'error': 'Falta el ID de la incidencia (id_gtask)'
            }), 400
        
        # Buscar la incidencia
        incidencias = bc_client.obtener_incidencias()
        incidencia = next((inc for inc in incidencias if inc.id_gtask == id_gtask), None)
        
        if not incidencia:
            return jsonify({
                'success': False,
                'error': f'Incidencia con ID {id_gtask} no encontrada'
            }), 404
        
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
        
        # Actualizar en Business Central
        exito = bc_client.actualizar_incidencia(incidencia)
        
        if exito:
            return jsonify({
                'success': True,
                'message': f'Incidencia {incidencia.no} actualizada correctamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo actualizar la incidencia en Business Central'
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
        
        # Asignar la incidencia
        exito = gestor.asignar_incidencia(incidencia, usuario_id)
        
        if exito:
            # Sincronizar con BC
            if bc_client:
                bc_client.actualizar_incidencia(incidencia)
            
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
        print(f"❌ Error al obtener detalle de incidencia: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


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
        
        # Obtener todas las incidencias
        filtros = {}
        if request.args.get('estado'):
            filtros['estado'] = request.args.get('estado')
        if request.args.get('recurso'):
            filtros['recurso'] = request.args.get('recurso')
        
        incidencias = bc_client.obtener_incidencias(filtros=filtros if filtros else None)
        
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
                print(f"📅 Filtradas {len(incidencias)} incidencias en rango {fecha_inicio_str} a {fecha_fin_str}")
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
        print(f"❌ Error al ejecutar asignación automática: {str(e)}")
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
    print("\n🌐 Iniciando servidor web...")
    print("📱 Abre tu navegador en: http://localhost:5020")
    print("🤖 Asignación automática disponible en: POST /api/asignacion-automatica")
    print("=" * 60)
    
    app.run(debug=True, host='127.0.0.1', port=5020)

