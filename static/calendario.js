// Estado de la aplicación
let estado = {
    fechaInicioSemana: null,
    usuarios: [],
    incidencias: [],
    asignaciones: {}, // { usuario_id: { fecha: [incidencias] } }
    autenticado: false,
    usuarioActual: null,
    usuariosFiltrados: null, // null = todos, Set de IDs = usuarios filtrados
    miniCalendarioMes: null, // Mes del mini calendario (0-11)
    miniCalendarioAño: null, // Año del mini calendario
    vistaSimple: false // Vista simple activada/desactivada
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar con la semana actual usando UTC
    const hoy = new Date();
    const año = hoy.getUTCFullYear();
    const mes = hoy.getUTCMonth();
    const dia = hoy.getUTCDate();
    const hoyUTC = new Date(Date.UTC(año, mes, dia));
    
    // Ajustar para obtener el lunes de esta semana (0 = domingo, 1 = lunes, etc.)
    const diaSemana = hoyUTC.getUTCDay();
    const diasHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana; // Si es domingo, retroceder 6 días
    const lunes = new Date(Date.UTC(año, mes, dia + diasHastaLunes));
    estado.fechaInicioSemana = lunes;
    
    // Inicializar mes y año del mini calendario con el mes actual
    estado.miniCalendarioMes = mes;
    estado.miniCalendarioAño = año;
    
    // Verificar estado de autenticación
    verificarAutenticacion();
    
    // Event listeners
    document.getElementById('refrescar-btn').addEventListener('click', cargarDatos);
    
    // Login/Logout - Toggle según estado
    document.getElementById('login-icon').addEventListener('click', () => {
        if (estado.autenticado) {
            cerrarSesion();
        } else {
            mostrarLogin();
        }
    });
    
    document.getElementById('user-icon').addEventListener('click', () => {
        if (estado.autenticado) {
            cerrarSesion();
        } else {
            mostrarLogin();
        }
    });
    document.getElementById('login-form').addEventListener('submit', realizarLogin);
    
    // Cerrar modal
    document.querySelector('.close').addEventListener('click', cerrarModal);
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('login-modal');
        if (e.target === modal) {
            cerrarModal();
        }
    });
    
    // Filtro de usuarios
    document.getElementById('filtro-usuarios-btn').addEventListener('click', toggleFiltroPanel);
    document.getElementById('cerrar-filtro-btn').addEventListener('click', cerrarFiltroPanel);
    document.getElementById('seleccionar-todos-btn').addEventListener('click', seleccionarTodosUsuarios);
    document.getElementById('deseleccionar-todos-btn').addEventListener('click', deseleccionarTodosUsuarios);
    
    // Asignación automática
    document.getElementById('asignar-automatico-btn').addEventListener('click', ejecutarAsignacionAutomatica);
    document.getElementById('reasignar-automatico-btn').addEventListener('click', ejecutarReasignacionAutomatica);
    
    // Navegación de semanas
    document.getElementById('semana-anterior-btn').addEventListener('click', semanaAnterior);
    document.getElementById('semana-siguiente-btn').addEventListener('click', semanaSiguiente);
    
    // Toggle vista simple
    document.getElementById('vista-simple-btn').addEventListener('click', toggleVistaSimple);
    
    // Cargar filtro guardado
    cargarFiltroUsuarios();
});

// Verificar estado de autenticación
async function verificarAutenticacion() {
    try {
        const response = await fetch('/api/auth-status');
        const data = await response.json();
        
        if (data.success && data.authenticated) {
            estado.autenticado = true;
            estado.usuarioActual = data.user_data;
            actualizarUIAutenticacion();
            cargarDatos();
        } else {
            estado.autenticado = false;
            actualizarUIAutenticacion();
        }
    } catch (error) {
        console.error('Error al verificar autenticación:', error);
        estado.autenticado = false;
        actualizarUIAutenticacion();
    }
}

// Realizar login automático
async function realizarLoginAutomatico(username, password) {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            estado.autenticado = true;
            estado.usuarioActual = data.user_data;
            actualizarUIAutenticacion();
            cargarDatos();
            console.log('✅ Login automático exitoso');
        } else {
            console.log('⚠️ Login automático falló:', data.error);
        }
    } catch (error) {
        console.error('Error en login automático:', error);
    }
}

// Actualizar UI de autenticación
function actualizarUIAutenticacion() {
    const loginIcon = document.getElementById('login-icon');
    const userIcon = document.getElementById('user-icon');
    
    if (estado.autenticado && estado.usuarioActual) {
        loginIcon.style.display = 'none';
        userIcon.style.display = 'flex';
        const nombre = estado.usuarioActual.name || 
                     estado.usuarioActual.username || 
                     estado.usuarioActual.nombre || 
                     'Usuario';
        userIcon.title = nombre;
        userIcon.setAttribute('data-usuario', nombre);
    } else {
        loginIcon.style.display = 'flex';
        userIcon.style.display = 'none';
        loginIcon.title = 'Iniciar Sesión';
    }
}

// Mostrar modal de login
function mostrarLogin() {
    document.getElementById('login-modal').style.display = 'block';
}

// Cerrar modal
function cerrarModal() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-form').reset();
}

// Realizar login
async function realizarLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            estado.autenticado = true;
            estado.usuarioActual = data.user_data;
            actualizarUIAutenticacion();
            cerrarModal();
            cargarDatos(); // Recargar datos con autenticación
        } else {
            errorDiv.textContent = data.error || 'Error en el login';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error al realizar login:', error);
        errorDiv.textContent = 'Error de conexión';
        errorDiv.style.display = 'block';
    }
}

// Cerrar sesión
async function cerrarSesion() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            estado.autenticado = false;
            estado.usuarioActual = null;
            actualizarUIAutenticacion();
            // Limpiar datos
            estado.usuarios = [];
            estado.incidencias = [];
            estado.asignaciones = {};
            generarCalendario();
        }
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }
}

// Cargar todos los datos
async function cargarDatos() {
    await Promise.all([
        cargarUsuarios(),
        cargarIncidencias()
    ]);
    
    // Actualizar lista de filtro después de cargar usuarios
    actualizarListaFiltroUsuarios();
    
    // Generar calendario principal primero
    generarCalendario();
    
    // Generar sidebar (el mini calendario se sincronizará automáticamente con la semana visible)
    generarFiltrosTipos();
}

// Cargar usuarios desde la API
async function cargarUsuarios() {
    try {
        const response = await fetch('/api/usuarios');
        const data = await response.json();
        
        if (data.success && data.usuarios && data.usuarios.length > 0) {
            // Ordenar usuarios por nombre
            estado.usuarios = data.usuarios.sort((a, b) => {
                const nombreA = (a.name || a.username || a.nombre || '').toLowerCase();
                const nombreB = (b.name || b.username || b.nombre || '').toLowerCase();
                return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
            });
            console.log('✅ Usuarios cargados:', estado.usuarios.length, '(ordenados por nombre)');
        } else {
            console.warn('⚠️ No se pudieron cargar usuarios desde la API, extrayendo de incidencias...');
            // Extraer usuarios únicos de las incidencias
            const usuariosUnicos = new Map();
            estado.incidencias.forEach(inc => {
                if (inc.usuario) {
                    if (!usuariosUnicos.has(inc.usuario)) {
                        usuariosUnicos.set(inc.usuario, {
                            id: inc.usuario,
                            name: `Usuario ${inc.usuario.substring(0, 8)}`
                        });
                    }
                }
            });
            estado.usuarios = Array.from(usuariosUnicos.values());
            // Ordenar usuarios por nombre
            estado.usuarios.sort((a, b) => {
                const nombreA = (a.name || a.username || a.nombre || '').toLowerCase();
                const nombreB = (b.name || b.username || b.nombre || '').toLowerCase();
                return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
            });
            console.log('✅ Usuarios extraídos de incidencias:', estado.usuarios.length, '(ordenados por nombre)');
        }
    } catch (error) {
        console.error('❌ Error al cargar usuarios:', error);
        // Extraer usuarios de incidencias como fallback
        const usuariosUnicos = new Map();
        estado.incidencias.forEach(inc => {
            if (inc.usuario) {
                if (!usuariosUnicos.has(inc.usuario)) {
                    usuariosUnicos.set(inc.usuario, {
                        id: inc.usuario,
                        name: `Usuario ${inc.usuario.substring(0, 8)}`
                    });
                }
            }
        });
        estado.usuarios = Array.from(usuariosUnicos.values());
        // Ordenar usuarios por nombre
        estado.usuarios.sort((a, b) => {
            const nombreA = (a.name || a.username || a.nombre || '').toLowerCase();
            const nombreB = (b.name || b.username || b.nombre || '').toLowerCase();
            return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
        });
    }
}

// Cargar incidencias
async function cargarIncidencias() {
    try {
        const response = await fetch('/api/incidencias');
        const data = await response.json();
        
        if (data.success) {
            estado.incidencias = data.incidencias || [];
            console.log('Incidencias cargadas:', estado.incidencias.length);
            
            // Organizar incidencias por usuario y fecha
            organizarIncidencias();
            mostrarIncidenciasLibres();
        } else {
            console.error('Error al cargar incidencias:', data.error);
            estado.incidencias = [];
        }
    } catch (error) {
        console.error('Error al cargar incidencias:', error);
        estado.incidencias = [];
    }
}

// Función auxiliar para ajustar fecha de fin de semana a día laboral
function ajustarFechaFinSemana(fechaStr) {
    // Parsear la fecha manualmente para evitar problemas de zona horaria
    // Formato esperado: YYYY-MM-DD
    const partes = fechaStr.split('-');
    if (partes.length !== 3) return fechaStr;
    
    const año = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10) - 1; // Los meses en Date son 0-indexados
    const dia = parseInt(partes[2], 10);
    
    // Crear fecha en UTC para evitar problemas de zona horaria
    const fecha = new Date(Date.UTC(año, mes, dia));
    const diaSemana = fecha.getUTCDay(); // 0 = Domingo, 6 = Sábado
    
    // Si es sábado (6), mover a viernes (restar 1 día)
    if (diaSemana === 6) {
        fecha.setUTCDate(fecha.getUTCDate() - 1);
        return fecha.toISOString().split('T')[0];
    }
    
    // Si es domingo (0), mover a lunes (sumar 1 día)
    if (diaSemana === 0) {
        fecha.setUTCDate(fecha.getUTCDate() + 1);
        return fecha.toISOString().split('T')[0];
    }
    
    // Si es día laboral, devolver la fecha original
    return fechaStr;
}

// Organizar incidencias por usuario y fecha
function organizarIncidencias() {
    estado.asignaciones = {};
    
    // Organizar incidencias (solo las que tienen usuario válido)
    estado.incidencias.forEach(incidencia => {
        const usuarioId = incidencia.usuario;
        // Verificar que el usuario existe y no está vacío
        if (usuarioId && usuarioId !== null && usuarioId !== undefined && String(usuarioId).trim() !== '') {
            if (!estado.asignaciones[usuarioId]) {
                estado.asignaciones[usuarioId] = {};
            }
            
            // Usar la fecha de la incidencia o la fecha actual si no tiene
            let fecha = incidencia.fecha || new Date().toISOString().split('T')[0];
            const fechaOriginal = fecha; // Guardar fecha original antes de ajustar
            
            // Ajustar fecha si es fin de semana: sábado -> viernes, domingo -> lunes
            const fechaAjustada = ajustarFechaFinSemana(fecha);
            
            // Si la fecha cambió, actualizar la incidencia y moverla en el backend
            if (fechaAjustada !== fechaOriginal) {
                console.log(`[INFO] Moviendo incidencia ${incidencia.no} de ${fechaOriginal} (fin de semana) a ${fechaAjustada}`);
                fecha = fechaAjustada;
                
                // Actualizar la fecha de la incidencia localmente
                incidencia.fecha = fechaAjustada;
                
                // Mover la incidencia en el backend de forma asíncrona (sin bloquear)
                moverIncidenciaSilenciosa(incidencia.no, usuarioId, fechaOriginal, fechaAjustada);
            }
            
            if (!estado.asignaciones[usuarioId][fecha]) {
                estado.asignaciones[usuarioId][fecha] = [];
            }
            
            estado.asignaciones[usuarioId][fecha].push(incidencia);
        }
        // Las incidencias sin usuario se mostrarán en "incidencias sin asignar"
    });
    
    console.log('📊 Incidencias organizadas:', Object.keys(estado.asignaciones).length, 'usuarios con asignaciones');
}

