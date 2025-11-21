# Guía de Instalación de Python para GMalla

## Python no está instalado en tu sistema

Para ejecutar el proyecto GMalla, necesitas tener Python instalado. Aquí tienes las opciones:

## Opción 1: Instalar desde python.org (Recomendado)

1. **Descargar Python:**
   - Ve a https://www.python.org/downloads/
   - Descarga la versión más reciente de Python 3.11 o superior (recomendado: Python 3.11 o 3.12)

2. **Instalar Python:**
   - Ejecuta el instalador descargado
   - **IMPORTANTE:** Marca la casilla "Add Python to PATH" durante la instalación
   - Selecciona "Install Now" o "Customize installation"
   - Si eliges "Customize installation", asegúrate de marcar "Add Python to environment variables"

3. **Verificar la instalación:**
   - Abre una nueva ventana de PowerShell o CMD
   - Ejecuta: `python --version`
   - Deberías ver algo como: `Python 3.11.x` o `Python 3.12.x`

## Opción 2: Instalar desde Microsoft Store

1. Abre Microsoft Store
2. Busca "Python 3.11" o "Python 3.12"
3. Haz clic en "Obtener" o "Instalar"
4. Espera a que se complete la instalación

## Opción 3: Usar Chocolatey (si lo tienes instalado)

```powershell
choco install python --version=3.11.0
```

## Después de instalar Python

Una vez que Python esté instalado, sigue estos pasos para configurar el proyecto:

1. **Verificar la instalación:**
   ```powershell
   python --version
   ```

2. **Crear un entorno virtual (recomendado):**
   ```powershell
   python -m venv venv
   ```

3. **Activar el entorno virtual:**
   ```powershell
   .\venv\Scripts\Activate.ps1
   ```
   
   Si obtienes un error de política de ejecución, ejecuta primero:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

4. **Instalar las dependencias del proyecto:**
   ```powershell
   pip install -r requirements.txt
   ```

5. **Ejecutar la aplicación:**
   ```powershell
   python app.py
   ```

## Solución de problemas

### Error: "Python was not found"

- Asegúrate de haber marcado "Add Python to PATH" durante la instalación
- Reinicia tu terminal/PowerShell después de instalar Python
- Verifica que Python esté en el PATH ejecutando: `where python`

### Error de política de ejecución en PowerShell

Si al activar el entorno virtual obtienes un error sobre políticas de ejecución:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Verificar que Python está en el PATH

```powershell
$env:Path -split ';' | Select-String -Pattern 'Python'
```

Si no aparece Python en el PATH, necesitas agregarlo manualmente o reinstalar Python marcando la opción "Add Python to PATH".

## Versión recomendada

- **Python 3.11** o **Python 3.12** (versiones más recientes y estables)
- Evita Python 3.13+ si hay problemas de compatibilidad con las dependencias

