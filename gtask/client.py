"""
Cliente para interactuar con la API de GTask
"""
import requests
from typing import List, Optional, Dict, Any
import json
from datetime import datetime, timedelta

# Importar config desde la raíz del proyecto
try:
    from ...config import GTASK_API_URL
except ImportError:
    # Fallback: importación absoluta si la relativa falla
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from config import GTASK_API_URL


class GTaskClient:
    """Cliente para interactuar con la API de GTask"""
    
    def __init__(self, api_url: str = ""):
        """
        Inicializa el cliente de GTask
        
        Args:
            api_url: URL base de la API de GTask (por defecto usa la de config)
        """
        self.api_url = api_url or GTASK_API_URL
        self._users_cache: Optional[List[Dict[str, Any]]] = None
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl = timedelta(hours=1)  # TTL del caché: 1 hora
        self._auth_token: Optional[str] = None  # Token de autenticación
        self._user_data: Optional[Dict[str, Any]] = None  # Datos del usuario autenticado
    
    def obtener_usuarios(self, usar_cache: bool = True) -> Dict[str, Any]:
        """
        Obtiene la lista de usuarios desde la API de GTask
        
        Args:
            usar_cache: Si es True, usa el caché si está disponible y no ha expirado
        
        Returns:
            Diccionario con:
                - success: bool - Indica si la operación fue exitosa
                - users: List[Dict] - Lista de usuarios (si success=True)
                - count: int - Número de usuarios (si success=True)
                - source: str - Origen de los datos ('cache' o 'api')
                - error: str - Mensaje de error (si success=False)
        """
        # Intentar obtener del cache primero si está habilitado
        if usar_cache and self._users_cache is not None and self._cache_timestamp:
            if datetime.now() - self._cache_timestamp < self._cache_ttl:
                print("✅ Usuarios obtenidos del caché (ya ordenados)")
                return {
                    'success': True,
                    'users': self._users_cache,
                    'count': len(self._users_cache),
                    'source': 'cache'
                }
        
        # Si no hay cache válido, obtener desde la API
        try:
            url = f"{self.api_url.rstrip('/')}/users"
            
            print(f"🌐 Obteniendo usuarios desde GTask API: {url}")
            
            # Preparar headers con autenticación si está disponible
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
            
            # Agregar token de autenticación si está disponible
            if self._auth_token:
                headers["Authorization"] = f"Bearer {self._auth_token}"
            
            response = requests.get(
                url,
                timeout=30,
                headers=headers
            )
            
            # Verificar si la petición fue exitosa
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # La API puede devolver los usuarios directamente o en un formato específico
                    if isinstance(data, list):
                        users = data
                    elif isinstance(data, dict):
                        # Si viene en formato { "users": [...], "count": ... }
                        users = data.get('users', [])
                    else:
                        users = []
                    
                    # Ordenar usuarios por nombre
                    def obtener_nombre_usuario(user):
                        """Obtiene el nombre del usuario para ordenación"""
                        return (user.get('name') or user.get('username') or user.get('nombre') or '').lower()
                    
                    users_ordenados = sorted(users, key=obtener_nombre_usuario)
                    
                    # Actualizar caché
                    self._users_cache = users_ordenados
                    self._cache_timestamp = datetime.now()
                    
                    print(f"✅ {len(users_ordenados)} usuarios obtenidos desde la API (ordenados por nombre)")
                    
                    return {
                        'success': True,
                        'users': users_ordenados,
                        'count': len(users_ordenados),
                        'source': 'api'
                    }
                    
                except json.JSONDecodeError as e:
                    error_msg = f'Error al decodificar respuesta JSON: {str(e)}'
                    print(f"❌ {error_msg}")
                    return {
                        'success': False,
                        'error': error_msg
                    }
            else:
                error_msg = f'Error del servidor: {response.status_code}'
                print(f"❌ {error_msg}")
                print(f"❌ Respuesta: {response.text}")
                return {
                    'success': False,
                    'error': error_msg,
                    'response_text': response.text
                }
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con la API de GTask: {str(e)}'
            print(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al obtener usuarios: {str(e)}'
            print(f"❌ {error_msg}")
            print(f"📋 Traceback:\n{error_trace}")
            return {
                'success': False,
                'error': error_msg
            }
    
    def limpiar_cache(self):
        """Limpia el caché de usuarios"""
        self._users_cache = None
        self._cache_timestamp = None
        print("🗑️ Caché de usuarios limpiado")
    
    def obtener_usuario_por_id(self, usuario_id: str) -> Optional[Dict[str, Any]]:
        """
        Obtiene un usuario específico por su ID
        
        Args:
            usuario_id: ID del usuario (Guid)
        
        Returns:
            Diccionario con los datos del usuario o None si no se encuentra
        """
        resultado = self.obtener_usuarios()
        
        if resultado['success']:
            usuarios = resultado['users']
            for usuario in usuarios:
                # El ID puede estar en diferentes campos según la estructura de la API
                if (usuario.get('id') == usuario_id or 
                    usuario.get('Id') == usuario_id or
                    usuario.get('user_id') == usuario_id or
                    usuario.get('userId') == usuario_id):
                    return usuario
        
        return None
    
    def login(self, username: str, password: str) -> Dict[str, Any]:
        """
        Realiza login en la API de GTask
        
        Args:
            username: Nombre de usuario
            password: Contraseña
        
        Returns:
            Diccionario con:
                - success: bool - Indica si el login fue exitoso
                - token: str - Token de autenticación (si success=True)
                - user_data: Dict - Datos del usuario (si success=True)
                - error: str - Mensaje de error (si success=False)
        """
        try:
            url = f"{self.api_url.rstrip('/')}/user/login"
            
            print(f"🔐 Realizando login en GTask API: {url}")
            
            payload = {
                "username": username,
                "password": password
            }
            
            response = requests.post(
                url,
                json=payload,
                timeout=30,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                }
            )
            
            # Verificar si la petición fue exitosa
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # Extraer token y datos del usuario de la respuesta
                    # La estructura puede variar, intentamos diferentes formatos comunes
                    token = None
                    user_data = None
                    
                    if isinstance(data, dict):
                        # Formato común: { "token": "...", "user": {...} }
                        token = data.get('token') or data.get('access_token') or data.get('auth_token')
                        user_data = data.get('user') or data.get('user_data') or data.get('data')
                        
                        # Si no hay campo 'user', usar todo el objeto excepto el token
                        if not user_data and token:
                            user_data = {k: v for k, v in data.items() if k not in ['token', 'access_token', 'auth_token']}
                        elif not user_data:
                            user_data = data
                    
                    # Guardar token y datos del usuario
                    self._auth_token = token
                    self._user_data = user_data
                    
                    print(f"✅ Login exitoso para usuario: {username}")
                    if token:
                        print(f"🔑 Token obtenido: {token[:20]}...")
                    
                    return {
                        'success': True,
                        'token': token,
                        'user_data': user_data,
                        'response': data
                    }
                    
                except json.JSONDecodeError as e:
                    error_msg = f'Error al decodificar respuesta JSON: {str(e)}'
                    print(f"❌ {error_msg}")
                    return {
                        'success': False,
                        'error': error_msg
                    }
            elif response.status_code == 401:
                error_msg = 'Credenciales inválidas'
                print(f"❌ {error_msg}")
                return {
                    'success': False,
                    'error': error_msg,
                    'status_code': 401
                }
            else:
                error_msg = f'Error del servidor: {response.status_code}'
                print(f"❌ {error_msg}")
                print(f"❌ Respuesta: {response.text}")
                return {
                    'success': False,
                    'error': error_msg,
                    'status_code': response.status_code,
                    'response_text': response.text
                }
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con la API de GTask: {str(e)}'
            print(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al realizar login: {str(e)}'
            print(f"❌ {error_msg}")
            print(f"📋 Traceback:\n{error_trace}")
            return {
                'success': False,
                'error': error_msg
            }
    
    def logout(self):
        """Cierra la sesión y limpia el token de autenticación"""
        self._auth_token = None
        self._user_data = None
        print("🚪 Sesión cerrada")
    
    def esta_autenticado(self) -> bool:
        """Verifica si hay una sesión activa"""
        return self._auth_token is not None
    
    def obtener_token(self) -> Optional[str]:
        """Obtiene el token de autenticación actual"""
        return self._auth_token
    
    def obtener_usuario_actual(self) -> Optional[Dict[str, Any]]:
        """Obtiene los datos del usuario actualmente autenticado"""
        return self._user_data

