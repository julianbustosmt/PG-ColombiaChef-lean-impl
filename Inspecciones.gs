/**
 * ============================================================
 *  Inspecciones.gs  —  Lectura + filtrado de inspecciones/detalle
 * ============================================================
 *  Carga las tablas normalizadas a memoria como objetos tipados
 *  y aplica los filtros globales. No calcula KPIs (eso es
 *  responsabilidad de Indicadores.gs).
 * ============================================================
 */

/** Carga Inspecciones (resumen) como array de objetos tipados. */
function cargarInspecciones() {
  return leerHojaObjetos(CONFIG.HOJAS.INSPECCIONES).map(function (o) {
    return {
      id: limpiar(o['ID_Inspeccion']),
      fecha: limpiar(o['Fecha']),
      responsable: limpiar(o['Responsable']),
      area: limpiar(o['Area']),
      modulo: limpiar(o['Modulo']),
      rutas: limpiar(o['Rutas_Evaluadas']),
      horaInicio: limpiar(o['Hora_Inicio']),
      horaFinal: limpiar(o['Hora_Final']),
      duracionMin: aNumero(o['Duracion_Min']),
      cumplimiento: aNumero(o['Cumplimiento_Pct']),
      nValidos: aNumero(o['Num_Criterios_Validos']) || 0,
      completada: o['Ruta_Completada'] === true || clave(o['Ruta_Completada']) === 'true',
      requiereSeguimiento: o['Requiere_Seguimiento'] === true || clave(o['Requiere_Seguimiento']) === 'true',
      numHallazgos: aNumero(o['Num_Hallazgos']) || 0,
      observaciones: limpiar(o['Observaciones'])
    };
  });
}

/** Carga Detalle_Inspecciones como array de objetos tipados. */
function cargarDetalle() {
  return leerHojaObjetos(CONFIG.HOJAS.DETALLE_INSPECCIONES).map(function (o) {
    return {
      idInspeccion: limpiar(o['ID_Inspeccion']),
      fecha: limpiar(o['Fecha']),
      responsable: limpiar(o['Responsable']),
      area: limpiar(o['Area']),
      modulo: limpiar(o['Modulo']),
      rutaEvaluada: limpiar(o['Ruta_Evaluada']),
      codigoRuta: limpiar(o['Codigo_Ruta']),
      codigoCriterio: limpiar(o['Codigo_Criterio']),
      nombreCriterio: limpiar(o['Nombre_Criterio']),
      resultado: limpiar(o['Resultado']),
      valor: aNumero(o['Valor_Ponderado']),
      esValido: o['Es_Valido'] === true || clave(o['Es_Valido']) === 'true'
    };
  });
}

/**
 * Aplica filtros globales a una lista de inspecciones.
 * filtros: { desde, hasta, area, modulo, ruta, responsable }
 */
function filtrarInspecciones(items, filtros) {
  filtros = filtros || {};
  return items.filter(function (i) {
    return pasaFecha(i.fecha, filtros) &&
      pasaIgual(i.area, filtros.area) &&
      pasaIgual(i.modulo, filtros.modulo) &&
      pasaIgual(i.responsable, filtros.responsable) &&
      pasaRuta(i.rutas, filtros.ruta);
  });
}

/** Aplica filtros al detalle (incluye filtro por ruta exacto). */
function filtrarDetalle(items, filtros) {
  filtros = filtros || {};
  return items.filter(function (d) {
    return pasaFecha(d.fecha, filtros) &&
      pasaIgual(d.area, filtros.area) &&
      pasaIgual(d.modulo, filtros.modulo) &&
      pasaIgual(d.responsable, filtros.responsable) &&
      (!filtros.ruta || d.codigoRuta === filtros.ruta);
  });
}

// ---- Predicados de filtro ----------------------------------------------

function pasaFecha(fechaISOstr, filtros) {
  if (!filtros.desde && !filtros.hasta) return true;
  if (!fechaISOstr) return false;
  if (filtros.desde && fechaISOstr < filtros.desde) return false;
  if (filtros.hasta && fechaISOstr > filtros.hasta) return false;
  return true;
}

function pasaIgual(valor, filtro) {
  if (!filtro) return true;
  return clave(valor) === clave(filtro);
}

function pasaRuta(rutasStr, filtroRuta) {
  if (!filtroRuta) return true;
  return clave(rutasStr).indexOf(clave(filtroRuta)) !== -1;
}

/** Devuelve el detalle de una inspección concreta (pantalla Detalle). */
function detalleDeInspeccion(idInspeccion) {
  var det = cargarDetalle().filter(function (d) {
    return d.idInspeccion === idInspeccion;
  });
  var insp = cargarInspecciones().filter(function (i) {
    return i.id === idInspeccion;
  })[0] || null;
  return { inspeccion: insp, criterios: det };
}
