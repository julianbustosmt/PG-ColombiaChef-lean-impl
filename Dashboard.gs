/**
 * ============================================================
 *  Dashboard.gs  —  API que consume el frontend (google.script.run)
 * ============================================================
 *  Cada función recibe un objeto `filtros` y devuelve datos ya
 *  agregados y listos para pintar. Usa caché por clave de filtros.
 *  Las funciones devuelven objetos JSON-serializables.
 * ============================================================
 */

/**
 * Opciones para poblar los filtros globales del frontend.
 */
function obtenerOpcionesFiltros() {
  var cacheado = cacheGet(cacheKey('opcionesFiltros', {}));
  if (cacheado) return cacheado;

  var insp = cargarInspecciones();
  var hall = cargarHallazgos();

  var res = {
    areas: unicos(insp, 'area'),
    modulos: unicos(insp, 'modulo'),
    responsables: unicos(insp, 'responsable'),
    rutas: Object.keys(CONFIG.RUTAS).map(function (k) {
      return { codigo: k, nombre: CONFIG.RUTAS[k] };
    }),
    estados: ['Corregido', 'En seguimiento', 'Pendiente', 'Vencido'],
    tipos: unicos(hall, 'tipo'),
    cincoS: unicos(hall, 'cincoS')
  };
  cachePut(cacheKey('opcionesFiltros', {}), res);
  return res;
}

/**
 * Datos del Dashboard principal: KPIs + gráficos base.
 */
function obtenerDashboard(filtros) {
  var key = cacheKey('dashboard', filtros);
  var cacheado = cacheGet(key);
  if (cacheado) return cacheado;

  obtenerConfig(); // aplica overrides de umbrales

  var inspAll = cargarInspecciones();
  var detAll = cargarDetalle();
  var hallAll = cargarHallazgos();

  var insp = filtrarInspecciones(inspAll, filtros);
  var det = filtrarDetalle(detAll, filtros);
  var hall = filtrarHallazgos(hallAll, filtros);

  var kInsp = kpisInspecciones(insp, det);
  var kHall = kpisHallazgos(hall);

  // Comparación con periodo anterior (solo si hay rango definido).
  var comparacion = compararCumplimiento(filtros, detAll);

  var res = {
    kpis: {
      cumplimiento: kInsp.cumplimientoGeneral,
      cumplimientoSemaforo: semaforoCumplimiento(kInsp.cumplimientoGeneral),
      comparacionCumplimiento: comparacion,
      totalInspecciones: kInsp.total,
      inspeccionesCompletadas: kInsp.completadas,
      rutasCompletadasPct: kInsp.completadasPct,
      totalHallazgos: kHall.total,
      hallazgosAbiertos: kHall.abiertos,
      hallazgosCerrados: kHall.corregidos,
      hallazgosVencidos: kHall.vencidos,
      correccionInmediataPct: kHall.correccionInmediataPct,
      tiempoPromedioInspeccion: kInsp.tiempoPromedioInspeccion,
      tiempoPromedioCorreccion: kHall.tiempoPromedioCorreccion,
      rutasSeguimientoPct: kInsp.conSeguimientoPct,
      requierenEstandarizacion: kHall.requierenEstandarizacion
    },
    cumplimientoPorRuta: cumplimientoPorRuta(det),
    cumplimientoPorModulo: cumplimientoPorGrupo(det, 'modulo'),
    hallazgosPorEstado: contarPor(hall, 'estado'),
    topModulosProblema: topModulosProblema(hall),
    evolucionCumplimiento: evolucionCumplimiento(det, 'mes')
  };
  cachePut(key, res);
  return res;
}

/** Pantalla Cumplimiento 5S. */
function obtenerCumplimiento(filtros) {
  var det = filtrarDetalle(cargarDetalle(), filtros);
  return {
    general: cumplimientoDesdeDetalle(det).pct,
    porRuta: cumplimientoPorRuta(det),
    porModulo: cumplimientoPorGrupo(det, 'modulo'),
    porArea: cumplimientoPorGrupo(det, 'area'),
    evolucion: evolucionCumplimiento(det, filtros && filtros.periodo || 'mes'),
    heatmapModuloRuta: heatmapModuloRuta(det),
    radarRutas: cumplimientoPorRuta(det).map(function (r) {
      return { eje: r.codigo, valor: r.cumplimiento };
    })
  };
}

