"""
Cliente para interactuar con Business Central
Los métodos específicos para recuperar y guardar incidencias se implementarán aquí
"""
import json
import logging
import requests
from datetime import datetime
from typing import List, Optional, Dict, Any

_bc_log = logging.getLogger(__name__)

# Importar modelo de incidencia con fallback
try:
    from ..models.incidencia import Incidencia
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from models.incidencia import Incidencia

# Importar config desde la raíz del proyecto (usando importación relativa)
try:
    from ...config import (
        get_bc_incidences_url,
        get_bc_detalle_incidences_url,
        get_bc_lista_incidencias_url,
        get_bc_post_respuesta_whatsapp_url,
        get_bc_auth_header,
        get_bc_auth_credentials,
        BC_CONFIG,
    )
except ImportError:
    # Fallback: importación absoluta si la relativa falla
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from config import (
        get_bc_incidences_url,
        get_bc_detalle_incidences_url,
        get_bc_lista_incidencias_url,
        get_bc_post_respuesta_whatsapp_url,
        get_bc_auth_header,
        get_bc_auth_credentials,
        BC_CONFIG,
    )


class BusinessCentralClient:
    """Cliente para interactuar con Business Central"""
    
    def __init__(self, base_url: str = "", api_key: str = ""):
        """
        Inicializa el cliente de Business Central
        
        Args:
            base_url: URL base de la API de Business Central
            api_key: Clave de API para autenticación
        """
        self.base_url = base_url
        self.api_key = api_key
    
    def obtener_incidencias(self, filtros: Optional[dict] = None) -> List[Incidencia]:
        """
        Recupera las incidencias de Business Central desde el endpoint OData
        
        Args:
            filtros: Diccionario con filtros opcionales (fecha, estado, usuario, etc.)
                    Los filtros se aplican como parámetros OData $filter
        
        Returns:
            Lista de incidencias
        """
        try:
            # URL del endpoint OData para listar incidencias
            url = get_bc_lista_incidencias_url()
            
            # Construir parámetros OData si hay filtros
            params = {}
            if filtros:
                filter_parts = []
                
                # Filtro por estado (varios valores: Abierta, EnProgreso, Cerrada)
                if 'estado' in filtros:
                    est = filtros['estado']
                    if isinstance(est, (list, tuple)):
                        if est:
                            filter_parts.append("(" + " or ".join(f"Estado eq '{e}'" for e in est) + ")")
                    else:
                        filter_parts.append(f"Estado eq '{est}'")
                
                # Filtro por recurso
                if 'recurso' in filtros:
                    recurso = filtros['recurso']
                    filter_parts.append(f"Recurso eq '{recurso}'")
                
                # Filtro por tipo de incidencia
                if 'tipo_incidencia' in filtros:
                    tipo = filtros['tipo_incidencia']
                    filter_parts.append(f"Tipo_Incidencia eq '{tipo}'")
                
                # Filtro por fecha (si se proporciona)
                if 'fecha' in filtros:
                    fecha = filtros['fecha']
                    if isinstance(fecha, str):
                        filter_parts.append(f"Fecha_Hora ge {fecha}")
                    # Puedes agregar más lógica de filtrado por fecha si es necesario

                # Una fila concreta por id GTask (evita depender solo de la 1.ª página OData)
                if filtros.get('id_gtask'):
                    gid = str(filtros['id_gtask']).strip().replace("'", "''")
                    if gid:
                        filter_parts.append(f"Id_Gtask eq '{gid}'")
                
                if filter_parts:
                    params['$filter'] = ' and '.join(filter_parts)
            
            # Headers con autenticación BC
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
            
            # Agregar autenticación: priorizar API Key, sino usar autenticación básica
            auth_header = get_bc_auth_header()
            if auth_header:
                headers["Authorization"] = auth_header
                auth_credentials = None
            else:
                # Usar autenticación básica HTTP (username/password)
                auth_credentials = get_bc_auth_credentials()
            
            # Obtener timeout de la configuración
            timeout = BC_CONFIG.get('timeout', 120)
            
            print("=== Obteniendo incidencias desde Business Central ===")
            print(f"URL: {url}")
            if params:
                print(f"Filtros: {params}")
            print("=====================================================")
            
            # Realizar la petición GET a BC
            response = requests.get(
                url,
                params=params,
                headers=headers,
                auth=auth_credentials,  # Autenticación básica si no hay API Key
                timeout=timeout
            )
            
            # Verificar si la petición fue exitosa
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # OData devuelve los datos en el campo "value"
                    incidencias_data = data.get('value', [])
                    
                    # Convertir cada incidencia del formato OData al modelo Incidencia
                    incidencias = []
                    for inc_data in incidencias_data:
                        # Extraer fecha de Fecha_Hora si está disponible
                        fecha = None
                        fecha_hora_str = inc_data.get("Fecha_Hora")
                        if fecha_hora_str and fecha_hora_str != "0001-01-01T00:00:00Z":
                            try:
                                # Parsear la fecha-hora manteniendo la fecha original sin conversión de zona horaria
                                # Si termina en Z, es UTC, pero queremos usar la fecha tal cual está
                                if fecha_hora_str.endswith('Z'):
                                    # Extraer solo la parte de fecha sin convertir zona horaria
                                    fecha_str = fecha_hora_str.split('T')[0]
                                    fecha = datetime.fromisoformat(fecha_str).date()
                                else:
                                    fecha_hora = datetime.fromisoformat(fecha_hora_str.replace('Z', '+00:00'))
                                    fecha = fecha_hora.date()
                            except Exception as e:
                                print(f"⚠️ Error al parsear fecha {fecha_hora_str}: {str(e)}")
                                pass
                        
                        # Mapear campos de OData al modelo
                        # Usuario creador: Id_Uduario_Gtask (nombre en BC: Usuario)
                        # Usuario asignado: Id_Uduario_Gtask_Asignado (nombre en BC: Usuario Asignado)
                        id_creador = inc_data.get("Id_Uduario_Gtask") or inc_data.get("Id_Usuario_Gtask")
                        if id_creador and not str(id_creador).strip():
                            id_creador = None
                        id_asignado = inc_data.get("Id_Uduario_Gtask_Asignado") or inc_data.get("Id_Usuario_Gtask_Asignado")
                        if id_asignado and not str(id_asignado).strip():
                            id_asignado = None
                        id_tarea_gtask = inc_data.get("ID_Tarea_Gtask", "")
                        if id_tarea_gtask == "":
                            id_asignado = None  # Sin usuario asignado si no hay tarea GTask
                        incidencia_dict = {
                            "No.": inc_data.get("No", ""),
                            "Descripción": inc_data.get("Descripción", ""),
                            "Recurso": inc_data.get("Recurso", ""),
                            "Tipo Incidencia": inc_data.get("Tipo_Incidencia"),
                            "Subtipo Incidencia": inc_data.get("SubTipo_Incidencia"),
                            "Estado": inc_data.get("Estado", "Abierta"),
                            "FechaHora": fecha_hora_str,
                            "Fecha": fecha.isoformat() if fecha else None,
                            "Usuario": id_asignado,  # Id_Uduario_Gtask_Asignado - usuario asignado
                            "UsuarioCreador": id_creador,  # Id_Uduario_Gtask - usuario creador
                            "Id_Gtask": inc_data.get("Id_Gtask", ""),
                            "ID_Tarea_Gtask": inc_data.get("ID_Tarea_Gtask", ""),
                            "URL_Primera_Imagen": inc_data.get("URL_Primera_Imagen", ""),
                            "Comunicado_por_EMT": inc_data.get("Comunicado_por_EMT")
                        }
                        
                        # Crear objeto Incidencia desde el diccionario
                        incidencia = Incidencia.from_dict(incidencia_dict)
                        incidencias.append(incidencia)
                    
                    print(f"✅ {len(incidencias)} incidencias obtenidas desde BC")
                    return incidencias
                    
                except json.JSONDecodeError as e:
                    error_msg = f'Error al decodificar respuesta JSON: {str(e)}'
                    print(f"❌ {error_msg}")
                    print(f"❌ Respuesta: {response.text[:500]}")
                    return []
                except Exception as e:
                    import traceback
                    error_trace = traceback.format_exc()
                    error_msg = f'Error al procesar incidencias: {str(e)}'
                    print(f"❌ {error_msg}")
                    print(f"📋 Traceback:\n{error_trace}")
                    return []
            else:
                print(f"❌ Error al obtener incidencias de BC. Código: {response.status_code}")
                print(f"❌ Respuesta completa: {response.text}")
                print(f"❌ URL que falló: {url}")
                return []
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con Business Central: {str(e)}'
            print("=" * 50)
            print("❌❌❌ ERROR DE CONEXIÓN CON BC ❌❌❌")
            print(f"❌ Error: {error_msg}")
            print("=" * 50)
            return []
            
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al obtener incidencias: {str(e)}'
            print("=" * 50)
            print("❌❌❌ ERROR INTERNO EN obtener_incidencias() ❌❌❌")
            print(f"❌ Error: {error_msg}")
            print(f"📋 Traceback completo:\n{error_trace}")
            print("=" * 50)
            return []
    
    def actualizar_incidencia(self, incidencia: Incidencia) -> tuple:
        """
        Actualiza una incidencia existente en Business Central.
        Se envían fecha, estado, recurso, descripción, user (creador, no se cambia) y user_assigned (usuario asignado).
        
        Si el API devuelve HTTP 200 pero el JSON contiene la clave "error",
        se considera fallo y no se guardan los cambios.
        
        Args:
            incidencia: Objeto Incidencia con los datos actualizados (usuario_creador = Id_Uduario_Gtask, usuario = Id_Uduario_Gtask_Asignado)
        
        Returns:
            (True, None) si se actualizó correctamente,
            (False, mensaje_error) en caso contrario (mensaje del API si viene en el JSON)
        """
        try:
            # Validar campos mínimos requeridos
            # Si no hay Id_Gtask, usar No como fallback
            id_gtask = incidencia.id_gtask or incidencia.no
            if not id_gtask:
                print("❌ Error: La incidencia debe tener un Id_Gtask o No")
                return (False, "La incidencia debe tener un Id_Gtask o No")
            
            # URL del endpoint de incidencias en Business Central
            url = get_bc_incidences_url()
            
            # Mapear estado de la incidencia al formato esperado por BC
            estado_bc = "PENDING"  # Valor por defecto
            if incidencia.estado:
                estado_map = {
                    "Abierta": "PENDING",
                    "EnProgreso": "IN_PROGRESS",
                    "Cerrada": "CLOSED"
                }
                estado_bc = estado_map.get(incidencia.estado.value, "PENDING")
            
            # Formatear fecha para BC (formato ISO si existe)
            fecha_str = incidencia.fecha.isoformat() if incidencia.fecha else None
            # Si hay fecha_hora, usarla; si no, si hay fecha, convertirla a datetime; si no, None
            if incidencia.fecha_hora:
                fecha_hora_str = incidencia.fecha_hora.isoformat()
                # Eliminar zona horaria si existe para enviar sin 'Z'
                if '+' in fecha_hora_str:
                    fecha_hora_str = fecha_hora_str.split('+')[0]
                elif fecha_hora_str.endswith('Z'):
                    fecha_hora_str = fecha_hora_str[:-1]
                elif fecha_hora_str.count('-') > 2:
                    # Formato: YYYY-MM-DDTHH:MM:SS-HH:MM, eliminar la parte de zona horaria
                    partes = fecha_hora_str.rsplit('-', 1)
                    if len(partes) == 2 and ':' in partes[1]:
                        fecha_hora_str = partes[0]
            elif incidencia.fecha:
                # Convertir date a datetime para tener formato completo
                from datetime import time
                fecha_hora_str = datetime.combine(incidencia.fecha, time.min).isoformat()
            else:
                fecha_hora_str = None
            
            # Limpiar HTML de la descripción para que sea legible en BC
            descripcion_limpia = incidencia.descripcion or ""
            if descripcion_limpia:
                import re
                # Remover etiquetas HTML
                descripcion_limpia = re.sub(r'<[^>]+>', '', descripcion_limpia)
                # Reemplazar entidades HTML comunes
                descripcion_limpia = descripcion_limpia.replace('&nbsp;', ' ')
                descripcion_limpia = descripcion_limpia.replace('&lt;', '<')
                descripcion_limpia = descripcion_limpia.replace('&gt;', '>')
                descripcion_limpia = descripcion_limpia.replace('&amp;', '&')
                # Limpiar espacios múltiples y saltos de línea
                descripcion_limpia = re.sub(r'\s+', ' ', descripcion_limpia)
                descripcion_limpia = descripcion_limpia.strip()
            
            # Crear la estructura de datos para BC (simplificada, sin documentos)
            # Business Central espera Id_Gtask en _id, no el No
            # Si no hay Id_Gtask, usar No como fallback
            id_gtask = incidencia.id_gtask or incidencia.no
            
            # user = usuario creador (Id_Uduario_Gtask), no se cambia al actualizar
            # user_assigned = usuario asignado (Id_Uduario_Gtask_Asignado), es el que se asigna al guardar
            bc_incidence_data = {
                "_id": id_gtask,
                "state": estado_bc,
                "incidenceType": incidencia.tipo_incidencia or "",
                "observation": "",
                "description": descripcion_limpia,
                "resource": incidencia.recurso or "",
                "user": incidencia.usuario_creador or "",  # Creador (Id_Uduario_Gtask), no se modifica
                "user_assigned": incidencia.usuario or "",  # Usuario asignado (Id_Uduario_Gtask_Asignado)
                "fechahora": fecha_hora_str,
                "image": [],
                "audio": []
            }
            
            # Envolver en el formato que espera BC
            json_text = json.dumps(bc_incidence_data, ensure_ascii=False)
            datos = {
                "jsonText": json_text
            }
            
            # Parámetros para la petición
            params = {"company": BC_CONFIG['company']}
            
            # Headers con autenticación BC
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Agregar autenticación: priorizar API Key, sino usar autenticación básica
            auth_header = get_bc_auth_header()
            if auth_header:
                headers["Authorization"] = auth_header
                auth_credentials = None
            else:
                # Usar autenticación básica HTTP (username/password)
                auth_credentials = get_bc_auth_credentials()
            
            # Obtener timeout de la configuración
            timeout = BC_CONFIG.get('timeout', 120)
            
            print("=== Enviando actualización de incidencia a Business Central ===")
            print(f"URL: {url}")
            print(f"Params: {params}")
            print(f"Incidencia No.: {incidencia.no}")
            print(f"Id_Gtask: {incidencia.id_gtask}")
            print(f"Recurso: {incidencia.recurso}")
            print(f"Fecha: {fecha_str}")
            print(f"Timeout: {timeout}s")
            print("==============================================================")
            
            # Realizar la petición POST a BC
            response = requests.post(
                url,
                params=params,
                headers=headers,
                data=json.dumps(datos),
                auth=auth_credentials,  # Autenticación básica si no hay API Key
                timeout=timeout
            )
            
            # Verificar si la petición fue exitosa (código 2xx)
            if response.status_code in (200, 201, 204):
                # Si el API devuelve 200 pero el JSON contiene "error", no considerar éxito
                try:
                    data = response.json()
                    if isinstance(data, dict) and data.get("error"):
                        error_msg = data.get("error", "Error desconocido")
                        print(f"❌ API devolvió 200 pero con error en el cuerpo: {error_msg}")
                        print(f"❌ Respuesta: {response.text}")
                        return (False, str(error_msg))
                except (ValueError, TypeError):
                    pass  # No es JSON o no tiene la estructura esperada
                print(f"✅ Incidencia actualizada correctamente en BC: {response.text}")
                return (True, None)
            else:
                error_msg = None
                try:
                    data = response.json()
                    if isinstance(data, dict) and data.get("error"):
                        error_msg = data.get("error")
                except (ValueError, TypeError):
                    pass
                print(f"❌ Error al actualizar incidencia en BC. Código: {response.status_code}")
                print(f"❌ Respuesta completa: {response.text}")
                print(f"❌ URL que falló: {url}")
                return (False, error_msg or f"Error del servidor: {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con Business Central: {str(e)}'
            print("=" * 50)
            print("❌❌❌ ERROR DE CONEXIÓN CON BC ❌❌❌")
            print(f"❌ Error: {error_msg}")
            print("=" * 50)
            return (False, error_msg)
            
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al actualizar incidencia en Business Central: {str(e)}'
            print("=" * 50)
            print("❌❌❌ ERROR INTERNO EN actualizar_incidencia() ❌❌❌")
            print(f"❌ Error: {error_msg}")
            print(f"📋 Traceback completo:\n{error_trace}")
            print("=" * 50)
            return (False, error_msg)
    
    def obtener_detalle_incidencia(self, id_gtask: str) -> Optional[Dict[str, Any]]:
        """
        Obtiene el detalle completo de una incidencia desde Business Central.
        Usa el procedimiento DetalleIncidencia de la misma codeunit.
        
        Args:
            id_gtask: ID de GTask de la incidencia
            
        Returns:
            Diccionario con el detalle de la incidencia o None si hay error
        """
        try:
            # URL del endpoint de incidencias en Business Central (misma codeunit)
            url = get_bc_detalle_incidences_url()
            
            # El procedimiento DetalleIncidencia espera un parámetro IdIncidencia
            # Enviamos el Id_Gtask como parámetro
            datos = {
                "jsonText": json.dumps({
                    "IdIncidencia": id_gtask
                }, ensure_ascii=False)
            }
            
            # Parámetros para la petición
            params = {
                "company": BC_CONFIG['company'],
                "procedure": "DetalleIncidencia"  # Especificar el procedimiento
            }
            
            # Headers con autenticación BC
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Agregar autenticación: priorizar API Key, sino usar autenticación básica
            auth_header = get_bc_auth_header()
            if auth_header:
                headers["Authorization"] = auth_header
                auth_credentials = None
            else:
                # Usar autenticación básica HTTP (username/password)
                auth_credentials = get_bc_auth_credentials()
            
            # Obtener timeout de la configuración
            timeout = BC_CONFIG.get('timeout', 120)
            
            print(f"=== Obteniendo detalle de incidencia desde Business Central ===")
            print(f"URL: {url}")
            print(f"Id_Gtask: {id_gtask}")
            print(f"Timeout: {timeout}s")
            print("==============================================================")
            
            # Realizar la petición POST a BC
            response = requests.post(
                url,
                params=params,
                headers=headers,
                data=json.dumps(datos),
                auth=auth_credentials,  # Autenticación básica si no hay API Key
                timeout=timeout
            )
            
            # Verificar si la petición fue exitosa
            if response.status_code in (200, 201):
                try:
                    respuesta = response.json()
                    # Si el JSON contiene "error", no considerar éxito
                    if isinstance(respuesta, dict) and respuesta.get("error"):
                        error_msg = respuesta.get("error", "Error desconocido")
                        print(f"❌ API devolvió 200 pero con error en el cuerpo: {error_msg}")
                        return None

                    # El procedimiento devuelve un objeto OData con @odata.context y value
                    # donde value es una cadena JSON que contiene el detalle real
                    # Extraer el campo 'value' que contiene el JSON como cadena
                    if 'value' in respuesta:
                        # Parsear la cadena JSON dentro de 'value'
                        # Limpiar caracteres \r\n que pueden estar en la cadena
                        detalle_str = respuesta['value'].replace('\r\n', ' ').replace('\n', ' ').strip()
                        detalle = json.loads(detalle_str)
                        print(f"✅ Detalle de incidencia obtenido correctamente")
                        print(f"📋 Detalle parseado: {detalle}")
                        return detalle
                    else:
                        # Si no hay 'value', intentar usar la respuesta directamente
                        print(f"⚠️ No se encontró campo 'value' en la respuesta")
                        print(f"Respuesta completa: {respuesta}")
                        return respuesta
                        
                except json.JSONDecodeError as e:
                    # Si no es JSON, intentar parsear como texto JSON
                    try:
                        respuesta = json.loads(response.text)
                        if 'value' in respuesta:
                            # Limpiar caracteres \r\n que pueden estar en la cadena
                            detalle_str = respuesta['value'].replace('\r\n', ' ').replace('\n', ' ').strip()
                            detalle = json.loads(detalle_str)
                            print(f"✅ Detalle de incidencia obtenido correctamente")
                            return detalle
                        else:
                            print(f"⚠️ No se encontró campo 'value' en la respuesta")
                            return respuesta
                    except Exception as e2:
                        print(f"⚠️ Error al parsear respuesta: {str(e2)}")
                        print(f"⚠️ Respuesta completa: {response.text}")
                        return None
            else:
                print(f"❌ Error al obtener detalle de incidencia. Código: {response.status_code}")
                print(f"❌ Respuesta: {response.text}")
                return None
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con Business Central: {str(e)}'
            print(f"❌ Error de conexión: {error_msg}")
            return None
            
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al obtener detalle de incidencia: {str(e)}'
            print(f"❌ Error interno: {error_msg}")
            print(f"📋 Traceback:\n{error_trace}")
            return None

    def notificar_respuesta_whatsapp(self, inner: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        POST al servicio OData postRespuestaWhatsApp (jsonText), mismo patrón que Apiwhats → BC.
        inner suele incluir: id_mensaje, telefono, texto; GMalla añade id_registro e id_tabla.
        """
        try:
            if not inner.get("id_mensaje"):
                return False, "Falta id_mensaje"
            url = get_bc_post_respuesta_whatsapp_url()
            _bc_log.info(
                "postRespuestaWhatsApp POST %s Nº=%s wamid=%s…",
                url,
                inner.get("id_registro"),
                str(inner.get("id_mensaje", ""))[:32],
            )
            print(
                f"[BC postRespuestaWhatsApp] POST {url} | id_registro={inner.get('id_registro')} | "
                f"wamid={str(inner.get('id_mensaje', ''))[:40]}…"
            )
            json_text = json.dumps(inner, ensure_ascii=False)
            datos = {"jsonText": json_text}
            params = {"company": BC_CONFIG["company"]}
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            auth_header = get_bc_auth_header()
            if auth_header:
                headers["Authorization"] = auth_header
                auth_credentials = None
            else:
                auth_credentials = get_bc_auth_credentials()
            timeout = BC_CONFIG.get("timeout", 120)
            response = requests.post(
                url,
                params=params,
                headers=headers,
                data=json.dumps(datos),
                auth=auth_credentials,
                timeout=timeout,
            )
            raw = response.text or ""
            if response.status_code >= 400:
                print(
                    f"❌ BC postRespuestaWhatsApp HTTP {response.status_code}: {raw[:1200]}"
                )
                return False, raw[:2000]
            try:
                data = response.json()
                if isinstance(data, dict) and data.get("error"):
                    err = str(data.get("error"))
                    print(f"❌ BC postRespuestaWhatsApp error en JSON: {err}")
                    return False, err
                if isinstance(data, dict) and data.get("value") is not None:
                    val = data["value"]
                    if isinstance(val, str):
                        inner_resp = json.loads(val.replace("\r\n", " ").strip())
                        if isinstance(inner_resp, dict) and inner_resp.get("ok") is False:
                            err = str(inner_resp.get("error") or "error")
                            print(f"❌ BC postRespuestaWhatsApp: {err}")
                            return False, err
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
            print(
                f"✅ BC postRespuestaWhatsApp OK | id_registro={inner.get('id_registro')} | "
                f"wamid={inner.get('id_mensaje', '')[:56]}…"
            )
            return True, None
        except requests.exceptions.RequestException as e:
            print(f"❌ BC postRespuestaWhatsApp red: {e}")
            return False, str(e)
        except Exception as e:
            print(f"❌ BC postRespuestaWhatsApp: {e}")
            return False, str(e)