// Mover incidencia de forma silenciosa (sin mostrar alertas)
async function moverIncidenciaSilenciosa(noIncidencia, usuarioId, fechaOriginal, fechaNueva) {
    try {
        const response = await fetch('/api/mover-incidencia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                no: noIncidencia,
                nueva_fecha: fechaNueva,
                nuevo_usuario_id: usuarioId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            console.log(`[OK] Incidencia ${noIncidencia} movida automáticamente de ${fechaOriginal} a ${fechaNueva}`);
        } else {
            console.warn(`[WARN] No se pudo mover automáticamente la incidencia ${noIncidencia}:`, data.error);
        }
    } catch (error) {
        console.error('Error al mover incidencia automáticamente:', error);
    }
}

// Generar calendario
function generarCalendario() {
    const tabla = document.getElementById('calendario-tabla');
    const thead = tabla.querySelector('thead tr');
    const tbody = document.getElementById('calendario-body');
    
    // Limpiar
    thead.innerHTML = '<th class="col-usuario">Usuario</th>';
    tbody.innerHTML = '';
    
    // Generar encabezados de días (solo 5 días: lunes a viernes)
    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const hoyStr = hoy.toISOString().split('T')[0];
    
    for (let i = 0; i < 5; i++) {
        // Obtener fecha en UTC para evitar problemas de zona horaria
        const fechaInicio = estado.fechaInicioSemana;
        const año = fechaInicio.getUTCFullYear();
        const mes = fechaInicio.getUTCMonth();
        const dia = fechaInicio.getUTCDate();
        const fecha = new Date(Date.UTC(año, mes, dia + i));
        
        const fechaStr = fecha.toISOString().split('T')[0];
        // Comparar solo las fechas (sin horas)
        const esHoy = fechaStr === hoyStr;
        
        const th = document.createElement('th');
        th.className = `col-dia ${esHoy ? 'hoy' : ''}`;
        th.textContent = `${diasSemana[i]} ${fecha.getUTCDate()}/${fecha.getUTCMonth() + 1}`;
        th.dataset.fecha = fechaStr;
        thead.appendChild(th);
    }
    
    // Actualizar título de la semana (lunes a viernes)
    const fechaInicio = estado.fechaInicioSemana;
    const añoInicio = fechaInicio.getUTCFullYear();
    const mesInicio = fechaInicio.getUTCMonth();
    const diaInicio = fechaInicio.getUTCDate();
    const fechaFin = new Date(Date.UTC(añoInicio, mesInicio, diaInicio + 4)); // Viernes (4 días después del lunes)
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    document.getElementById('semana-actual').textContent = 
        `Semana Laboral: ${fechaInicio.getUTCDate()} ${meses[fechaInicio.getUTCMonth()]} - ` +
        `${fechaFin.getUTCDate()} ${meses[fechaFin.getUTCMonth()]} ${fechaFin.getUTCFullYear()}`;
    
        // Obtener usuarios a mostrar (aplicar filtro si existe)
        let usuariosAMostrar = estado.usuarios;
        if (estado.usuariosFiltrados !== null) {
            usuariosAMostrar = estado.usuarios.filter(usuario => {
                const usuarioId = String(usuario.id || usuario.user_id || usuario.userId || usuario._id || '');
                return estado.usuariosFiltrados.has(usuarioId);
            });
        }
        
        // Generar filas de usuarios
        if (usuariosAMostrar.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = estado.usuariosFiltrados !== null 
                ? 'No hay usuarios seleccionados en el filtro. Usa el botón "Filtrar Usuarios" para seleccionar usuarios.'
                : 'No hay usuarios disponibles. Haz clic en "Refrescar" para cargar datos.';
            td.style.textAlign = 'center';
            td.style.padding = '20px';
            td.style.color = '#666';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        
        usuariosAMostrar.forEach(usuario => {
            const tr = document.createElement('tr');
            
            // Obtener ID del usuario de diferentes formas posibles
            const usuarioId = String(usuario.id || usuario.user_id || usuario.userId || usuario._id || JSON.stringify(usuario));
            const nombreUsuario = usuario.name || usuario.username || usuario.nombre || `Usuario ${usuarioId.substring(0, 8)}`;
            
            // Celda de usuario
            const tdUsuario = document.createElement('td');
            tdUsuario.className = 'celda-usuario';
            tdUsuario.textContent = nombreUsuario;
            tr.appendChild(tdUsuario);
            
            // Celdas de días (solo 5 días: lunes a viernes)
            for (let i = 0; i < 5; i++) {
                // Obtener fecha en UTC para evitar problemas de zona horaria
                const fechaInicio = estado.fechaInicioSemana;
                const año = fechaInicio.getUTCFullYear();
                const mes = fechaInicio.getUTCMonth();
                const dia = fechaInicio.getUTCDate();
                const fecha = new Date(Date.UTC(año, mes, dia + i));
                
                const fechaStr = fecha.toISOString().split('T')[0];
                
                const td = document.createElement('td');
                td.className = 'celda-dia';
                
                // Comparar solo las fechas (sin horas)
                const esHoy = fechaStr === hoyStr;
                if (esHoy) {
                    td.classList.add('hoy');
                }
                
                td.dataset.usuario = usuarioId;
                td.dataset.fecha = fechaStr;
            
            // Agregar incidencias del usuario para este día
            // Normalizar usuarioId para comparación
            const usuarioIdNormalizado = String(usuarioId);
            
            // Recopilar todas las incidencias para este usuario y fecha
            let incidenciasParaAgregar = [];
            
            // Buscar incidencias para este usuario y fecha
            if (estado.asignaciones[usuarioIdNormalizado] && estado.asignaciones[usuarioIdNormalizado][fechaStr]) {
                estado.asignaciones[usuarioIdNormalizado][fechaStr].forEach(incidencia => {
                    // Verificar si el tipo de incidencia está filtrado
                    if (debeMostrarIncidencia(incidencia)) {
                        incidenciasParaAgregar.push(incidencia);
                    }
                });
            }
            
            // También buscar por otros formatos de ID
            Object.keys(estado.asignaciones).forEach(key => {
                if (key === usuarioIdNormalizado) return; // Ya procesado
                // Intentar comparar de diferentes formas
                if (estado.asignaciones[key] && estado.asignaciones[key][fechaStr]) {
                    estado.asignaciones[key][fechaStr].forEach(incidencia => {
                        // Verificar si la incidencia pertenece a este usuario
                        const incUsuarioId = String(incidencia.usuario || '');
                        if (incUsuarioId === usuarioIdNormalizado || 
                            incUsuarioId.includes(usuarioIdNormalizado) ||
                            usuarioIdNormalizado.includes(incUsuarioId)) {
                            // Verificar si el tipo de incidencia está filtrado
                            if (debeMostrarIncidencia(incidencia)) {
                                incidenciasParaAgregar.push(incidencia);
                            }
                        }
                    });
                }
            });
            
            // Ordenar por hora si está en vista simple
            if (estado.vistaSimple) {
                incidenciasParaAgregar.sort((a, b) => {
                    const horaA = a.fecha_hora ? new Date(a.fecha_hora).getTime() : 0;
                    const horaB = b.fecha_hora ? new Date(b.fecha_hora).getTime() : 0;
                    return horaA - horaB;
                });
            }
            
            // Agregar incidencias ordenadas
            incidenciasParaAgregar.forEach(incidencia => {
                const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                td.appendChild(incDiv);
            });
            
            // Hacer la celda droppable
            td.addEventListener('dragover', (e) => {
                e.preventDefault();
                td.classList.add('drag-over');
            });
            
            td.addEventListener('dragleave', () => {
                td.classList.remove('drag-over');
            });
            
            td.addEventListener('drop', (e) => {
                e.preventDefault();
                td.classList.remove('drag-over');
                
                const incidenciaNo = e.dataTransfer.getData('text/plain');
                const datos = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                
                moverIncidencia(incidenciaNo, datos.usuarioId, datos.fecha, usuarioId, fechaStr);
            });
            
            tr.appendChild(td);
        }
        
        tbody.appendChild(tr);
    });
    
    // Asegurar que las incidencias sin asignar se muestren
    mostrarIncidenciasLibres();
    
    // Sincronizar mini calendario con la semana visible
    actualizarMiniCalendarioDesdeSemana();
}

// Función para verificar si una incidencia debe mostrarse según los filtros
function debeMostrarIncidencia(incidencia) {
    const checkboxes = document.querySelectorAll('.filtro-tipo-checkbox');
    if (checkboxes.length === 0) return true; // Si no hay filtros, mostrar todas
    
    const tipoIncidencia = incidencia.tipo_incidencia || '';
    let algunoSeleccionado = false;
    let tipoSeleccionado = false;
    
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            algunoSeleccionado = true;
            if (checkbox.value === tipoIncidencia) {
                tipoSeleccionado = true;
            }
        }
    });
    
    // Si no hay ningún tipo seleccionado, mostrar todas
    if (!algunoSeleccionado) return true;
    
    // Si el tipo de la incidencia está seleccionado, mostrarla
    return tipoSeleccionado;
}

// Función para obtener color según tipo de incidencia
function obtenerColorPorTipo(tipoIncidencia) {
    if (!tipoIncidencia) return 'tipo-default';
    
    // Normalizar el tipo de incidencia para comparación
    const tipo = String(tipoIncidencia).toLowerCase().trim();
    
    // Mapeo de tipos de incidencia a clases CSS
    const mapeoTipos = {
        'incidencias emt': 'tipo-emt',
        'emt': 'tipo-emt',
        'mantenimiento': 'tipo-mantenimiento',
        'reparación': 'tipo-reparacion',
        'reparacion': 'tipo-reparacion',
        'instalación': 'tipo-instalacion',
        'instalacion': 'tipo-instalacion',
        'revisión': 'tipo-revision',
        'revision': 'tipo-revision',
        'limpieza': 'tipo-limpieza',
        'otras': 'tipo-otras',
        'otra': 'tipo-otras'
    };
    
    // Buscar coincidencia exacta o parcial
    for (const [key, className] of Object.entries(mapeoTipos)) {
        if (tipo.includes(key) || key.includes(tipo)) {
            return className;
        }
    }
    
    return 'tipo-default';
}