/** Pantalla Análisis de Criterios. */
function obtenerCumplimientoPorCriterio(filtros) {
  var det = filtrarDetalle(cargarDetalle(), filtros);
  var ruta = filtros && filtros.ruta ? filtros.ruta : null;
  return {
    ranking: rankingCriterios(det, ruta),
    heatmapModuloCriterio: heatmapModuloCriterio(det, ruta)
  };
}

/** Pantalla Gestión de Hallazgos. */
function obtenerHallazgos(filtros) {
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);
  return {
    kpis: kpisHallazgos(hall),
    porEstado: contarPor(hall, 'estado'),
    porModulo: contarPor(hall, 'modulo'),
    porTipo: contarPor(hall, 'tipo'),
    por5S: contarPor(hall, 'cincoS'),
    porResponsable: contarPor(hall, 'responsableAccion'),
    evolucion: serieTemporal(hall, 'fecha', filtros && filtros.periodo || 'mes',
      function (g) { return g.length; }),
    tabla: hall.map(function (h) {
      return {
        idHallazgo: h.idHallazgo, fecha: h.fecha, area: h.area, modulo: h.modulo,
        ruta: h.idRutaVinculada, tipo: h.tipo, descripcion: h.descripcion,
        cincoS: h.cincoS, responsable: h.responsableAccion, fechaLimite: h.fechaLimite,
        estado: h.estadoGestion || h.estado,   // estado efectivo (híbrido)
        estadoLegacy: h.estado,
        vencido: h.vencido,
        correccionInmediata: h.correccionInmediata,
        accion: h.accion, diasAbiertos: h.diasAbiertos, evidenciaFoto: h.evidenciaFoto
      };
    })
  };
}

// ============================================================
//  Sección INSPECCIONES (independiente)
// ============================================================

/**
 * Listado de inspecciones con KPIs (sección 4, 5, 24).
 * Reutiliza cargarInspecciones/filtrarInspecciones existentes.
 */
function obtenerInspecciones(filtros) {
  filtros = filtros || {};
  var todas = cargarInspecciones();
  var insp = filtrarInspecciones(todas, filtros);

  // Filtros adicionales propios de la vista Inspecciones.
  if (filtros.cumplMin != null && filtros.cumplMin !== '') {
    insp = insp.filter(function (i) { return i.cumplimiento != null && i.cumplimiento >= Number(filtros.cumplMin); });
  }
  if (filtros.cumplMax != null && filtros.cumplMax !== '') {
    insp = insp.filter(function (i) { return i.cumplimiento != null && i.cumplimiento <= Number(filtros.cumplMax); });
  }
  if (filtros.conHallazgos === 'si') insp = insp.filter(function (i) { return i.numHallazgos > 0; });
  if (filtros.conHallazgos === 'no') insp = insp.filter(function (i) { return !i.numHallazgos; });

  var cumpls = insp.filter(function (i) { return i.cumplimiento != null; }).map(function (i) { return i.cumplimiento; });
  var durs = insp.filter(function (i) { return i.duracionMin != null; }).map(function (i) { return i.duracionMin; });
  var completadas = insp.filter(function (i) { return i.completada; }).length;
  var conSeg = insp.filter(function (i) { return i.requiereSeguimiento; }).length;

  return {
    kpis: {
      total: insp.length,
      completadas: completadas,
      conHallazgos: insp.filter(function (i) { return i.numHallazgos > 0; }).length,
      cumplimientoPromedio: cumpls.length ? redondear(promedio(cumpls), 1) : null,
      cumplimientoMin: cumpls.length ? Math.min.apply(null, cumpls) : null,
      cumplimientoMax: cumpls.length ? Math.max.apply(null, cumpls) : null,
      duracionPromedio: durs.length ? redondear(promedio(durs), 1) : null,
      requierenSeguimientoPct: insp.length ? redondear(conSeg / insp.length * 100, 1) : null
    },
    tabla: insp.map(function (i) {
      return {
        id: i.id, fecha: i.fecha, horaInicio: i.horaInicio, horaFinal: i.horaFinal,
        duracionMin: i.duracionMin, responsable: i.responsable, area: i.area,
        modulo: i.modulo, rutas: i.rutas, cumplimiento: i.cumplimiento,
        numHallazgos: i.numHallazgos, requiereSeguimiento: i.requiereSeguimiento,
        completada: i.completada
      };
    })
  };
}

