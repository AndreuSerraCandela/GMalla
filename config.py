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

# Configuración de base de datos (si se necesita almacenamiento local)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'gmalla.db'}")

# Configuración de BC en formato diccionario (valores por defecto de Navision)
BC_CONFIG = {
    'base_url': BUSINESS_CENTRAL_BASE_URL,
    'endpoint_incidences': os.getenv("BUSINESS_CENTRAL_ENDPOINT_INCIDENCES", "/powerbi/ODataV4/GtaskMalla_PostIncidencia"),
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
def get_bc_lista_incidencias_url() -> str:
    """
    Obtiene la URL del endpoint OData para listar incidencias en Business Central.
    Formato: /powerbi/ODataV4/Company('Malla%20Publicidad')/ListaIncidencias
    """
    base_url = get_bc_url().rstrip('/')
    company = BC_CONFIG.get('company', BUSINESS_CENTRAL_COMPANY)
    # Codificar el nombre de la empresa para URL (espacios como %20)
    company_encoded = company.replace(' ', '%20')
    lista_url = f"{base_url}/powerbi/ODataV4/Company('{company_encoded}')/ListaIncidencias"
    return lista_url


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

