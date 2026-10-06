/**
 * ============================================================
 *  Indicadores.gs  —  Cálculo centralizado de KPIs y agregaciones
 * ============================================================
 *  FUENTE ÚNICA DE VERDAD de la metodología de cálculo (sección 6).
 *  Toda agregación de cumplimiento/hallazgos pasa por aquí para
 *  evitar inconsistencias entre pantallas.
 *
 *  Cumplimiento = promedio de Valor_Ponderado de filas Es_Valido=TRUE
 *                 (Cumple=100, Parcial=50, No cumple=0; N/A excluido)
 * ============================================================
 */

/** Promedio de cumplimiento sobre filas de Detalle_Inspecciones válidas. */
function cumplimientoDesdeDetalle(filasDetalle) {
  var suma = 0, n = 0;
  filasDetalle.forEach(function (f) {
    if (f.esValido) { suma += f.valor; n++; }
  });
  return n > 0 ? { pct: redondear(suma / n, 1), n: n } : { pct: null, n: 0 };
}

/** Agrupa detalle por una propiedad y calcula cumplimiento de cada grupo. */
function cumplimientoPorGrupo(filasDetalle, prop) {
  var grupos = agrupar(filasDetalle, prop);
  return Object.keys(grupos).map(function (k) {
    var c = cumplimientoDesdeDetalle(grupos[k]);
    return { grupo: k, cumplimiento: c.pct, nValidos: c.n };
  }).filter(function (x) { return x.nValidos > 0; })
    .sort(function (a, b) { return (a.cumplimiento || 0) - (b.cumplimiento || 0); });
}

/** Cumplimiento por ruta, con el nombre legible de la ruta. */
function cumplimientoPorRuta(filasDetalle) {
  var res = cumplimientoPorGrupo(filasDetalle, 'codigoRuta');
  return res.map(function (r) {
    return {
      codigo: r.grupo,
      nombre: CONFIG.RUTAS[r.grupo] || r.grupo,
      cumplimiento: r.cumplimiento,
      nValidos: r.nValidos
    };
  }).sort(function (a, b) { return a.codigo.localeCompare(b.codigo); });
}

/** Ranking de criterios por incumplimiento (menor cumplimiento primero). */
function rankingCriterios(filasDetalle, codigoRutaFiltro) {
  var det = codigoRutaFiltro
    ? filasDetalle.filter(function (f) { return f.codigoRuta === codigoRutaFiltro; })
    : filasDetalle;

  var grupos = agrupar(det, 'codigoCriterio');
  var out = Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    var c = cumplimientoDesdeDetalle(g);
    var noCumple = g.filter(function (f) { return f.resultado === 'No cumple'; }).length;
    var parcial = g.filter(function (f) { return f.resultado === 'Parcial'; }).length;
    return {
      codigoCriterio: k,
      nombreCriterio: g[0].nombreCriterio,
      codigoRuta: g[0].codigoRuta,
      cumplimiento: c.pct,
      noCumple: noCumple,
      parcial: parcial,
      evaluaciones: c.n
    };
  }).filter(function (x) { return x.evaluaciones > 0; });

  out.sort(function (a, b) { return (a.cumplimiento || 0) - (b.cumplimiento || 0); });
  return out;
}

// ---- KPIs de hallazgos -------------------------------------------------