/** Pantalla Seguimiento de acciones. */
function obtenerAccionesPendientes(filtros) {
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);
  var clasif = clasificarSeguimiento(hall);
  return {
    acciones: clasif,
    resumen: {
      pendientes: clasif.filter(function (c) { return c.estado === 'Pendiente'; }).length,
      vencidas: clasif.filter(function (c) { return c.semaforo === 'rojo'; }).length,
      proximasVencer: clasif.filter(function (c) { return c.semaforo === 'amarillo'; }).length,
      cerradas: clasif.filter(function (c) { return c.semaforo === 'verde'; }).length
    }
  };
}

/** Pantalla Detalle de una inspección (incluye hallazgos vinculados). */
function obtenerDetalleInspeccion(idInspeccion) {
  var d = detalleDeInspeccion(idInspeccion);
  var hall = hallazgosDeInspeccion(idInspeccion);
  var cumpl = cumplimientoDesdeDetalle(d.criterios);
  return {
    inspeccion: d.inspeccion,
    criterios: d.criterios,
    cumplimiento: cumpl.pct,
    hallazgos: hall
  };
}

/** Pantalla Tendencias. */
function obtenerTendencias(filtros) {
  var periodo = filtros && filtros.periodo || 'mes';
  var det = filtrarDetalle(cargarDetalle(), filtros);
  var insp = filtrarInspecciones(cargarInspecciones(), filtros);
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);

  return {
    cumplimiento: evolucionCumplimiento(det, periodo),
    inspecciones: serieTemporal(insp, 'fecha', periodo, function (g) { return g.length; }),
    hallazgosGenerados: serieTemporal(hall, 'fecha', periodo, function (g) { return g.length; }),
    hallazgosCerrados: serieTemporal(
      hall.filter(function (h) { return h.estado === 'Corregido'; }),
      'fecha', periodo, function (g) { return g.length; }),
    correccionesInmediatas: serieTemporal(
      hall.filter(function (h) { return h.correccionInmediata; }),
      'fecha', periodo, function (g) { return g.length; })
  };
}

/** Pantalla Estandarización (análisis de actividades). */
function obtenerActividadesEstandarizacion(filtros) {
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);
  var requieren = hall.filter(function (h) { return h.requiereEstandarizacion; });
  var tiempos = hall.filter(function (h) { return h.tiempoCorreccionMin !== null; });

  return {
    totalRequierenMedicion: requieren.length,
    recurrentes: hall.filter(function (h) { return h.recurrente; }).length,
    noRecurrentes: hall.filter(function (h) { return !h.recurrente; }).length,
    porTipoIntervencion: contarPor(hall, 'intervencion'),
    tiempoPorTipo: tiempoPromedioPorTipo(tiempos),
    topRecurrentes: topRecurrentes(hall),
    // Análisis de recurrencia AVANZADO (por similitud de texto + frecuencia).
    recurrencia: analizarRecurrencia(filtros)
  };
}

/** Pantalla Mapa 5S (tarjetas por módulo). */
function obtenerMapa5S(filtros) {
  var det = filtrarDetalle(cargarDetalle(), filtros);
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);
  var cumplPorMod = cumplimientoPorGrupo(det, 'modulo');

  return cumplPorMod.map(function (c) {
    var hMod = hall.filter(function (h) { return clave(h.modulo) === clave(c.grupo); });
    return {
      modulo: c.grupo,
      cumplimiento: c.cumplimiento,
      semaforo: semaforoCumplimiento(c.cumplimiento),
      hallazgosAbiertos: hMod.filter(function (h) { return h.estado !== 'Corregido'; }).length,
      hallazgosVencidos: hMod.filter(function (h) { return h.estado === 'Vencido'; }).length
    };
  });
}

// ---- Helpers de agregación para la API --------------------------------

function contarPor(items, prop) {
  var g = agrupar(items, prop);
  return Object.keys(g).map(function (k) {
    return { etiqueta: k, valor: g[k].length };
  }).sort(function (a, b) { return b.valor - a.valor; });
}

