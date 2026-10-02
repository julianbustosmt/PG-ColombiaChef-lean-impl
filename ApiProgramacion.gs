/**
 * ============================================================
 *  ApiProgramacion.gs  —  API del módulo Programación (frontend)
 * ============================================================
 *  Funciones invocadas por google.script.run desde el frontend.
 *  Siguen el mismo contrato que Dashboard.gs: reciben filtros/datos
 *  y devuelven objetos JSON-serializables.
 *
 *  Fase 1: panel de Programación (listar + crear + cambiar estado) y
 *  opciones para el formulario. Las vistas Calendario/Agenda y las
 *  acciones iniciar/reprogramar/cancelar llegan en fases posteriores.
 * ============================================================
 */

/**
 * Datos para el panel "Programación":
 *  - tabla de programaciones con su "próxima sesión" calculada.
 */
function obtenerProgramaciones(filtros) {
  var progs = cargarProgramaciones();
  var sesiones = cargarSesiones();

  // Próxima sesión futura (Programada/Pendiente) por programación.
  var hoy = fechaISO(new Date());
  var proximaPorProg = {};
  sesiones.forEach(function (s) {
    if (s.estado !== 'Programada' && s.estado !== 'Pendiente') return;
    if (s.fecha < hoy) return;
    var actual = proximaPorProg[s.idProgramacion];
    if (!actual || s.fecha < actual.fecha ||
        (s.fecha === actual.fecha && s.horaInicioProg < actual.horaInicioProg)) {
      proximaPorProg[s.idProgramacion] = s;
    }
  });

  var tabla = progs.map(function (p) {
    var prox = proximaPorProg[p.id];
    return {
      id: p.id,
      estado: p.estado,
      ruta: p.ruta,
      nombreRuta: p.nombreRuta,
      area: p.area,
      modulo: p.modulo,
      responsable: p.responsable,
      frecuencia: p.frecuencia,
      tipo: p.tipo,
      diasSemana: p.diasSemana,
      hora: p.hora,
      proximaSesion: prox ? (prox.fecha + ' ' + (prox.horaInicioProg || '')) : '—'
    };
  });

  // Filtro opcional por área/módulo/ruta/responsable si vienen.
  if (filtros) {
    tabla = tabla.filter(function (t) {
      return (!filtros.area || clave(t.area) === clave(filtros.area)) &&
        (!filtros.modulo || clave(t.modulo) === clave(filtros.modulo)) &&
        (!filtros.ruta || clave(t.ruta).indexOf(clave(filtros.ruta)) !== -1) &&
        (!filtros.responsable || clave(t.responsable) === clave(filtros.responsable));
    });
  }

  return { programaciones: tabla, total: tabla.length };
}

/** Opciones para el formulario de nueva programación. */
function obtenerOpcionesProgramacion() {
  var tiposActivos = Object.keys(CONFIG.PROGRAMACION_CFG.TIPOS).filter(function (t) {
    return CONFIG.PROGRAMACION_CFG.TIPOS[t].activo;
  });
  // Áreas/Módulos/Responsables salen del CATÁLOGO MAESTRO (editable), no del
  // histórico. Así se puede planificar para módulos/responsables nuevos.
  var cat = obtenerCatalogosParaFormulario();
  return {
    rutas: Object.keys(CONFIG.RUTAS).map(function (k) {
      return { codigo: k, nombre: CONFIG.RUTAS[k] };
    }),
    tipos: tiposActivos,
    diasSemana: CONFIG.DIAS_SEMANA.slice(1).concat(CONFIG.DIAS_SEMANA[0]), // Lun..Dom
    areas: cat.areas,
    modulos: cat.modulos,
    responsables: cat.responsables // [{ nombre, correo }]
  };
}

/** Crea una o varias programaciones (passthrough al dominio). */
function guardarProgramacion(datos) {
  return crearProgramacion(datos);
}

/** Cambia estado de una programación (Activa/Pausada/Finalizada). */
function actualizarEstadoProgramacion(idProgramacion, nuevoEstado) {
  return cambiarEstadoProgramacion(idProgramacion, nuevoEstado);
}

/** Fuerza la generación de sesiones (botón manual del panel). */
function regenerarSesiones() {
  var g = generarSesionesProgramadas();
  var e = actualizarEstadosSesiones();
  return { ok: true, creadas: g.creadas, vencidas: e.actualizadas };
}

// ============================================================
//  FASE 2 — Calendario y Agenda
// ============================================================

/**
 * Datos para el CALENDARIO (vista mes).
 * Params: { anio, mes (1-12), ...filtrosGlobales }
 * Si no se pasan anio/mes, usa el mes actual.
 *
 * Devuelve:
 *  - periodo: { anio, mes, nombreMes, primerDiaSemana (0=Dom), diasEnMes }
 *  - sesionesPorDia: { 'yyyy-MM-dd': [ {sesion...} ] }
 *  - total, navegacion previa/siguiente
 */
