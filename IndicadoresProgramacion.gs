/**
 * ============================================================
 *  IndicadoresProgramacion.gs  —  KPIs de programación (Fase 5)
 * ============================================================
 *  Metodología CENTRALIZADA (sección 18). Distingue estrictamente:
 *
 *   Cumplimiento de PROGRAMACIÓN
 *     = ¿se realizaron las inspecciones programadas?
 *     = Sesiones completadas / sesiones programadas VÁLIDAS × 100
 *     Denominador EXCLUYE: Canceladas y las futuras (aún no exigibles).
 *
 *   Cumplimiento 5S (ya existente en Indicadores.gs)
 *     = ¿qué tan bien se cumplieron los estándares evaluados?
 *
 *  Son indicadores DIFERENTES y se muestran por separado.
 * ============================================================
 */

/**
 * Determina si una sesión cuenta en el denominador de "programadas válidas".
 * Válida = ya era exigible (fecha <= hoy) y no está cancelada.
 * Las futuras no penalizan el cumplimiento; las canceladas se excluyen.
 */
function sesionEsValidaParaCumplimiento(s, hoyISO) {
  if (s.estado === 'Cancelada') return false;
  if (s.fecha > hoyISO) return false; // futura: aún no exigible
  return true;
}

/** Una sesión "cumplida" = Completada. */
function sesionCumplida(s) {
  return s.estado === 'Completada';
}

/**
 * KPIs globales de programación sobre un conjunto de sesiones ya filtrado.
 */
function kpisProgramacion(sesiones) {
  var hoyISO = fechaISO(soloFecha(new Date()));

  var validas = sesiones.filter(function (s) {
    return sesionEsValidaParaCumplimiento(s, hoyISO);
  });
  var completadas = sesiones.filter(sesionCumplida).length;
  var completadasValidas = validas.filter(sesionCumplida).length;

  var por = function (estado) {
    return sesiones.filter(function (s) { return s.estado === estado; }).length;
  };

  // Tiempo promedio de ejecución (duración real de sesiones completadas).
  var dur = sesiones
    .filter(function (s) { return s.estado === 'Completada' && s.duracionReal; })
    .map(function (s) { return s.duracionReal; });

  var cumplimiento = validas.length > 0
    ? redondear(completadasValidas / validas.length * 100, 1) : null;

  return {
    programadas: sesiones.length,
    programadasValidas: validas.length,
    completadas: completadas,
    pendientes: por('Programada') + por('Pendiente'),
    vencidas: por('Vencida'),
    canceladas: por('Cancelada'),
    reprogramadas: por('Reprogramada'),
    enCurso: por('En curso'),
    cumplimientoProgramacion: cumplimiento,
    cumplimientoSemaforo: semaforoCumplimiento(cumplimiento),
    tiempoPromedioEjecucion: dur.length ? redondear(promedio(dur), 1) : null
  };
}

/** Cumplimiento de programación agrupado por una propiedad (ruta/modulo/area/responsable). */
function cumplimientoProgramacionPorGrupo(sesiones, prop) {
  var hoyISO = fechaISO(soloFecha(new Date()));
  var grupos = agrupar(sesiones, prop);
  return Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    var validas = g.filter(function (s) { return sesionEsValidaParaCumplimiento(s, hoyISO); });
    var compl = validas.filter(sesionCumplida).length;
    return {
      grupo: k,
      programadas: g.length,
      validas: validas.length,
      completadas: g.filter(sesionCumplida).length,
      pendientes: g.filter(function (s) { return s.estado === 'Programada' || s.estado === 'Pendiente'; }).length,
      vencidas: g.filter(function (s) { return s.estado === 'Vencida'; }).length,
      cumplimiento: validas.length ? redondear(compl / validas.length * 100, 1) : null
    };
  }).sort(function (a, b) { return (a.cumplimiento || 0) - (b.cumplimiento || 0); });
}

/** Serie temporal: programadas vs completadas por periodo. */
function serieProgramadasVsEjecutadas(sesiones, periodo) {
  var prog = serieTemporal(sesiones, 'fecha', periodo, function (g) { return g.length; });
  var comp = serieTemporal(sesiones.filter(sesionCumplida), 'fecha', periodo,
    function (g) { return g.length; });
  // Unificar etiquetas de periodo.
  var mapa = {};
  prog.forEach(function (p) { mapa[p.periodo] = { periodo: p.periodo, programadas: p.valor, completadas: 0 }; });
  comp.forEach(function (c) {
    if (!mapa[c.periodo]) mapa[c.periodo] = { periodo: c.periodo, programadas: 0, completadas: 0 };
    mapa[c.periodo].completadas = c.valor;
  });
  return Object.keys(mapa).sort().map(function (k) { return mapa[k]; });
}

/**
 * ANÁLISIS COMBINADO (sección 19): cruza, por grupo, el cumplimiento de
 * PROGRAMACIÓN (de sesiones) con el cumplimiento 5S (del detalle de criterios).
 * Permite detectar casos como "mucha ejecución pero bajo cumplimiento 5S".
 *
 * dimension: 'modulo' | 'area' | 'responsable' | 'ruta'
 */
function analisisCombinado(sesiones, detalle, dimension) {
  var propDet = dimension === 'ruta' ? 'codigoRuta' : dimension;

  // Cumplimiento de programación por grupo.
  var prog = cumplimientoProgramacionPorGrupo(sesiones, dimension);
  var mapaProg = {};
  prog.forEach(function (p) { mapaProg[clave(p.grupo)] = p; });

  // Cumplimiento 5S por grupo (reutiliza Indicadores.gs).
  var cinco = cumplimientoPorGrupo(detalle, propDet); // [{grupo, cumplimiento, nValidos}]
  var mapa5S = {};
  cinco.forEach(function (c) { mapa5S[clave(c.grupo)] = c; });

  // Unir claves de ambos.
  var claves = {};
  Object.keys(mapaProg).forEach(function (k) { claves[k] = true; });
  Object.keys(mapa5S).forEach(function (k) { claves[k] = true; });

  return Object.keys(claves).map(function (k) {
    var p = mapaProg[k], c = mapa5S[k];
    var etiqueta = (p && p.grupo) || (c && c.grupo) || k;
    if (dimension === 'ruta') etiqueta = (CONFIG.RUTAS[etiqueta] ? etiqueta + ' ' + CONFIG.RUTAS[etiqueta] : etiqueta);
    return {
      grupo: etiqueta,
      cumplimientoProgramacion: p ? p.cumplimiento : null,
      cumplimiento5S: c ? c.cumplimiento : null,
      sesionesCompletadas: p ? p.completadas : 0,
      criteriosEvaluados: c ? c.nValidos : 0
    };
  }).filter(function (x) {
    // Solo filas con al menos un dato comparable.
    return x.cumplimientoProgramacion !== null || x.cumplimiento5S !== null;
  });
}
