/**
 * Calendario de mantenimiento preventivo (emplazamientos y recursos BC).
 */
const MTO_ESTADO = {
    mes: new Date().getMonth(),
    año: new Date().getFullYear(),
    items: [],
    cargando: false,
};

const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function isoFecha(y, m, d) {
    return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function inicioFinMes(año, mes) {
    const primero = new Date(año, mes, 1);
    const ultimo = new Date(año, mes + 1, 0);
    return {
        desde: isoFecha(año, mes, 1),
        hasta: isoFecha(año, mes, ultimo.getDate()),
    };
}

function parseIsoDate(s) {
    if (!s) return null;
    const d = new Date(s + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
}

function hoyIso() {
    const t = new Date();
    return isoFecha(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Etiqueta en calendario (Opis a veces llega sin nº emplazamiento). */
function etiquetaMantenimiento(it) {
    if (it.codigo) return it.codigo;
    if (it.no_emplazamiento) return it.no_emplazamiento;
    if (it.no_recurso) return it.no_recurso;
    if (it.descripcion) {
        const corta = it.descripcion.split(' -', 1)[0].trim();
        return corta || it.descripcion;
    }
    return it.ubicacion || '?';
}

async function cargarDatos() {
    const errEl = document.getElementById('mto-error');
    errEl.hidden = true;
    MTO_ESTADO.cargando = true;
    const { desde, hasta } = inicioFinMes(MTO_ESTADO.año, MTO_ESTADO.mes);
    try {
        const res = await fetch(`/api/mantenimiento-emplazamientos?desde=${desde}&hasta=${hasta}`);
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Error al cargar datos');
        }
        MTO_ESTADO.items = data.items || [];
        actualizarTiposRecurso();
        aplicarFiltrosYRender();
    } catch (e) {
        errEl.textContent = e.message || String(e);
        errEl.hidden = false;
        MTO_ESTADO.items = [];
        renderCalendario([]);
        renderSinFecha([]);
    } finally {
        MTO_ESTADO.cargando = false;
    }
}

function actualizarTiposRecurso() {
    const sel = document.getElementById('filtro-tipo-recurso');
    const actual = sel.value;
    const tipos = new Set();
    MTO_ESTADO.items.forEach((it) => {
        (it.tipos_recurso_lista || []).forEach((t) => tipos.add(t));
        if (it.tipos_recurso) {
            it.tipos_recurso.split(';').forEach((t) => {
                if (t.trim()) tipos.add(t.trim());
            });
        }
    });
    const sorted = Array.from(tipos).sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = '<option value="">Todos los tipos</option>';
    sorted.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        sel.appendChild(opt);
    });
    if (sorted.includes(actual)) sel.value = actual;
}

function filtrarItems() {
    const cat = document.getElementById('filtro-categoria').value;
    const tipoRec = document.getElementById('filtro-tipo-recurso').value;
    const texto = (document.getElementById('filtro-texto').value || '').trim().toLowerCase();
    const soloVencidos = document.getElementById('filtro-solo-vencidos').checked;
    const hoy = hoyIso();

    return MTO_ESTADO.items.filter((it) => {
        const c = it.categoria || '';
        if (cat === 'paradas_bus' && c !== 'paradas_bus') return false;
        if (cat === 'emplazamientos' && c === 'paradas_bus') return false;
        if (cat === 'vallas' && c !== 'vallas') return false;
        if (cat === 'otros' && c !== 'otros') return false;
        if (cat === 'recursos' && c !== 'recursos') return false;
        if (tipoRec) {
            const lista = it.tipos_recurso_lista || [];
            const enLista = lista.some((t) => t === tipoRec);
            const enTxt = (';' + (it.tipos_recurso || '') + ';').includes(';' + tipoRec + ';');
            if (!enLista && !enTxt) return false;
        }
        if (texto) {
            const blob = [
                it.no_emplazamiento,
                it.descripcion,
                it.ubicacion,
                it.municipio,
                it.zona,
                it.tipos_recurso,
            ].join(' ').toLowerCase();
            if (!blob.includes(texto)) return false;
        }
        if (soloVencidos && it.fecha_proximo_mantenimiento) {
            if (it.fecha_proximo_mantenimiento > hoy) return false;
        }
        return true;
    });
}

function itemFechaEnMes(it, desde, hasta) {
    const f = it.fecha_proximo_mantenimiento;
    if (!f) return false;
    return f >= desde && f <= hasta;
}

function aplicarFiltrosYRender() {
    const filtrados = filtrarItems();
    const { desde, hasta } = inicioFinMes(MTO_ESTADO.año, MTO_ESTADO.mes);
    const enCalendario = filtrados.filter((it) => itemFechaEnMes(it, desde, hasta));
    const sinFecha = filtrados.filter((it) => !it.fecha_proximo_mantenimiento);
    const fueraMes = filtrados.filter(
        (it) => it.fecha_proximo_mantenimiento && !itemFechaEnMes(it, desde, hasta)
    );
    let texto = `${enCalendario.length} en el calendario`;
    if (sinFecha.length) texto += ` · ${sinFecha.length} sin fecha`;
    if (fueraMes.length) texto += ` · ${fueraMes.length} fuera de este mes`;
    document.getElementById('mto-contador').textContent = texto;
    renderCalendario(enCalendario);
    renderSinFecha(sinFecha);
}

function renderCalendario(items) {
    const grid = document.getElementById('mto-calendario');
    const titulo = document.getElementById('mto-mes-titulo');
    titulo.textContent = `${MESES[MTO_ESTADO.mes]} ${MTO_ESTADO.año}`;

    grid.innerHTML = '';
    DOW.forEach((d) => {
        const h = document.createElement('div');
        h.className = 'mto-dow';
        h.textContent = d;
        grid.appendChild(h);
    });

    const año = MTO_ESTADO.año;
    const mes = MTO_ESTADO.mes;
    const primerDia = new Date(año, mes, 1);
    let startPad = primerDia.getDay() - 1;
    if (startPad < 0) startPad = 6;
    const diasMes = new Date(año, mes + 1, 0).getDate();
    const hoy = hoyIso();

    const porFecha = {};
    items.forEach((it) => {
        const f = it.fecha_proximo_mantenimiento;
        if (!f) return;
        if (!porFecha[f]) porFecha[f] = [];
        porFecha[f].push(it);
    });

    const totalCeldas = Math.ceil((startPad + diasMes) / 7) * 7;
    for (let i = 0; i < totalCeldas; i++) {
        const cell = document.createElement('div');
        cell.className = 'mto-day';
        const dayNum = i - startPad + 1;
        let y = año;
        let m = mes;
        let d = dayNum;
        if (dayNum < 1) {
            const prev = new Date(año, mes, 0);
            d = prev.getDate() + dayNum;
            m = mes - 1;
            if (m < 0) { m = 11; y -= 1; }
            cell.classList.add('other-month');
        } else if (dayNum > diasMes) {
            d = dayNum - diasMes;
            m = mes + 1;
            if (m > 11) { m = 0; y += 1; }
            cell.classList.add('other-month');
        }
        const fechaIso = isoFecha(y, m, d);
        if (fechaIso === hoy) cell.classList.add('today');

        const num = document.createElement('div');
        num.className = 'mto-day-num';
        num.textContent = d;
        cell.appendChild(num);

        (porFecha[fechaIso] || []).forEach((it) => {
            const ev = document.createElement('div');
            ev.className = 'mto-event ' + (it.categoria || 'otros');
            if (it.bajo_mantenimiento) ev.classList.add('bajo-mantenimiento');
            if (it.fecha_proximo_mantenimiento && it.fecha_proximo_mantenimiento <= hoy) {
                ev.classList.add('vencido');
            }
            const etiqueta = etiquetaMantenimiento(it);
            ev.title = `${etiqueta} – ${it.descripcion || ''}`;
            ev.textContent = etiqueta;
            ev.addEventListener('click', () => mostrarDetalle(it));
            cell.appendChild(ev);
        });
        grid.appendChild(cell);
    }
}

function renderSinFecha(items) {
    const box = document.getElementById('mto-sin-fecha');
    const list = document.getElementById('mto-sin-fecha-lista');
    if (!box || !list) return;
    if (!items.length) {
        box.hidden = true;
        list.innerHTML = '';
        return;
    }
    box.hidden = false;
    list.innerHTML = '';
    items.forEach((it) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mto-sin-fecha-item ' + (it.categoria || 'otros');
        btn.textContent = `${etiquetaMantenimiento(it)} – ${it.descripcion || 'Sin descripción'}`;
        btn.addEventListener('click', () => mostrarDetalle(it));
        list.appendChild(btn);
    });
}