function obtenerCalendario(filtros) {
  filtros = filtros || {};
  var hoy = new Date();
  var anio = filtros.anio ? parseInt(filtros.anio, 10) : hoy.getFullYear();
  var mes = filtros.mes ? parseInt(filtros.mes, 10) : (hoy.getMonth() + 1); // 1-12

  var primerDia = new Date(anio, mes - 1, 1);
  var ultimoDia = new Date(anio, mes, 0);
  var desdeISO = fechaISO(primerDia);
  var hastaISO = fechaISO(ultimoDia);

  // Filtra sesiones del mes aplicando también filtros globales.
  // Nota: el filtro global 'estado' pertenece a HALLAZGOS (Corregido, etc.),
  // no a sesiones; se omite aquí para no vaciar el calendario sin querer.
  var filtrosMes = Object.assign({}, filtros, { desde: desdeISO, hasta: hastaISO, estado: '' });
  var sesiones = filtrarSesiones(cargarSesiones(), filtrosMes);

  var porDia = {};
  sesiones.forEach(function (s) {
    (porDia[s.fecha] = porDia[s.fecha] || []).push(serializarSesion(s));
  });
  // Ordena cada día por hora.
  Object.keys(porDia).forEach(function (k) {
    porDia[k].sort(function (a, b) {
      return (a.horaInicioProg || '').localeCompare(b.horaInicioProg || '');
    });
  });

  var prev = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio: anio, mes: mes - 1 };
  var next = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio: anio, mes: mes + 1 };

  return {
    periodo: {
      anio: anio, mes: mes,
      nombreMes: nombreMes(mes) + ' ' + anio,
      primerDiaSemana: primerDia.getDay(), // 0=Dom..6=Sáb
      diasEnMes: ultimoDia.getDate(),
      hoyISO: fechaISO(soloFecha(hoy))
    },
    sesionesPorDia: porDia,
    total: sesiones.length,
    prev: prev, next: next
  };
}

/**
 * Datos para la AGENDA: próximas sesiones no finalizadas, agrupadas por día,
 * desde hoy hacia adelante (respeta filtros globales).
 */
function obtenerAgenda(filtros) {
  filtros = filtros || {};
  var hoyISO = fechaISO(soloFecha(new Date()));
  // Se omite el filtro global 'estado' (es de hallazgos, no de sesiones).
  var filtrosAgenda = Object.assign({}, filtros, { estado: '' });
  var sesiones = filtrarSesiones(cargarSesiones(), filtrosAgenda).filter(function (s) {
    return s.fecha >= hoyISO &&
      s.estado !== 'Completada' && s.estado !== 'Cancelada';
  });

  sesiones.sort(function (a, b) {
    if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
    return (a.horaInicioProg || '').localeCompare(b.horaInicioProg || '');
  });

  var grupos = {};
  sesiones.forEach(function (s) {
    (grupos[s.fecha] = grupos[s.fecha] || []).push(serializarSesion(s));
  });

  var dias = Object.keys(grupos).sort().map(function (f) {
    return { fecha: f, etiqueta: etiquetaDiaRelativo(f, hoyISO), sesiones: grupos[f] };
  });
  return { dias: dias, total: sesiones.length };
}

/** Detalle de una sesión para el modal. */
function obtenerDetalleSesion(idSesion) {
  var s = cargarSesiones().filter(function (x) { return x.id === idSesion; })[0];
  if (!s) return { ok: false, error: 'Sesión no encontrada.' };
  return { ok: true, sesion: serializarSesion(s) };
}

// ---- Helpers de serialización / formato -------------------------------

function serializarSesion(s) {
  return {
    id: s.id,
    idProgramacion: s.idProgramacion,
    fecha: s.fecha,
    horaInicioProg: s.horaInicioProg,
    horaFinProg: s.horaFinProg,
    ruta: s.ruta,
    nombreRuta: s.nombreRuta,
    area: s.area,
    modulo: s.modulo,
    responsable: s.responsable,
    correoResponsable: s.correoResponsable,
    estado: s.estado,
    idInspeccion: s.idInspeccion,
    duracionEstimada: duracionEntreHoras(s.horaInicioProg, s.horaFinProg),
    semaforo: semaforoSesion(s.estado),
    idCalendar: s.idCalendar
  };
}

/** Color del estado de una sesión (para el calendario/agenda). */
function semaforoSesion(estado) {
  switch (estado) {
    case 'Completada': return 'verde';
    case 'Vencida': return 'rojo';
    case 'En curso': return 'azul';
    case 'Cancelada': return 'gris';
    case 'Reprogramada': return 'morado';
    case 'Pendiente': return 'amarillo';
    default: return 'azul'; // Programada
  }
}

function duracionEntreHoras(ini, fin) {
  var d = duracionMin(ini, fin);
  return d === null ? null : d;
}

function nombreMes(mes) {
  var nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return nombres[(mes - 1 + 12) % 12];
}

