"""
Configuración de la aplicación GMalla
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno desde archivo .env
load_dotenv()

# Directorio base del proyecto
BASE_DIR = Path(__file__).parent

# Directorio para almacenar archivos de imagen
IMAGENES_DIR = BASE_DIR / "imagenes"
IMAGENES_DIR.mkdir(exist_ok=True)

# Configuración de Business Central
BUSINESS_CENTRAL_BASE_URL = os.getenv("BUSINESS_CENTRAL_BASE_URL", "https://bc220.malla.es")
BUSINESS_CENTRAL_API_KEY = os.getenv("BUSINESS_CENTRAL_API_KEY", "")
BUSINESS_CENTRAL_COMPANY = os.getenv("BUSINESS_CENTRAL_COMPANY", "Malla Publicidad")
BUSINESS_CENTRAL_USERNAME = os.getenv("BUSINESS_CENTRAL_USERNAME", "debug")
BUSINESS_CENTRAL_PASSWORD = os.getenv("BUSINESS_CENTRAL_PASSWORD", "Ib6343ds.")

# Configuración de GTask API
GTASK_API_URL = os.getenv("GTASK_API_URL", "https://gtasks-api.deploy.malla.es")
GTASK_USERNAME = os.getenv("GTASK_USERNAME", "andreuserra")
GTASK_PASSWORD = os.getenv("GTASK_PASSWORD", "12345")
# Departamento GTask «Taller» (ObjectId en API de usuarios)
GTASK_DEPARTAMENTO_TALLER_ID = os.getenv(
    "GTASK_DEPARTAMENTO_TALLER_ID",
    "6536459ad826e80019f16725",
).strip()

# Administradores: solo estos usuarios pueden gestionar permisos (usernames separados por coma)
_ADMINISTRADORES_STR = os.getenv("ADMINISTRADORES", "andreuserra,lllompart@malla.es")
ADMINISTRADORES = {s.strip().lower() for s in _ADMINISTRADORES_STR.split(",") if s.strip()}

# Fichero donde se guardan los permisos por usuario
PERMISOS_FILE = BASE_DIR / "permisos.json"

# Servicio de imágenes (mismo que app Incidencias / FormBase64ToUrl en BC)
BASE64_API_SAVE_URL = os.getenv(
    "BASE64_API_SAVE_URL",
    "https://base64-api.deploy.malla.es/save",
).strip()

# Configuración de LLM local
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://192.168.10.238:1234")

# URL pública de la app (enlaces en WhatsApp, p. ej. asignación → detalle ?id=Nº)
GMALLA_PUBLIC_APP_URL = os.getenv("GMALLA_PUBLIC_APP_URL", "https://taller.malla.es").strip()

# SSO desde portal Malla (mismo MALLA_SSO_SECRET que apps.malla.es)
MALLA_SSO_SECRET = (os.getenv("MALLA_SSO_SECRET") or "").strip()
SSO_LOGIN_ENABLED = os.getenv("SSO_LOGIN_ENABLED", "true").lower() in ("1", "true", "yes")
APPDESKTOP_URL = (os.getenv("APPDESKTOP_URL") or "https://apps.malla.es").strip().rstrip("/")

# App dedicada de mantenimiento (botón «Mantenimiento» en el calendario de incidencias)
MANTENIMIENTO_APP_URL = os.getenv("MANTENIMIENTO_APP_URL", "http://127.0.0.1:5021").strip().rstrip("/")

# API WhatsApp (Apiwhats: POST /enviar). Vacío = no se envían avisos.
API_WHATS_URL = os.getenv("API_WHATS_URL", "https://meta.malla.es").strip()
API_WHATS_SECRET_TOKEN = os.getenv("API_WHATS_SECRET_TOKEN", "").strip()
WHATSAPP_NOTIFICAR_ASIGNACION = os.getenv("WHATSAPP_NOTIFICAR_ASIGNACION", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Tras enviar WhatsApp (Apiwhats), notificar a BC (postRespuestaWhatsApp) con id_mensaje + id_registro + id_tabla
WHATSAPP_NOTIFICAR_BC = os.getenv("WHATSAPP_NOTIFICAR_BC", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# Aviso masivo Taller: espaciar envíos y variar texto ligeramente (reduce bloqueos Meta por spam)
try:
    WHATSAPP_TALLER_INTERVALO_SEG = max(
        0.0, float(os.getenv("WHATSAPP_TALLER_INTERVALO_SEG", "3"))
    )
except ValueError:
    WHATSAPP_TALLER_INTERVALO_SEG = 3.0
WHATSAPP_TALLER_VARIAR_TEXTO = os.getenv("WHATSAPP_TALLER_VARIAR_TEXTO", "true").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# Configuración de base de datos (si se necesita almacenamiento local)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'gmalla.db'}")

# Configuración de BC en formato diccionario (valores por defecto de Navision)
BC_CONFIG = {
    'base_url': BUSINESS_CENTRAL_BASE_URL,
    'endpoint_incidences': os.getenv("BUSINESS_CENTRAL_ENDPOINT_INCIDENCES", "/powerbi/ODataV4/GtaskMalla_PostIncidencia"),
    'endpoint_post_respuesta_whatsapp': os.getenv(
        "BUSINESS_CENTRAL_ENDPOINT_POST_RESPUESTA_WHATSAPP",
        "/powerbi/ODataV4/GtaskMalla_postRespuestaWhatsApp",
    ),
    'company': BUSINESS_CENTRAL_COMPANY,
    'credentials': {
        'username': BUSINESS_CENTRAL_USERNAME,
        'password': BUSINESS_CENTRAL_PASSWORD
    },
    'timeout': int(os.getenv("BUSINESS_CENTRAL_TIMEOUT", "120")),  # 2 minutos por defecto
    'timeout_large_images': int(os.getenv("BUSINESS_CENTRAL_TIMEOUT_LARGE_IMAGES", "300")),  # 5 minutos
    'max_image_size_mb': int(os.getenv("BUSINESS_CENTRAL_MAX_IMAGE_SIZE_MB", "10")),
    'compress_quality': int(os.getenv("BUSINESS_CENTRAL_COMPRESS_QUALITY", "85")),
    'enable_compression': os.getenv("BUSINESS_CENTRAL_ENABLE_COMPRESSION", "True").lower() == "true"
}


def get_bc_url() -> str:
    """Obtiene la URL base de Business Central"""
    return BC_CONFIG.get('base_url', BUSINESS_CENTRAL_BASE_URL)


def get_base64_api_save_url() -> str:
    """URL POST para guardar base64 → url + _id (app Incidencias)."""
    return BASE64_API_SAVE_URL


def get_bc_incidences_url() -> str:
    """
    Obtiene la URL del endpoint de incidencias en Business Central.
    Usa el endpoint configurado en BC_CONFIG
    """
    base_url = get_bc_url().rstrip('/')
    endpoint = BC_CONFIG.get('endpoint_incidences', '/powerbi/ODataV4/GtaskMalla_PostIncidencia')
    # Asegurar que el endpoint comience con /
    if not endpoint.startswith('/'):
        endpoint = '/' + endpoint
    incidences_url = f"{base_url}{endpoint}"
    return incidences_url

def get_bc_detalle_incidences_url() -> str:
    """
    Obtiene la URL del endpoint de incidencias en Business Central.
    Usa el endpoint configurado en BC_CONFIG
    """
    base_url = get_bc_url().rstrip('/')
    endpoint = BC_CONFIG.get('endpoint_detalle_incidences', '/powerbi/ODataV4/GtaskMalla_DetalleIncidencia')
    # Asegurar que el endpoint comience con /
    if not endpoint.startswith('/'):
        endpoint = '/' + endpoint
    incidences_url = f"{base_url}{endpoint}"
    return incidences_url
def get_bc_post_respuesta_whatsapp_url() -> str:
    """URL OData del servicio web postRespuestaWhatsApp (mismo criterio que Apiwhats → BC)."""
    base_url = get_bc_url().rstrip("/")
    endpoint = BC_CONFIG.get(
        "endpoint_post_respuesta_whatsapp",
        "/powerbi/ODataV4/GtaskMalla_postRespuestaWhatsApp",
    )
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return f"{base_url}{endpoint}"


def get_bc_listado_mantenimiento_emplaz_url() -> str:
    """
    OData codeunit GTask (7001148): procedimiento ListadoMantenimientoEmplaz.
    Mismo patrón que GtaskMalla_DetalleIncidencia (publicar en BC si aún no está).
    """
    base_url = get_bc_url().rstrip("/")
    endpoint = os.getenv(
        "BUSINESS_CENTRAL_ENDPOINT_LISTADO_MANTENIMIENTO",
        "/powerbi/ODataV4/GtaskMalla_ListadoMantenimientoEmplaz",
    )
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return f"{base_url}{endpoint}"


def get_bc_listado_mantenimiento_recurso_url() -> str:
    """
    Misma publicación OData que emplazamientos , procedure distinto.
    Solo definir BUSINESS_CENTRAL_ENDPOINT_LISTADO_MANTENIMIENTO_RECURSO si BC publica otro servicio.
    """
    dedicated = os.getenv("BUSINESS_CENTRAL_ENDPOINT_LISTADO_MANTENIMIENTO_RECURSO", "").strip()
    if dedicated:
        base_url = get_bc_url().rstrip("/")
        if not dedicated.startswith("/"):
            dedicated = "/" + dedicated
        return f"{base_url}{dedicated}"
    return get_bc_listado_mantenimiento_emplaz_url()


def get_bc_procedure_mantenimiento_emplaz() -> str:
    return os.getenv(
        "BUSINESS_CENTRAL_PROCEDURE_MANTENIMIENTO_EMPLAZ",
        "ListadoMantenimientoEmplaz",
    )


def get_bc_procedure_mantenimiento_recurso() -> str:
    return os.getenv(
        "BUSINESS_CENTRAL_PROCEDURE_MANTENIMIENTO_RECURSO",
        "ListadoMantenimientoRecurso",
    )


def get_bc_lista_incidencias_url() -> str:
    """
    Obtiene la URL del endpoint OData para listar incidencias en Business Central.
    Formato: /powerbi/ODataV4/Company('Malla%20Publicidad')/ListaIncidencias
    """
    base_url = get_bc_url().rstrip('/')
    company = BC_CONFIG.get('company', BUSINESS_CENTRAL_COMPANY)
    company_encoded = company.replace(' ', '%20')
    endpoint = os.getenv(
        "BUSINESS_CENTRAL_ENDPOINT_LISTA_INCIDENCIAS",
        "/powerbi/ODataV4/Company('{company}')/ListaIncidencias",
    ).format(company=company_encoded)
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return f"{base_url}{endpoint}"


def get_bc_lista_ordenes_url() -> str:
    """
    OData para órdenes de trabajo (misma tabla Incidencias, Es Peticion = true).
  """
    base_url = get_bc_url().rstrip('/')
    company = BC_CONFIG.get('company', BUSINESS_CENTRAL_COMPANY)
    company_encoded = company.replace(' ', '%20')
    endpoint = os.getenv(
        "BUSINESS_CENTRAL_ENDPOINT_LISTA_ORDENES",
        "/powerbi/ODataV4/Company('{company}')/ListaOrdenes",
    ).format(company=company_encoded)
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return f"{base_url}{endpoint}"


def get_bc_auth_header() -> str:
    """
    Obtiene el header de autenticación para Business Central.
    Prioriza API Key si está disponible, sino usa autenticación básica (username/password)
    """
    if BUSINESS_CENTRAL_API_KEY:
        return f"Bearer {BUSINESS_CENTRAL_API_KEY}"
    return ""


def get_bc_auth_credentials() -> tuple:
    """
    Obtiene las credenciales de autenticación básica para Business Central.
    
    Returns:
        Tupla (username, password) para autenticación básica HTTP
    """
    credentials = BC_CONFIG.get('credentials', {})
    username = credentials.get('username', BUSINESS_CENTRAL_USERNAME)
    password = credentials.get('password', BUSINESS_CENTRAL_PASSWORD)
    return (username, password)

