// Estado de la aplicación
let estado = {
    fechaInicioSemana: null,
    usuarios: [],
    incidencias: [],
    asignaciones: {}, // { usuario_id: { fecha: [incidencias] } }
    autenticado: false,
    usuarioActual: null,
    usuariosFiltrados: null // null = todos, Set de IDs = usuarios filtrados
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar con la semana actual
    const hoy = new Date();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - hoy.getDay() + 1); // Lunes de esta semana
    estado.fechaInicioSemana = lunes;
    
    // Verificar estado de autenticación
    verificarAutenticacion();
    
    // Event listeners
    document.getElementById('refrescar-btn').addEventListener('click', cargarDatos);
    document.getElementById('anterior-btn').addEventListener('click', semanaAnterior);
    document.getElementById('siguiente-btn').addEventListener('click', semanaSiguiente);
    
    // Login/Logout
    document.getElementById('login-btn').addEventListener('click', mostrarLogin);
    document.getElementById('logout-btn').addEventListener('click', cerrarSesion);
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
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    
    if (estado.autenticado && estado.usuarioActual) {
        loginBtn.style.display = 'none';
        userInfo.style.display = 'flex';
        const nombre = estado.usuarioActual.name || 
                     estado.usuarioActual.username || 
                     estado.usuarioActual.nombre || 
                     'Usuario';
        userName.textContent = `👤 ${nombre}`;
    } else {
        loginBtn.style.display = 'block';
        userInfo.style.display = 'none';
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
    
    generarCalendario();
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
            const fecha = incidencia.fecha || new Date().toISOString().split('T')[0];
            if (!estado.asignaciones[usuarioId][fecha]) {
                estado.asignaciones[usuarioId][fecha] = [];
            }
            
            estado.asignaciones[usuarioId][fecha].push(incidencia);
        }
        // Las incidencias sin usuario se mostrarán en "incidencias sin asignar"
    });
    
    console.log('📊 Incidencias organizadas:', Object.keys(estado.asignaciones).length, 'usuarios con asignaciones');
}

// Generar calendario
function generarCalendario() {
    const tabla = document.getElementById('calendario-tabla');
    const thead = tabla.querySelector('thead tr');
    const tbody = document.getElementById('calendario-body');
    
    // Limpiar
    thead.innerHTML = '<th class="col-usuario">Usuario</th>';
    tbody.innerHTML = '';
    
    // Generar encabezados de días (7 días de la semana)
    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 7; i++) {
        const fecha = new Date(estado.fechaInicioSemana);
        fecha.setDate(estado.fechaInicioSemana.getDate() + i);
        
        const fechaStr = fecha.toISOString().split('T')[0];
        const esHoy = fecha.getTime() === hoy.getTime();
        
        const th = document.createElement('th');
        th.className = `col-dia ${esHoy ? 'hoy' : ''}`;
        th.textContent = `${diasSemana[i]} ${fecha.getDate()}/${fecha.getMonth() + 1}`;
        th.dataset.fecha = fechaStr;
        thead.appendChild(th);
    }
    
    // Actualizar título de la semana
    const fechaFin = new Date(estado.fechaInicioSemana);
    fechaFin.setDate(estado.fechaInicioSemana.getDate() + 6);
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    document.getElementById('semana-actual').textContent = 
        `Semana: ${estado.fechaInicioSemana.getDate()} ${meses[estado.fechaInicioSemana.getMonth()]} - ` +
        `${fechaFin.getDate()} ${meses[fechaFin.getMonth()]} ${fechaFin.getFullYear()}`;
    
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
            td.colSpan = 8;
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
            
            // Celdas de días
            for (let i = 0; i < 7; i++) {
                const fecha = new Date(estado.fechaInicioSemana);
                fecha.setDate(estado.fechaInicioSemana.getDate() + i);
                const fechaStr = fecha.toISOString().split('T')[0];
                
                const td = document.createElement('td');
                td.className = 'celda-dia';
                
                const esHoy = fecha.getTime() === hoy.getTime();
                if (esHoy) {
                    td.classList.add('hoy');
                }
                
                td.dataset.usuario = usuarioId;
                td.dataset.fecha = fechaStr;
            
            // Agregar incidencias del usuario para este día
            // Normalizar usuarioId para comparación
            const usuarioIdNormalizado = String(usuarioId);
            
            // Buscar incidencias para este usuario y fecha
            if (estado.asignaciones[usuarioIdNormalizado] && estado.asignaciones[usuarioIdNormalizado][fechaStr]) {
                estado.asignaciones[usuarioIdNormalizado][fechaStr].forEach(incidencia => {
                    const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                    td.appendChild(incDiv);
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
                            const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                            td.appendChild(incDiv);
                        }
                    });
                }
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
}