function etiquetaCategoria(it) {
    const map = {
        paradas_bus: 'Parada bus (Opis)',
        vallas: 'Vallas',
        otros: 'Otros emplazamientos',
        recursos: 'Recurso (soporte / mobiliario)',
    };
    if (map[it.categoria]) return map[it.categoria];
    if ((it.tipo_emplazamiento || '').toLowerCase() === 'opis') return 'Parada bus (Opis)';
    return it.tipo_emplazamiento || it.tipo_recurso || '—';
}

function etiquetaOrigen(it) {
    if (it.categoria === 'paradas_bus') return 'Parada bus';
    if (it.origen === 'recurso') return 'Recurso';
    return 'Emplazamiento';
}

function mostrarDetalle(it) {
    const panel = document.getElementById('mto-detalle');
    const body = document.getElementById('mto-detalle-body');
    const esRecursoPuro = it.origen === 'recurso' && it.categoria === 'recursos';
    const tipoRecursoVal = it.tipo_recurso || (it.tipos_recurso_lista && it.tipos_recurso_lista[0]) || it.tipos_recurso || '';

    body.innerHTML = `
        <h3>${etiquetaMantenimiento(it)} – ${it.descripcion || ''}</h3>
        <dl>
            <dt>Origen</dt><dd>${etiquetaOrigen(it)}</dd>
            <dt>Tipo</dt><dd>${etiquetaCategoria(it)}</dd>
            <dt>Próximo mantenimiento</dt><dd>${it.fecha_proximo_mantenimiento || '—'}</dd>
            <dt>Último mantenimiento</dt><dd>${it.ultimo_mantenimiento || '—'}</dd>
            <dt>Periodicidad</dt><dd>${it.periodicidad || '—'}</dd>
            <dt>Bajo mantenimiento</dt><dd>${it.bajo_mantenimiento ? 'Sí' : 'No'}</dd>
            <dt>Ubicación</dt><dd>${it.ubicacion || '—'}</dd>
            <dt>Municipio</dt><dd>${it.municipio || '—'}</dd>
            <dt>Zona</dt><dd>${it.zona || '—'}</dd>
            ${it.no_emplazamiento ? `<dt>Nº emplazamiento</dt><dd>${it.no_emplazamiento}</dd>` : ''}
            ${esRecursoPuro && tipoRecursoVal ? `<dt>Tipo recurso</dt><dd>${tipoRecursoVal}</dd>` : ''}
            ${!esRecursoPuro && it.tipos_recurso ? `<dt>Tipos recurso en emplaz.</dt><dd>${it.tipos_recurso}</dd>` : ''}
        </dl>
    `;
    panel.hidden = false;
}

