const SSO_CONFIG = (() => {
    try {
        const el = document.getElementById('sso-config-json');
        return el ? JSON.parse(el.textContent || '{}') : {};
    } catch (e) {
        return {};
    }
})();

function getAuthRequestHeaders() {
    return { 'Content-Type': 'application/json' };
}

async function completarLoginUsuario(data, { cerrarModalLogin = true } = {}) {
    estado.autenticado = true;
    estado.usuarioActual = data.user_data;
    actualizarUIAutenticacion();
    await cargarPermisos();
    if (cerrarModalLogin) {
        cerrarModal();
    }
    cargarDatos();
}

async function procesarSsoTokenDesdeUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('sso_token');
    if (!token) return false;
    params.delete('sso_token');
    const qs = params.toString();
    const cleanUrl = window.location.pathname + (qs ? `?${qs}` : '');
    window.history.replaceState({}, '', cleanUrl);
    try {
        const response = await fetch('/api/auth/sso/exchange', {
            method: 'POST',
            headers: getAuthRequestHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({ token }),
        });
        const data = await response.json();
        if (!data.success) {
            const errorDiv = document.getElementById('login-error');
            const msg = data.error || 'No se pudo completar el acceso Malla';
            if (errorDiv) {
                errorDiv.textContent = msg;
                errorDiv.style.display = 'block';
            }
            mostrarLogin();
            return true;
        }
        await completarLoginUsuario(data);
        console.log('✅ Login SSO exitoso');
        return true;
    } catch (error) {
        console.error('Error SSO:', error);
        return false;
    }
}

function iniciarLoginSsoMalla() {
    const url = (SSO_CONFIG && SSO_CONFIG.launch_url) || '';
    if (!url) {
        alert('Login Malla no configurado');
        return;
    }
    window.location.href = url;
}

let estado = {
    fechaInicioSemana: null,
    usuarios: [],
    incidencias: [],
    asignaciones: {}, // { usuario_id: { fecha: [incidencias] } }
    autenticado: false,
    usuarioActual: null,
    usuariosFiltrados: null, // null = todos, Set de IDs = usuarios filtrados
    permisos: null,  // { tipos_incidencia_visible, subtipos_incidencia_visible, comunicado_por_emt_visible, puede_modificar, puede_asignar, puede_imprimir, puede_ver_ordenes }
    isAdmin: false,
    miniCalendarioMes: null,
    miniCalendarioAño: null,
    vistaSimple: false,
    tipoVista: 'lista'
};
// Estado para vista lista: filtro y ordenación
let vistaListaEstado = {
    filtro: '',
    sortCol: 'fecha',
    sortDir: -1, // -1 desc, 1 asc
    /** Filtro tipo Excel por columna: clave data-sort → Set de valores mostrados permitidos; ausente/null = sin filtro en esa columna. */
    columnFilters: {}
};

const VISTA_LISTA_SORT_COLS = ['no', 'fecha', 'descripcion', 'tipo', 'subtipo', 'comunicado_emt', 'recurso', 'usuario_creador', 'usuario'];

/** Convierte valores heterogéneos (bool/string/num) a booleano real. */
function esOrdenTrabajo(incidencia) {
    return parseBooleanLike(incidencia && incidencia.es_peticion);
}

function parseBooleanLike(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    return false;
}

/** Incidencias visibles por reglas del panel (sin filtro texto ni autofiltros de tabla). */
function getVistaListaBaseIncidencias() {
    return (estado.incidencias || []).filter(inc => debeMostrarIncidencia(inc));
}

function formatFechaListaIncidencia(inc) {
    let fechaStr = '-';
    if (inc.fecha_hora) {
        try {
            const d = new Date(inc.fecha_hora);
            fechaStr = d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
        } catch (e) {
            if (inc.fecha) {
                fechaStr = typeof inc.fecha === 'string' ? inc.fecha : (inc.fecha.toISOString ? inc.fecha.toISOString().split('T')[0] : '-');
            }
        }
    } else if (inc.fecha) {
        if (typeof inc.fecha === 'string') fechaStr = inc.fecha;
        else if (inc.fecha.toISOString) fechaStr = inc.fecha.toISOString().split('T')[0];
    }
    return fechaStr;
}

/** Valor de celda alineado con la vista lista (para autofiltro y filtrado). */
function getVistaListaColumnDisplayValue(inc, col) {
    if (col === 'no') return String(inc.no || inc.id_gtask || '');
    if (col === 'fecha') return formatFechaListaIncidencia(inc);
    if (col === 'descripcion') {
        const raw = inc.descripcion || '-';
        return raw.length <= 120 ? raw : raw.substring(0, 120) + '...';
    }
    if (col === 'tipo') return inc.tipo_incidencia || '-';
    if (col === 'subtipo') return inc.subtipo_incidencia || '-';
    if (col === 'comunicado_emt') return parseBooleanLike(inc.comunicado_por_emt) ? 'Sí' : 'No';
    if (col === 'recurso') return formatearRecursoDisplay(inc);
    if (col === 'usuario_creador') return obtenerNombreUsuario(inc.usuario_creador,false) || '';
    if (col === 'usuario') return obtenerNombreUsuario(inc.usuario,true) || '';
    return '';
}

function aplicarFiltrosColumnaVistaLista(incidencias) {
    const cf = vistaListaEstado.columnFilters;
    if (!cf) return incidencias;
    return incidencias.filter(inc => {
        for (const col of VISTA_LISTA_SORT_COLS) {
            const allowed = cf[col];
            if (allowed == null) continue;
            const v = getVistaListaColumnDisplayValue(inc, col);
            if (!allowed.has(v)) return false;
        }
        return true;
    });
}

let vistaListaColFilterPanelCol = null;
let vistaListaColFilterPanelSelection = null;