// Crear elemento de incidencia
function crearElementoIncidencia(incidencia, usuarioId, fecha) {
    const div = document.createElement('div');
    div.className = `incidencia estado-${(incidencia.estado || 'abierta').toLowerCase().replace(' ', '')}`;
    div.draggable = true;
    div.dataset.no = incidencia.no;
    div.dataset.usuario = usuarioId;
    div.dataset.fecha = fecha;
    
    // Mostrar descripción como elemento principal (más importante)
    const descripcion = incidencia.descripcion || 'Sin descripción';
    const descripcionCorta = descripcion.length > 40 ? descripcion.substring(0, 40) + '...' : descripcion;
    
    // Agregar miniatura si hay URL de imagen
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
    
    // Agregar event listener para el botón de editar
    const editBtn = div.querySelector('.incidencia-editar');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que se active el drag
            const idGtask = editBtn.dataset.idGtask;
            abrirDetalleIncidencia(idGtask);
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
    });
    
    div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
    });
    
    return div;
}

// Mover incidencia
async function moverIncidencia(noIncidencia, usuarioOrigen, fechaOrigen, usuarioDestino, fechaDestino) {
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
            // Refrescar datos
            await cargarDatos();
        } else {
            alert('Error al mover incidencia: ' + data.error);
        }
    } catch (error) {
        console.error('Error al mover incidencia:', error);
        alert('Error al mover la incidencia');
    }
}

// Mostrar incidencias libres (sin asignar o de usuarios no filtrados)
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
    
    incidenciasLibres.forEach(incidencia => {
        const div = crearElementoIncidencia(incidencia, null, null);
        container.appendChild(div);
    });
}