function initMantenimiento() {
    document.getElementById('mto-prev').addEventListener('click', () => {
        MTO_ESTADO.mes -= 1;
        if (MTO_ESTADO.mes < 0) { MTO_ESTADO.mes = 11; MTO_ESTADO.año -= 1; }
        cargarDatos();
    });
    document.getElementById('mto-next').addEventListener('click', () => {
        MTO_ESTADO.mes += 1;
        if (MTO_ESTADO.mes > 11) { MTO_ESTADO.mes = 0; MTO_ESTADO.año += 1; }
        cargarDatos();
    });
    document.getElementById('mto-hoy').addEventListener('click', () => {
        const t = new Date();
        MTO_ESTADO.mes = t.getMonth();
        MTO_ESTADO.año = t.getFullYear();
        cargarDatos();
    });
    document.getElementById('mto-detalle-cerrar').addEventListener('click', () => {
        document.getElementById('mto-detalle').hidden = true;
    });
    ['filtro-categoria', 'filtro-tipo-recurso', 'filtro-solo-vencidos'].forEach((id) => {
        document.getElementById(id).addEventListener('change', aplicarFiltrosYRender);
    });
    document.getElementById('filtro-texto').addEventListener('input', aplicarFiltrosYRender);
    cargarDatos();
}

document.addEventListener('DOMContentLoaded', initMantenimiento);