// Crear elemento de incidencia
function crearElementoIncidencia(incidencia, usuarioId, fecha) {
    const div = document.createElement('div');
    // Usar tipo de incidencia para el color en lugar del estado
    const tipoClase = obtenerColorPorTipo(incidencia.tipo_incidencia);
    
    // Si está en vista simple, usar clase diferente
    if (estado.vistaSimple) {
        div.className = `incidencia incidencia-simple ${tipoClase}`;
    } else {
        div.className = `incidencia ${tipoClase}`;
    }
    
    div.draggable = true;
    div.dataset.no = incidencia.no;
    div.dataset.usuario = usuarioId;
    div.dataset.fecha = fecha;
    
    // Mostrar descripción como elemento principal (más importante)
    const descripcion = incidencia.descripcion || 'Sin descripción';
    const descripcionCorta = descripcion.length > 40 ? descripcion.substring(0, 40) + '...' : descripcion;
    const recurso = incidencia.recurso || 'N/A';
    
    // Formatear hora si existe fecha_hora
    let horaHTML = '';
    if (incidencia.fecha_hora) {
        try {
            const fechaHora = new Date(incidencia.fecha_hora);
            const horas = String(fechaHora.getHours()).padStart(2, '0');
            const minutos = String(fechaHora.getMinutes()).padStart(2, '0');
            horaHTML = `<span class="incidencia-hora">${horas}:${minutos}</span>`;
        } catch (e) {
            // Si hay error al parsear, no mostrar hora
        }
    }
    
    // Crear tooltip si está en vista simple
    let tooltipId = null;
    const urlImagen = incidencia.url_primera_imagen || null;
    
    if (estado.vistaSimple) {
        // Crear tooltip con descripción completa e imagen
        tooltipId = `tooltip-calendario-${incidencia.no.replace(/[^a-zA-Z0-9]/g, '-')}`;
        div.dataset.tooltipId = tooltipId;
        
        // Vista simple: hora arriba con línea roja, luego incidencia en cuadro gris
        div.innerHTML = `
            ${horaHTML ? `<div class="incidencia-hora-container">${horaHTML}<div class="incidencia-hora-linea"></div></div>` : ''}
            <div class="incidencia-simple-box">
                <div class="incidencia-simple-header">
                    <span class="incidencia-simple-no">${incidencia.no}</span>
                    <span class="incidencia-simple-recurso">${recurso}</span>
                    <span class="incidencia-editar" data-id-gtask="${incidencia.id_gtask || incidencia.no}" title="Ver detalle">✎</span>
                </div>
                <div class="incidencia-simple-descripcion">${descripcionCorta}</div>
            </div>
        `;
        
        // Crear tooltip fuera del contenedor para evitar problemas de overflow
        const tooltip = document.createElement('div');
        tooltip.id = tooltipId;
        tooltip.className = 'incidencia-libre-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-contenido">
                ${urlImagen ? `<img src="${urlImagen}" alt="Imagen" class="tooltip-imagen" onerror="this.style.display='none'">` : ''}
                <div class="tooltip-descripcion">${descripcion}</div>
            </div>
        `;
        document.body.appendChild(tooltip);
    } else {
        // Vista normal: con imagen y más espacio
        let imagenHTML = '';
        if (incidencia.url_primera_imagen) {
            imagenHTML = `<img src="${incidencia.url_primera_imagen}" alt="Imagen" class="incidencia-miniatura" onerror="this.style.display='none'">`;
        }
        
        div.innerHTML = `
            <div class="incidencia-header">
                <span class="incidencia-editar" data-id-gtask="${incidencia.id_gtask || incidencia.no}" title="Ver detalle">
                    ✏️
                </span>
            </div>
            ${imagenHTML}
            <div class="incidencia-descripcion">${descripcionCorta}</div>
            <div class="incidencia-no">${incidencia.no}</div>
        `;
    }
    
    // Agregar event listener para el botón de editar
    const editBtn = div.querySelector('.incidencia-editar');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que se active el drag
            const idGtask = editBtn.dataset.idGtask;
            abrirDetalleIncidencia(idGtask);
        });
    }
    
    // Event listeners para tooltip en vista simple
    if (estado.vistaSimple && tooltipId) {
        div.addEventListener('mouseenter', (e) => {
            const tooltip = document.getElementById(tooltipId);
            if (tooltip) {
                // Obtener posición del elemento
                const rect = div.getBoundingClientRect();
                
                // Mostrar tooltip temporalmente fuera de pantalla para calcular dimensiones
                tooltip.style.display = 'block';
                tooltip.style.opacity = '0';
                tooltip.style.top = '-9999px';
                tooltip.style.left = '-9999px';
                
                // Forzar reflow para que el navegador calcule las dimensiones
                void tooltip.offsetWidth;
                
                // Calcular dimensiones del tooltip
                const tooltipRect = tooltip.getBoundingClientRect();
                
                // Posicionar arriba de la tarjeta, centrado
                let top = rect.top - tooltipRect.height - 8;
                let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                
                // Ajustar si se sale por la izquierda
                if (left < 10) {
                    left = 10;
                }
                
                // Ajustar si se sale por la derecha
                if (left + tooltipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipRect.width - 10;
                }
                
                // Ajustar si se sale por arriba
                if (top < 10) {
                    top = rect.bottom + 8; // Mostrar abajo en su lugar
                }
                
                // Aplicar posición y mostrar con transición
                tooltip.style.top = `${top}px`;
                tooltip.style.left = `${left}px`;
                // Usar setTimeout para permitir que el navegador aplique la posición antes de mostrar
                setTimeout(() => {
                    tooltip.style.opacity = '1';
                }, 10);
            }
        });
        
        div.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById(tooltipId);
            if (tooltip) {
                tooltip.style.opacity = '0';
                setTimeout(() => {
                    tooltip.style.display = 'none';
                }, 200); // Esperar a que termine la transición
            }
        });
    }
    
    // Event listeners para drag & drop
    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', incidencia.no);
        e.dataTransfer.setData('application/json', JSON.stringify({
            usuarioId: usuarioId,
            fecha: fecha
        }));
        div.classList.add('dragging');
        // Ocultar tooltip al arrastrar
        if (tooltipId) {
            const tooltip = document.getElementById(tooltipId);
            if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
            }
        }
    });
    
    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });
    
    return div;
}

// Toggle vista simple
function toggleVistaSimple() {
    estado.vistaSimple = !estado.vistaSimple;
    const btn = document.getElementById('vista-simple-btn');
    if (estado.vistaSimple) {
        btn.textContent = '🖼️ Vista Normal';
        btn.title = 'Cambiar a vista normal';
    } else {
        btn.textContent = '📋 Vista Simple';
        btn.title = 'Cambiar a vista simple';
    }
    // Regenerar calendario para aplicar los cambios
    generarCalendario();
}

// Mover incidencia
async function moverIncidencia(noIncidencia, usuarioOrigen, fechaOrigen, usuarioDestino, fechaDestino) {
    // Mostrar overlay de carga
    mostrarOverlayCarga();
    actualizarMensajeOverlay('Moviendo incidencia...');
    
    try {
        const response = await fetch('/api/mover-incidencia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                no: noIncidencia,
                nueva_fecha: fechaDestino,
                nuevo_usuario_id: usuarioDestino
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Actualizar mensaje del overlay
            actualizarMensajeOverlay('Refrescando incidencias...');
            
            // Refrescar incidencias explícitamente
            await cargarIncidencias();
            
            // Actualizar mensaje del overlay
            actualizarMensajeOverlay('Actualizando calendario...');
            
            // Regenerar calendario para mostrar los cambios
            generarCalendario();
            
            console.log(`✅ Incidencia ${noIncidencia} movida correctamente. Datos refrescados.`);
        } else {
            alert('Error al mover incidencia: ' + data.error);
        }
    } catch (error) {
        console.error('Error al mover incidencia:', error);
        alert('Error al mover la incidencia');
    } finally {
        // Ocultar overlay de carga
        ocultarOverlayCarga();
    }
}

// Crear elemento de incidencia simplificado (sin foto, solo número, recurso y descripción)
function crearElementoIncidenciaSimplificado(incidencia) {
    const div = document.createElement('div');
    div.className = 'incidencia-libre-item';
    div.draggable = true;
    div.dataset.no = incidencia.no;
    
    const descripcion = incidencia.descripcion || 'Sin descripción';
    const descripcionCorta = descripcion.length > 10 ? descripcion.substring(0, 10) + '...' : descripcion;
    const recurso = incidencia.recurso || 'N/A';
    const urlImagen = incidencia.url_primera_imagen || null;
    
    // Crear tooltip con descripción completa e imagen
    const tooltipId = `tooltip-${incidencia.no.replace(/[^a-zA-Z0-9]/g, '-')}`;
    div.dataset.tooltipId = tooltipId;
    div.dataset.descripcionCompleta = descripcion;
    if (urlImagen) {
        div.dataset.urlImagen = urlImagen;
    }
    
    div.innerHTML = `
        <div class="incidencia-libre-header">
            <span class="incidencia-libre-no">${incidencia.no}</span>
            <span class="incidencia-libre-editar" data-id-gtask="${incidencia.id_gtask || incidencia.no}" title="Ver detalle">✎</span>
        </div>
        <div class="incidencia-libre-linea2">
            <span class="incidencia-libre-recurso">📍 ${recurso}</span>
            <span class="incidencia-libre-descripcion">${descripcionCorta}</span>
        </div>
    `;
    
    // Crear tooltip fuera del contenedor para evitar problemas de overflow
    const tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'incidencia-libre-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-contenido">
            ${urlImagen ? `<img src="${urlImagen}" alt="Imagen" class="tooltip-imagen" onerror="this.style.display='none'">` : ''}
            <div class="tooltip-descripcion">${descripcion}</div>
        </div>
    `;
    document.body.appendChild(tooltip);
    
    // Agregar event listener para el botón de editar
    const editBtn = div.querySelector('.incidencia-libre-editar');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idGtask = editBtn.dataset.idGtask;
            abrirDetalleIncidencia(idGtask);
        });
    }
    
    // Event listeners para mostrar/ocultar tooltip
    div.addEventListener('mouseenter', (e) => {
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            // Obtener posición del elemento
            const rect = div.getBoundingClientRect();
            
            // Mostrar tooltip temporalmente fuera de pantalla para calcular dimensiones
            tooltip.style.display = 'block';
            tooltip.style.opacity = '0';
            tooltip.style.top = '-9999px';
            tooltip.style.left = '-9999px';
            
            // Forzar reflow para que el navegador calcule las dimensiones
            void tooltip.offsetWidth;
            
            // Calcular dimensiones del tooltip
            const tooltipRect = tooltip.getBoundingClientRect();
            
            // Posicionar arriba de la tarjeta, centrado
            let top = rect.top - tooltipRect.height - 8;
            let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            
            // Ajustar si se sale por la izquierda
            if (left < 10) {
                left = 10;
            }
            
            // Ajustar si se sale por la derecha
            if (left + tooltipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tooltipRect.width - 10;
            }
            
            // Ajustar si se sale por arriba
            if (top < 10) {
                top = rect.bottom + 8; // Mostrar abajo en su lugar
            }
            
            // Aplicar posición y mostrar con transición
            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
            // Usar setTimeout para permitir que el navegador aplique la posición antes de mostrar
            setTimeout(() => {
                tooltip.style.opacity = '1';
            }, 10);
        }
    });
    
    div.addEventListener('mouseleave', () => {
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            tooltip.style.opacity = '0';
            setTimeout(() => {
                tooltip.style.display = 'none';
            }, 200); // Esperar a que termine la transición
        }
    });
    
    // Event listeners para drag & drop
    div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', incidencia.no);
        e.dataTransfer.setData('application/json', JSON.stringify({
            usuarioId: null,
            fecha: null
        }));
        div.classList.add('dragging');
        // Ocultar tooltip al arrastrar
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    });
    
    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });
    
    return div;
}