function kpisHallazgos(hallazgos) {
  var total = hallazgos.length;
  // Estado efectivo (híbrido). Si por compatibilidad un hallazgo no lo trae,
  // se cae al calculado legacy mapeado.
  var eff = function (h) {
    return h.estadoGestion || (CONFIG.HALLAZGO_CFG.MAPEO_LEGACY[h.estado] || 'Abierto');
  };
  var porEff = function (estado) {
    return hallazgos.filter(function (h) { return eff(h) === estado; }).length;
  };
  var cerrados = CONFIG.HALLAZGO_CFG.ESTADOS_CERRADOS; // Corregido/Cerrado/No aplica
  var nCerrados = hallazgos.filter(function (h) { return cerrados.indexOf(eff(h)) !== -1; }).length;
  var nVencidos = hallazgos.filter(function (h) {
    return h.vencido === true || (h.vencido === undefined && h.estado === 'Vencido');
  }).length;

  var corrInm = hallazgos.filter(function (h) { return h.correccionInmediata; }).length;
  var otraArea = hallazgos.filter(function (h) {
    return h.requiereOtraArea && cerrados.indexOf(eff(h)) === -1;
  }).length;

  var tiempos = hallazgos
    .filter(function (h) { return h.tiempoCorreccionMin !== null; })
    .map(function (h) { return h.tiempoCorreccionMin; });

  // Tiempo promedio de cierre: días entre fecha y días abiertos de los cerrados.
  var diasCierre = hallazgos
    .filter(function (h) { return cerrados.indexOf(eff(h)) !== -1 && h.diasAbiertos !== null; })
    .map(function (h) { return h.diasAbiertos; });

  return {
    total: total,
    // --- Campos NUEVOS (estado gestionado) ---
    abiertosEstado: porEff('Abierto'),
    enProceso: porEff('En proceso'),
    corregidosEstado: porEff('Corregido'),
    cerradosEstado: porEff('Cerrado'),
    noAplica: porEff('No aplica'),
    reabiertos: porEff('Reabierto'),
    cerradosTotal: nCerrados,
    pctCierre: total > 0 ? redondear(nCerrados / total * 100, 1) : null,
    tiempoPromedioCierre: diasCierre.length ? redondear(promedio(diasCierre), 1) : null,
    // --- Campos EXISTENTES (compatibilidad; ahora sobre estado efectivo) ---
    corregidos: nCerrados,                 // "cerrados/terminados" en sentido amplio
    enSeguimiento: porEff('En proceso'),
    pendientes: porEff('Abierto'),
    vencidos: nVencidos,
    abiertos: total - nCerrados,
    correccionInmediataPct: total > 0 ? redondear(corrInm / total * 100, 1) : null,
    pendientesOtraArea: otraArea,
    tiempoPromedioCorreccion: tiempos.length ? redondear(promedio(tiempos), 1) : null,
    requierenEstandarizacion: hallazgos.filter(function (h) {
      return h.requiereEstandarizacion;
    }).length
  };
}

/** KPIs de inspecciones. */
function kpisInspecciones(inspecciones, detalle) {
  var total = inspecciones.length;
  var completadas = inspecciones.filter(function (i) { return i.completada; }).length;
  var conSeguimiento = inspecciones.filter(function (i) { return i.requiereSeguimiento; }).length;
  var dur = inspecciones.filter(function (i) { return i.duracionMin !== null; })
    .map(function (i) { return i.duracionMin; });
  var cumpl = cumplimientoDesdeDetalle(detalle);

  return {
    total: total,
    completadas: completadas,
    completadasPct: total > 0 ? redondear(completadas / total * 100, 1) : null,
    conSeguimientoPct: total > 0 ? redondear(conSeguimiento / total * 100, 1) : null,
    cumplimientoGeneral: cumpl.pct,
    tiempoPromedioInspeccion: dur.length ? redondear(promedio(dur), 1) : null
  };
}

function promedio(arr) {
  if (!arr.length) return null;
  return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
}

/** Semáforo de cumplimiento según umbrales. */
function semaforoCumplimiento(pct) {
  if (pct === null || pct === undefined) return 'gris';
  if (pct >= CONFIG.UMBRALES.CUMPLIMIENTO_BUENO) return 'verde';
  if (pct >= CONFIG.UMBRALES.CUMPLIMIENTO_MEDIO) return 'amarillo';
  return 'rojo';
}

/** Serie temporal: agrupa por periodo (dia|semana|mes) y aplica un reductor. */
function serieTemporal(items, propFecha, periodo, reductor) {
  var buckets = {};
  items.forEach(function (it) {
    var f = aFecha(it[propFecha]);
    if (!f) return;
    var k = etiquetaPeriodo(f, periodo);
    (buckets[k] = buckets[k] || []).push(it);
  });
  return Object.keys(buckets).sort().map(function (k) {
    return { periodo: k, valor: reductor(buckets[k]) };
  });
}

/** Etiqueta de periodo para agrupar series temporales. */
function etiquetaPeriodo(fecha, periodo) {
  var tz = Session.getScriptTimeZone();
  if (periodo === 'mes') return Utilities.formatDate(fecha, tz, 'yyyy-MM');
  if (periodo === 'semana') {
    return Utilities.formatDate(fecha, tz, 'yyyy') + '-S' +
      Utilities.formatDate(fecha, tz, 'ww');
  }
  return Utilities.formatDate(fecha, tz, 'yyyy-MM-dd'); // día
}

// ---- Comparación con periodo anterior (sección 4) ----------------------

/**
 * Dado un rango [desde, hasta], calcula el rango inmediatamente anterior
 * de la misma longitud. Devuelve null si el rango no está completo.
 */
function periodoAnterior(desde, hasta) {
  var fd = aFecha(desde), fh = aFecha(hasta);
  if (!fd || !fh) return null;
  var dias = diasEntre(fd, fh);
  if (dias === null) return null;
  var prevHasta = new Date(fd.getTime() - 86400000);
  var prevDesde = new Date(prevHasta.getTime() - dias * 86400000);
  return { desde: fechaISO(prevDesde), hasta: fechaISO(prevHasta) };
}
