"""
Cliente para interactuar con LLM local DeepSeek-R1-Distill-Qwen-7B-GGUF)
"""
from socket import timeout
import time
import requests
import json
import re
from typing import Optional, Dict, Any, List
from datetime import datetime

# Importar config desde la raíz del proyecto
try:
    from ...config import LLM_BASE_URL
except ImportError:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from config import LLM_BASE_URL


class LLMClient:
    """Cliente para interactuar con LLM local"""
    
    def __init__(self, base_url: str = ""):
        """
        Inicializa el cliente de LLM
        
        Args:
            base_url: URL base del servidor LLM (por defecto usa la de config)
        """
        self.base_url = base_url or LLM_BASE_URL
        if not self.base_url.startswith('http'):
            self.base_url = f"http://{self.base_url}"
        # Asegurar que no termine en /
        self.base_url = self.base_url.rstrip('/')
    
    def generar_respuesta(self, prompt: str, system_prompt: Optional[str] = None, 
                         max_tokens: int = 2000, temperature: float = 0.7) -> Dict[str, Any]:
        """
        Genera una respuesta del LLM
        
        Args:
            prompt: Prompt del usuario
            system_prompt: Prompt del sistema (opcional)
            max_tokens: Número máximo de tokens a generar
            temperature: Temperatura para la generación (0.0-1.0)
        
        Returns:
            Diccionario con:
                - success: bool - Indica si la operación fue exitosa
                - response: str - Respuesta del LLM (si success=True)
                - error: str - Mensaje de error (si success=False)
        """
        try:
            # Construir mensajes para la API
            messages = []
            
            if system_prompt:
                messages.append({
                    "role": "system",
                    "content": system_prompt
                })
            
            messages.append({
                "role": "user",
                "content": prompt
            })
            
            # Preparar payload para la API (formato compatible con OpenAI/DeepSeek)
        #deepseek-r1-distill-qwen-7b, "llama-3.2-1b-instruct"
            payload = {
                "model": "deepseek-r1-distill-qwen-7b",
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": False
            }
            
            # URL del endpoint de chat/completion
            url = f"{self.base_url}/v1/chat/completions"
            
            print(f"🤖 Enviando petición al LLM: {url}")
            print(f"📝 Prompt: {prompt[:200]}...")
            
            # Realizar petición
            response = requests.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                timeout=180  # 2 minutos de timeout
            )
            
            # Verificar respuesta
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    # Extraer la respuesta del LLM
                    # Formato puede variar según la API
                    if "choices" in data and len(data["choices"]) > 0:
                        message = data["choices"][0].get("message", {})
                        content = message.get("content", "")
                        
                        print(f"✅ Respuesta recibida del LLM ({len(content)} caracteres)")
                        
                        return {
                            'success': True,
                            'response': content,
                            'raw_response': data
                        }
                    else:
                        error_msg = "No se encontró respuesta en la respuesta del LLM"
                        print(f"❌ {error_msg}")
                        print(f"Respuesta completa: {data}")
                        return {
                            'success': False,
                            'error': error_msg,
                            'raw_response': data
                        }
                        
                except json.JSONDecodeError as e:
                    error_msg = f'Error al decodificar respuesta JSON: {str(e)}'
                    print(f"❌ {error_msg}")
                    print(f"Respuesta: {response.text[:500]}")
                    return {
                        'success': False,
                        'error': error_msg
                    }
            else:
                error_msg = f'Error del servidor LLM: {response.status_code}'
                print(f"❌ {error_msg}")
                print(f"Respuesta: {response.text[:500]}")
                return {
                    'success': False,
                    'error': error_msg,
                    'status_code': response.status_code,
                    'response_text': response.text
                }
                
        except requests.exceptions.RequestException as e:
            error_msg = f'Error de conexión con el LLM: {str(e)}'
            print(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            error_msg = f'Error interno al generar respuesta: {str(e)}'
            print(f"❌ {error_msg}")
            print(f"📋 Traceback:\n{error_trace}")
            return {
                'success': False,
                'error': error_msg
            }
    
    def parsear_asignaciones(self, respuesta_llm: str) -> List[Dict[str, Any]]:
        """
        Parsea la respuesta del LLM para extraer asignaciones
        
        Args:
            respuesta_llm: Respuesta del LLM en formato JSON o texto estructurado
        
        Returns:
            Lista de diccionarios con asignaciones:
                - incidencia_id: str - ID de la incidencia
                - usuario_id: str - ID del usuario asignado
                - fecha: str - Fecha asignada (ISO format)
                - hora_inicio: str - Hora de inicio (HH:MM)
                - razon: str - Razón de la asignación
        """
        try:
            # Intentar parsear como JSON primero
            # El LLM puede devolver JSON directamente o dentro de markdown
            respuesta_limpia = respuesta_llm.strip()
            
            # Remover markdown code blocks si existen
            if respuesta_limpia.startswith('```'):
                # Extraer contenido del bloque de código
                lines = respuesta_limpia.split('\n')
                json_lines = []
                in_code_block = False
                for line in lines:
                    if line.strip().startswith('```'):
                        in_code_block = not in_code_block
                        continue
                    if in_code_block:
                        json_lines.append(line)
                respuesta_limpia = '\n'.join(json_lines)
            
            # Convertir saltos de línea escapados (\n) a saltos de línea reales
            # Primero intentar decodificar si viene como string escapado
            if '\\n' in respuesta_limpia:
                try:
                    # Intentar decodificar como string JSON
                    respuesta_limpia = respuesta_limpia.encode().decode('unicode_escape')
                except:
                    # Si falla, reemplazar manualmente
                    respuesta_limpia = respuesta_limpia.replace('\\n', '\n').replace('\\t', '\t')
            
            # Limpiar comas finales antes de cerrar arrays/objetos (JSON inválido pero común)
            # Remover coma antes de ] o }
            respuesta_limpia = re.sub(r',\s*([}\]])', r'\1', respuesta_limpia)
            
            # Intentar parsear JSON
            try:
                data = json.loads(respuesta_limpia)
                
                # Si es una lista directamente
                if isinstance(data, list):
                    return data
                
                # Si es un diccionario con una clave 'asignaciones' o 'assignments'
                if isinstance(data, dict):
                    asignaciones = data.get('asignaciones') or data.get('assignments') or data.get('resultado')
                    if isinstance(asignaciones, list):
                        return asignaciones
                    # Si el diccionario completo es una asignación
                    if 'incidencia_id' in data or 'usuario_id' in data:
                        return [data]
                
            except json.JSONDecodeError as e:
                # Si no es JSON válido, intentar extraer información del texto
                print(f"⚠️ Error al parsear JSON: {str(e)}")
                print(f"⚠️ Respuesta recibida (primeros 500 chars): {respuesta_limpia[:500]}")
                
                # Intentar extraer JSON del texto usando expresiones regulares
                # Buscar el objeto JSON más grande
                json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
                matches = re.findall(json_pattern, respuesta_limpia, re.DOTALL)
                
                if matches:
                    # Intentar parsear el match más grande
                    for match in sorted(matches, key=len, reverse=True):
                        try:
                            # Limpiar comas finales
                            match_limpio = re.sub(r',\s*([}\]])', r'\1', match)
                            data = json.loads(match_limpio)
                            
                            if isinstance(data, dict) and 'asignaciones' in data:
                                asignaciones = data.get('asignaciones')
                                if isinstance(asignaciones, list):
                                    print(f"✅ JSON extraído usando regex: {len(asignaciones)} asignaciones")
                                    return asignaciones
                        except:
                            continue
                
                # Si todo falla, intentar buscar asignaciones individuales
                asignaciones = []
                # Buscar patrones de asignaciones individuales
                asignacion_pattern = r'\{\s*"incidencia_id"\s*:\s*"([^"]+)"\s*,\s*"usuario_id"\s*:\s*"([^"]+)"[^}]*\}'
                matches = re.findall(asignacion_pattern, respuesta_limpia)
                
                if matches:
                    print(f"⚠️ Extraídas {len(matches)} asignaciones usando regex")
                    # Esto es un fallback, mejor retornar vacío y mostrar el error
                
                return []
            
            return []
            
        except Exception as e:
            print(f"❌ Error al parsear asignaciones: {str(e)}")
            import traceback
            print(f"📋 Traceback: {traceback.format_exc()}")
            return []