function topModulosProblema(hallazgos) {
  var g = agrupar(hallazgos.filter(function (h) {
    return h.estado !== 'Corregido';
  }), 'modulo');
  return Object.keys(g).map(function (k) {
    return { modulo: k, abiertos: g[k].length };
  }).sort(function (a, b) { return b.abiertos - a.abiertos; }).slice(0, 10);
}

function evolucionCumplimiento(detalle, periodo) {
  return serieTemporal(detalle, 'fecha', periodo, function (grupo) {
    return cumplimientoDesdeDetalle(grupo).pct;
  });
}

function heatmapModuloRuta(detalle) {
  var modulos = unicos(detalle, 'modulo');
  var rutas = Object.keys(CONFIG.RUTAS);
  var celdas = [];
  modulos.forEach(function (mod) {
    rutas.forEach(function (ruta) {
      var sub = detalle.filter(function (d) {
        return clave(d.modulo) === clave(mod) && d.codigoRuta === ruta;
      });
      var c = cumplimientoDesdeDetalle(sub);
      celdas.push({ fila: mod, columna: ruta, valor: c.pct, n: c.n });
    });
  });
  return { modulos: modulos, rutas: rutas, celdas: celdas };
}

function heatmapModuloCriterio(detalle, codigoRuta) {
  var det = codigoRuta
    ? detalle.filter(function (d) { return d.codigoRuta === codigoRuta; })
    : detalle;
  var modulos = unicos(det, 'modulo');
  var criteriosMap = {};
  det.forEach(function (d) { criteriosMap[d.codigoCriterio] = d.nombreCriterio; });
  var criterios = Object.keys(criteriosMap).sort();

  var celdas = [];
  modulos.forEach(function (mod) {
    criterios.forEach(function (crit) {
      var sub = det.filter(function (d) {
        return clave(d.modulo) === clave(mod) && d.codigoCriterio === crit;
      });
      var c = cumplimientoDesdeDetalle(sub);
      celdas.push({ fila: mod, columna: crit, valor: c.pct, n: c.n });
    });
  });
  return { modulos: modulos, criterios: criterios, nombres: criteriosMap, celdas: celdas };
}

function tiempoPromedioPorTipo(hallazgosConTiempo) {
  var g = agrupar(hallazgosConTiempo, 'intervencion');
  return Object.keys(g).map(function (k) {
    var t = g[k].map(function (h) { return h.tiempoCorreccionMin; });
    return { tipo: k, promedioMin: redondear(promedio(t), 1), n: t.length };
  });
}

function topRecurrentes(hallazgos) {
  // Agrupación simple por (tipo + 5S + módulo) como proxy de recurrencia.
  var g = agrupar(hallazgos, function (h) {
    return [clave(h.tipo), clave(h.cincoS), clave(h.modulo)].join(' | ');
  });
  return Object.keys(g).map(function (k) {
    var items = g[k];
    return {
      clave: k,
      ejemplo: items[0].descripcion,
      modulo: items[0].modulo,
      tipo: items[0].tipo,
      cincoS: items[0].cincoS,
      ocurrencias: items.length
    };
  }).filter(function (x) { return x.ocurrencias > 1; })
    .sort(function (a, b) { return b.ocurrencias - a.ocurrencias; })
    .slice(0, 15);
}

function compararCumplimiento(filtros, detalleAll) {
  if (!filtros || !filtros.desde || !filtros.hasta) {
    return { disponible: false, texto: 'Sin datos comparables' };
  }
  var prev = periodoAnterior(filtros.desde, filtros.hasta);
  if (!prev) return { disponible: false, texto: 'Sin datos comparables' };

  var actual = cumplimientoDesdeDetalle(filtrarDetalle(detalleAll, filtros));
  var anterior = cumplimientoDesdeDetalle(filtrarDetalle(detalleAll, {
    desde: prev.desde, hasta: prev.hasta,
    area: filtros.area, modulo: filtros.modulo,
    responsable: filtros.responsable, ruta: filtros.ruta
  }));

  if (actual.pct === null || anterior.pct === null || anterior.n === 0) {
    return { disponible: false, texto: 'Sin datos comparables' };
  }
  var delta = redondear(actual.pct - anterior.pct, 1);
  return {
    disponible: true,
    delta: delta,
    direccion: delta >= 0 ? 'subida' : 'bajada',
    texto: (delta >= 0 ? '▲ +' : '▼ ') + delta + ' puntos vs periodo anterior'
  };
}