/** 'Hoy', 'Mañana' o fecha dd/MM/yyyy según cercanía. */
function etiquetaDiaRelativo(fechaISOstr, hoyISO) {
  if (fechaISOstr === hoyISO) return 'Hoy';
  var manana = fechaISO(new Date(soloFecha(new Date()).getTime() + 86400000));
  if (fechaISOstr === manana) return 'Mañana';
  var p = fechaISOstr.split('-');
  return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : fechaISOstr;
}

// ============================================================
//  FASE 3 — Ejecución de sesiones (passthrough al dominio)
// ============================================================

/** Inicia la sesión y devuelve la URL del Form prellenado. */
function apiIniciarSesion(idSesion) {
  return iniciarSesion(idSesion);
}

/** Finaliza la sesión y la vincula con la inspección. */
function apiFinalizarSesion(idSesion, idInspeccion) {
  return finalizarSesion(idSesion, idInspeccion);
}

/** Reprograma la sesión. cambios: { nuevaFecha, nuevaHora, motivo } */
function apiReprogramarSesion(idSesion, cambios) {
  return reprogramarSesion(idSesion, cambios);
}

/** Cancela la sesión con un motivo. */
function apiCancelarSesion(idSesion, motivo) {
  return cancelarSesion(idSesion, motivo);
}

/**
 * Diagnóstico: indica si el Form de inspección está configurado para el
 * pre-llenado (Fase 3). El frontend lo usa para avisar si falta configurar.
 */
function formInspeccionConfigurado() {
  var cfg = CONFIG.FORM_INSPECCION || {};
  var urlOk = cfg.URL_BASE && cfg.URL_BASE.indexOf('XXXX') === -1;
  var e = cfg.ENTRIES || {};
  var algunEntry = ['ruta', 'area', 'modulo', 'responsable'].some(function (k) {
    return e[k] && e[k].indexOf('0000') === -1;
  });
  return { configurado: !!(urlOk && algunEntry), urlBase: cfg.URL_BASE || '' };
}

// ============================================================
//  FASE 5 — Indicadores de programación para el Dashboard
// ============================================================

/**
 * Datos de la sección "Programación" del Dashboard (sección 20).
 * KPIs + gráficos (programadas vs ejecutadas, cumplimiento por ruta/módulo,
 * pendientes por responsable, tendencia) + tabla resumen por ruta.
 */
function obtenerDashboardProgramacion(filtros) {
  filtros = filtros || {};
  var key = cacheKey('dashProg', filtros);
  var cacheado = cacheGet(key);
  if (cacheado) return cacheado;

  // Las sesiones no usan el filtro global 'estado' (es de hallazgos).
  var fs = Object.assign({}, filtros, { estado: '' });
  var sesiones = filtrarSesiones(cargarSesiones(), fs);

  var periodo = filtros.periodo || 'semana';

  var res = {
    kpis: kpisProgramacion(sesiones),
    programadasVsEjecutadas: serieProgramadasVsEjecutadas(sesiones, periodo),
    cumplimientoPorRuta: cumplimientoProgramacionPorGrupo(sesiones, 'ruta'),
    cumplimientoPorModulo: cumplimientoProgramacionPorGrupo(sesiones, 'modulo'),
    pendientesPorResponsable: pendientesPorResponsable(sesiones),
    tendencia: serieProgramadasVsEjecutadas(sesiones, 'mes'),
    tablaPorRuta: cumplimientoProgramacionPorGrupo(sesiones, 'ruta').map(function (r) {
      return {
        ruta: r.grupo,
        programadas: r.programadas,
        completadas: r.completadas,
        pendientes: r.pendientes,
        vencidas: r.vencidas,
        cumplimiento: r.cumplimiento
      };
    })
  };
  cachePut(key, res);
  return res;
}

/** Sesiones pendientes/vencidas agrupadas por responsable (sección 20). */
function pendientesPorResponsable(sesiones) {
  var pend = sesiones.filter(function (s) {
    return s.estado === 'Programada' || s.estado === 'Pendiente' || s.estado === 'Vencida';
  });
  var g = agrupar(pend, 'responsable');
  return Object.keys(g).map(function (k) {
    return { responsable: k, pendientes: g[k].length };
  }).sort(function (a, b) { return b.pendientes - a.pendientes; });
}

/**
 * Análisis combinado programación vs 5S (sección 19).
 * dimension: 'modulo' (default) | 'area' | 'responsable' | 'ruta'
 */
function obtenerAnalisisCombinado(filtros) {
  filtros = filtros || {};
  var dimension = filtros.dimension || 'modulo';
  var fs = Object.assign({}, filtros, { estado: '' });

  var sesiones = filtrarSesiones(cargarSesiones(), fs);
  var detalle = filtrarDetalle(cargarDetalle(), filtros);

  return {
    dimension: dimension,
    datos: analisisCombinado(sesiones, detalle, dimension)
  };
}