// Variable global para almacenar el detalle actual y el id_gtask
let detalleActual = null;
let idGtaskActual = null;

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
        detalle.image.forEach(img => {
            if (img.url) {
                imagenesHTML += `
                    <div class="imagen-item">
                        <img src="${img.url}" alt="${img.name || 'Imagen'}" onclick="abrirImagenGrande('${img.url}')">
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
                <p>${detalle.resource || 'N/A'}</p>
                ${detalle.resource_name ? `<p class="detalle-subcampo">${detalle.resource_name}</p>` : ''}
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

async function guardarCambiosIncidencia() {
    if (!detalleActual || !idGtaskActual) {
        alert('No hay detalle de incidencia disponible');
        return;
    }
    
    const descripcionInput = document.getElementById('edit-descripcion');
    const fechaHoraInput = document.getElementById('edit-fecha-hora');
    const guardarBtn = document.getElementById('guardar-cambios-btn');
    const mensajeSpan = document.getElementById('guardar-mensaje');
    
    if (!descripcionInput || !fechaHoraInput) {
        alert('Error: No se encontraron los campos de edición');
        return;
    }
    
    const nuevaDescripcion = descripcionInput.value.trim();
    const nuevaFechaHora = fechaHoraInput.value;
    
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
    
    if (nuevaDescripcion === descripcionOriginalTexto && nuevaFechaHora === fechaOriginalInput) {
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
            fecha_hora: nuevaFechaHora
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
        
        // Descripción (con ancho limitado para no superponerse con el QR)
        doc.setFont('helvetica', 'bold');
        doc.text('Descripción:', margin, yPos);
        yPos += lineHeight;
        doc.setFont('helvetica', 'normal');
        // Limpiar HTML de la descripción
        let descripcion = detalle.description || 'Sin descripción';
        // Crear un elemento temporal para extraer solo el texto
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = descripcion;
        descripcion = tempDiv.textContent || tempDiv.innerText || descripcion;
        const descripcionLines = doc.splitTextToSize(descripcion, contentWidth);
        doc.text(descripcionLines, margin, yPos);
        yPos += descripcionLines.length * lineHeight + 3;
        
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
        
        // Tipo de Incidencia
        doc.setFont('helvetica', 'bold');
        doc.text('Tipo de Incidencia:', margin, yPos);
        yPos += lineHeight;
        doc.setFont('helvetica', 'normal');
        doc.text(detalle.incidenceType || 'N/A', margin, yPos);
        yPos += lineHeight + 3;
        
        // Elemento y Usuario en la misma línea
        doc.setFont('helvetica', 'bold');
        doc.text('Elemento:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(detalle.resource || 'N/A', margin , yPos+lineHeight-3);
        
        // Usuario a la derecha
        doc.setFont('helvetica', 'bold');
        doc.text('Usuario:', margin + mitadAncho, yPos);
        doc.setFont('helvetica', 'normal');
        const userId = detalle.user || detalle.user_name;
        const nombreUsuario = obtenerNombreUsuario(userId);
        doc.text(nombreUsuario, margin + mitadAncho + 20, yPos);
        yPos += lineHeight;
        if (detalle.resource_name) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(10);
            doc.text(detalle.resource_name, margin + 10, yPos);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'normal');
            yPos += lineHeight;
        }
        
        // QR de ubicación debajo del Elemento (si hay coordenadas)
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
                
                // Añadir título "Ubicación"
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text('Ubicación:', margin, yPos);
                yPos += lineHeight - 2;
                
                // Añadir el QR pequeño
                if (qrMapsDataUrl) {
                    doc.addImage(qrMapsDataUrl, 'PNG', margin, yPos, qrMapsSize, qrMapsSize);
                    yPos += qrMapsSize + 3;
                }
                
                doc.setFontSize(12);
            }
        }
        yPos += 3;
        
        // La geolocalización ya se añadió debajo del Elemento con el QR
        
        // Imágenes (usar ancho completo de página ya que el QR no interfiere aquí)
        if (detalle.image && Array.isArray(detalle.image) && detalle.image.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.text('Imágenes:', margin, yPos);
            yPos += lineHeight + 3;
            
            // Para las imágenes, usar el ancho completo de la página menos márgenes
            const fullContentWidth = pageWidth - (margin * 2);
            const imagesPerRow = 2;
            const imageWidth = (fullContentWidth - 10) / imagesPerRow;
            const imageHeight = imageWidth * 0.75; // Aspect ratio 4:3
            let currentX = margin;
            let imagesInRow = 0;
            
            for (let i = 0; i < detalle.image.length; i++) {
                const img = detalle.image[i];
                if (img.url) {
                    try {
                        // Cargar imagen desde URL
                        const imgData = await loadImageAsDataUrl(img.url);
                        if (imgData) {
                            // Verificar si hay espacio en la página
                            if (yPos + imageHeight > pageHeight - margin) {
                                doc.addPage();
                                yPos = margin;
                                currentX = margin;
                                imagesInRow = 0;
                            }
                            
                            doc.addImage(imgData, 'JPEG', currentX, yPos, imageWidth, imageHeight);
                            
                            imagesInRow++;
                            if (imagesInRow >= imagesPerRow) {
                                yPos += imageHeight + 10; // Altura de imagen + espacio
                                currentX = margin;
                                imagesInRow = 0;
                            } else {
                                currentX += imageWidth + 10;
                            }
                        }
                    } catch (error) {
                        console.error(`Error cargando imagen ${img.url}:`, error);
                    }
                }
            }
            
            // Si quedaron imágenes en la fila, avanzar yPos
            if (imagesInRow > 0) {
                yPos += imageHeight + 15;
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
    estado.fechaInicioSemana.setDate(estado.fechaInicioSemana.getDate() - 7);
    generarCalendario();
}

function semanaSiguiente() {
    estado.fechaInicioSemana.setDate(estado.fechaInicioSemana.getDate() + 7);
    generarCalendario();
}

// Obtener rango de fechas visible en el calendario
function obtenerRangoFechasVisible() {
    const fechaInicio = new Date(estado.fechaInicioSemana);
    fechaInicio.setHours(0, 0, 0, 0);
    
    const fechaFin = new Date(fechaInicio);
    fechaFin.setDate(fechaInicio.getDate() + 6); // 7 días (semana completa)
    fechaFin.setHours(23, 59, 59, 999);
    
    return {
        fechaInicio: fechaInicio.toISOString().split('T')[0],
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