function ensureVistaListaColFilterPanel() {
    let panel = document.getElementById('vista-lista-col-filter-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'vista-lista-col-filter-panel';
    panel.className = 'vista-lista-col-filter-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="vista-lista-col-filter-panel-inner">
            <div class="vista-lista-col-filter-title" id="vista-lista-col-filter-title"></div>
            <input type="search" class="vista-lista-col-filter-search" id="vista-lista-col-filter-search" placeholder="Buscar valores…" autocomplete="off">
            <div class="vista-lista-col-filter-list" id="vista-lista-col-filter-list"></div>
            <div class="vista-lista-col-filter-actions-row">
                <button type="button" class="vista-lista-col-filter-mini" id="vista-lista-col-filter-sel-todo">Todo</button>
                <button type="button" class="vista-lista-col-filter-mini" id="vista-lista-col-filter-sel-ninguno">Nada</button>
                <button type="button" class="vista-lista-col-filter-mini" id="vista-lista-col-filter-limpiar">Limpiar</button>
            </div>
            <div class="vista-lista-col-filter-footer">
                <button type="button" class="vista-lista-col-filter-btn-aplicar" id="vista-lista-col-filter-aplicar">Aplicar</button>
                <button type="button" class="vista-lista-col-filter-btn-cancelar" id="vista-lista-col-filter-cancelar">Cancelar</button>
            </div>
        </div>`;
    document.body.appendChild(panel);
    panel.querySelector('#vista-lista-col-filter-search').addEventListener('input', () => refrescarListaCheckboxesVistaListaColFilter());
    panel.querySelector('#vista-lista-col-filter-sel-todo').addEventListener('click', () => {
        const base = getVistaListaBaseIncidencias();
        const col = vistaListaColFilterPanelCol;
        if (!col) return;
        const allVals = [...new Set(base.map(inc => getVistaListaColumnDisplayValue(inc, col)))].sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
        vistaListaColFilterPanelSelection = new Set(allVals);
        refrescarListaCheckboxesVistaListaColFilter();
    });
    panel.querySelector('#vista-lista-col-filter-sel-ninguno').addEventListener('click', () => {
        vistaListaColFilterPanelSelection = new Set();
        refrescarListaCheckboxesVistaListaColFilter();
    });
    panel.querySelector('#vista-lista-col-filter-limpiar').addEventListener('click', () => {
        const col = vistaListaColFilterPanelCol;
        if (col && vistaListaEstado.columnFilters) delete vistaListaEstado.columnFilters[col];
        cerrarVistaListaColFilterPanel();
        generarVistaLista();
    });
    panel.querySelector('#vista-lista-col-filter-aplicar').addEventListener('click', () => aplicarVistaListaColFilterDesdePanel());
    panel.querySelector('#vista-lista-col-filter-cancelar').addEventListener('click', () => cerrarVistaListaColFilterPanel());
    return panel;
}

function cerrarVistaListaColFilterPanel() {
    const panel = document.getElementById('vista-lista-col-filter-panel');
    if (panel) {
        panel.hidden = true;
        panel.style.left = '';
        panel.style.top = '';
    }
    vistaListaColFilterPanelCol = null;
    vistaListaColFilterPanelSelection = null;
}

function vistaListaColFilterKeydown(e) {
    if (e.key === 'Escape') cerrarVistaListaColFilterPanel();
}

function refrescarListaCheckboxesVistaListaColFilter() {
    const panel = document.getElementById('vista-lista-col-filter-panel');
    const listEl = document.getElementById('vista-lista-col-filter-list');
    const searchEl = document.getElementById('vista-lista-col-filter-search');
    if (!panel || !listEl || !vistaListaColFilterPanelCol || !vistaListaColFilterPanelSelection) return;
    const col = vistaListaColFilterPanelCol;
    const q = (searchEl && searchEl.value) ? searchEl.value.trim().toLowerCase() : '';
    const base = getVistaListaBaseIncidencias();
    const allVals = [...new Set(base.map(inc => getVistaListaColumnDisplayValue(inc, col)))].sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
    listEl.innerHTML = '';
    const sel = vistaListaColFilterPanelSelection;
    for (const val of allVals) {
        if (q && !String(val).toLowerCase().includes(q)) continue;
        const label = document.createElement('label');
        label.className = 'vista-lista-col-filter-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = sel.has(val);
        cb.addEventListener('change', () => {
            if (cb.checked) sel.add(val);
            else sel.delete(val);
        });
        const span = document.createElement('span');
        span.textContent = val === '' ? '(vacío)' : val;
        label.appendChild(cb);
        label.appendChild(span);
        listEl.appendChild(label);
    }
}

function aplicarVistaListaColFilterDesdePanel() {
    const col = vistaListaColFilterPanelCol;
    if (!col || !vistaListaColFilterPanelSelection) {
        cerrarVistaListaColFilterPanel();
        return;
    }
    const base = getVistaListaBaseIncidencias();
    const allVals = new Set(base.map(inc => getVistaListaColumnDisplayValue(inc, col)));
    const sel = vistaListaColFilterPanelSelection;
    if (!vistaListaEstado.columnFilters) vistaListaEstado.columnFilters = {};
    if (allVals.size === 0 || sel.size === allVals.size) {
        delete vistaListaEstado.columnFilters[col];
    } else {
        vistaListaEstado.columnFilters[col] = new Set(sel);
    }
    cerrarVistaListaColFilterPanel();
    generarVistaLista();
}

function abrirVistaListaColFilterPanel(col, anchorBtn) {
    if (!VISTA_LISTA_SORT_COLS.includes(col)) return;
    const panel = ensureVistaListaColFilterPanel();
    const base = getVistaListaBaseIncidencias();
    const allVals = [...new Set(base.map(inc => getVistaListaColumnDisplayValue(inc, col)))].sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
    const allSet = new Set(allVals);
    const prev = vistaListaEstado.columnFilters && vistaListaEstado.columnFilters[col];
    if (prev == null) {
        vistaListaColFilterPanelSelection = new Set(allVals);
    } else {
        vistaListaColFilterPanelSelection = new Set([...prev].filter(v => allSet.has(v)));
    }
    vistaListaColFilterPanelCol = col;
    const titleEl = document.getElementById('vista-lista-col-filter-title');
    const searchEl = document.getElementById('vista-lista-col-filter-search');
    if (titleEl) titleEl.textContent = 'Filtrar: ' + (anchorBtn && anchorBtn.getAttribute('aria-label') ? anchorBtn.getAttribute('aria-label').replace(/^Filtrar columna /, '') : col);
    if (searchEl) searchEl.value = '';
    panel.hidden = false;
    refrescarListaCheckboxesVistaListaColFilter();
    const r = anchorBtn.getBoundingClientRect();
    const pw = panel.offsetWidth || 280;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = (r.bottom + 4) + 'px';
}

function actualizarIndicadoresAutofiltroVistaLista() {
    const base = getVistaListaBaseIncidencias();
    document.querySelectorAll('.vista-lista-filter-btn').forEach(btn => {
        const col = btn.getAttribute('data-col');
        if (!col) return;
        const allVals = new Set(base.map(inc => getVistaListaColumnDisplayValue(inc, col)));
        const f = vistaListaEstado.columnFilters && vistaListaEstado.columnFilters[col];
        const activo = f != null && (f.size < allVals.size || f.size === 0);
        btn.classList.toggle('vista-lista-filter-btn-active', activo);
    });
}

function initVistaListaAutofiltros() {
    const tabla = document.getElementById('vista-lista-tabla');
    if (!tabla || tabla.dataset.autofilterInited) return;
    tabla.dataset.autofilterInited = '1';
    tabla.querySelector('thead')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.vista-lista-filter-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const col = btn.getAttribute('data-col');
        const panel = document.getElementById('vista-lista-col-filter-panel');
        if (panel && !panel.hidden && vistaListaColFilterPanelCol === col) {
            cerrarVistaListaColFilterPanel();
            return;
        }
        abrirVistaListaColFilterPanel(col, btn);
    }, true);
    if (!document.body.dataset.vistaListaColFilterDocClose) {
        document.body.dataset.vistaListaColFilterDocClose = '1';
        document.addEventListener('click', (e) => {
            const p = document.getElementById('vista-lista-col-filter-panel');
            if (!p || p.hidden) return;
            if (e.target.closest('#vista-lista-col-filter-panel') || e.target.closest('.vista-lista-filter-btn')) return;
            cerrarVistaListaColFilterPanel();
        }, true);
        document.addEventListener('keydown', vistaListaColFilterKeydown, true);
    }
}

/** Valor interno para incidencias sin subtipo (filtros y permisos). */
const SUBTIPO_FILTRO_SIN_VALOR = '__sin_subtipo__';

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
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
    
    // Verificar autenticación (SSO desde portal o sesión existente)
    const ssoHandled = await procesarSsoTokenDesdeUrl();
    if (!ssoHandled) {
        verificarAutenticacion();
    }
    
    const btnSsoMalla = document.getElementById('btnSsoMalla');
    if (btnSsoMalla) btnSsoMalla.addEventListener('click', iniciarLoginSsoMalla);
    
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
    
    // Filtro de estado (Abierta, En Progreso, Cerrada): al cambiar, recargar incidencias
    const filtroEstadoContainer = document.getElementById('filtro-estado-container');
    if (filtroEstadoContainer) {
        filtroEstadoContainer.querySelectorAll('input[name="filtro-estado"]').forEach(cb => {
            cb.addEventListener('change', cargarIncidencias);
        });
    }
    ['filtro-mostrar-incidencias', 'filtro-mostrar-ordenes'].forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.addEventListener('change', actualizarVista);
    });
    // Filtro de usuarios
    document.getElementById('filtro-usuarios-btn').addEventListener('click', toggleFiltroPanel);
    document.getElementById('cerrar-filtro-btn').addEventListener('click', cerrarFiltroPanel);
    document.getElementById('seleccionar-todos-btn').addEventListener('click', seleccionarTodosUsuarios);
    document.getElementById('deseleccionar-todos-btn').addEventListener('click', deseleccionarTodosUsuarios);
    document.getElementById('actualizar-nombres-btn').addEventListener('click', actualizarNombresUsuarios);
    
    // Asignación automática
    document.getElementById('asignar-automatico-btn').addEventListener('click', ejecutarAsignacionAutomatica);
    document.getElementById('reasignar-automatico-btn').addEventListener('click', ejecutarReasignacionAutomatica);
    
    // Navegación de semanas
    document.getElementById('semana-anterior-btn').addEventListener('click', semanaAnterior);
    document.getElementById('semana-siguiente-btn').addEventListener('click', semanaSiguiente);
    
    // Selector de vista: Lista, Simple, Calendario
    const vistaTipoSelect = document.getElementById('vista-tipo-select');
    if (vistaTipoSelect) {
        vistaTipoSelect.value = estado.tipoVista || 'lista';
        vistaTipoSelect.addEventListener('change', () => cambiarTipoVista(vistaTipoSelect.value));
    }
    
    // Cargar filtro guardado
    cargarFiltroUsuarios();
    
    // Panel lateral arriba a la derecha (abrir/cerrar)
    const sidebarPanel = document.getElementById('sidebar-panel');
    const navbarPanelBtn = document.getElementById('navbar-panel-btn');
    const sidebarPanelCerrar = document.getElementById('sidebar-panel-cerrar');
    if (sidebarPanel && navbarPanelBtn) {
        const saved = localStorage.getItem('gmalla-panel-abierto');
        if (saved === '1') sidebarPanel.classList.add('abierto');
        navbarPanelBtn.addEventListener('click', () => {
            sidebarPanel.classList.toggle('abierto');
            localStorage.setItem('gmalla-panel-abierto', sidebarPanel.classList.contains('abierto') ? '1' : '0');
        });
        if (sidebarPanelCerrar) {
            sidebarPanelCerrar.addEventListener('click', () => {
                sidebarPanel.classList.remove('abierto');
                localStorage.setItem('gmalla-panel-abierto', '0');
            });
        }
    }
    // Botón Permisos (solo visible para admins)
    const permisosBtn = document.getElementById('navbar-permisos-btn');
    if (permisosBtn) {
        permisosBtn.addEventListener('click', abrirModalPermisos);
    }
    document.getElementById('permisos-modal-close').addEventListener('click', cerrarModalPermisos);
    document.getElementById('permisos-guardar-btn').addEventListener('click', guardarPermisos);
    window.addEventListener('click', (e) => {
        const modalPermisos = document.getElementById('permisos-modal');
        if (e.target === modalPermisos) cerrarModalPermisos();
    });
    
    // Mostrar vista inicial (Lista por defecto)
    actualizarVista();
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
            await cargarPermisos();
            cargarDatos();
        } else {
            estado.autenticado = false;
            actualizarUIAutenticacion();
            await cargarPermisos(); // permisos por defecto cuando no hay sesión
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
            await cargarPermisos();
            cargarDatos();
            console.log('✅ Login automático exitoso');
        } else {
            console.log('⚠️ Login automático falló:', data.error);
        }
    } catch (error) {
        console.error('Error en login automático:', error);
    }
}

// Cargar permisos del usuario actual (y si es admin)
async function cargarPermisos() {
    try {
        const response = await fetch('/api/permisos');
        const data = await response.json();
        if (data.success) {
            estado.permisos = data.permisos || {};
            estado.isAdmin = !!data.is_admin;
        } else {
            estado.permisos = { comunicado_por_emt_visible: true, puede_modificar: true, puede_asignar: true, puede_imprimir: true, puede_ver_ordenes: true, tipos_incidencia_visible: null, subtipos_incidencia_visible: null };
            estado.isAdmin = false;
        }
    } catch (e) {
        estado.permisos = { comunicado_por_emt_visible: true, puede_modificar: true, puede_asignar: true, puede_imprimir: true, puede_ver_ordenes: true, tipos_incidencia_visible: null, subtipos_incidencia_visible: null };
        estado.isAdmin = false;
    }
    actualizarUIAutenticacion();
    aplicarPermisosUI();
}

// Aplicar permisos en la UI: ocultar filtros y deshabilitar botones según permisos
function aplicarPermisosUI() {
    const p = estado.permisos || {};
    const containerEMT = document.getElementById('filtro-comunicado-emt-container');
    if (containerEMT) containerEMT.style.display = (p.comunicado_por_emt_visible !== false) ? 'block' : 'none';
    const asignarAutoBtn = document.getElementById('asignar-automatico-btn');
    const reasignarAutoBtn = document.getElementById('reasignar-automatico-btn');
    if (asignarAutoBtn) asignarAutoBtn.style.display = (p.puede_asignar !== false) ? '' : 'none';
    if (reasignarAutoBtn) reasignarAutoBtn.style.display = (p.puede_asignar !== false) ? '' : 'none';
    const sectionOrdenes = document.getElementById('filtro-ordenes-section');
    if (sectionOrdenes) sectionOrdenes.style.display = (p.puede_ver_ordenes !== false) ? '' : 'none';
    // Tipos de incidencia y botones modificar/imprimir se aplican al generar vistas
}

// --- Modal de Permisos (solo administradores) ---
function abrirModalPermisos() {
    if (!estado.isAdmin) return;
    const modal = document.getElementById('permisos-modal');
    document.getElementById('permisos-loading').style.display = 'block';
    document.getElementById('permisos-content').style.display = 'none';
    modal.style.display = 'block';
    cargarPermisosAdmin();
}

function cerrarModalPermisos() {
    document.getElementById('permisos-modal').style.display = 'none';
}

async function cargarPermisosAdmin() {
    const loading = document.getElementById('permisos-loading');
    const content = document.getElementById('permisos-content');
    try {
        const [resUsers, resPermisos] = await Promise.all([
            fetch('/api/permisos/admin/usuarios'),
            fetch('/api/permisos/admin')
        ]);
        const dataUsers = await resUsers.json();
        const dataPermisos = await resPermisos.json();
        if (!dataUsers.success || !dataPermisos.success) {
            loading.textContent = dataUsers.error || dataPermisos.error || 'Error al cargar';
            return;
        }
        const usuarios = dataUsers.usuarios || [];
        const permisos = dataPermisos.permisos || {};
        const tiposIncidencia = obtenerTiposIncidenciaUnicos();
        const subtiposIncidencia = obtenerSubtiposIncidenciaUnicos();
        const container = document.getElementById('permisos-lista-usuarios');
        container.innerHTML = '';
        usuarios.forEach(u => {
            const uid = String(u.id || u.user_id || u.userId || u._id || '');
            const uname = (u.username || u.email || u.name || u.nombre || uid).trim();
            const key = uid || uname.toLowerCase();
            const p = permisos[key] || permisos[uid] || permisos[uname] || {};
            const tipList = p.tipos_incidencia_visible;
            const todosTipos = !Array.isArray(tipList) || tipList.length === 0;
            const tiposPermitidosSet = new Set(Array.isArray(tipList) ? tipList.map(t => String(t).trim()) : []);
            const tiposCheckboxes = tiposIncidencia.length === 0
                ? '<p class="permisos-tipos-aviso">No hay tipos cargados. Refresca las incidencias para ver la lista.</p>'
                : '<div class="permisos-tipos-lista">' + tiposIncidencia.map(tipo => {
                    const checked = todosTipos || tiposPermitidosSet.has(String(tipo).trim());
                    return `<label class="permisos-tipo-item"><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="tipos_incidencia_visible" value="${escapeHtml(tipo)}" ${checked ? 'checked' : ''}> ${escapeHtml(tipo)}</label>`;
                }).join('') + '</div>';
            const subList = p.subtipos_incidencia_visible;
            const todosSubtipos = !Array.isArray(subList) || subList.length === 0;
            const subtiposPermitidosSet = new Set(Array.isArray(subList) ? subList.map(t => String(t).trim()) : []);
            const subtiposCheckboxes = subtiposIncidencia.length === 0
                ? '<p class="permisos-tipos-aviso">No hay subtipos cargados. Refresca las incidencias para ver la lista.</p>'
                : '<div class="permisos-tipos-lista">' + subtiposIncidencia.map(st => {
                    const checked = todosSubtipos || subtiposPermitidosSet.has(String(st).trim());
                    const etiqueta = etiquetaSubtipoFiltro(st);
                    return `<label class="permisos-tipo-item"><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="subtipos_incidencia_visible" value="${escapeHtml(st)}" ${checked ? 'checked' : ''}> ${escapeHtml(etiqueta)}</label>`;
                }).join('') + '</div>';
            const div = document.createElement('div');
            div.className = 'permisos-usuario';
            div.innerHTML = `
                <div class="permisos-usuario-nombre">${escapeHtml(uname)}</div>
                <div class="permisos-usuario-campos">
                    <label><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="comunicado_por_emt_visible" ${(p.comunicado_por_emt_visible !== false) ? 'checked' : ''}> Ver Comunicado por EMT</label>
                    <label><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="puede_modificar" ${(p.puede_modificar !== false) ? 'checked' : ''}> Modificar incidencias</label>
                    <label><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="puede_asignar" ${(p.puede_asignar !== false) ? 'checked' : ''}> Asignar incidencias</label>
                    <label><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="puede_imprimir" ${(p.puede_imprimir !== false) ? 'checked' : ''}> Imprimir incidencias</label>
                    <label><input type="checkbox" data-key="${escapeHtml(key)}" data-opt="puede_ver_ordenes" ${(p.puede_ver_ordenes !== false) ? 'checked' : ''}> Ver órdenes de trabajo</label>
                    <div class="permisos-tipos"><label>Tipos visibles (todos marcados = todos):</label>${tiposCheckboxes}</div>
                    <div class="permisos-tipos"><label>Subtipos visibles (todos marcados = todos):</label>${subtiposCheckboxes}</div>
                </div>
            `;
            container.appendChild(div);
        });
        loading.style.display = 'none';
        content.style.display = 'block';
    } catch (e) {
        loading.textContent = 'Error: ' + (e.message || e);
    }
}

async function guardarPermisos() {
    const btn = document.getElementById('permisos-guardar-btn');
    const msg = document.getElementById('permisos-mensaje');
    const container = document.getElementById('permisos-lista-usuarios');
    const tiposIncidencia = obtenerTiposIncidenciaUnicos();
    const subtiposIncidencia = obtenerSubtiposIncidenciaUnicos();
    const permisos = {};
    container.querySelectorAll('.permisos-usuario').forEach(div => {
        const key = div.querySelector('[data-opt="comunicado_por_emt_visible"]')?.dataset?.key;
        if (!key) return;
        const tiposChecked = Array.from(div.querySelectorAll('input[data-opt="tipos_incidencia_visible"]:checked')).map(cb => cb.value.trim()).filter(Boolean);
        const todosMarcados = tiposIncidencia.length > 0 && tiposChecked.length === tiposIncidencia.length;
        const subtiposChecked = Array.from(div.querySelectorAll('input[data-opt="subtipos_incidencia_visible"]:checked')).map(cb => cb.value.trim()).filter(Boolean);
        const todosSubMarcados = subtiposIncidencia.length > 0 && subtiposChecked.length === subtiposIncidencia.length;
        permisos[key] = {
            comunicado_por_emt_visible: !!div.querySelector('input[data-opt="comunicado_por_emt_visible"]')?.checked,
            puede_modificar: !!div.querySelector('input[data-opt="puede_modificar"]')?.checked,
            puede_asignar: !!div.querySelector('input[data-opt="puede_asignar"]')?.checked,
            puede_imprimir: !!div.querySelector('input[data-opt="puede_imprimir"]')?.checked,
            puede_ver_ordenes: !!div.querySelector('input[data-opt="puede_ver_ordenes"]')?.checked,
            tipos_incidencia_visible: (tiposIncidencia.length === 0 || todosMarcados) ? null : tiposChecked,
            subtipos_incidencia_visible: (subtiposIncidencia.length === 0 || todosSubMarcados) ? null : subtiposChecked
        };
    });
    btn.disabled = true;
    msg.textContent = 'Guardando...';
    msg.className = 'guardar-mensaje';
    try {
        const res = await fetch('/api/permisos/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(permisos)
        });
        const data = await res.json();
        if (data.success) {
            msg.textContent = '✅ ' + (data.message || 'Guardado correctamente');
            msg.className = 'guardar-mensaje guardar-mensaje-success';
            await cargarPermisos();
            generarFiltrosTipos();
            generarFiltrosSubtipos();
            actualizarVista();
        } else {
            msg.textContent = '❌ ' + (data.error || 'Error al guardar');
            msg.className = 'guardar-mensaje guardar-mensaje-error';
        }
    } catch (e) {
        msg.textContent = '❌ ' + (e.message || e);
        msg.className = 'guardar-mensaje guardar-mensaje-error';
    }
    btn.disabled = false;
}

// Actualizar UI de autenticación
function actualizarUIAutenticacion() {
    const loginIcon = document.getElementById('login-icon');
    const userIcon = document.getElementById('user-icon');
    const permisosBtn = document.getElementById('navbar-permisos-btn');
    
    if (estado.autenticado && estado.usuarioActual) {
        loginIcon.style.display = 'none';
        userIcon.style.display = 'flex';
        const nombre = estado.usuarioActual.name || 
                     estado.usuarioActual.username || 
                     estado.usuarioActual.nombre || 
                     'Usuario';
        userIcon.title = nombre;
        userIcon.setAttribute('data-usuario', nombre);
        if (permisosBtn) permisosBtn.style.display = estado.isAdmin ? 'flex' : 'none';
    } else {
        loginIcon.style.display = 'flex';
        userIcon.style.display = 'none';
        if (permisosBtn) permisosBtn.style.display = 'none';
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
            await completarLoginUsuario(data);
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
            estado.permisos = null;
            estado.isAdmin = false;
            actualizarUIAutenticacion();
            // Limpiar datos
            estado.usuarios = [];
            estado.incidencias = [];
            estado.asignaciones = {};
            actualizarVista();
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
    
    // Mostrar vista actual (lista o calendario)
    actualizarVista();
    
    // Generar sidebar (el mini calendario se sincronizará automáticamente con la semana visible)
    generarFiltrosTipos();
    generarFiltrosSubtipos();

    if (estado.autenticado) {
        intentarAbrirDetalleDesdeUrl();
    }
}

/** Lee ?id= de la URL (Id_Gtask u otro identificador de incidencia). */
function obtenerIdIncidenciaDesdeUrl() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return null;
    const t = String(id).trim();
    return t || null;
}

/** Quita el parámetro id de la barra de dirección sin recargar. */
function quitarParamIdDeLaUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('id')) return;
    url.searchParams.delete('id');
    const q = url.searchParams.toString();
    const newPath = url.pathname + (q ? `?${q}` : '') + url.hash;
    window.history.replaceState(null, '', newPath);
}

/** Si la URL trae ?id=..., abre el modal de detalle (tras login y datos cargados). */
function intentarAbrirDetalleDesdeUrl() {
    const id = obtenerIdIncidenciaDesdeUrl();
    if (!id) return;
    quitarParamIdDeLaUrl();
    abrirDetalleIncidencia(id);
}

function ordenarUsuariosPorNombre(arr) {
    return [...(arr || [])].sort((a, b) => {
        const nombreA = (a.name || a.username || a.nombre || '').toLowerCase();
        const nombreB = (b.name || b.username || b.nombre || '').toLowerCase();
        return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
    });
}

function usuariosFallbackDesdeIncidencias() {
    const usuariosUnicos = new Map();
    (estado.incidencias || []).forEach(inc => {
        if (inc.usuario) {
            if (!usuariosUnicos.has(inc.usuario)) {
                const idStr = String(inc.usuario);
                usuariosUnicos.set(inc.usuario, {
                    id: inc.usuario,
                    name: `Usuario ${idStr.substring(0, 8)}`
                });
            }
        }
    });
    estado.usuarios = ordenarUsuariosPorNombre(Array.from(usuariosUnicos.values()));
    console.log('✅ Usuarios extraídos de incidencias:', estado.usuarios.length, '(ordenados por nombre)');
}

// Cargar usuarios desde la API
async function cargarUsuarios() {
    try {
        const response = await fetch('/api/usuarios');
        let data = {};
        try {
            data = await response.json();
        } catch (e) {
            console.warn('⚠️ /api/usuarios: respuesta no es JSON (HTTP ' + response.status + ')');
            usuariosFallbackDesdeIncidencias();
            return;
        }
        // Éxito con lista (puede estar vacía): no usar fallback por "length === 0"
        if (data.success === true && Array.isArray(data.usuarios)) {
            estado.usuarios = ordenarUsuariosPorNombre(data.usuarios);
            if (estado.usuarios.length === 0) {
                console.warn('⚠️ GTask devolvió 0 usuarios. ¿Sesión iniciada en GTask? (La API /users suele exigir Bearer)');
            } else {
                console.log('✅ Usuarios cargados:', estado.usuarios.length, '(ordenados por nombre)');
            }
            return;
        }
        const detalle = data.error || response.statusText || 'Error desconocido';
        console.warn('⚠️ No se pudieron cargar usuarios desde la API (' + response.status + '):', detalle);
        usuariosFallbackDesdeIncidencias();
    } catch (error) {
        console.error('❌ Error al cargar usuarios:', error);
        usuariosFallbackDesdeIncidencias();
    }
}

// Obtener estados seleccionados en el filtro de estado (sidebar). Por defecto Abierta y En Progreso.
function obtenerFiltroEstados() {
    const container = document.getElementById('filtro-estado-container');
    if (!container) return ['Abierta', 'EnProgreso'];
    const checked = container.querySelectorAll('input[name="filtro-estado"]:checked');
    const valores = Array.from(checked).map(c => c.value);
    return valores.length ? valores : ['Abierta', 'EnProgreso'];
}

// Cargar incidencias (respeta filtro de estado del sidebar)
async function cargarIncidencias() {
    try {
        const estadosSeleccionados = obtenerFiltroEstados();
        const params = new URLSearchParams();
        estadosSeleccionados.forEach(e => params.append('estado', e));
        const query = params.toString();
        const url = query ? `/api/incidencias?${query}` : '/api/incidencias';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            estado.incidencias = data.incidencias || [];
            console.log('Incidencias cargadas:', estado.incidencias.length);
            
            // Organizar incidencias por usuario y fecha
            organizarIncidencias();
            // Actualizar la vista activa (lista o calendario)
            actualizarVista();
            generarFiltrosTipos();
            generarFiltrosSubtipos();
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
    
    // Organizar incidencias (solo las que tienen usuario válido Y tienen id_gtask)
    estado.incidencias.forEach(incidencia => {
        // Si no tiene id_gtask, tratarla como no asignada (no organizarla)
        if (!incidencia.id_gtask || incidencia.id_gtask === null || incidencia.id_gtask === undefined || String(incidencia.id_gtask).trim() === '') {
            return; // Saltar esta incidencia, se mostrará como no asignada
        }
        
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
        // Las incidencias sin usuario o sin id_gtask se mostrarán en "incidencias sin asignar"
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
            
            // Verificar si el usuario tiene incidencias en la semana
            const usuarioIdNormalizado = String(usuarioId);
            let tieneIncidencias = false;
            const fechasSemana = [];
            for (let i = 0; i < 5; i++) {
                const fechaInicio = estado.fechaInicioSemana;
                const año = fechaInicio.getUTCFullYear();
                const mes = fechaInicio.getUTCMonth();
                const dia = fechaInicio.getUTCDate();
                const fecha = new Date(Date.UTC(año, mes, dia + i));
                const fechaStr = fecha.toISOString().split('T')[0];
                fechasSemana.push(fechaStr);
                
                // Verificar si hay incidencias para este usuario y fecha
                if (estado.asignaciones[usuarioIdNormalizado] && estado.asignaciones[usuarioIdNormalizado][fechaStr]) {
                    const incidenciasDia = estado.asignaciones[usuarioIdNormalizado][fechaStr].filter(inc => debeMostrarIncidencia(inc));
                    if (incidenciasDia.length > 0) {
                        tieneIncidencias = true;
                    }
                }
                
                // También buscar por otros formatos de ID
                Object.keys(estado.asignaciones).forEach(key => {
                    if (key === usuarioIdNormalizado) return;
                    if (estado.asignaciones[key] && estado.asignaciones[key][fechaStr]) {
                        estado.asignaciones[key][fechaStr].forEach(incidencia => {
                            const incUsuarioId = String(incidencia.usuario || '');
                            if ((incUsuarioId === usuarioIdNormalizado || 
                                incUsuarioId.includes(usuarioIdNormalizado) ||
                                usuarioIdNormalizado.includes(incUsuarioId)) && 
                                debeMostrarIncidencia(incidencia)) {
                                tieneIncidencias = true;
                            }
                        });
                    }
                });
            }
            
            // Si no tiene incidencias, marcar como plegado
            if (!tieneIncidencias) {
                tr.classList.add('usuario-plegado');
                tr.dataset.usuarioId = usuarioId;
            }
            
            // Celda de usuario
            const tdUsuario = document.createElement('td');
            tdUsuario.className = 'celda-usuario';
            
            // Si no tiene incidencias, agregar botón de desplegar/plegar
            if (!tieneIncidencias) {
                const btnToggle = document.createElement('button');
                btnToggle.className = 'btn-toggle-usuario';
                btnToggle.innerHTML = '▶';
                btnToggle.title = 'Desplegar usuario';
                btnToggle.addEventListener('click', () => {
                    tr.classList.toggle('usuario-plegado');
                    btnToggle.innerHTML = tr.classList.contains('usuario-plegado') ? '▶' : '▼';
                    btnToggle.title = tr.classList.contains('usuario-plegado') ? 'Desplegar usuario' : 'Plegar usuario';
                });
                tdUsuario.appendChild(btnToggle);
            }
            
            const nombreSpan = document.createElement('span');
            nombreSpan.textContent = nombreUsuario;
            tdUsuario.appendChild(nombreSpan);
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
            
            // Si está en vista simple, crear estructura con horas
            if (estado.vistaSimple) {
                // Crear contenedor de horas
                const horasContainer = document.createElement('div');
                horasContainer.className = 'celda-dia-horas';
                
                // Definir horas: 6:30, 7:30, 8:30, 9:30, 10:30, 11:30, 12:30
                const horas = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5]; // En formato decimal (6.5 = 6:30)
                
                // Obtener hora actual para marcar en rojo
                const ahora = new Date();
                const esHoy = fechaStr === hoyStr;
                const horaActual = ahora.getHours() + ahora.getMinutes() / 60;
                const minutosActuales = ahora.getMinutes();
                
                horas.forEach((horaDecimal, index) => {
                    const horaDiv = document.createElement('div');
                    horaDiv.className = 'celda-hora';
                    horaDiv.dataset.hora = horaDecimal;
                    horaDiv.dataset.usuario = usuarioId;
                    horaDiv.dataset.fecha = fechaStr;
                    
                    // Verificar si es la hora actual (dentro del rango de esta hora)
                    const horasEnteras = Math.floor(horaDecimal);
                    const esHoraActual = esHoy && 
                        horaActual >= (horaDecimal - 0.5) && 
                        horaActual < (horaDecimal + 0.5);
                    
                    if (esHoraActual) {
                        horaDiv.classList.add('hora-actual');
                    }
                    
                    // Etiqueta de hora (solo la hora, sin minutos para formato compacto)
                    const horaLabel = document.createElement('div');
                    horaLabel.className = 'hora-label';
                    if (esHoraActual) {
                        horaLabel.classList.add('hora-actual-label');
                        // Mostrar hora completa con minutos si es la hora actual
                        horaLabel.textContent = `${String(horasEnteras).padStart(2, '0')}:${String(minutosActuales).padStart(2, '0')}`;
                    } else {
                        horaLabel.textContent = String(horasEnteras).padStart(2, '0');
                    }
                    horaDiv.appendChild(horaLabel);
                    
                    // Línea divisoria para la media hora (en la mitad de cada celda)
                    const lineaMediaHora = document.createElement('div');
                    lineaMediaHora.className = 'linea-media-hora';
                    horaDiv.appendChild(lineaMediaHora);
                    
                    // Contenedor para incidencias de esta hora
                    const incidenciasContainer = document.createElement('div');
                    incidenciasContainer.className = 'incidencias-hora-container';
                    horaDiv.appendChild(incidenciasContainer);
                    
                    // Agregar incidencias que corresponden a esta hora
                    incidenciasParaAgregar.forEach(incidencia => {
                        let horaIncidencia = null;
                        if (incidencia.fecha_hora) {
                            try {
                                const fechaHora = new Date(incidencia.fecha_hora);
                                horaIncidencia = fechaHora.getHours() + fechaHora.getMinutes() / 60;
                            } catch (e) {
                                // Error al parsear
                            }
                        }
                        
                        // Si la incidencia tiene hora
                        if (horaIncidencia !== null) {
                            // Si la hora es mayor a 12:30, ponerla en la última hora (12:30)
                            if (horaIncidencia > 12.5) {
                                // Solo agregar en la última hora (índice 6, que es 12:30)
                                if (index === horas.length - 1) {
                                    const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                                    incidenciasContainer.appendChild(incDiv);
                                }
                            } else {
                                // Si está dentro del rango de esta hora (con margen de 30 min)
                                const horaInicio = horaDecimal - 0.5; // 30 min antes
                                const horaFin = horaDecimal + 0.5; // 30 min después
                                if (horaIncidencia >= horaInicio && horaIncidencia < horaFin) {
                                    const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                                    incidenciasContainer.appendChild(incDiv);
                                }
                            }
                        }
                    });
                    
                    // Agregar incidencias sin hora al final de la primera hora (6:30)
                    if (index === 0) {
                        incidenciasParaAgregar.forEach(incidencia => {
                            if (!incidencia.fecha_hora) {
                                // Verificar que no se haya agregado ya
                                const yaAgregada = Array.from(incidenciasContainer.children).some(
                                    child => child.dataset.no === incidencia.no
                                );
                                if (!yaAgregada) {
                                    const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                                    incidenciasContainer.appendChild(incDiv);
                                }
                            }
                        });
                    }
                    
                    // Hacer la celda de hora droppable
                    horaDiv.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        horaDiv.classList.add('drag-over');
                        
                        // Si el usuario está plegado, desplegarlo automáticamente
                        if (tr.classList.contains('usuario-plegado')) {
                            tr.classList.remove('usuario-plegado');
                            const btnToggle = tdUsuario.querySelector('.btn-toggle-usuario');
                            if (btnToggle) {
                                btnToggle.innerHTML = '▼';
                                btnToggle.title = 'Plegar usuario';
                            }
                        }
                    });
                    
                    horaDiv.addEventListener('dragleave', () => {
                        horaDiv.classList.remove('drag-over');
                    });
                    
                    horaDiv.addEventListener('drop', (e) => {
                        e.preventDefault();
                        horaDiv.classList.remove('drag-over');
                        
                        const incidenciaNo = e.dataTransfer.getData('text/plain');
                        const datos = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                        
                        // Calcular la hora basándose en la posición Y dentro de la celda de hora
                        const rect = horaDiv.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const alturaHora = rect.height;
                        const porcentaje = Math.max(0, Math.min(1, y / alturaHora));
                        
                        // Calcular hora exacta (dentro del rango de esta hora)
                        const horaInicio = horaDecimal - 0.5;
                        const horaCalculada = horaInicio + (porcentaje * 1.0); // Rango de 1 hora
                        
                        // Crear nueva fecha_hora
                        const nuevaFechaHora = new Date(fecha);
                        nuevaFechaHora.setUTCHours(Math.floor(horaCalculada), Math.round((horaCalculada % 1) * 60), 0, 0);
                        
                        moverIncidenciaConHora(incidenciaNo, datos.usuarioId, datos.fecha, usuarioId, fechaStr, nuevaFechaHora.toISOString());
                    });
                    
                    horasContainer.appendChild(horaDiv);
                });
                
                td.appendChild(horasContainer);
            } else {
                // Vista normal: contenedor con grid 2 columnas y agregar incidencias
                const contenidoDiv = document.createElement('div');
                contenidoDiv.className = 'celda-dia-contenido';
                incidenciasParaAgregar.forEach(incidencia => {
                    const incDiv = crearElementoIncidencia(incidencia, usuarioIdNormalizado, fechaStr);
                    contenidoDiv.appendChild(incDiv);
                });
                td.appendChild(contenidoDiv);
                
                // Hacer la celda droppable
                td.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    td.classList.add('drag-over');
                    
                    // Si el usuario está plegado, desplegarlo automáticamente
                    if (tr.classList.contains('usuario-plegado')) {
                        tr.classList.remove('usuario-plegado');
                        const btnToggle = tdUsuario.querySelector('.btn-toggle-usuario');
                        if (btnToggle) {
                            btnToggle.innerHTML = '▼';
                            btnToggle.title = 'Plegar usuario';
                        }
                    }
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
            }
            
            tr.appendChild(td);
        }
        
        // Agregar listener de dragover en la fila completa para desplegar automáticamente
        // cuando se arrastra sobre cualquier parte de la fila, incluso si está plegada
        tr.addEventListener('dragover', (e) => {
            // Solo procesar si la fila está plegada
            if (tr.classList.contains('usuario-plegado')) {
                e.preventDefault();
                // Desplegar automáticamente
                tr.classList.remove('usuario-plegado');
                const btnToggle = tdUsuario.querySelector('.btn-toggle-usuario');
                if (btnToggle) {
                    btnToggle.innerHTML = '▼';
                    btnToggle.title = 'Plegar usuario';
                }
            }
        });
        
        tbody.appendChild(tr);
    });
    
    // Asegurar que las incidencias sin asignar se muestren
    mostrarIncidenciasLibres();
    
    // Sincronizar mini calendario con la semana visible
    actualizarMiniCalendarioDesdeSemana();
}

// Función para verificar si una incidencia debe mostrarse según los filtros
function debeMostrarIncidencia(incidencia) {
    const esOrden = esOrdenTrabajo(incidencia);
    if (esOrden && estado.permisos && estado.permisos.puede_ver_ordenes === false) return false;

    const cbInc = document.getElementById('filtro-mostrar-incidencias');
    const cbOrd = document.getElementById('filtro-mostrar-ordenes');
    if (cbInc && cbOrd) {
        if (esOrden && !cbOrd.checked) return false;
        if (!esOrden && !cbInc.checked) return false;
    }

    // Permisos: si el usuario tiene tipos_incidencia_visible definido, solo mostrar esos tipos
    const tiposPermitidos = estado.permisos && estado.permisos.tipos_incidencia_visible;
    if (Array.isArray(tiposPermitidos) && tiposPermitidos.length > 0) {
        const tipo = (incidencia.tipo_incidencia || '').trim();
        if (!tiposPermitidos.some(t => String(t).trim() === tipo)) return false;
    }
    const subtiposPermitidos = estado.permisos && estado.permisos.subtipos_incidencia_visible;
    if (Array.isArray(subtiposPermitidos) && subtiposPermitidos.length > 0) {
        const subRaw = (incidencia.subtipo_incidencia || '').trim();
        const subKey = subRaw || SUBTIPO_FILTRO_SIN_VALOR;
        if (!subtiposPermitidos.some(t => String(t).trim() === subKey)) return false;
    }
    // Filtro Comunicado por EMT: si solo está marcado "Sí" o solo "No", filtrar
    const containerEMT = document.getElementById('filtro-comunicado-emt-container');
    if (containerEMT) {
        const cbSi = document.getElementById('filtro-comunicado-emt-si');
        const cbNo = document.getElementById('filtro-comunicado-emt-no');
        if (cbSi && cbNo) {
            const soloSi = cbSi.checked && !cbNo.checked;
            const soloNo = cbNo.checked && !cbSi.checked;
            const valorEMT = parseBooleanLike(incidencia.comunicado_por_emt);
            if (soloSi && !valorEMT) return false;
            if (soloNo && valorEMT) return false;
        }
    }
    
    const checkboxes = document.querySelectorAll('.filtro-tipo-checkbox');
    if (checkboxes.length > 0) {
        const tipoIncidencia = incidencia.tipo_incidencia || '';
        let algunoSeleccionado = false;
        let tipoSeleccionado = false;
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                algunoSeleccionado = true;
                if (checkbox.value === tipoIncidencia) tipoSeleccionado = true;
            }
        });
        if (algunoSeleccionado && !tipoSeleccionado) return false;
    }

    const checkboxesSub = document.querySelectorAll('.filtro-subtipo-checkbox');
    if (checkboxesSub.length > 0) {
        const subKey = (incidencia.subtipo_incidencia || '').trim() || SUBTIPO_FILTRO_SIN_VALOR;
        let algunoSub = false;
        let subSel = false;
        checkboxesSub.forEach(cb => {
            if (cb.checked) {
                algunoSub = true;
                if (cb.value === subKey) subSel = true;
            }
        });
        if (algunoSub && !subSel) return false;
    }
    return true;
}

// Caché para tipos ya mapeados (mejora el rendimiento)
const cacheTiposColores = {};

// Función para normalizar texto (eliminar acentos, espacios, convertir a minúsculas)
function normalizarTexto(texto) {
    if (!texto) return '';
    return String(texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
        .trim()
        .replace(/\s+/g, ' '); // Normalizar espacios
}

// Función para obtener color según tipo de incidencia
function obtenerColorPorTipo(tipoIncidencia) {
    // Si no hay tipo, usar default
    if (!tipoIncidencia || String(tipoIncidencia).trim() === '') {
        return 'tipo-default';
    }
    
    // Normalizar el tipo de incidencia para comparación
    const tipoNormalizado = normalizarTexto(tipoIncidencia);
    
    // Verificar si ya está en caché
    if (cacheTiposColores[tipoNormalizado]) {
        return cacheTiposColores[tipoNormalizado];
    }
    
    // Mapeo completo de tipos de incidencia a clases CSS
    // Se busca coincidencia exacta primero, luego parcial
    const mapeoTipos = {
        // EMT - múltiples variantes
        'incidencias emt': 'tipo-emt',
        'incidencia emt': 'tipo-emt',
        'emt': 'tipo-emt',
        
        // Mantenimiento
        'mantenimiento': 'tipo-mantenimiento',
        'mantenimientos': 'tipo-mantenimiento',
        
        // Reparación
        'reparación': 'tipo-reparacion',
        'reparacion': 'tipo-reparacion',
        'reparaciones': 'tipo-reparacion',
        
        // Instalación
        'instalación': 'tipo-instalacion',
        'instalacion': 'tipo-instalacion',
        'instalaciones': 'tipo-instalacion',
        
        // Revisión
        'revisión': 'tipo-revision',
        'revision': 'tipo-revision',
        'revisiones': 'tipo-revision',
        
        // Limpieza
        'limpieza': 'tipo-limpieza',
        'limpiezas': 'tipo-limpieza',
        
        // Otras
        'otras': 'tipo-otras',
        'otra': 'tipo-otras',
        'otros': 'tipo-otras',
        'otro': 'tipo-otras'
    };
    
    // Primero buscar coincidencia exacta
    if (mapeoTipos[tipoNormalizado]) {
        cacheTiposColores[tipoNormalizado] = mapeoTipos[tipoNormalizado];
        return mapeoTipos[tipoNormalizado];
    }
    
    // Luego buscar coincidencia parcial (el tipo contiene la clave o viceversa)
    // Ordenar por longitud de clave (más largas primero) para mejor coincidencia
    const clavesOrdenadas = Object.keys(mapeoTipos).sort((a, b) => b.length - a.length);
    for (const key of clavesOrdenadas) {
        if (tipoNormalizado.includes(key) || key.includes(tipoNormalizado)) {
            const className = mapeoTipos[key];
            cacheTiposColores[tipoNormalizado] = className;
            return className;
        }
    }
    
    // Si no hay coincidencia, SIEMPRE generar un color único basado en el hash del tipo
    // Esto asegura que cada tipo tenga un color consistente y único
    // NUNCA devolvemos 'tipo-default' para tipos válidos
    const colorGenerado = generarClaseColorPorHash(tipoNormalizado);
    cacheTiposColores[tipoNormalizado] = colorGenerado;
    return colorGenerado;
}

// Función para generar una clase de color única basada en el hash del tipo
// Esto asegura que tipos desconocidos tengan un color consistente y único
function generarClaseColorPorHash(tipo) {
    // Lista completa de clases de color disponibles
    // Incluye los tipos específicos y los tipos genéricos (tipo-1 a tipo-10)
    const clasesDisponibles = [
        'tipo-emt',
        'tipo-mantenimiento',
        'tipo-reparacion',
        'tipo-instalacion',
        'tipo-revision',
        'tipo-limpieza',
        'tipo-otras',
        'tipo-1',
        'tipo-2',
        'tipo-3',
        'tipo-4',
        'tipo-5',
        'tipo-6',
        'tipo-7',
        'tipo-8',
        'tipo-9',
        'tipo-10'
    ];
    
    // Generar un hash simple pero efectivo del tipo
    let hash = 0;
    for (let i = 0; i < tipo.length; i++) {
        const char = tipo.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convertir a entero de 32 bits
    }
    
    // Usar el hash para seleccionar un color de la lista
    // Esto asegura que el mismo tipo siempre obtenga el mismo color
    const indice = Math.abs(hash) % clasesDisponibles.length;
    return clasesDisponibles[indice];
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
    if (esOrdenTrabajo(incidencia)) div.classList.add('es-orden-trabajo');
    
    div.draggable = true;
    div.dataset.no = incidencia.no;
    div.dataset.usuario = usuarioId;
    div.dataset.fecha = fecha;
    
    // Mostrar descripción como elemento principal (más importante)
    const descripcion = incidencia.descripcion || 'Sin descripción';
    const descripcionCorta = descripcion.length > 80 ? descripcion.substring(0, 80) + '...' : descripcion;
    const recurso = formatearRecursoDisplay(incidencia);
    
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
        
        // Vista simple: solo incidencia en cuadro gris (la hora está en la etiqueta de la celda)
        div.innerHTML = `
            <div class="incidencia-simple-box">
                <div class="incidencia-simple-header">
                    <span class="incidencia-simple-no">${esOrdenTrabajo(incidencia) ? '<span class="badge-orden" title="Orden de trabajo">OT</span> ' : ''}${incidencia.no}</span>
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
                <span class="incidencia-no-header">${esOrdenTrabajo(incidencia) ? '<span class="badge-orden" title="Orden de trabajo">OT</span> ' : ''}${incidencia.no}</span>
                <span class="incidencia-editar" data-id-gtask="${incidencia.id_gtask || incidencia.no}" title="Ver detalle">
                    ✏️
                </span>
            </div>
            ${imagenHTML}
            <div class="incidencia-descripcion">${descripcionCorta}</div>
            
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

// Cambiar tipo de vista: lista (principal), simple, calendario
function cambiarTipoVista(tipo) {
    estado.tipoVista = tipo;
    estado.vistaSimple = (tipo === 'simple');
    const vistaTipoSelect = document.getElementById('vista-tipo-select');
    if (vistaTipoSelect) vistaTipoSelect.value = tipo;
    actualizarVista();
}

// Mostrar/ocultar contenedores según tipoVista y rellenar contenido
function actualizarVista() {
    const listaContainer = document.getElementById('vista-lista-container');
    const calendarioWrapper = document.getElementById('vista-calendario-wrapper');
    const controls = document.querySelector('.controls');
    if (estado.tipoVista === 'lista') {
        if (listaContainer) listaContainer.style.display = 'block';
        if (calendarioWrapper) calendarioWrapper.style.display = 'none';
        if (controls) controls.style.display = 'none';
        generarVistaLista();
        initVistaListaFiltroYOrden();
    } else {
        if (listaContainer) listaContainer.style.display = 'none';
        if (calendarioWrapper) calendarioWrapper.style.display = 'block';
        if (controls) controls.style.display = 'flex';
        generarCalendario();
        mostrarIncidenciasLibres();
    }
}

// Generar tabla de la vista lista: filtrable, ordenable por columnas, con Tipo de incidencia
function generarVistaLista() {
    const tbody = document.getElementById('vista-lista-body');
    const inputFiltro = document.getElementById('vista-lista-input-filtro');
    if (!tbody) return;
    if (inputFiltro) vistaListaEstado.filtro = inputFiltro.value.trim().toLowerCase();
    tbody.innerHTML = '';
    let incidencias = getVistaListaBaseIncidencias();
    incidencias = aplicarFiltrosColumnaVistaLista(incidencias);
    // Aplicar filtro de texto (busca en no, descripción, tipo, recurso, dirección, usuario)
    if (vistaListaEstado.filtro) {
        const q = vistaListaEstado.filtro;
        const nombreUsuario = (id) => {
            const u = estado.usuarios.find(us => String(us.id || us.user_id || us.userId || us._id || '').indexOf(String(id)) !== -1 || String(id).indexOf(String(us.id || us.user_id || '')) !== -1);
            return u ? (u.name || u.username || u.nombre || '') : '';
        };
        incidencias = incidencias.filter(inc => {
            const no = (inc.no || '').toLowerCase();
            const desc = (inc.descripcion || '').toLowerCase();
            const tipo = (inc.tipo_incidencia || '').toLowerCase();
            const subtipo = (inc.subtipo_incidencia || '').toLowerCase();
            const recursoNombre = (inc.resource_name || '').toLowerCase();
            const recursoNum = (inc.recurso || '').toLowerCase();
            const dir = (inc.direccion || inc.address || '').toLowerCase();
            const user = (inc.usuario || '').toLowerCase();
            const userNombre = nombreUsuario(inc.usuario).toLowerCase();
            const creador = (inc.usuario_creador || '').toLowerCase();
            const creadorNombre = nombreUsuario(inc.usuario_creador).toLowerCase();
            const comunicadoEMT = (parseBooleanLike(inc.comunicado_por_emt) ? 'sí' : 'no');
            return no.includes(q) || desc.includes(q) || tipo.includes(q) || subtipo.includes(q)
                || recursoNombre.includes(q) || recursoNum.includes(q)
                || dir.includes(q) || user.includes(q) || userNombre.includes(q) || creador.includes(q) || creadorNombre.includes(q)
                || comunicadoEMT.includes(q);
        });
    }
    // Ordenar
    const col = vistaListaEstado.sortCol;
    const dir = vistaListaEstado.sortDir;
    const getVal = (inc, c) => {
        if (c === 'no') return (inc.no || inc.id_gtask || '').toLowerCase();
        if (c === 'fecha') return inc.fecha_hora ? new Date(inc.fecha_hora).getTime() : (inc.fecha ? new Date(inc.fecha).getTime() : 0);
        if (c === 'descripcion') return (inc.descripcion || '').toLowerCase();
        if (c === 'tipo') return (inc.tipo_incidencia || '').toLowerCase();
        if (c === 'subtipo') return (inc.subtipo_incidencia || '').toLowerCase();
        if (c === 'comunicado_emt') return parseBooleanLike(inc.comunicado_por_emt) ? 'sí' : 'no';
        if (c === 'recurso') return (inc.resource_name || inc.recurso || '').toLowerCase();
        if (c === 'usuario_creador') return (obtenerNombreUsuario(inc.usuario_creador,false) || '').toLowerCase();
        if (c === 'usuario') return (obtenerNombreUsuario(inc.usuario,true) || '').toLowerCase();
        return '';
    };
    incidencias.sort((a, b) => {
        const va = getVal(a, col);
        const vb = getVal(b, col);
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
        return dir < 0 ? -cmp : cmp;
    });
    // Actualizar iconos de ordenación en thead
    document.querySelectorAll('.vista-lista-tabla thead th.sortable').forEach(th => {
        const span = th.querySelector('.sort-icon');
        const dataSort = th.getAttribute('data-sort');
        th.classList.remove('sort-asc', 'sort-desc');
        if (span) {
            if (dataSort === vistaListaEstado.sortCol) {
                th.classList.add(vistaListaEstado.sortDir < 0 ? 'sort-desc' : 'sort-asc');
                span.textContent = vistaListaEstado.sortDir < 0 ? ' ▼' : ' ▲';
            } else {
                span.textContent = '';
            }
        }
    });
    if (incidencias.length === 0) {
        const tr = document.createElement('tr');
        const hayFiltroCols = vistaListaEstado.columnFilters && VISTA_LISTA_SORT_COLS.some(c => vistaListaEstado.columnFilters[c] != null);
        const msgFiltro = (vistaListaEstado.filtro || hayFiltroCols)
            ? 'No hay coincidencias con los filtros aplicados.'
            : 'No hay incidencias que mostrar. Usa "Refrescar" para cargar datos.';
        tr.innerHTML = '<td colspan="10" class="vista-lista-empty">' + msgFiltro + '</td>';
        tbody.appendChild(tr);
        actualizarIndicadoresAutofiltroVistaLista();
        return;
    }
    incidencias.forEach(inc => {
        const tr = document.createElement('tr');
        const fechaStr = formatFechaListaIncidencia(inc);
        const descripcion = (inc.descripcion || '-').substring(0, 120) + ((inc.descripcion && inc.descripcion.length > 120) ? '...' : '');
        const recurso = formatearRecursoDisplay(inc);
        const tipoIncidencia = inc.tipo_incidencia || '-';
        const subtipoIncidencia = inc.subtipo_incidencia || '-';
        const comunicadoEMT = parseBooleanLike(inc.comunicado_por_emt) ? 'Sí' : 'No';
        const creadoPor = obtenerNombreUsuario(inc.usuario_creador,false);
        const usuarioAsignado = obtenerNombreUsuario(inc.usuario,true);
        const idGtask = inc.id_gtask || inc.no;
        const noIncidencia = (esOrdenTrabajo(inc) ? 'OT ' : '') + (inc.no || idGtask);
        const p = estado.permisos || {};
        const puedeModificar = p.puede_modificar !== false;
        const puedeImprimir = p.puede_imprimir !== false;
        const botonesAcciones = [
            puedeModificar ? `<button type="button" class="btn-editar-lista" data-id-gtask="${escapeHtml(idGtask)}" title="Editar">✎</button>` : '',
            puedeImprimir ? `<button type="button" class="btn-imprimir-lista" data-id-gtask="${escapeHtml(idGtask)}" title="Imprimir PDF">🖨️</button>` : ''
        ].filter(Boolean).join('');
        tr.innerHTML = `
            <td class="vista-lista-no">${escapeHtml(noIncidencia)}</td>
            <td class="vista-lista-fecha">${fechaStr}</td>
            <td class="vista-lista-descripcion" title="${(inc.descripcion || '').replace(/"/g, '&quot;')}">${escapeHtml(descripcion)}</td>
            <td class="vista-lista-tipo">${escapeHtml(tipoIncidencia)}</td>
            <td class="vista-lista-subtipo">${escapeHtml(subtipoIncidencia)}</td>
            <td class="vista-lista-comunicado-emt">${comunicadoEMT}</td>
            <td class="vista-lista-recurso">${escapeHtml(recurso)}</td>
            <td class="vista-lista-creador">${escapeHtml(creadoPor)}</td>
            <td class="vista-lista-usuario">${escapeHtml(usuarioAsignado)}</td>
            <td class="col-acciones vista-lista-td-acciones"><div class="vista-lista-acciones">${botonesAcciones || '—'}</div></td>
        `;
        if (puedeModificar) tr.querySelector('.btn-editar-lista')?.addEventListener('click', () => abrirDetalleIncidencia(idGtask));
        if (puedeImprimir) tr.querySelector('.btn-imprimir-lista')?.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/detalle-incidencia/${encodeURIComponent(idGtask)}`);
                const data = await response.json();
                if (data.success && data.detalle) {
                    detalleActual = data.detalle;
                    idGtaskActual = idGtask;
                    await imprimirPDFPasandoPorActualizar();
                } else {
                    alert('No se pudo cargar el detalle para imprimir: ' + (data.error || ''));
                }
            } catch (e) {
                alert('Error al imprimir: ' + (e.message || e));
            }
        });
        tbody.appendChild(tr);
    });
    actualizarIndicadoresAutofiltroVistaLista();
}

// Inicializar filtro y ordenación de la vista lista (llamar al cargar la página y al mostrar vista lista)
function initVistaListaFiltroYOrden() {
    initVistaListaAutofiltros();
    const inputFiltro = document.getElementById('vista-lista-input-filtro');
    if (inputFiltro && !inputFiltro.dataset.inited) {
        inputFiltro.dataset.inited = '1';
        inputFiltro.addEventListener('input', () => { generarVistaLista(); });
        inputFiltro.addEventListener('keyup', () => { generarVistaLista(); });
    }
    document.querySelectorAll('.vista-lista-tabla thead th.sortable').forEach(th => {
        if (th.dataset.sortInited) return;
        th.dataset.sortInited = '1';
        th.style.cursor = 'pointer';
        th.addEventListener('click', (e) => {
            if (e.target.closest('.vista-lista-filter-btn')) return;
            const col = th.getAttribute('data-sort');
            if (col === vistaListaEstado.sortCol) vistaListaEstado.sortDir = -vistaListaEstado.sortDir;
            else { vistaListaEstado.sortCol = col; vistaListaEstado.sortDir = 1; }
            generarVistaLista();
        });
    });
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Formato parada/recurso: descripción (número). Si solo hay uno, solo ese. */
function formatearRecursoDisplay(obj) {
    const name = (obj.resource_name || '').trim();
    const num = (obj.recurso || obj.resource || '').trim();
    if (name && num) return `${name} (${num})`;
    if (name) return name;
    if (num) return num;
    return '-';
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
            actualizarVista();
            
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

// Mover incidencia con hora específica
async function moverIncidenciaConHora(noIncidencia, usuarioOrigen, fechaOrigen, usuarioDestino, fechaDestino, nuevaFechaHora) {
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
                nuevo_usuario_id: usuarioDestino,
                nueva_fecha_hora: nuevaFechaHora
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
            actualizarVista();
            
            console.log(`✅ Incidencia ${noIncidencia} movida correctamente con hora ${nuevaFechaHora}. Datos refrescados.`);
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
    const recurso = formatearRecursoDisplay(incidencia);
    const subtipoLibre = (incidencia.subtipo_incidencia && String(incidencia.subtipo_incidencia).trim()) || '';
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
            <span class="incidencia-libre-no">${escapeHtml(String(incidencia.no))}${subtipoLibre ? ` <span class="incidencia-libre-subtipo">· ${escapeHtml(subtipoLibre)}</span>` : ''}</span>
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
    // 2. Sin id_gtask (aunque tengan usuario)
    // 3. O asignadas a usuarios que no están en el filtro
    const incidenciasLibres = estado.incidencias.filter(inc => {
        // Si no tiene id_gtask, tratarla como no asignada
        if (!inc.id_gtask || inc.id_gtask === null || inc.id_gtask === undefined || String(inc.id_gtask).trim() === '') {
            return true;
        }
        
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
                incidenciasDiv.style.display = 'grid'; // Usar 'grid' en lugar de 'flex' para mantener el layout
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
/** Imágenes nuevas pendientes de enviar a BC al guardar ({ name, file }) */
let imagenesPendientesDetalle = [];
/** Estado pendiente de guardar (ej. 'Cerrada') cuando el usuario pulsa "Cerrar incidencia" */
let estadoPendienteGuardar = null;

// Objeto para almacenar las rotaciones de las imágenes (URL -> grados: 0, 90, 180, 270)
let rotacionesImagenes = {};

// Abrir modal de detalle de incidencia
async function abrirDetalleIncidencia(idGtask) {
    const modal = document.getElementById('detalle-modal');
    const contenido = document.getElementById('detalle-contenido');
    
    idGtaskActual = idGtask;
    imagenesPendientesDetalle = [];
    
    // Mostrar modal con loading
    contenido.innerHTML = '<div class="loading">Cargando detalle de la incidencia...</div>';
    modal.style.display = 'block';
    
    try {
        const response = await fetch(`/api/detalle-incidencia/${encodeURIComponent(idGtask)}`);
        const data = await response.json();
        
        if (data.success && data.detalle) {
            detalleActual = data.detalle;
            estadoPendienteGuardar = null;
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
function obtenerNombreUsuario(userId,asignado) {
    if (!userId) {
        if (asignado) {
            return 'Sin asignar';
        } else {
            return 'N/A';
        }
    }
       
    
    
    // Buscar en la lista de usuarios cargados
    const usuario = estado.usuarios.find(u => {
        const id = String(u.id || u.user_id || u.userId || u._id || '');
        return id === String(userId) || id.includes(String(userId)) || String(userId).includes(id);
    });
    
    if (usuario) {
        if (usuario.suranme) {
            return usuario.name+' '+usuario.suranme;
        } else {
            return usuario.name;
        }
        
    }
    
    // Si no se encuentra, devolver el ID
    return String(userId);
}

// Mostrar detalle de incidencia en el modal
function mostrarDetalleIncidencia(detalle) {
    const contenido = document.getElementById('detalle-contenido');
    const modalTitle = document.querySelector('#detalle-modal .modal-header h2');
    const incCache = estado.incidencias.find(i => String(i.id_gtask || i.no) === String(idGtaskActual));
    const esOrden = parseBooleanLike(detalle.Es_Peticion ?? detalle.es_peticion) || (incCache && esOrdenTrabajo(incCache));
    if (modalTitle) {
        modalTitle.textContent = esOrden ? '📋 Detalle de Orden de trabajo' : '📋 Detalle de Incidencia';
    }
    
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
    
    // Usuario creador (solo lectura): Id_Uduario_Gtask; en BC el nombre es "Usuario"
    const userIdCreador = detalle.user_name;
    const nombreCreador = obtenerNombreUsuario(userIdCreador,false);
    // Usuario asignado: ID puede venir en varios campos del detalle BC
    const userIdAsignado = detalle.Id_Uduario_Gtask_Asignado || detalle.Id_Usuario_Gtask_Asignado || detalle.user_assigned;
    const nombreUsuario = obtenerNombreUsuario(userIdAsignado,true);
    
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
    
    const permDetalle = estado.permisos || {};
    const puedeModificarDetalle = permDetalle.puede_modificar !== false;
    let galeriaExistenteHTML = '';
    if (detalle.image && Array.isArray(detalle.image) && detalle.image.length > 0) {
        detalle.image.forEach((img, index) => {
            if (img.url) {
                const rotacionGuardada = rotacionesImagenes[img.url] || 0;
                const esVertical = esImagenVertical(img.url);
                const rotacionInicial = esVertical ? 90 : 0;
                const rotacionTotal = (rotacionInicial + rotacionGuardada) % 360;
                let claseRotacion = '';
                if (rotacionTotal === 90 || rotacionTotal === 270) {
                    claseRotacion = 'imagen-vertical-rotada';
                }
                const claseContenedor = (rotacionTotal === 90 || rotacionTotal === 270) ? 'imagen-item-vertical' : '';
                const estiloRotacion = `transform: rotate(${rotacionTotal}deg);`;
                const urlAttr = escapeHtml(img.url);
                const urlJs = String(img.url).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                galeriaExistenteHTML += `
                    <div class="imagen-item ${claseContenedor}" data-image-url="${urlAttr}" data-image-index="${index}">
                        <div class="imagen-rotar-btn" onclick="rotarImagen('${urlJs}', event)" title="Rotar imagen 90°">🔄</div>
                        <img src="${urlAttr}" alt="${escapeHtml(img.name || 'Imagen')}" 
                             class="${claseRotacion}" 
                             style="${estiloRotacion}"
                             onclick="abrirImagenGrande('${urlJs}')">
                    </div>
                `;
            }
        });
    }
    const imagenesHTML = `
        <div class="detalle-imagenes">
            <div class="detalle-imagenes-toolbar">
                <h3>Imágenes</h3>
                ${puedeModificarDetalle ? `
                    <button type="button" id="btn-anadir-imagenes-detalle" class="btn-anadir-imagenes" title="Añadir imágenes (se envían al guardar)">📷 Añadir imágenes</button>
                    <input type="file" id="input-imagenes-detalle" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
                ` : ''}
            </div>
            ${galeriaExistenteHTML ? `<div class="galeria-imagenes">${galeriaExistenteHTML}</div>` : '<p class="detalle-imagenes-vacio">Sin imágenes en BC.</p>'}
            <div id="galeria-imagenes-pendientes" class="galeria-imagenes galeria-imagenes-pendientes"></div>
            ${puedeModificarDetalle ? '<p class="detalle-imagenes-ayuda">Las imágenes nuevas se suben a Business Central al pulsar «Guardar Cambios».</p>' : ''}
        </div>
    `;
    
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
    
    const detalleTipoStr = (detalle.incidenceType != null && String(detalle.incidenceType).trim() !== '')
        ? String(detalle.incidenceType).trim() : 'N/A';
    const rawSubtipoDetalle = detalle.subIncidenceType != null ? detalle.subIncidenceType : detalle.subIncidenceType;
    const detalleSubtipoStr = (rawSubtipoDetalle != null && String(rawSubtipoDetalle).trim() !== '')
        ? String(rawSubtipoDetalle).trim() : 'N/A';
    
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
                    <p>
                        <span id="detalle-estado-badge" class="estado-badge estado-${estadoClaseBadge(detalle.state)}">${formatearEstado(detalle.state) || 'N/A'}</span>
                        ${esEstadoCerrada(detalle.state) ? '' : '<button type="button" id="cerrar-incidencia-btn" class="btn-cerrar-incidencia" title="Marcar como cerrada y guardar con Guardar Cambios">✓ Cerrar incidencia</button>'}
                    </p>
                </div>
                <div class="detalle-campo" style="flex: 1;">
                    <label>Fecha/Hora:</label>
                    <input type="datetime-local" id="edit-fecha-hora" class="detalle-input" value="${fechaHoraInput}">
                </div>
            </div>
            <div style="display: flex; gap: 20px; align-items: flex-start;">
                <div class="detalle-campo" style="flex: 1;">
                    <label>Tipo de Incidencia:</label>
                    <p>${escapeHtml(detalleTipoStr)}</p>
                </div>
                <div class="detalle-campo" style="flex: 1;">
                    <label>Subtipo incidencia:</label>
                    <p class="detalle-campo-solo-lectura">${escapeHtml(detalleSubtipoStr)}</p>
                </div>
            </div>
            <div class="detalle-campo">
                <label>Creado por:</label>
                <p class="detalle-campo-solo-lectura">${escapeHtml(nombreCreador || 'N/A')}</p>
            </div>
            <div style="display: flex; gap: 20px; align-items: flex-start;">
                <div class="detalle-campo" style="flex: 1;">
                    <label>Usuario asignado:</label>
                    <select id="edit-usuario-asignado" class="detalle-input detalle-select-usuario">
                        <option value="">— Sin asignar —</option>
                        ${(estado.usuarios || []).map(u => {
                            const uid = String(u.id || u.user_id || u.userId || u._id || '');
                            const nom = u.name || u.username || u.nombre || uid;
                            const sel = (uid && userIdAsignado && (uid === String(userIdAsignado) || uid.includes(String(userIdAsignado)) || String(userIdAsignado).includes(uid))) ? ' selected' : '';
                            return `<option value="${escapeHtml(uid)}"${sel}>${escapeHtml(nom)}</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="detalle-campo" style="flex: 1;">
                    <label>Comunicado por EMT:</label>
                    <p class="detalle-campo-solo-lectura">${parseBooleanLike(detalle.Comunicado_por_EMT ?? detalle.comunicado_por_emt) ? 'Sí' : 'No'}</p>
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
                ${(detalle.resource_name || detalle.resource || detalle.recurso) ? `<p class="detalle-subcampo" id="resource-name-display">${escapeHtml(formatearRecursoDisplay(detalle))}</p>` : '<p class="detalle-subcampo" id="resource-name-display" style="display: none;"></p>'}
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
    // Botón Cerrar incidencia: marca estado como Cerrada (se envía al pulsar Guardar Cambios)
    const cerrarBtn = document.getElementById('cerrar-incidencia-btn');
    const estadoBadge = document.getElementById('detalle-estado-badge');
    if (cerrarBtn && estadoBadge) {
        cerrarBtn.addEventListener('click', () => {
            estadoPendienteGuardar = 'Cerrada';
            estadoBadge.textContent = 'Cerrada';
            estadoBadge.className = 'estado-badge estado-cerrada';
            cerrarBtn.remove();
            const mensajeSpan = document.getElementById('guardar-mensaje');
            if (mensajeSpan) {
                mensajeSpan.textContent = 'Estado marcado como Cerrada. Pulsa "Guardar Cambios" para enviar.';
                mensajeSpan.className = 'guardar-mensaje guardar-mensaje-info';
            }
        });
    }
    
    // Aplicar permisos en el modal: ocultar acciones no permitidas
    const perm = estado.permisos || {};
    const detalleAcciones = contenido.querySelector('.detalle-acciones');
    if (detalleAcciones && perm.puede_modificar === false) detalleAcciones.style.display = 'none';
    configurarAnadirImagenesDetalle(puedeModificarDetalle);
    renderizarImagenesPendientesDetalle();
    const editUsuarioAsignado = document.getElementById('edit-usuario-asignado');
    if (editUsuarioAsignado && perm.puede_asignar === false) editUsuarioAsignado.closest('.detalle-campo')?.style.setProperty('display', 'none');
    const imprimirPdfBtn = document.getElementById('imprimir-pdf-btn');
    if (imprimirPdfBtn && perm.puede_imprimir === false) imprimirPdfBtn.style.display = 'none';
    const waTallerBtn = document.getElementById('whatsapp-taller-btn');
    if (waTallerBtn && perm.puede_imprimir === false) waTallerBtn.style.display = 'none';
    else if (waTallerBtn) waTallerBtn.style.display = '';
    
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
                        const texto = formatearRecursoDisplay({ resource_name: elemento.name, recurso: elemento.no });
                        nameDisplay.textContent = texto;
                        nameDisplay.style.display = texto !== '-' ? 'block' : 'none';
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

const DETALLE_IMAGEN_MAX_MB = 10;
const DETALLE_IMAGEN_MAX_LADO = 1920;

function configurarAnadirImagenesDetalle(activo) {
    const btn = document.getElementById('btn-anadir-imagenes-detalle');
    const input = document.getElementById('input-imagenes-detalle');
    if (!btn || !input || !activo) return;
    const nuevoBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(nuevoBtn, btn);
    nuevoBtn.addEventListener('click', () => input.click());
    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        await procesarArchivosImagenDetalle(files);
    };
}

function renderizarImagenesPendientesDetalle() {
    const container = document.getElementById('galeria-imagenes-pendientes');
    if (!container) return;
    if (!imagenesPendientesDetalle.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    container.style.display = 'grid';
    container.innerHTML = imagenesPendientesDetalle.map((img, idx) => `
        <div class="imagen-item imagen-item-pendiente">
            <button type="button" class="imagen-quitar-btn" data-idx="${idx}" title="Quitar">×</button>
            <img src="${escapeHtml(img.preview)}" alt="${escapeHtml(img.name)}">
            <span class="imagen-pendiente-nombre">${escapeHtml(img.name)}</span>
        </div>
    `).join('');
    container.querySelectorAll('.imagen-quitar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.idx, 10);
            if (!Number.isNaN(i)) {
                imagenesPendientesDetalle.splice(i, 1);
                renderizarImagenesPendientesDetalle();
            }
        });
    });
}

async function comprimirImagenParaBC(file) {
    const maxBytes = DETALLE_IMAGEN_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes * 3) {
        throw new Error(`La imagen «${file.name}» supera el tamaño máximo (${DETALLE_IMAGEN_MAX_MB} MB).`);
    }
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`No se pudo leer «${file.name}»`));
        reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Formato no válido: «${file.name}»`));
        el.src = dataUrl;
    });
    let w = img.width;
    let h = img.height;
    const maxLado = DETALLE_IMAGEN_MAX_LADO;
    if (w > maxLado || h > maxLado) {
        if (w >= h) {
            h = Math.round(h * (maxLado / w));
            w = maxLado;
        } else {
            w = Math.round(w * (maxLado / h));
            h = maxLado;
        }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    let quality = 0.85;
    let jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
    while (jpegDataUrl.length > maxBytes * 1.37 && quality > 0.45) {
        quality -= 0.1;
        jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (jpegDataUrl.length > maxBytes * 1.37) {
        throw new Error(`«${file.name}» sigue siendo demasiado grande tras comprimir.`);
    }
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const base64 = jpegDataUrl.includes(',') ? jpegDataUrl.split(',')[1] : jpegDataUrl;
    return {
        name: `Imagen_${uid}.jpg`,
        file: base64,
        preview: jpegDataUrl
    };
}

async function procesarArchivosImagenDetalle(files) {
    const mensajeSpan = document.getElementById('guardar-mensaje');
    const btn = document.getElementById('btn-anadir-imagenes-detalle');
    if (btn) btn.disabled = true;
    let errores = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            errores++;
            continue;
        }
        try {
            const item = await comprimirImagenParaBC(file);
            imagenesPendientesDetalle.push(item);
        } catch (err) {
            errores++;
            console.error(err);
            if (mensajeSpan) {
                mensajeSpan.textContent = `❌ ${err.message || err}`;
                mensajeSpan.className = 'guardar-mensaje guardar-mensaje-error';
            }
        }
    }
    renderizarImagenesPendientesDetalle();
    if (btn) btn.disabled = false;
    if (imagenesPendientesDetalle.length && mensajeSpan && !errores) {
        mensajeSpan.textContent = `${imagenesPendientesDetalle.length} imagen(es) pendiente(s). Pulsa «Guardar Cambios».`;
        mensajeSpan.className = 'guardar-mensaje guardar-mensaje-info';
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
    const usuarioAsignadoSelect = document.getElementById('edit-usuario-asignado');
    const guardarBtn = document.getElementById('guardar-cambios-btn');
    const mensajeSpan = document.getElementById('guardar-mensaje');
    
    if (!descripcionInput || !fechaHoraInput || !resourceInput) {
        alert('Error: No se encontraron los campos de edición');
        return;
    }
    
    const nuevaDescripcion = descripcionInput.value.trim();
    const nuevaFechaHora = fechaHoraInput.value;
    const nuevoRecurso = resourceInput.value.trim();
    const nuevoUsuarioId = (usuarioAsignadoSelect && usuarioAsignadoSelect.value.trim()) || null;
    
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
    const hayCambioEstado = estadoPendienteGuardar !== null;
    const usuarioOriginal = detalleActual.Id_Uduario_Gtask_Asignado || detalleActual.Id_Usuario_Gtask_Asignado || detalleActual.user_assigned || detalleActual.user || '';
    const hayCambioUsuario = (nuevoUsuarioId || '') !== String(usuarioOriginal);
    
    const hayImagenesNuevas = imagenesPendientesDetalle.length > 0;

    if (nuevaDescripcion === descripcionOriginalTexto && 
        nuevaFechaHora === fechaOriginalInput && 
        nuevoRecurso === recursoOriginal && !hayCambioEstado && !hayCambioUsuario && !hayImagenesNuevas) {
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
        // Preparar datos para enviar (incluir estado si se pulsó "Cerrar incidencia")
        const datosActualizacion = {
            id_gtask: idGtaskActual,
            descripcion: nuevaDescripcion,
            fecha_hora: nuevaFechaHora,
            recurso: nuevoRecurso
        };
        if (estadoPendienteGuardar) {
            datosActualizacion.state = estadoPendienteGuardar;
        }
        if (nuevoUsuarioId !== undefined) {
            datosActualizacion.usuario_id = nuevoUsuarioId;
        }
        if (hayImagenesNuevas) {
            datosActualizacion.imagenes = imagenesPendientesDetalle.map(img => ({
                name: img.name,
                file: img.file
            }));
        }
        
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
            if (nuevoUsuarioId !== undefined) {
                detalleActual.user_assigned = nuevoUsuarioId;
                detalleActual.Id_Uduario_Gtask_Asignado = nuevoUsuarioId;
            }
            if (estadoPendienteGuardar) {
                detalleActual.state = estadoPendienteGuardar;
                estadoPendienteGuardar = null;
            }
            if (hayImagenesNuevas) {
                imagenesPendientesDetalle = [];
                renderizarImagenesPendientesDetalle();
                try {
                    const resDet = await fetch(`/api/detalle-incidencia/${encodeURIComponent(idGtaskActual)}`);
                    const dataDet = await resDet.json();
                    if (dataDet.success && dataDet.detalle) {
                        detalleActual = dataDet.detalle;
                        mostrarDetalleIncidencia(dataDet.detalle);
                    }
                } catch (e) {
                    console.warn('No se pudo refrescar el detalle tras subir imágenes', e);
                }
            }
            
            if (mensajeSpan) {
                mensajeSpan.textContent = hayImagenesNuevas
                    ? '✅ Cambios e imágenes guardados correctamente'
                    : '✅ Cambios guardados correctamente';
                mensajeSpan.className = 'guardar-mensaje guardar-mensaje-success';
            }
            
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

// Clase CSS del badge de estado (abierta, enprogreso, cerrada)
function estadoClaseBadge(state) {
    const m = { '0': 'abierta', '1': 'enprogreso', '2': 'cerrada', 'Abierta': 'abierta', 'EnProgreso': 'enprogreso', 'En Progreso': 'enprogreso', 'Cerrada': 'cerrada', 'PENDING': 'abierta', 'IN_PROGRESS': 'enprogreso', 'CLOSED': 'cerrada' };
    return m[String(state)] || 'abierta';
}

// Indica si el estado actual es Cerrada
function esEstadoCerrada(state) {
    const s = String(state);
    return s === '2' || s === 'Cerrada' || s === 'CLOSED';
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

/** Aviso por WhatsApp a usuarios del departamento Taller (GTask) con teléfono. */
async function notificarWhatsappTaller() {
    if (!idGtaskActual) {
        alert('No hay incidencia seleccionada.');
        return;
    }
    const perm = estado.permisos || {};
    if (perm.puede_imprimir === false) {
        alert('No tiene permiso para esta acción.');
        return;
    }
    if (
        !confirm(
            '¿Enviar aviso por WhatsApp a todo el personal de Taller con teléfono registrado en GTask?\n\n' +
                'Entre cada destinatario se dejará una pausa de unos segundos y el texto del encabezado variará ligeramente, para reducir bloqueos de WhatsApp (Meta). Si hay muchos usuarios, el envío puede tardar más de un minuto.'
        )
    ) {
        return;
    }
    const btn = document.getElementById('whatsapp-taller-btn');
    const prev = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Enviando...';
    }
    try {
        const incLista = (estado.incidencias || []).find(
            (i) => String(i.id_gtask || '') === String(idGtaskActual)
        );
        const payload = { id_gtask: idGtaskActual };
        if (incLista && incLista.no != null && String(incLista.no).trim() !== '') {
            payload.no = String(incLista.no).trim();
        }
        const response = await fetch('/api/incidencia/notificar-whatsapp-taller', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (data.success) {
            let msg = `WhatsApp enviado a ${data.enviados} destinatario(s).`;
            if (data.en_departamento != null) {
                msg += `\nUsuarios en Taller: ${data.en_departamento} (con teléfono: ${data.con_telefono ?? '—'}).`;
            }
            if (data.omitidos_duplicado_telefono > 0) {
                msg += `\nOmitidos (mismo número): ${data.omitidos_duplicado_telefono}.`;
            }
            if (data.errores && data.errores.length) {
                msg += `\n\nEnvíos fallidos:\n${data.errores.join('\n')}`;
            }
            const as = data.anti_spam_taller;
            if (as && typeof as === 'object') {
                const iv = as.intervalo_seg;
                const vt = as.variar_texto;
                const tot = as.espera_total_aprox_seg;
                const bits = [];
                if (iv != null && Number(iv) > 0) bits.push(`${iv} s entre cada envío`);
                if (vt === true) bits.push('texto con encabezado distinto por persona');
                else if (vt === false) bits.push('mismo formato de mensaje');
                if (tot != null && Number(tot) > 0) bits.push(`~${tot} s de espera acumulada`);
                if (bits.length) {
                    msg += `\n\nAnti-spam (GMalla → Apiwhats): ${bits.join('; ')}.`;
                }
            }
            if (data.bc_notificaciones && data.bc_notificaciones.length) {
                const bc = data.bc_notificaciones;
                const nOk = bc.filter(x => x.business_central === 'exito').length;
                const nOm = bc.filter(x => x.business_central === 'omitido').length;
                const nErr = bc.filter(x => x.business_central === 'error').length;
                msg += `\n\nBusiness Central (postRespuestaWhatsApp): ${nOk} correctos, ${nOm} omitidos, ${nErr} con error.`;
                const det = bc
                    .filter(x => x.business_central !== 'exito')
                    .map(x => {
                        const t = (x.telefono || '').slice(-6);
                        const d = (x.detalle || '').slice(0, 200);
                        return `• …${t}: ${x.business_central} — ${d}`;
                    });
                if (det.length) msg += '\n' + det.join('\n');
            }
            alert(msg);
        } else {
            alert(`No se completó el envío: ${data.error || response.statusText || 'Error desconocido'}`);
        }
    } catch (e) {
        alert('Error de red: ' + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = prev;
        }
    }
}

// Antes de imprimir, pasar por actualizar incidencia para sincronizar con BC
/** Extrae texto legible de errores API (evita alert «[object Object]»). */
function formatApiError(error) {
    if (error == null || error === '') return 'Error desconocido';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
        // OData: { message: { lang, value } } o { message: "..." }
        if (error.message != null) {
            if (typeof error.message === 'object') {
                if (error.message.value != null) return formatApiError(error.message.value);
                return formatApiError(error.message);
            }
            return String(error.message);
        }
        if (error.value != null) return formatApiError(error.value);
        if (error.error != null) return formatApiError(error.error);
        if (error.Message != null) return formatApiError(error.Message);
        try {
            return JSON.stringify(error);
        } catch (_) {
            return String(error);
        }
    }
    return String(error);
}

function hayCambiosPendientesDetalleIncidencia() {
    if (!detalleActual) return false;
    const descripcionInput = document.getElementById('edit-descripcion');
    const fechaHoraInput = document.getElementById('edit-fecha-hora');
    const resourceInput = document.getElementById('edit-resource');
    const usuarioAsignadoSelect = document.getElementById('edit-usuario-asignado');
    const nuevaDescripcion = (descripcionInput && descripcionInput.value.trim()) || detalleActual.description || '';
    const nuevaFechaHora = (fechaHoraInput && fechaHoraInput.value) || '';
    const nuevoRecurso = (resourceInput && resourceInput.value.trim()) || detalleActual.resource || '';
    const nuevoUsuarioId = (usuarioAsignadoSelect && usuarioAsignadoSelect.value.trim()) || '';

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
        } catch (_) {}
    }

    const recursoOriginal = detalleActual.resource || '';
    const usuarioOriginal = detalleActual.Id_Uduario_Gtask_Asignado || detalleActual.Id_Usuario_Gtask_Asignado || detalleActual.user_assigned || detalleActual.user || '';

    return nuevaDescripcion !== descripcionOriginalTexto
        || (nuevaFechaHora && nuevaFechaHora !== fechaOriginalInput)
        || nuevoRecurso !== recursoOriginal
        || estadoPendienteGuardar !== null
        || (nuevoUsuarioId || '') !== String(usuarioOriginal || '')
        || imagenesPendientesDetalle.length > 0;
}

async function imprimirPDFPasandoPorActualizar() {
    if (!detalleActual || !idGtaskActual) return;

    if (!hayCambiosPendientesDetalleIncidencia()) {
        await generarPDF(detalleActual, idGtaskActual);
        return;
    }

    const descripcionInput = document.getElementById('edit-descripcion');
    const fechaHoraInput = document.getElementById('edit-fecha-hora');
    const resourceInput = document.getElementById('edit-resource');
    const usuarioAsignadoSelect = document.getElementById('edit-usuario-asignado');
    const nuevaDescripcion = (descripcionInput && descripcionInput.value.trim()) || detalleActual.description || '';
    let nuevaFechaHora = (fechaHoraInput && fechaHoraInput.value) || '';
    if (!nuevaFechaHora && detalleActual.fecha) {
        try {
            const fecha = new Date(detalleActual.fecha);
            const year = fecha.getFullYear();
            const month = String(fecha.getMonth() + 1).padStart(2, '0');
            const day = String(fecha.getDate()).padStart(2, '0');
            const hours = String(fecha.getHours()).padStart(2, '0');
            const minutes = String(fecha.getMinutes()).padStart(2, '0');
            nuevaFechaHora = `${year}-${month}-${day}T${hours}:${minutes}`;
        } catch (_) {
            nuevaFechaHora = '';
        }
    }
    const nuevoRecurso = (resourceInput && resourceInput.value.trim()) || detalleActual.resource || '';
    const nuevoUsuarioId = (usuarioAsignadoSelect && usuarioAsignadoSelect.value.trim()) || null;
    const datosActualizacion = {
        id_gtask: idGtaskActual,
        descripcion: nuevaDescripcion,
        fecha_hora: nuevaFechaHora || undefined,
        recurso: nuevoRecurso
    };
    if (estadoPendienteGuardar) {
        datosActualizacion.state = estadoPendienteGuardar;
    }
    if (nuevoUsuarioId !== undefined && nuevoUsuarioId !== null) {
        datosActualizacion.usuario_id = nuevoUsuarioId;
    }
    if (imagenesPendientesDetalle.length > 0) {
        datosActualizacion.imagenes = imagenesPendientesDetalle.map(img => ({
            name: img.name,
            file: img.file
        }));
    }
    try {
        const response = await fetch('/api/actualizar-incidencia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosActualizacion)
        });
        let data = {};
        try {
            data = await response.json();
        } catch (_) {
            data = {};
        }
        if (!response.ok || !data.success) {
            const msg = formatApiError(data.error || data.message || response.statusText);
            console.warn('No se pudo sincronizar con BC antes de imprimir:', data.error || data);
            if (!confirm(`No se pudo actualizar en Business Central antes de imprimir:\n\n${msg}\n\n¿Imprimir igualmente con los datos actuales?`)) {
                return;
            }
        } else {
            detalleActual.description = nuevaDescripcion;
            if (nuevaFechaHora) detalleActual.fecha = new Date(nuevaFechaHora).toISOString();
            detalleActual.resource = nuevoRecurso;
            if (estadoPendienteGuardar) detalleActual.state = estadoPendienteGuardar;
            if (imagenesPendientesDetalle.length > 0) {
                imagenesPendientesDetalle = [];
            }
        }
        await generarPDF(detalleActual, idGtaskActual);
    } catch (e) {
        console.error(e);
        if (!confirm(`Error al sincronizar antes de imprimir:\n\n${e.message || String(e)}\n\n¿Imprimir igualmente?`)) {
            return;
        }
        try {
            await generarPDF(detalleActual, idGtaskActual);
        } catch (e2) {
            alert('Error al generar el PDF: ' + (e2.message || String(e2)));
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
        
        // Tipo de Incidencia
        doc.setFont('helvetica', 'bold');
        doc.text('Tipo de Incidencia:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(String(detalle.incidenceType || 'N/A'), margin + 45, yPos);
        yPos += lineHeight + 3;
        
        const subtipoPdfRaw = detalle.subIncidenceType != null ? detalle.subIncidenceType : detalle.subIncidenceType;
        const subtipoPdf = (subtipoPdfRaw != null && String(subtipoPdfRaw).trim() !== '') ? String(subtipoPdfRaw).trim() : '';
        doc.setFont('helvetica', 'bold');
        doc.text('Subtipo incidencia:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(subtipoPdf || 'N/A', margin + 45, yPos);
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
        const nombreUsuario = obtenerNombreUsuario(userId,true);
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
        const elemTexto = formatearRecursoDisplay(detalle);
        doc.text(elemTexto === '-' ? 'N/A' : elemTexto, margin + 25, yPos);
        yPos += lineHeight;
        
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

// Borrar caché de usuarios y volver a cargar nombres desde GTask
async function actualizarNombresUsuarios() {
    const btn = document.getElementById('actualizar-nombres-btn');
    if (!btn) return;
    const textoOriginal = btn.textContent;
    try {
        btn.disabled = true;
        btn.textContent = 'Actualizando…';
        const res = await fetch('/api/usuarios/limpiar-cache', { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
            console.error('Error al limpiar caché:', data.error);
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 2000);
            return;
        }
        await cargarUsuarios();
        actualizarListaFiltroUsuarios();
        actualizarVista();
        btn.textContent = '✓ Listo';
        setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 1500);
    } catch (err) {
        console.error('Error al actualizar nombres:', err);
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 2000);
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
    actualizarVista();
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
                imprimirPDFPasandoPorActualizar();
            } else {
                alert('No hay detalle de incidencia disponible para imprimir');
            }
        });
    }

    const waTallerBtn = document.getElementById('whatsapp-taller-btn');
    if (waTallerBtn) {
        waTallerBtn.addEventListener('click', () => {
            if (detalleActual && idGtaskActual) {
                notificarWhatsappTaller();
            } else {
                alert('No hay detalle de incidencia disponible');
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
    actualizarVista();
    // Actualizar mini calendario para mostrar el mes de la semana visible
    actualizarMiniCalendarioDesdeSemana();
}

function semanaSiguiente() {
    const fecha = estado.fechaInicioSemana;
    const año = fecha.getUTCFullYear();
    const mes = fecha.getUTCMonth();
    const dia = fecha.getUTCDate();
    estado.fechaInicioSemana = new Date(Date.UTC(año, mes, dia + 7));
    actualizarVista();
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
                    actualizarVista();
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

// Obtener lista de tipos de incidencia únicos (misma fuente que el filtro "Mis calendarios")
function obtenerTiposIncidenciaUnicos() {
    const tiposUnicos = new Set();
    (estado.incidencias || []).forEach(inc => {
        if (inc.tipo_incidencia) {
            tiposUnicos.add(inc.tipo_incidencia);
        }
    });
    return Array.from(tiposUnicos).sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

function etiquetaSubtipoFiltro(valor) {
    return valor === SUBTIPO_FILTRO_SIN_VALOR ? '(Sin subtipo)' : String(valor);
}

function obtenerSubtiposIncidenciaUnicos() {
    const set = new Set();
    let haySinSubtipo = false;
    (estado.incidencias || []).forEach(inc => {
        const s = (inc.subtipo_incidencia && String(inc.subtipo_incidencia).trim()) || '';
        if (s) set.add(s);
        else haySinSubtipo = true;
    });
    const arr = Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'es'));
    if (haySinSubtipo) arr.unshift(SUBTIPO_FILTRO_SIN_VALOR);
    return arr;
}

// Generar filtros de tipos de incidencias
function generarFiltrosTipos() {
    const container = document.getElementById('tipos-incidencias-filtro');
    if (!container) return;
    
    const tiposUnicos = new Set();
    estado.incidencias.forEach(inc => {
        if (inc.tipo_incidencia) {
            tiposUnicos.add(inc.tipo_incidencia);
        }
    });
    
    // Si el usuario tiene permisos que limitan tipos visibles, solo mostrar esos
    const tiposPermitidos = estado.permisos && estado.permisos.tipos_incidencia_visible;
    let tiposAMostrar = Array.from(tiposUnicos);
    if (Array.isArray(tiposPermitidos) && tiposPermitidos.length > 0) {
        tiposAMostrar = tiposAMostrar.filter(t => tiposPermitidos.some(p => String(p).trim() === String(t).trim()));
    }
    
    if (tiposAMostrar.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 0.85rem;">No hay tipos de incidencias visibles</p>';
        return;
    }
    
    let html = '';
    tiposAMostrar.forEach(tipo => {
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
            actualizarVista();
        });
    });
}

// Filtros por subtipo (misma lógica que tipos; permisos subtipos_incidencia_visible)
function generarFiltrosSubtipos() {
    const container = document.getElementById('subtipos-incidencias-filtro');
    if (!container) return;

    const subtiposUnicos = obtenerSubtiposIncidenciaUnicos();
    const subtiposPermitidos = estado.permisos && estado.permisos.subtipos_incidencia_visible;
    let subtiposAMostrar = [...subtiposUnicos];
    if (Array.isArray(subtiposPermitidos) && subtiposPermitidos.length > 0) {
        subtiposAMostrar = subtiposAMostrar.filter(s => subtiposPermitidos.some(p => String(p).trim() === String(s).trim()));
    }

    if (subtiposAMostrar.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 0.85rem;">No hay subtipos visibles</p>';
        return;
    }

    let html = '';
    subtiposAMostrar.forEach((st, idx) => {
        const id = `filtro-subtipo-${idx}`;
        const etiqueta = etiquetaSubtipoFiltro(st);
        const tipoClase = obtenerColorPorTipo('');
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
                <input type="checkbox" id="${id}" 
                       value="${escapeHtml(st)}" checked class="filtro-subtipo-checkbox">
                <div class="tipo-filtro-color" style="background-color: ${bgColor}"></div>
                <label for="${id}" style="cursor: pointer; font-size: 0.85rem;">
                    ${escapeHtml(etiqueta)}
                </label>
            </div>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.filtro-subtipo-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            actualizarVista();
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
