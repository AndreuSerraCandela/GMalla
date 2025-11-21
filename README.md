# GMalla

Sistema de gestión de calendario para asignación de incidencias a usuarios.

## Descripción

GMalla es una aplicación Python diseñada para gestionar el calendario de asignación de incidencias a usuarios. Las incidencias se almacenan en Business Central y la aplicación permite:

- Recuperar incidencias desde Business Central
- Obtener lista de usuarios desde la API de GTask
- Asignar incidencias a usuarios
- Gestionar calendarios de asignación
- Guardar y actualizar incidencias en Business Central (solo fecha y usuario, sin documentos)

## Estructura del Proyecto

```
GMalla/
├── models/
│   ├── __init__.py
│   └── incidencia.py          # Modelo de datos para incidencias
├── business_central/
│   ├── __init__.py
│   └── client.py              # Cliente para interactuar con Business Central
├── gtask/
│   ├── __init__.py
│   └── client.py              # Cliente para interactuar con la API de GTask
├── calendario/
│   ├── __init__.py
│   └── gestor.py              # Gestor de calendario de asignaciones
├── templates/
│   └── calendario.html        # Plantilla HTML del calendario
├── static/
│   ├── style.css              # Estilos CSS
│   └── calendario.js          # JavaScript para interactividad
├── imagenes/                  # Directorio para archivos de imagen asociados
├── config.py                  # Configuración de la aplicación
├── app.py                     # Aplicación web Flask
├── main.py                    # Script principal (CLI)
├── requirements.txt           # Dependencias del proyecto
└── README.md                  # Este archivo
```

## Requisitos Previos

### Instalar Python

**Si Python no está instalado en tu sistema**, consulta la guía detallada en [INSTALACION_PYTHON.md](INSTALACION_PYTHON.md).

**Verificar que Python está instalado:**
```bash
python --version
```

Deberías ver algo como: `Python 3.11.x` o `Python 3.12.x`

## Instalación

1. Crear un entorno virtual (recomendado):
```bash
python -m venv venv
venv\Scripts\activate  # En Windows
```

2. Instalar dependencias:
```bash
pip install -r requirements.txt
```

## Configuración

Configurar las variables de entorno para la conexión con Business Central y GTask:

- `BUSINESS_CENTRAL_BASE_URL`: URL base de la API de Business Central (por defecto: `https://bc220.malla.es`)
- `BUSINESS_CENTRAL_API_KEY`: Clave de API para autenticación (opcional, si no se usa, se usa autenticación básica)
- `BUSINESS_CENTRAL_COMPANY`: Nombre de la empresa en Business Central (por defecto: `Malla Publicidad`)
- `BUSINESS_CENTRAL_USERNAME`: Usuario para autenticación básica (por defecto: `debug`)
- `BUSINESS_CENTRAL_PASSWORD`: Contraseña para autenticación básica (por defecto: `Ib6343ds.`)
- `BUSINESS_CENTRAL_ENDPOINT_INCIDENCES`: Endpoint para incidencias (por defecto: `/powerbi/ODataV4/GtaskMalla_PostIncidencia`)
- `BUSINESS_CENTRAL_TIMEOUT`: Timeout en segundos (por defecto: `120`)
- `GTASK_API_URL`: URL base de la API de GTask (por defecto: `https://gtasks-api.deploy.malla.es`)

O crear un archivo `.env` en la raíz del proyecto (los valores por defecto ya están configurados):
```
# Configuración de Business Central (valores por defecto de Navision)
BUSINESS_CENTRAL_BASE_URL=https://bc220.malla.es
BUSINESS_CENTRAL_COMPANY=Malla Publicidad
BUSINESS_CENTRAL_USERNAME=debug
BUSINESS_CENTRAL_PASSWORD=Ib6343ds.
BUSINESS_CENTRAL_ENDPOINT_INCIDENCES=/powerbi/ODataV4/GtaskMalla_PostIncidencia
BUSINESS_CENTRAL_TIMEOUT=120

# Configuración de GTask
GTASK_API_URL=https://gtasks-api.deploy.malla.es
```