// Mostrar incidencias libres (sin asignar o de usuarios no filtrados) agrupadas por tipo
function mostrarIncidenciasLibres() {
    const container = document.getElementById('lista-incidencias-libres');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Obtener IDs de usuarios filtrados
    const usuariosFiltradosSet = estado.usuariosFiltrados;
    
    // Filtrar incidencias:
    // 1. Sin usuario asignado
    // 2. O asignadas a usuarios que no están en el filtro
    const incidenciasLibres = estado.incidencias.filter(inc => {
        const usuario = inc.usuario;
        
        // Si no tiene usuario, está libre
        if (!usuario || usuario === null || usuario === undefined || usuario === '' || usuario.trim() === '') {
            return true;
        }
        
        // Si hay filtro activo y el usuario no está en el filtro, mostrar como libre
        if (usuariosFiltradosSet !== null) {
            const usuarioId = String(usuario);
            // Buscar si el usuario está en el filtro
            let usuarioEnFiltro = false;
            for (const u of estado.usuarios) {
                const id = String(u.id || u.user_id || u.userId || u._id || '');
                if (id === usuarioId || id.includes(usuarioId) || usuarioId.includes(id)) {
                    // Verificar si este usuario está en el filtro
                    if (usuariosFiltradosSet.has(id)) {
                        usuarioEnFiltro = true;
                        break;
                    }
                }
            }
            return !usuarioEnFiltro;
        }
        
        return false;
    });
    
    console.log(`📋 Incidencias sin asignar o de usuarios no filtrados: ${incidenciasLibres.length} de ${estado.incidencias.length} totales`);
    
    if (incidenciasLibres.length === 0) {
        container.innerHTML = '<p style="color: #666;">No hay incidencias sin asignar</p>';
        return;
    }
    
    // Agrupar incidencias por tipo
    const incidenciasPorTipo = {};
    incidenciasLibres.forEach(inc => {
        const tipo = inc.tipo_incidencia || 'Sin tipo';
        if (!incidenciasPorTipo[tipo]) {
            incidenciasPorTipo[tipo] = [];
        }
        incidenciasPorTipo[tipo].push(inc);
    });
    
    // Crear grupos colapsables por tipo
    Object.keys(incidenciasPorTipo).sort().forEach(tipo => {
        const incidencias = incidenciasPorTipo[tipo];
        const tipoClase = obtenerColorPorTipo(tipo);
        
        // Crear contenedor del grupo
        const grupoDiv = document.createElement('div');
        grupoDiv.className = 'grupo-tipo-incidencia';
        
        // Crear header del grupo (colapsable)
        const headerDiv = document.createElement('div');
        headerDiv.className = 'grupo-tipo-header';
        headerDiv.innerHTML = `
            <span class="grupo-tipo-icon">▶</span>
            <span class="grupo-tipo-nombre">${tipo}</span>
            <span class="grupo-tipo-contador">(${incidencias.length})</span>
        `;
        
        // Crear contenedor de incidencias (inicialmente oculto)
        const incidenciasDiv = document.createElement('div');
        incidenciasDiv.className = 'grupo-tipo-incidencias';
        incidenciasDiv.style.display = 'none';
        
        // Agregar incidencias al contenedor
        incidencias.forEach(incidencia => {
            const incDiv = crearElementoIncidenciaSimplificado(incidencia);
            incidenciasDiv.appendChild(incDiv);
        });
        
        // Event listener para expandir/colapsar
        headerDiv.addEventListener('click', () => {
            const estaExpandido = incidenciasDiv.style.display !== 'none';
            const icon = headerDiv.querySelector('.grupo-tipo-icon');
            
            if (estaExpandido) {
                incidenciasDiv.style.display = 'none';
                icon.textContent = '▶';
                headerDiv.classList.remove('expandido');
            } else {
                incidenciasDiv.style.display = 'flex';
                icon.textContent = '▼';
                headerDiv.classList.add('expandido');
            }
        });
        
        grupoDiv.appendChild(headerDiv);
        grupoDiv.appendChild(incidenciasDiv);
        container.appendChild(grupoDiv);
    });
}

// Variable global para almacenar el detalle actual y el id_gtask
let detalleActual = null;
let idGtaskActual = null;

// Objeto para almacenar las rotaciones de las imágenes (URL -> grados: 0, 90, 180, 270)
let rotacionesImagenes = {};

// Abrir modal de detalle de incidencia
async function abrirDetalleIncidencia(idGtask) {
    const modal = document.getElementById('detalle-modal');
    const contenido = document.getElementById('detalle-contenido');
    
    // Guardar el id_gtask actual
    idGtaskActual = idGtask;
    
    // Mostrar modal con loading
    contenido.innerHTML = '<div class="loading">Cargando detalle de la incidencia...</div>';
    modal.style.display = 'block';
    
    try {
        const response = await fetch(`/api/detalle-incidencia/${idGtask}`);
        const data = await response.json();
        
        if (data.success && data.detalle) {
            detalleActual = data.detalle;
            mostrarDetalleIncidencia(data.detalle);
        } else {
            contenido.innerHTML = `
                <div class="error-message">
                    <p>❌ Error al cargar el detalle de la incidencia</p>
                    <p>${data.error || 'Error desconocido'}</p>
                </div>
            `;
        }
    } catch (error) {
        contenido.innerHTML = `
            <div class="error-message">
                <p>❌ Error de conexión</p>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// Obtener nombre de usuario por ID
function obtenerNombreUsuario(userId) {
    if (!userId) return 'N/A';
    
    // Buscar en la lista de usuarios cargados
    const usuario = estado.usuarios.find(u => {
        const id = String(u.id || u.user_id || u.userId || u._id || '');
        return id === String(userId) || id.includes(String(userId)) || String(userId).includes(id);
    });
    
    if (usuario) {
        return usuario.name || usuario.username || usuario.nombre || String(userId);
    }
    
    // Si no se encuentra, devolver el ID
    return String(userId);
}

// Mostrar detalle de incidencia en el modal
function mostrarDetalleIncidencia(detalle) {
    const contenido = document.getElementById('detalle-contenido');
    
    // Formatear fecha
    let fechaHTML = '';
    if (detalle.fecha) {
        try {
            const fecha = new Date(detalle.fecha);
            fechaHTML = fecha.toLocaleString('es-ES');
        } catch {
            fechaHTML = detalle.fecha;
        }
    }
    
    // Obtener nombre del usuario usando el ID
    const userId = detalle.user || detalle.user_name;
    const nombreUsuario = obtenerNombreUsuario(userId);
    
    // Formatear geolocalización (puntoX es longitud, puntoY es latitud) - solo el icono
    let geolocalizacionIcono = '';
    if (detalle.puntoX && detalle.puntoY) {
        const lng = parseFloat(detalle.puntoX); // Longitud
        const lat = parseFloat(detalle.puntoY); // Latitud
        if (!isNaN(lat) && !isNaN(lng)) {
            const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
            geolocalizacionIcono = `
                <a href="${mapsUrl}" target="_blank" class="geolocalizacion-icon" title="Abrir en Google Maps" style="margin-left: 10px; text-decoration: none; font-size: 1.2em;">
                    📍
                </a>
            `;
        }
    }
    
    // Formatear imágenes
    let imagenesHTML = '';
    if (detalle.image && Array.isArray(detalle.image) && detalle.image.length > 0) {
        imagenesHTML = '<div class="detalle-imagenes"><h3>Imágenes:</h3><div class="galeria-imagenes">';
        detalle.image.forEach((img, index) => {
            if (img.url) {
                // Obtener rotación guardada o usar la rotación por defecto
                const rotacionGuardada = rotacionesImagenes[img.url] || 0;
                const esVertical = esImagenVertical(img.url);
                const rotacionInicial = esVertical ? 90 : 0;
                const rotacionTotal = (rotacionInicial + rotacionGuardada) % 360;
                
                // Clase CSS para la rotación visual
                let claseRotacion = '';
                if (rotacionTotal === 90 || rotacionTotal === 270) {
                    claseRotacion = 'imagen-vertical-rotada';
                }
                const claseContenedor = (rotacionTotal === 90 || rotacionTotal === 270) ? 'imagen-item-vertical' : '';
                
                // Estilo inline para la rotación exacta
                const estiloRotacion = `transform: rotate(${rotacionTotal}deg);`;
                
                imagenesHTML += `
                    <div class="imagen-item ${claseContenedor}" data-image-url="${img.url}" data-image-index="${index}">
                        <div class="imagen-rotar-btn" onclick="rotarImagen('${img.url}', event)" title="Rotar imagen 90°">🔄</div>
                        <img src="${img.url}" alt="${img.name || 'Imagen'}" 
                             class="${claseRotacion}" 
                             style="${estiloRotacion}"
                             onclick="abrirImagenGrande('${img.url}')">
                    </div>
                `;
            }
        });
        imagenesHTML += '</div></div>';
    }
    
    // Preparar fecha/hora para el input datetime-local
    let fechaHoraInput = '';
    if (detalle.fecha) {
        try {
            const fecha = new Date(detalle.fecha);
            // Formato para input datetime-local: YYYY-MM-DDTHH:mm
            const year = fecha.getFullYear();
            const month = String(fecha.getMonth() + 1).padStart(2, '0');
            const day = String(fecha.getDate()).padStart(2, '0');
            const hours = String(fecha.getHours()).padStart(2, '0');
            const minutes = String(fecha.getMinutes()).padStart(2, '0');
            fechaHoraInput = `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch {
            fechaHoraInput = '';
        }
    }
    
    // Limpiar HTML de la descripción para el textarea
    let descripcionTexto = detalle.description || 'Sin descripción';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = descripcionTexto;
    descripcionTexto = tempDiv.textContent || tempDiv.innerText || descripcionTexto;
    
    contenido.innerHTML = `
        <div class="detalle-incidencia">
            <div class="detalle-campo">
                <label>Descripción:</label>
                <textarea id="edit-descripcion" class="detalle-input" rows="4">${descripcionTexto}</textarea>
            </div>
            <div style="display: flex; gap: 20px; align-items: flex-start;">
                <div class="detalle-campo" style="flex: 1;">
                    <label>Estado:</label>
                    <p><span class="estado-badge estado-${(detalle.state || '').toLowerCase()}">${formatearEstado(detalle.state) || 'N/A'}</span></p>
                </div>
                <div class="detalle-campo" style="flex: 1;">
                    <label>Fecha/Hora:</label>
                    <input type="datetime-local" id="edit-fecha-hora" class="detalle-input" value="${fechaHoraInput}">
                </div>
            </div>
            <div style="display: flex; gap: 20px; align-items: flex-start;">
                <div class="detalle-campo" style="flex: 1;">
                    <label>Tipo de Incidencia:</label>
                    <p>${detalle.incidenceType || 'N/A'}</p>
                </div>
                <div class="detalle-campo" style="flex: 1;">
                    <label>Usuario:</label>
                    <p>${nombreUsuario}</p>
                </div>
            </div>
            <div class="detalle-campo">
                <label>Elemento:${geolocalizacionIcono}</label>
                <div style="position: relative;">
                    <input type="text" id="edit-resource" class="detalle-input" 
                           value="${detalle.resource || ''}" 
                           placeholder="Buscar elemento..."
                           autocomplete="off">
                    <div id="resource-autocomplete" class="autocomplete-dropdown" style="display: none;"></div>
                </div>
                ${detalle.resource_name ? `<p class="detalle-subcampo" id="resource-name-display">${detalle.resource_name}</p>` : '<p class="detalle-subcampo" id="resource-name-display" style="display: none;"></p>'}
            </div>
            <div class="detalle-acciones">
                <button id="guardar-cambios-btn" class="btn-guardar">💾 Guardar Cambios</button>
                <span id="guardar-mensaje" class="guardar-mensaje"></span>
            </div>
            ${imagenesHTML}
        </div>
    `;
    
    // Añadir event listener para el botón de guardar
    const guardarBtn = document.getElementById('guardar-cambios-btn');
    if (guardarBtn) {
        guardarBtn.addEventListener('click', () => {
            guardarCambiosIncidencia();
        });
    }
    
    // Configurar autocompletado para el campo resource
    const resourceInput = document.getElementById('edit-resource');
    const autocompleteDiv = document.getElementById('resource-autocomplete');
    if (resourceInput && autocompleteDiv) {
        let timeoutBusqueda = null;
        let elementosCargados = [];
        
        resourceInput.addEventListener('input', (e) => {
            const busqueda = e.target.value.trim();
            
            // Limpiar timeout anterior
            if (timeoutBusqueda) {
                clearTimeout(timeoutBusqueda);
            }
            
            // Si está vacío, ocultar dropdown
            if (!busqueda) {
                autocompleteDiv.style.display = 'none';
                return;
            }
            
            // Esperar 300ms antes de buscar (debounce)
            timeoutBusqueda = setTimeout(async () => {
                try {
                    const response = await fetch(`/api/buscar-elementos?q=${encodeURIComponent(busqueda)}`);
                    const data = await response.json();
                    
                    if (data.success && data.elementos && data.elementos.length > 0) {
                        elementosCargados = data.elementos;
                        mostrarAutocompletado(data.elementos, busqueda);
                    } else {
                        autocompleteDiv.style.display = 'none';
                        elementosCargados = [];
                    }
                } catch (error) {
                    console.error('Error al buscar elementos:', error);
                    autocompleteDiv.style.display = 'none';
                }
            }, 300);
        });
        
        // Ocultar dropdown al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (autocompleteDiv && resourceInput && 
                !resourceInput.contains(e.target) && 
                !autocompleteDiv.contains(e.target)) {
                autocompleteDiv.style.display = 'none';
            }
        });
        
        // Función para mostrar el dropdown de autocompletado
        function mostrarAutocompletado(elementos, busqueda) {
            autocompleteDiv.innerHTML = '';
            
            elementos.forEach((elemento, index) => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.innerHTML = `
                    <strong>${elemento.no || ''}</strong>
                    ${elemento.name ? `<span style="color: #666; margin-left: 10px;">${elemento.name}</span>` : ''}
                    ${elemento.tipo ? `<span style="color: #999; margin-left: 10px; font-size: 0.9em;">(${elemento.tipo})</span>` : ''}
                `;
                
                item.addEventListener('click', () => {
                    resourceInput.value = elemento.no;
                    const nameDisplay = document.getElementById('resource-name-display');
                    if (nameDisplay) {
                        nameDisplay.textContent = elemento.name || '';
                        nameDisplay.style.display = elemento.name ? 'block' : 'none';
                    }
                    autocompleteDiv.style.display = 'none';
                });
                
                // Resaltar al pasar el mouse
                item.addEventListener('mouseenter', () => {
                    item.style.backgroundColor = '#f0f0f0';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.backgroundColor = '';
                });
                
                autocompleteDiv.appendChild(item);
            });
            
            autocompleteDiv.style.display = 'block';
        }
    }
}

