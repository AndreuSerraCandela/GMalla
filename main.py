"""
Aplicación principal de GMalla para gestión de calendario de asignación de incidencias
"""
import sys
from pathlib import Path

# Agregar el directorio raíz al path para importaciones
sys.path.insert(0, str(Path(__file__).parent))

from datetime import date, datetime, timedelta
from business_central.client import BusinessCentralClient
from calendario.gestor import GestorCalendario
from models.incidencia import Incidencia, EstadoIncidencia, TipoElemento
from gtask.client import GTaskClient
from config import (
    BUSINESS_CENTRAL_BASE_URL, 
    BUSINESS_CENTRAL_API_KEY,
    GTASK_API_URL
)


def main():
    """Función principal de la aplicación"""
    print("=" * 60)
    print("GMalla - Gestión de Calendario de Asignación de Incidencias")
    print("=" * 60)
    
    # Inicializar clientes
    bc_client = BusinessCentralClient(
        base_url=BUSINESS_CENTRAL_BASE_URL,
        api_key=BUSINESS_CENTRAL_API_KEY
    )
    
    gtask_client = GTaskClient(api_url=GTASK_API_URL)
    
    # Inicializar gestor de calendario con sincronización a BC
    gestor = GestorCalendario(bc_client=bc_client)
    
    print("\n✅ Sistema inicializado correctamente")
    print(f"   Business Central: {BUSINESS_CENTRAL_BASE_URL}")
    print(f"   GTask API: {GTASK_API_URL}")
    
    # Aquí puedes agregar tu lógica de aplicación
    # Por ejemplo:
    # - Obtener incidencias desde BC
    # - Obtener usuarios desde GTask
    # - Asignar incidencias a usuarios
    # - Mover incidencias entre fechas/usuarios
    # etc.
    
    print("\n💡 Sistema listo para usar")
    print("   Usa los métodos del gestor para gestionar el calendario")


if __name__ == "__main__":
    main()