## Estructura de Incidencias

Las incidencias siguen la estructura de la tabla 7001250 "Incidencias" de Business Central:

- **No.**: Código de identificación (Code[20])
- **Descripción**: Descripción de la incidencia (Text[100])
- **Fecha**: Fecha de la incidencia (Date)
- **Estado**: Estado (Abierta, EnProgreso, Cerrada)
- **Nº Orden**: Número de orden (Integer)
- **No. Series**: Número de serie (Code[20])
- **Id_Gtask**: ID de Gtask (Text[30])
- **Tipo Incidencia**: Tipo de incidencia (Enum)
- **Recurso**: Recurso asignado (Code[20])
- **Tipo Elemento**: Tipo de elemento (Recurso, Parada)
- **FechaHora**: Fecha y hora (DateTime)
- **Work Description**: Descripción del trabajo (Blob)
- **Usuario**: Usuario asignado (Guid)
- **Archivos de imagen**: Archivos de imagen asociados

## Ejecutar la Aplicación Web

Para iniciar la aplicación web con el calendario interactivo:

```bash
python app.py
```

Luego abre tu navegador en: `http://localhost:5000`

### Características de la Aplicación Web

- 📅 **Calendario interactivo**: Visualiza incidencias organizadas por fecha
- 👥 **Gestión de usuarios**: Selecciona usuarios y ve sus incidencias asignadas
- 🖱️ **Arrastrar y soltar**: Mueve incidencias entre fechas arrastrándolas
- 🔄 **Sincronización automática**: Los cambios se guardan en Business Central
- 🎨 **Interfaz moderna**: Diseño responsive y fácil de usar

## Uso

### Autenticación y obtener usuarios desde GTask

```python
from gtask.client import GTaskClient
from config import GTASK_API_URL

# Inicializar cliente de GTask
gtask_client = GTaskClient(api_url=GTASK_API_URL)

# Realizar login (opcional, pero recomendado para endpoints protegidos)
resultado_login = gtask_client.login(username="tu_usuario", password="tu_contraseña")

if resultado_login['success']:
    print(f"✅ Login exitoso")
    print(f"Token: {resultado_login.get('token', 'N/A')}")
    print(f"Usuario: {resultado_login.get('user_data', {})}")
    
    # Verificar estado de autenticación
    if gtask_client.esta_autenticado():
        print("🔐 Sesión activa")
        usuario_actual = gtask_client.obtener_usuario_actual()
        print(f"Usuario actual: {usuario_actual}")
else:
    print(f"❌ Error en login: {resultado_login['error']}")

# Obtener lista de usuarios (con caché automático)
# Si hay token de autenticación, se usará automáticamente
resultado = gtask_client.obtener_usuarios()

if resultado['success']:
    usuarios = resultado['users']
    print(f"Se obtuvieron {resultado['count']} usuarios desde {resultado['source']}")
    for usuario in usuarios:
        print(f"Usuario: {usuario}")
else:
    print(f"Error: {resultado['error']}")

# Obtener un usuario específico por ID
usuario = gtask_client.obtener_usuario_por_id("usuario-guid-123")
if usuario:
    print(f"Usuario encontrado: {usuario}")

# Cerrar sesión cuando termines
gtask_client.logout()
```

### Obtener incidencias desde Business Central