// Guardar cambios de la incidencia
// Funciones para mostrar/ocultar overlay de carga
function mostrarOverlayCarga() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function ocultarOverlayCarga() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

function actualizarMensajeOverlay(mensaje) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        const h3 = overlay.querySelector('h3');
        if (h3) {
            h3.textContent = mensaje;
        }
    }
}

async function guardarCambiosIncidencia() {
    if (!detalleActual || !idGtaskActual) {
        alert('No hay detalle de incidencia disponible');
        return;
    }
    
    const descripcionInput = document.getElementById('edit-descripcion');
    const fechaHoraInput = document.getElementById('edit-fecha-hora');
    const resourceInput = document.getElementById('edit-resource');
    const guardarBtn = document.getElementById('guardar-cambios-btn');
    const mensajeSpan = document.getElementById('guardar-mensaje');
    
    if (!descripcionInput || !fechaHoraInput || !resourceInput) {
        alert('Error: No se encontraron los campos de edición');
        return;
    }
    
    const nuevaDescripcion = descripcionInput.value.trim();
    const nuevaFechaHora = fechaHoraInput.value;
    const nuevoRecurso = resourceInput.value.trim();
    
    // Validar que haya cambios
    const descripcionOriginal = detalleActual.description || '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = descripcionOriginal;
    const descripcionOriginalTexto = tempDiv.textContent || tempDiv.innerText || descripcionOriginal;
    
    let fechaOriginalInput = '';
    if (detalleActual.fecha) {
        try {
            const fecha = new Date(detalleActual.fecha);
            const year = fecha.getFullYear();
            const month = String(fecha.getMonth() + 1).padStart(2, '0');
            const day = String(fecha.getDate()).padStart(2, '0');
            const hours = String(fecha.getHours()).padStart(2, '0');
            const minutes = String(fecha.getMinutes()).padStart(2, '0');
            fechaOriginalInput = `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch {}
    }
    
    const recursoOriginal = detalleActual.resource || '';
    
    if (nuevaDescripcion === descripcionOriginalTexto && 
        nuevaFechaHora === fechaOriginalInput && 
        nuevoRecurso === recursoOriginal) {
        if (mensajeSpan) {
            mensajeSpan.textContent = 'No hay cambios para guardar';
            mensajeSpan.className = 'guardar-mensaje guardar-mensaje-info';
            setTimeout(() => {
                mensajeSpan.textContent = '';
                mensajeSpan.className = 'guardar-mensaje';
            }, 3000);
        }
        return;
    }
    
    // Deshabilitar botón mientras se guarda
    if (guardarBtn) {
        guardarBtn.disabled = true;
        guardarBtn.textContent = '💾 Guardando...';
    }
    
    if (mensajeSpan) {
        mensajeSpan.textContent = '';
        mensajeSpan.className = 'guardar-mensaje';
    }
    
    // Mostrar overlay de carga
    mostrarOverlayCarga();
    
    try {
        // Preparar datos para enviar
        const datosActualizacion = {
            id_gtask: idGtaskActual,
            descripcion: nuevaDescripcion,
            fecha_hora: nuevaFechaHora,
            recurso: nuevoRecurso
        };
        
        const response = await fetch('/api/actualizar-incidencia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosActualizacion)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Actualizar el detalle actual
            detalleActual.description = nuevaDescripcion;
            if (nuevaFechaHora) {
                detalleActual.fecha = new Date(nuevaFechaHora).toISOString();
            }
            if (nuevoRecurso) {
                detalleActual.resource = nuevoRecurso;
            }
            
            if (mensajeSpan) {
                mensajeSpan.textContent = '✅ Cambios guardados correctamente';
                mensajeSpan.className = 'guardar-mensaje guardar-mensaje-success';
            }
            
            // Recargar incidencias para reflejar los cambios
            setTimeout(() => {
                cargarIncidencias();
            }, 1000);
        } else {
            if (mensajeSpan) {
                mensajeSpan.textContent = `❌ Error: ${data.error || 'Error desconocido'}`;
                mensajeSpan.className = 'guardar-mensaje guardar-mensaje-error';
            } else {
                alert(`Error al guardar: ${data.error || 'Error desconocido'}`);
            }
        }
    } catch (error) {
        console.error('Error al guardar cambios:', error);
        if (mensajeSpan) {
            mensajeSpan.textContent = `❌ Error de conexión: ${error.message}`;
            mensajeSpan.className = 'guardar-mensaje guardar-mensaje-error';
        } else {
            alert(`Error de conexión: ${error.message}`);
        }
    } finally {
        // Ocultar overlay de carga
        ocultarOverlayCarga();
        
        // Rehabilitar botón
        if (guardarBtn) {
            guardarBtn.disabled = false;
            guardarBtn.textContent = '💾 Guardar Cambios';
        }
    }
}

// Formatear estado (convertir código numérico a texto)
function formatearEstado(state) {
    if (!state) return 'N/A';
    
    // Si es un número, convertirlo a texto
    const estadoMap = {
        '0': 'Abierta',
        '1': 'En Progreso',
        '2': 'Cerrada',
        'Abierta': 'Abierta',
        'EnProgreso': 'En Progreso',
        'En Progreso': 'En Progreso',
        'Cerrada': 'Cerrada',
        'PENDING': 'Abierta',
        'IN_PROGRESS': 'En Progreso',
        'CLOSED': 'Cerrada'
    };
    
    const estadoStr = String(state);
    return estadoMap[estadoStr] || estadoStr;
}

// Abrir imagen en tamaño grande
function abrirImagenGrande(url) {
    window.open(url, '_blank');
}

// Rotar imagen 90 grados
function rotarImagen(url, event) {
    event.stopPropagation(); // Evitar que se abra la imagen grande
    
    // Obtener rotación actual o inicializar en 0
    const rotacionActual = rotacionesImagenes[url] || 0;
    const nuevaRotacion = (rotacionActual + 90) % 360;
    rotacionesImagenes[url] = nuevaRotacion;
    
    // Buscar el elemento de imagen en el DOM
    const imagenItem = event.target.closest('.imagen-item');
    if (imagenItem) {
        const img = imagenItem.querySelector('img');
        if (img) {
            // Obtener rotación inicial basada en si es vertical
            const esVertical = esImagenVertical(url);
            const rotacionInicial = esVertical ? 90 : 0;
            const rotacionTotal = (rotacionInicial + nuevaRotacion) % 360;
            
            // Aplicar rotación visual
            img.style.transform = `rotate(${rotacionTotal}deg)`;
            
            // Actualizar clases CSS si es necesario
            if (rotacionTotal === 90 || rotacionTotal === 270) {
                img.classList.add('imagen-vertical-rotada');
                imagenItem.classList.add('imagen-item-vertical');
            } else {
                img.classList.remove('imagen-vertical-rotada');
                imagenItem.classList.remove('imagen-item-vertical');
            }
        }
    }
}

// Generar PDF con el detalle de la incidencia
async function generarPDF(detalle, idGtask) {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const qrSize = 40; // Tamaño del QR en mm
        const qrSpacing = 5; // Espacio entre QR y contenido
        const qrX = pageWidth - margin - qrSize;
        const qrY = margin;
        
        // Calcular ancho disponible para el contenido (considerando el QR)
        const contentWidth = qrX - margin - qrSpacing;
        let yPos = margin;
        
        // Generar QR de la incidencia a la derecha arriba
        const qrUrl = `https://gtasks-app.deploy.malla.es/IdQr/${idGtask}`;
        
        // Crear un div temporal para el QR (qrcodejs necesita un elemento DOM)
        const qrDiv = document.createElement('div');
        qrDiv.style.position = 'absolute';
        qrDiv.style.left = '-9999px';
        document.body.appendChild(qrDiv);
        
        // Generar QR usando qrcodejs
        const qrCode = new QRCode(qrDiv, {
            text: qrUrl,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        
        // Esperar a que el QR se genere y obtener la imagen
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const qrImg = qrDiv.querySelector('img');
        if (qrImg) {
            const qrDataUrl = qrImg.src;
            doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
            // Añadir etiqueta debajo del QR de incidencia
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text('', qrX + qrSize / 2 - 12, qrY + qrSize + 5);
        }
        
        // Limpiar el div temporal
        document.body.removeChild(qrDiv);
        
        // Variable para almacenar el QR de ubicación (se añadirá después del Elemento)
        let qrMapsDataUrl = null;
        let qrMapsSize = 15; // Tamaño más pequeño del QR de ubicación
        
        // Título (ajustado para no superponerse con el QR)
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Detalle de Incidencia', margin, yPos);
        yPos += 10;
        
        // Información de la incidencia
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        const lineHeight = 7;
        
        // Estado y Fecha en la misma línea
        const mitadAncho = contentWidth / 2;
        doc.setFont('helvetica', 'bold');
        doc.text('Estado:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(formatearEstado(detalle.state) || 'N/A', margin + 20, yPos);
        
        // Fecha a la derecha
        doc.setFont('helvetica', 'bold');
        doc.text('Fecha:', margin + mitadAncho, yPos);
        doc.setFont('helvetica', 'normal');
        let fechaTexto = 'N/A';
        if (detalle.fecha) {
            try {
                const fecha = new Date(detalle.fecha);
                fechaTexto = fecha.toLocaleString('es-ES');
            } catch {
                fechaTexto = detalle.fecha;
            }
        }
        doc.text(fechaTexto, margin + mitadAncho + 20, yPos);
        yPos += lineHeight + 3;
        
        // Tipo de Incidencia y Usuario en la misma línea
        doc.setFont('helvetica', 'bold');
        doc.text('Tipo de Incidencia:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(detalle.incidenceType || 'N/A', margin + 45, yPos);
        
        // Usuario a la derecha
        
        yPos += lineHeight + 3;
        
        // Descripción debajo del Tipo de Incidencia
        doc.setFont('helvetica', 'bold');
        doc.text('Descripción:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        yPos += lineHeight;
        // Limpiar HTML de la descripción
        let descripcion = detalle.description || 'Sin descripción';
        // Crear un elemento temporal para extraer solo el texto
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = descripcion;
        descripcion = tempDiv.textContent || tempDiv.innerText || descripcion;
        const descripcionLines = doc.splitTextToSize(descripcion, contentWidth);
        doc.text(descripcionLines, margin, yPos);
        yPos += descripcionLines.length * lineHeight + 3;
        
        // Usuario debajo de "Usuario:"
        doc.setFont('helvetica', 'bold');
        doc.text('Usuario:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        const userId = detalle.user || detalle.user_name;
        const nombreUsuario = obtenerNombreUsuario(userId);
        doc.text(nombreUsuario, margin + 25, yPos);
        yPos += lineHeight + 3;
        
        // Preparar QR de ubicación antes de mostrar Elemento (si hay coordenadas)
        if (detalle.puntoX && detalle.puntoY) {
            const lng = parseFloat(detalle.puntoX); // Longitud
            const lat = parseFloat(detalle.puntoY); // Latitud
            if (!isNaN(lat) && !isNaN(lng)) {
                const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
                
                // Crear div temporal para el QR de Maps
                const qrMapsDiv = document.createElement('div');
                qrMapsDiv.style.position = 'absolute';
                qrMapsDiv.style.left = '-9999px';
                document.body.appendChild(qrMapsDiv);
                
                // Generar QR de Maps (más pequeño)
                const qrMapsCode = new QRCode(qrMapsDiv, {
                    text: mapsUrl,
                    width: 100,
                    height: 100,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                
                // Esperar a que el QR se genere
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const qrMapsImg = qrMapsDiv.querySelector('img');
                if (qrMapsImg) {
                    qrMapsDataUrl = qrMapsImg.src;
                }
                
                // Limpiar el div temporal
                document.body.removeChild(qrMapsDiv);
            }
        }
        
        // Elemento
        doc.setFont('helvetica', 'bold');
        doc.text('Elemento:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(detalle.resource || 'N/A', margin + 25, yPos);
        yPos += lineHeight;
        
        if (detalle.resource_name) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(10);
            doc.text(detalle.resource_name, margin + 10, yPos);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            yPos += lineHeight;
        }
        
        // Ubicación (QR) debajo del Elemento
        if (qrMapsDataUrl) {
            doc.setFont('helvetica', 'bold');
            doc.text('Ubicación:', margin, yPos);
            // Añadir el QR pequeño debajo del texto
            doc.addImage(qrMapsDataUrl, 'PNG', margin + 30, yPos - 2, qrMapsSize, qrMapsSize);
            yPos += qrMapsSize + 3;
        }
        yPos += 3;
        
        // Imágenes (sin título, directamente las imágenes)
        if (detalle.image && Array.isArray(detalle.image) && detalle.image.length > 0) {
            // No añadir título "Imágenes:", ir directamente a las imágenes
            
            // Para las imágenes, usar el ancho completo de la página menos márgenes
            const fullContentWidth = pageWidth - (margin * 2);
            const maxImageHeight = pageHeight - margin - yPos - 20; // Altura máxima disponible
            const spacing = 10; // Espacio entre imágenes
            
            // Separar imágenes en horizontales y verticales
            const imagenesHorizontales = [];
            const imagenesVerticales = [];
            
            // Primero cargar todas las imágenes y clasificarlas
            for (let i = 0; i < detalle.image.length; i++) {
                const img = detalle.image[i];
                if (img.url) {
                    try {
                        const imgInfo = await loadImageWithDimensions(img.url);
                        if (imgInfo && imgInfo.dataUrl) {
                            const isLandscape = imgInfo.isLandscape !== undefined 
                                ? imgInfo.isLandscape 
                                : imgInfo.width > imgInfo.height;
                            
                            if (isLandscape) {
                                imagenesHorizontales.push({ ...img, imgInfo });
                            } else {
                                imagenesVerticales.push({ ...img, imgInfo });
                            }
                        }
                    } catch (error) {
                        console.error(`Error cargando imagen ${img.url}:`, error);
                    }
                }
            }
            
            // Procesar primero las imágenes horizontales (una por fila)
            for (let i = 0; i < imagenesHorizontales.length; i++) {
                const img = imagenesHorizontales[i];
                const imgInfo = img.imgInfo;
                const imgWidth = imgInfo.width;
                const imgHeight = imgInfo.height;
                
                // Calcular dimensiones de impresión
                let printWidth = fullContentWidth;
                let printHeight = (printWidth * imgHeight) / imgWidth;
                
                // Si es muy alta, limitar altura y ajustar ancho
                if (printHeight > maxImageHeight) {
                    printHeight = maxImageHeight;
                    printWidth = (printHeight * imgWidth) / imgHeight;
                }
                
                // Verificar si hay espacio en la página
                if (yPos + printHeight > pageHeight - margin) {
                    doc.addPage();
                    yPos = margin;
                }
                
                doc.addImage(imgInfo.dataUrl, 'JPEG', margin, yPos, printWidth, printHeight);
                yPos += printHeight + spacing;
            }
            
            // Procesar luego las imágenes verticales (dos por fila)
            // Tamaño máximo de referencia: 1080x1920 píxeles
            const maxVerticalWidthPx = 1080;
            const maxVerticalHeightPx = 1920;
            
            // Calcular ancho disponible para cada imagen vertical (dos por fila con espacio)
            const verticalSpacing = 5; // Espacio entre imágenes verticales en la misma fila
            const verticalWidthPerImage = (fullContentWidth - verticalSpacing) / 2;
            
            // Almacenar alturas de cada fila para manejar correctamente el espaciado
            let currentRowImages = [];
            let currentRowMaxHeight = 0;
            
            for (let i = 0; i < imagenesVerticales.length; i++) {
                const img = imagenesVerticales[i];
                const imgInfo = img.imgInfo;
                let imgWidth = imgInfo.width;
                let imgHeight = imgInfo.height;
                
                // Si la imagen es más grande que 1080x1920, calcular dimensiones escaladas
                if (imgWidth > maxVerticalWidthPx || imgHeight > maxVerticalHeightPx) {
                    const scaleWidth = maxVerticalWidthPx / imgWidth;
                    const scaleHeight = maxVerticalHeightPx / imgHeight;
                    const scale = Math.min(scaleWidth, scaleHeight);
                    // Usar dimensiones escaladas para calcular el tamaño de impresión
                    imgWidth = imgWidth * scale;
                    imgHeight = imgHeight * scale;
                    console.log(`[PDF] Imagen vertical ${imgInfo.width}x${imgInfo.height} reducida a ${imgWidth}x${imgHeight} (escala: ${scale.toFixed(2)})`);
                }
                
                // Calcular dimensiones de impresión para la imagen vertical usando las dimensiones (posiblemente escaladas)
                let printWidth = verticalWidthPerImage;
                let printHeight = (printWidth * imgHeight) / imgWidth;
                
                // Limitar altura máxima
                if (printHeight > maxImageHeight) {
                    printHeight = maxImageHeight;
                    printWidth = (printHeight * imgWidth) / imgHeight;
                }
                
                // Determinar posición X: primera imagen a la izquierda, segunda a la derecha
                const isFirstInRow = currentRowImages.length === 0;
                let xPos = margin;
                if (!isFirstInRow) {
                    xPos = margin + verticalWidthPerImage + verticalSpacing;
                }
                
                // Agregar imagen a la fila actual
                currentRowImages.push({ imgInfo, printWidth, printHeight, xPos });
                currentRowMaxHeight = Math.max(currentRowMaxHeight, printHeight);
                
                // Si es la segunda imagen de la fila o es la última, procesar la fila
                const isSecondInRow = currentRowImages.length === 2;
                const isLastImage = i === imagenesVerticales.length - 1;
                
                if (isSecondInRow || (isLastImage && currentRowImages.length > 0)) {
                    // Verificar si hay espacio en la página para toda la fila
                    if (yPos + currentRowMaxHeight > pageHeight - margin) {
                        doc.addPage();
                        yPos = margin;
                        // Si hay dos imágenes pero no caben juntas, poner la segunda en nueva fila
                        if (isSecondInRow && currentRowImages.length === 2) {
                            currentRowImages[1].xPos = margin;
                        }
                    }
                    
                    // Dibujar todas las imágenes de la fila
                    for (const rowImg of currentRowImages) {
                        doc.addImage(rowImg.imgInfo.dataUrl, 'JPEG', rowImg.xPos, yPos, rowImg.printWidth, rowImg.printHeight);
                    }
                    
                    // Avanzar posición Y después de dibujar la fila completa
                    yPos += currentRowMaxHeight + spacing;
                    
                    // Resetear para la siguiente fila
                    currentRowImages = [];
                    currentRowMaxHeight = 0;
                }
            }
        }
        
        // Guardar PDF
        const fileName = `Incidencia_${idGtask}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(fileName);
        
    } catch (error) {
        console.error('Error generando PDF:', error);
        alert('Error al generar el PDF: ' + error.message);
    }
}

// Cargar imagen desde URL y convertirla a DataURL
function loadImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve(dataUrl);
            } catch (error) {
                reject(error);
            }
        };
        
        img.onerror = () => {
            reject(new Error('Error cargando imagen'));
        };
        
        img.src = url;
    });
}

// Detectar si una imagen es vertical basándose en el nombre del archivo
function esImagenVertical(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || pathname;
        return filename.startsWith('V_');
    } catch (error) {
        return false;
    }
}

// Obtener orientación basándose en el nombre del archivo
// H_ = horizontal, V_ = vertical, sin prefijo = horizontal por defecto
function getImageOrientationFromFilename(url) {
    try {
        // Extraer el nombre del archivo de la URL
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || pathname;
        
        console.log(`[Orientación] URL: ${url}`);
        console.log(`[Orientación] Nombre del archivo extraído: ${filename}`);
        
        // Verificar si el nombre empieza con "H_" o "V_"
        if (filename.startsWith('H_')) {
            // Horizontal: debe mostrarse horizontal (ancho > alto)
            console.log(`[Orientación] Detectado prefijo H_ - Horizontal`);
            return Promise.resolve({ orientation: 1, isLandscape: true, needsVertical: false });
        } else if (filename.startsWith('V_')) {
            // Vertical: debe mostrarse vertical (alto > ancho)
            console.log(`[Orientación] Detectado prefijo V_ - Vertical`);
            return Promise.resolve({ orientation: 1, isLandscape: false, needsVertical: true });
        } else {
            // Sin prefijo: asumir horizontal por defecto
            console.log(`[Orientación] Sin prefijo detectado - Horizontal por defecto`);
            return Promise.resolve({ orientation: 1, isLandscape: true, needsVertical: false });
        }
    } catch (error) {
        console.warn('[Orientación] Error parseando nombre de archivo:', error);
        // Por defecto, asumir horizontal
        return Promise.resolve({ orientation: 1, isLandscape: true, needsVertical: false });
    }
}

// Cargar imagen desde URL con sus dimensiones y orientación corregida
function loadImageWithDimensions(url) {
    return new Promise((resolve, reject) => {
        // Obtener rotación guardada por el usuario (0, 90, 180, 270)
        const rotacionUsuario = rotacionesImagenes[url] || 0;
        
        // Obtener orientación basándose en el nombre del archivo
        getImageOrientationFromFilename(url).then(({ orientation, isLandscape: isLandscapeFromFilename, needsVertical }) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Dimensiones que el navegador nos da
                    let displayWidth = img.width;
                    let displayHeight = img.height;
                    
                    console.log(`[Orientación] Prefijo del archivo: orientación=${orientation}, isLandscape=${isLandscapeFromFilename}, needsVertical=${needsVertical}, Rotación usuario: ${rotacionUsuario}°, Dimensiones display: ${displayWidth}x${displayHeight}`);
                    
                    // Determinar rotación inicial basada en el nombre del archivo
                    let rotacionInicial = 0;
                    let finalWidth = displayWidth;
                    let finalHeight = displayHeight;
                    
                    if (needsVertical) {
                        // Debe mostrarse vertical (alto > ancho)
                        // Si actualmente está horizontal (ancho > alto), rotar 90°
                        if (displayWidth > displayHeight) {
                            rotacionInicial = 90;
                            console.log(`[Orientación] Imagen con prefijo V_ está horizontal, rotando 90° para hacerla vertical`);
                        } else {
                            console.log(`[Orientación] Imagen con prefijo V_ ya está vertical, no rotar`);
                        }
                    } else {
                        // Debe mostrarse horizontal (ancho > alto)
                        // Si actualmente está vertical (alto > ancho), rotar 90°
                        if (displayHeight > displayWidth) {
                            rotacionInicial = 90;
                            console.log(`[Orientación] Imagen con prefijo H_ o sin prefijo está vertical, rotando 90° para hacerla horizontal`);
                        } else {
                            console.log(`[Orientación] Imagen con prefijo H_ o sin prefijo ya está horizontal, no rotar`);
                        }
                    }
                    
                    // Calcular rotación total (inicial + usuario)
                    const totalRotation = (rotacionInicial + rotacionUsuario) % 360;
                    
                    // Determinar dimensiones finales del canvas
                    // Si la rotación total es 90 o 270, intercambiar dimensiones
                    if (totalRotation === 90 || totalRotation === 270) {
                        finalWidth = displayHeight;
                        finalHeight = displayWidth;
                    } else {
                        finalWidth = displayWidth;
                        finalHeight = displayHeight;
                    }
                    
                    canvas.width = finalWidth;
                    canvas.height = finalHeight;
                    
                    // Aplicar rotación total
                    if (totalRotation !== 0) {
                        ctx.save();
                        // Calcular el punto de rotación según el ángulo
                        if (totalRotation === 90) {
                            ctx.translate(canvas.width, 0);
                            ctx.rotate(Math.PI / 2);
                        } else if (totalRotation === 180) {
                            ctx.translate(canvas.width, canvas.height);
                            ctx.rotate(Math.PI);
                        } else if (totalRotation === 270) {
                            ctx.translate(0, canvas.height);
                            ctx.rotate(-Math.PI / 2);
                        }
                        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
                        ctx.restore();
                    } else {
                        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
                    }
                    
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    console.log(`[Orientación] Imagen final: ${canvas.width}x${canvas.height}, rotación total: ${totalRotation}°, isLandscape: ${isLandscapeFromFilename}`);
                    
                    resolve({
                        dataUrl: dataUrl,
                        width: canvas.width,
                        height: canvas.height,
                        orientation: orientation,
                        isLandscape: isLandscapeFromFilename
                    });
                } catch (error) {
                    reject(error);
                }
            };
            
            img.onerror = () => {
                reject(new Error('Error cargando imagen'));
            };
            
            img.src = url;
        }).catch(error => {
            console.warn('[Orientación] Error obteniendo orientación, usando fallback:', error);
            // Fallback: cargar imagen aplicando solo la rotación del usuario
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    let displayWidth = img.width;
                    let displayHeight = img.height;
                    let finalWidth = displayWidth;
                    let finalHeight = displayHeight;
                    
                    // Aplicar rotación del usuario
                    if (rotacionUsuario === 90 || rotacionUsuario === 270) {
                        finalWidth = displayHeight;
                        finalHeight = displayWidth;
                    }
                    
                    canvas.width = finalWidth;
                    canvas.height = finalHeight;
                    
                    // Aplicar rotación si es necesaria
                    if (rotacionUsuario !== 0) {
                        ctx.save();
                        if (rotacionUsuario === 90) {
                            ctx.translate(canvas.width, 0);
                            ctx.rotate(Math.PI / 2);
                        } else if (rotacionUsuario === 180) {
                            ctx.translate(canvas.width, canvas.height);
                            ctx.rotate(Math.PI);
                        } else if (rotacionUsuario === 270) {
                            ctx.translate(0, canvas.height);
                            ctx.rotate(-Math.PI / 2);
                        }
                        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
                        ctx.restore();
                    } else {
                        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
                    }
                    
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    // Determinar orientación por dimensiones (fallback)
                    const isLandscape = canvas.width > canvas.height;
                    resolve({
                        dataUrl: dataUrl,
                        width: img.width,
                        height: img.height,
                        orientation: 1, // Sin prefijo, asumir normal
                        isLandscape: isLandscape
                    });
                } catch (error) {
                    reject(error);
                }
            };
            
            img.onerror = () => {
                reject(new Error('Error cargando imagen'));
            };
            
            img.src = url;
        });
    });
}

// ========== FUNCIONES DE FILTRO DE USUARIOS ==========

// Guardar filtro en localStorage
function guardarFiltroUsuarios() {
    if (estado.usuariosFiltrados === null) {
        localStorage.removeItem('usuariosFiltrados');
    } else {
        const idsArray = Array.from(estado.usuariosFiltrados);
        localStorage.setItem('usuariosFiltrados', JSON.stringify(idsArray));
    }
}

// Cargar filtro desde localStorage
function cargarFiltroUsuarios() {
    try {
        const filtroGuardado = localStorage.getItem('usuariosFiltrados');
        if (filtroGuardado) {
            const idsArray = JSON.parse(filtroGuardado);
            estado.usuariosFiltrados = new Set(idsArray);
        } else {
            estado.usuariosFiltrados = null; // null = todos los usuarios
        }
    } catch (error) {
        console.error('Error al cargar filtro de usuarios:', error);
        estado.usuariosFiltrados = null;
    }
}

// Actualizar lista de checkboxes del filtro
function actualizarListaFiltroUsuarios() {
    const container = document.getElementById('lista-filtro-usuarios');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (estado.usuarios.length === 0) {
        container.innerHTML = '<p style="color: #666;">No hay usuarios disponibles</p>';
        return;
    }
    
    estado.usuarios.forEach(usuario => {
        const usuarioId = String(usuario.id || usuario.user_id || usuario.userId || usuario._id || '');
        const nombreUsuario = usuario.name || usuario.username || usuario.nombre || `Usuario ${usuarioId.substring(0, 8)}`;
        
        const item = document.createElement('div');
        item.className = 'filtro-usuario-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `filtro-usuario-${usuarioId}`;
        checkbox.value = usuarioId;
        
        // Marcar como seleccionado si está en el filtro (o si no hay filtro, todos están seleccionados)
        if (estado.usuariosFiltrados === null || estado.usuariosFiltrados.has(usuarioId)) {
            checkbox.checked = true;
        }
        
        checkbox.addEventListener('change', () => {
            actualizarFiltroDesdeCheckboxes();
        });
        
        const label = document.createElement('label');
        label.htmlFor = `filtro-usuario-${usuarioId}`;
        label.textContent = nombreUsuario;
        
        item.appendChild(checkbox);
        item.appendChild(label);
        container.appendChild(item);
    });
}

// Actualizar filtro desde los checkboxes
function actualizarFiltroDesdeCheckboxes() {
    const checkboxes = document.querySelectorAll('#lista-filtro-usuarios input[type="checkbox"]');
    const usuariosSeleccionados = new Set();
    
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            usuariosSeleccionados.add(checkbox.value);
        }
    });
    
    // Si todos están seleccionados, poner null (todos)
    if (usuariosSeleccionados.size === estado.usuarios.length) {
        estado.usuariosFiltrados = null;
    } else {
        estado.usuariosFiltrados = usuariosSeleccionados;
    }
    
    // Guardar filtro
    guardarFiltroUsuarios();
    
    // Regenerar calendario
    generarCalendario();
    mostrarIncidenciasLibres();
}

// Toggle panel de filtro
function toggleFiltroPanel() {
    const panel = document.getElementById('filtro-usuarios-panel');
    if (panel) {
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            actualizarListaFiltroUsuarios();
        } else {
            panel.style.display = 'none';
        }
    }
}

// Cerrar panel de filtro
function cerrarFiltroPanel() {
    const panel = document.getElementById('filtro-usuarios-panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

// Seleccionar todos los usuarios
function seleccionarTodosUsuarios() {
    const checkboxes = document.querySelectorAll('#lista-filtro-usuarios input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    actualizarFiltroDesdeCheckboxes();
}

// Deseleccionar todos los usuarios
function deseleccionarTodosUsuarios() {
    const checkboxes = document.querySelectorAll('#lista-filtro-usuarios input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    actualizarFiltroDesdeCheckboxes();
}

// Cerrar modal de detalle
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('detalle-modal');
    const closeBtn = document.getElementById('close-detalle');
    const imprimirBtn = document.getElementById('imprimir-pdf-btn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    if (imprimirBtn) {
        imprimirBtn.addEventListener('click', () => {
            if (detalleActual && idGtaskActual) {
                generarPDF(detalleActual, idGtaskActual);
            } else {
                alert('No hay detalle de incidencia disponible para imprimir');
            }
        });
    }
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});

// Navegación de semanas
function semanaAnterior() {
    const fecha = estado.fechaInicioSemana;
    const año = fecha.getUTCFullYear();
    const mes = fecha.getUTCMonth();
    const dia = fecha.getUTCDate();
    estado.fechaInicioSemana = new Date(Date.UTC(año, mes, dia - 7));
    generarCalendario();
    // Actualizar mini calendario para mostrar el mes de la semana visible
    actualizarMiniCalendarioDesdeSemana();
}

function semanaSiguiente() {
    const fecha = estado.fechaInicioSemana;
    const año = fecha.getUTCFullYear();
    const mes = fecha.getUTCMonth();
    const dia = fecha.getUTCDate();
    estado.fechaInicioSemana = new Date(Date.UTC(año, mes, dia + 7));
    generarCalendario();
    // Actualizar mini calendario para mostrar el mes de la semana visible
    actualizarMiniCalendarioDesdeSemana();
}

// Actualizar el mes/año del mini calendario basado en la semana visible
function actualizarMiniCalendarioDesdeSemana() {
    if (estado.fechaInicioSemana) {
        estado.miniCalendarioMes = estado.fechaInicioSemana.getUTCMonth();
        estado.miniCalendarioAño = estado.fechaInicioSemana.getUTCFullYear();
        generarMiniCalendario();
    }
}

// Obtener rango de fechas visible en el calendario (lunes a viernes)
function obtenerRangoFechasVisible() {
    const fechaInicio = estado.fechaInicioSemana;
    const año = fechaInicio.getUTCFullYear();
    const mes = fechaInicio.getUTCMonth();
    const dia = fechaInicio.getUTCDate();
    const fechaInicioUTC = new Date(Date.UTC(año, mes, dia));
    
    const fechaFin = new Date(Date.UTC(año, mes, dia + 4)); // 5 días (lunes a viernes)
    
    return {
        fechaInicio: fechaInicioUTC.toISOString().split('T')[0],
        fechaFin: fechaFin.toISOString().split('T')[0]
    };
}

// Ejecutar asignación automática (solo incidencias sin asignar)
async function ejecutarAsignacionAutomatica() {
    const rango = obtenerRangoFechasVisible();
    const usuariosFiltrados = estado.usuariosFiltrados ? Array.from(estado.usuariosFiltrados) : null;
    
    // Confirmar acción
    if (!confirm(`¿Desea asignar automáticamente las incidencias sin asignar para el rango de fechas ${rango.fechaInicio} a ${rango.fechaFin}?`)) {
        return;
    }
    
    const btn = document.getElementById('asignar-automatico-btn');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Procesando...';
    
    try {
        const response = await fetch('/api/asignacion-automatica', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fecha_inicio: rango.fechaInicio,
                fecha_fin: rango.fechaFin,
                usuarios_filtrados: usuariosFiltrados,
                aplicar_cambios: true,
                solo_sin_asignar: true  // Solo asignar incidencias sin asignar
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const asignadas = data.asignaciones_aplicadas?.length || 0;
            const propuestas = data.asignaciones_propuestas?.length || 0;
            alert(`✅ Asignación automática completada\n\n- ${propuestas} asignaciones propuestas\n- ${asignadas} asignaciones aplicadas${data.errores?.length > 0 ? `\n- ${data.errores.length} errores` : ''}`);
            
            // Recargar datos para mostrar los cambios
            await cargarDatos();
        } else {
            alert(`❌ Error en asignación automática: ${data.error || 'Error desconocido'}`);
        }
    } catch (error) {
        console.error('Error al ejecutar asignación automática:', error);
        alert(`❌ Error de conexión: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

// Navegación del mini calendario
function mesAnteriorMiniCalendario() {
    if (estado.miniCalendarioMes === null || estado.miniCalendarioAño === null) {
        const hoy = new Date();
        estado.miniCalendarioMes = hoy.getMonth();
        estado.miniCalendarioAño = hoy.getFullYear();
    }
    
    estado.miniCalendarioMes--;
    if (estado.miniCalendarioMes < 0) {
        estado.miniCalendarioMes = 11;
        estado.miniCalendarioAño--;
    }
    generarMiniCalendario();
}

function mesSiguienteMiniCalendario() {
    if (estado.miniCalendarioMes === null || estado.miniCalendarioAño === null) {
        const hoy = new Date();
        estado.miniCalendarioMes = hoy.getMonth();
        estado.miniCalendarioAño = hoy.getFullYear();
    }
    
    estado.miniCalendarioMes++;
    if (estado.miniCalendarioMes > 11) {
        estado.miniCalendarioMes = 0;
        estado.miniCalendarioAño++;
    }
    generarMiniCalendario();
}

// Generar mini calendario en el sidebar
function generarMiniCalendario() {
    const container = document.getElementById('mini-calendario');
    if (!container) return;
    
    const hoy = new Date();
    // Usar el mes y año del estado, o el mes/año actual si no están definidos
    const mes = estado.miniCalendarioMes !== null ? estado.miniCalendarioMes : hoy.getMonth();
    const año = estado.miniCalendarioAño !== null ? estado.miniCalendarioAño : hoy.getFullYear();
    
    // Obtener primer día del mes y día de la semana
    const primerDia = new Date(año, mes, 1);
    const ultimoDia = new Date(año, mes + 1, 0);
    const diasEnMes = ultimoDia.getDate();
    const diaSemanaInicio = primerDia.getDay(); // 0 = Domingo
    
    // Ajustar para que lunes sea 0
    const diaSemanaAjustado = (diaSemanaInicio + 6) % 7;
    
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const diasSemana = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    
    let html = `
        <div class="mini-calendario-header">
            <span class="mini-calendario-nav" id="mes-anterior-mini" title="Mes anterior">◀</span>
            <span>${meses[mes]} ${año}</span>
            <span class="mini-calendario-nav" id="mes-siguiente-mini" title="Mes siguiente">▶</span>
        </div>
        <table>
            <thead>
                <tr>
                    ${diasSemana.map(dia => `<th>${dia}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;
    
    let dia = 1;
    let fila = '';
    
    // Días del mes anterior (si es necesario)
    if (diaSemanaAjustado > 0) {
        const mesAnterior = new Date(año, mes, 0);
        const diasMesAnterior = mesAnterior.getDate();
        for (let i = diaSemanaAjustado - 1; i >= 0; i--) {
            fila += `<td class="other-month">${diasMesAnterior - i}</td>`;
        }
    }
    
    // Días del mes actual
    while (dia <= diasEnMes) {
        if (fila && fila.split('</td>').length - 1 === 7) {
            html += `<tr>${fila}</tr>`;
            fila = '';
        }
        
        const esHoy = dia === hoy.getDate() && mes === hoy.getMonth() && año === hoy.getFullYear();
        const claseHoy = esHoy ? 'today' : '';
        fila += `<td class="${claseHoy}" data-fecha="${año}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}">${dia}</td>`;
        dia++;
    }
    
    // Completar última fila
    while (fila && fila.split('</td>').length - 1 < 7) {
        fila += `<td class="other-month">${dia - diasEnMes}</td>`;
        dia++;
    }
    
    if (fila) {
        html += `<tr>${fila}</tr>`;
    }
    
    html += `
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
    
    // Agregar event listeners para los días
    container.querySelectorAll('td[data-fecha]').forEach(td => {
        td.addEventListener('click', () => {
            const fecha = td.dataset.fecha;
            if (fecha) {
                // Parsear la fecha manualmente para evitar problemas de zona horaria
                const partes = fecha.split('-');
                if (partes.length === 3) {
                    const año = parseInt(partes[0], 10);
                    const mes = parseInt(partes[1], 10) - 1; // Los meses en Date son 0-indexados
                    const dia = parseInt(partes[2], 10);
                    const fechaObj = new Date(Date.UTC(año, mes, dia));
                    
                    // Calcular el lunes de esa semana
                    const diaSemana = fechaObj.getUTCDay();
                    const lunes = new Date(fechaObj);
                    lunes.setUTCDate(fechaObj.getUTCDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
                    lunes.setUTCHours(0, 0, 0, 0); // Normalizar a medianoche UTC
                    estado.fechaInicioSemana = lunes;
                    generarCalendario();
                    actualizarMiniCalendarioDesdeSemana(); // Actualizar para mostrar el mes correcto
                }
            }
        });
    });
    
    // Agregar event listeners para navegación de meses
    const mesAnteriorBtn = document.getElementById('mes-anterior-mini');
    const mesSiguienteBtn = document.getElementById('mes-siguiente-mini');
    if (mesAnteriorBtn) {
        mesAnteriorBtn.addEventListener('click', mesAnteriorMiniCalendario);
    }
    if (mesSiguienteBtn) {
        mesSiguienteBtn.addEventListener('click', mesSiguienteMiniCalendario);
    }
}

// Generar filtros de tipos de incidencias
function generarFiltrosTipos() {
    const container = document.getElementById('tipos-incidencias-filtro');
    if (!container) return;
    
    // Obtener tipos únicos de incidencias
    const tiposUnicos = new Set();
    estado.incidencias.forEach(inc => {
        if (inc.tipo_incidencia) {
            tiposUnicos.add(inc.tipo_incidencia);
        }
    });
    
    if (tiposUnicos.size === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 0.85rem;">No hay tipos de incidencias</p>';
        return;
    }
    
    let html = '';
    tiposUnicos.forEach(tipo => {
        const tipoClase = obtenerColorPorTipo(tipo);
        
        // Crear elemento temporal para obtener el color
        const tempDiv = document.createElement('div');
        tempDiv.className = `incidencia ${tipoClase}`;
        tempDiv.style.position = 'absolute';
        tempDiv.style.visibility = 'hidden';
        document.body.appendChild(tempDiv);
        const estilo = window.getComputedStyle(tempDiv);
        const bgColor = estilo.backgroundColor;
        document.body.removeChild(tempDiv);
        
        html += `
            <div class="tipo-filtro-item">
                <input type="checkbox" id="filtro-tipo-${tipo.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '')}" 
                       value="${tipo}" checked class="filtro-tipo-checkbox">
                <div class="tipo-filtro-color" style="background-color: ${bgColor}"></div>
                <label for="filtro-tipo-${tipo.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '')}" style="cursor: pointer; font-size: 0.85rem;">
                    ${tipo}
                </label>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Agregar event listeners
    container.querySelectorAll('.filtro-tipo-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            generarCalendario();
        });
    });
}

// Ejecutar reasignación automática (incluye incidencias ya asignadas)
async function ejecutarReasignacionAutomatica() {
    const rango = obtenerRangoFechasVisible();
    const usuariosFiltrados = estado.usuariosFiltrados ? Array.from(estado.usuariosFiltrados) : null;
    
    // Confirmar acción (más importante porque reasignará incidencias ya asignadas)
    if (!confirm(`⚠️ ATENCIÓN: Esto reasignará TODAS las incidencias (incluidas las ya asignadas) para el rango de fechas ${rango.fechaInicio} a ${rango.fechaFin}.\n\n¿Desea continuar?`)) {
        return;
    }
    
    const btn = document.getElementById('reasignar-automatico-btn');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Procesando...';
    
    try {
        const response = await fetch('/api/asignacion-automatica', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fecha_inicio: rango.fechaInicio,
                fecha_fin: rango.fechaFin,
                usuarios_filtrados: usuariosFiltrados,
                aplicar_cambios: true,
                solo_sin_asignar: false,  // Incluir incidencias ya asignadas
                reasignar: true  // Indicar que es reasignación
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const asignadas = data.asignaciones_aplicadas?.length || 0;
            const propuestas = data.asignaciones_propuestas?.length || 0;
            alert(`✅ Reasignación automática completada\n\n- ${propuestas} asignaciones propuestas\n- ${asignadas} asignaciones aplicadas${data.errores?.length > 0 ? `\n- ${data.errores.length} errores` : ''}`);
            
            // Recargar datos para mostrar los cambios
            await cargarDatos();
        } else {
            alert(`❌ Error en reasignación automática: ${data.error || 'Error desconocido'}`);
        }
    } catch (error) {
        console.error('Error al ejecutar reasignación automática:', error);
        alert(`❌ Error de conexión: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}
