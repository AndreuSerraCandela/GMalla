"""
WSGI entry point para IIS
Este archivo permite que IIS ejecute la aplicación Flask usando HttpPlatformHandler
"""
import os
import sys

# Configurar encoding UTF-8 para evitar problemas con caracteres especiales
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

# Agregar el directorio del proyecto al path de Python
project_dir = os.path.dirname(os.path.abspath(__file__))
if project_dir not in sys.path:
    sys.path.insert(0, project_dir)

# Cambiar al directorio del proyecto
os.chdir(project_dir)

# Logging para debugging
try:
    log_file = os.path.join(project_dir, 'logs', 'wsgi.log')
    os.makedirs(os.path.dirname(log_file), exist_ok=True)
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(f"\n=== Iniciando WSGI - {os.getenv('HTTP_PLATFORM_PORT', 'N/A')} ===\n")
        f.write(f"Project dir: {project_dir}\n")
        f.write(f"Python path: {sys.executable}\n")
        f.write(f"Python version: {sys.version}\n")
        f.write(f"Working directory: {os.getcwd()}\n")
except Exception as e:
    pass  # Si no se puede escribir el log, continuar

try:
    # Importar la aplicación Flask desde app.py
    from app import app
    
    # Esta es la variable que IIS busca para la aplicación WSGI
    application = app
    
    # Logging exitoso
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write("✅ Aplicación Flask importada correctamente\n")
            f.flush()
    except:
        pass

except Exception as e:
    # Logging de errores
    error_msg = f"❌ Error importando aplicación: {str(e)}\n"
    error_msg += f"Traceback: {repr(e)}\n"
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(error_msg)
            import traceback
            f.write(traceback.format_exc())
            f.flush()
    except:
        pass
    # Re-lanzar el error para que IIS lo vea
    raise

# IMPORTANTE: HttpPlatformHandler ejecuta el script directamente, no como módulo
# Por lo tanto, el código aquí se ejecutará cuando IIS inicie el proceso
# Siempre iniciar waitress si hay HTTP_PLATFORM_PORT (IIS)
if os.environ.get('HTTP_PLATFORM_PORT'):
    try:
        port = int(os.environ.get('HTTP_PLATFORM_PORT', 5020))
        try:
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(f"🚀 Iniciando waitress en puerto {port} (IIS)\n")
                f.flush()
        except:
            pass
        
        from waitress import serve
        print(f"🚀 Iniciando servidor en puerto {port} (IIS)", flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        
        # IMPORTANTE: Usar '127.0.0.1' en lugar de '0.0.0.0' para evitar problemas de permisos
        # HttpPlatformHandler se encarga del enrutamiento, solo necesitamos escuchar en localhost
        serve(application, host='127.0.0.1', port=port, threads=4, channel_timeout=120)
    except Exception as e:
        error_msg = f"❌ Error iniciando waitress: {str(e)}\n"
        try:
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(error_msg)
                import traceback
                f.write(traceback.format_exc())
                f.flush()
        except:
            pass
        print(f"❌ Error: {str(e)}", file=sys.stderr, flush=True)
        sys.stderr.flush()
        raise

# Modo desarrollo (solo si se ejecuta directamente sin HTTP_PLATFORM_PORT)
if __name__ == "__main__" and not os.environ.get('HTTP_PLATFORM_PORT'):
    application.run(debug=True, host='0.0.0.0', port=5020)