```python
from business_central.client import BusinessCentralClient
from config import BUSINESS_CENTRAL_BASE_URL, BUSINESS_CENTRAL_API_KEY

# Inicializar cliente de Business Central
bc_client = BusinessCentralClient(
    base_url=BUSINESS_CENTRAL_BASE_URL,
    api_key=BUSINESS_CENTRAL_API_KEY
)

# Obtener todas las incidencias
incidencias = bc_client.obtener_incidencias()
print(f"Se obtuvieron {len(incidencias)} incidencias")

# Obtener incidencias con filtros
filtros = {
    'estado': 'Abierta',
    'recurso': '18-01061-01',
    'tipo_incidencia': 'Incidencias EMT'
}
incidencias_filtradas = bc_client.obtener_incidencias(filtros=filtros)
print(f"Incidencias filtradas: {len(incidencias_filtradas)}")

# Mostrar información de las incidencias
for incidencia in incidencias:
    print(f"Incidencia {incidencia.no}: {incidencia.descripcion}")
    print(f"  Estado: {incidencia.estado.value}")
    print(f"  Recurso: {incidencia.recurso}")
    print(f"  Tipo: {incidencia.tipo_incidencia}")
```

### Actualizar incidencia en Business Central

```python
from business_central.client import BusinessCentralClient
from models.incidencia import Incidencia, EstadoIncidencia
from datetime import date
from config import BUSINESS_CENTRAL_BASE_URL, BUSINESS_CENTRAL_API_KEY

# Inicializar cliente de Business Central
bc_client = BusinessCentralClient(
    base_url=BUSINESS_CENTRAL_BASE_URL,
    api_key=BUSINESS_CENTRAL_API_KEY
)

# Crear o actualizar una incidencia (solo fecha y usuario, sin documentos)
incidencia = Incidencia(
    no="INC-001",
    descripcion="Descripción de la incidencia",
    fecha=date.today(),
    estado=EstadoIncidencia.ABIERTA,
    usuario="usuario-guid-123"
)

# Actualizar en Business Central
exito = bc_client.actualizar_incidencia(incidencia)
if exito:
    print("Incidencia actualizada correctamente")
```

### Gestión de calendario

```python
from calendario.gestor import GestorCalendario
from models.incidencia import Incidencia
from datetime import date, timedelta
from business_central.client import BusinessCentralClient
from config import BUSINESS_CENTRAL_BASE_URL, BUSINESS_CENTRAL_API_KEY

# Inicializar cliente de Business Central
bc_client = BusinessCentralClient(
    base_url=BUSINESS_CENTRAL_BASE_URL,
    api_key=BUSINESS_CENTRAL_API_KEY
)

# Inicializar gestor de calendario con sincronización a BC
gestor = GestorCalendario(bc_client=bc_client)

# Asignar incidencia a usuario
gestor.asignar_incidencia(incidencias[0], "usuario-guid-123")

# Arrastrar incidencia a otra fecha (mover entre fechas)
nueva_fecha = date.today() + timedelta(days=3)
gestor.mover_incidencia_fecha(incidencias[0], nueva_fecha)

# Arrastrar incidencia a otro usuario (mover entre usuarios)
gestor.mover_incidencia_usuario(incidencias[0], "nuevo-usuario-guid-456")

# Arrastrar incidencia cambiando fecha y usuario a la vez
gestor.mover_incidencia(
    incidencia=incidencias[0],
    nuevo_usuario_id="nuevo-usuario-guid-456",
    nueva_fecha=date.today() + timedelta(days=5),
    sincronizar_bc=True  # Sincroniza automáticamente con Business Central
)

# Buscar una incidencia por su número
incidencia = gestor.buscar_incidencia_por_no("INC000005")
if incidencia:
    print(f"Incidencia encontrada: {incidencia.descripcion}")
```

## Estado del Proyecto

- ✅ **Cliente GTask**: Implementado para obtener usuarios desde la API de GTask con sistema de caché
- ✅ **Login GTask**: Implementado para autenticación en la API de GTask con manejo de tokens
- ✅ **Obtener incidencias desde BC**: Implementado para obtener incidencias desde OData con filtros opcionales
- ✅ **Actualizar incidencias en BC**: Implementado para actualizar fecha y usuario (sin documentos)
- ✅ **Arrastrar incidencias**: Implementado para mover incidencias entre fechas y usuarios con sincronización automática a BC
- ⏳ **Guardar nuevas incidencias en BC**: Pendiente de implementación

## Licencia

[Especificar licencia si es necesario]

