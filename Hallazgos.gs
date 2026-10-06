/**
 * ============================================================
 *  Hallazgos.gs  —  Lectura + filtrado de hallazgos
 * ============================================================
 *  Carga la hoja normalizada Hallazgos (con estado ya calculado
 *  por el ETL) y aplica los filtros globales + filtros propios
 *  (estado, tipo, 5S).
 * ============================================================
 */

/** Carga Hallazgos como array de objetos tipados.
 *  Enriquece cada hallazgo con:
 *   - estado           : estado CALCULADO por el ETL (compatibilidad, legacy).
 *   - estadoGestion     : estado EFECTIVO (híbrido): el gestionado por el usuario
 *                         si existe; si no, el mapeo del calculado. Es el que
 *                         deben usar las vistas/KPIs nuevos.
 *   - vencido           : bandera derivada de la fecha límite.
 */
function cargarHallazgos() {
  var gestion = mapaEstadosGestionados(); // {idHallazgo: 'Abierto'|...} una sola lectura
  return leerHojaObjetos(CONFIG.HOJAS.HALLAZGOS).map(function (o) {
    var h = {
      idHallazgo: limpiar(o['ID_Hallazgo']),
      idRutaVinculada: limpiar(o['ID_Ruta_Vinculada']),
      fecha: limpiar(o['Fecha']),
      area: limpiar(o['Area']),
      modulo: limpiar(o['Modulo']),
      tipo: limpiar(o['Tipo']),
      descripcion: limpiar(o['Descripcion']),
      ubicacion: limpiar(o['Ubicacion']),
      cincoS: limpiar(o['5S_Relacionada']),
      recurrente: o['Recurrente'] === true || clave(o['Recurrente']) === 'true',
      intervencion: limpiar(o['Tipo_Intervencion']),
      correccionInmediata: o['Correccion_Inmediata'] === true || clave(o['Correccion_Inmediata']) === 'true',
      tiempoCorreccionMin: aNumero(o['Tiempo_Correccion_Min']),
      accion: limpiar(o['Accion']),
      responsableAccion: limpiar(o['Responsable_Accion']),
      fechaLimite: limpiar(o['Fecha_Limite']),
      requiereOtraArea: o['Requiere_Otra_Area'] === true || clave(o['Requiere_Otra_Area']) === 'true',
      areaResponsable: limpiar(o['Area_Responsable']),
      requiereEstandarizacion: o['Requiere_Estandarizacion'] === true || clave(o['Requiere_Estandarizacion']) === 'true',
      estado: limpiar(o['Estado']),
      diasAbiertos: aNumero(o['Dias_Abiertos']),
      evidenciaFoto: limpiar(o['Evidencia_Foto']),
      observaciones: limpiar(o['Observaciones'])
    };
    // Estado híbrido.
    var gest = gestion[h.idHallazgo];
    h.estadoGestion = gest || (CONFIG.HALLAZGO_CFG.MAPEO_LEGACY[h.estado] || 'Abierto');
    h.vencido = (CONFIG.HALLAZGO_CFG.ESTADOS_CERRADOS.indexOf(h.estadoGestion) === -1) &&
      (function () { var fl = aFecha(h.fechaLimite); return !!(fl && soloFecha(fl) < soloFecha(new Date())); })();
    return h;
  });
}

/**
 * Lee de una sola pasada los estados gestionados desde Seguimiento_Hallazgos.
 * Devuelve { idHallazgo: estadoReal } (solo los que tienen Estado_Real).
 */
function mapaEstadosGestionados() {
  var mapa = {};
  var d = leerHoja(CONFIG.HOJAS.SEGUIMIENTO);
  if (!d.headers.length) return mapa;
  var cId = buscarCol(d.idx, d.headers, ['ID Hallazgo', 'ID_Hallazgo']);
  var cEstado = buscarCol(d.idx, d.headers, ['Estado_Real', 'Estado real', 'Estado']);
  if (cId < 0 || cEstado < 0) return mapa;
  d.rows.forEach(function (f) {
    var id = limpiar(f[cId]);
    var est = limpiar(f[cEstado]);
    if (id && est) mapa[id] = est;
  });
  return mapa;
}

/**
 * Aplica filtros globales + propios a hallazgos.
 * filtros: { desde, hasta, area, modulo, estado, tipo, cincoS }
 */
function filtrarHallazgos(items, filtros) {
  filtros = filtros || {};
  return items.filter(function (h) {
    // El filtro de estado matchea contra el estado efectivo (gestionado) o
    // el legacy, para no romper filtros guardados ni enlaces previos.
    var estadoOk = !filtros.estado ||
      clave(h.estadoGestion) === clave(filtros.estado) ||
      clave(h.estado) === clave(filtros.estado);
    // Filtro por inspección de origen (sección 22, trazabilidad).
    var inspOk = !filtros.idInspeccion ||
      clave(h.idRutaVinculada) === clave(filtros.idInspeccion);
    return pasaFecha(h.fecha, filtros) &&
      pasaIgual(h.area, filtros.area) &&
      pasaIgual(h.modulo, filtros.modulo) &&
      estadoOk && inspOk &&
      pasaIgual(h.tipo, filtros.tipo) &&
      (!filtros.cincoS || clave(h.cincoS).indexOf(clave(filtros.cincoS)) !== -1);
  });
}

/** Hallazgos vinculados a una inspección (para pantalla Detalle). */
function hallazgosDeInspeccion(idInspeccion) {
  return cargarHallazgos().filter(function (h) {
    return h.idRutaVinculada === idInspeccion;
  });
}

/** Clasifica acciones para la pantalla Seguimiento (semáforos). */
function clasificarSeguimiento(hallazgos) {
  var hoy = soloFecha(new Date());
  var umbral = CONFIG.UMBRALES.PROXIMO_VENCER_DIAS;

  return hallazgos.map(function (h) {
    var semaforo = 'gris';
    var fLim = aFecha(h.fechaLimite);

    if (h.estado === 'Corregido') {
      semaforo = 'verde';
    } else if (h.estado === 'Vencido') {
      semaforo = 'rojo';
    } else if (fLim) {
      var dias = diasEntre(hoy, fLim);
      semaforo = (dias !== null && dias <= umbral) ? 'amarillo' : 'gris';
    }

    return {
      idHallazgo: h.idHallazgo,
      descripcion: h.descripcion,
      modulo: h.modulo,
      area: h.area,
      responsableAccion: h.responsableAccion,
      areaResponsable: h.areaResponsable,
      fechaLimite: h.fechaLimite,
      estado: h.estado,
      diasAbiertos: h.diasAbiertos,
      semaforo: semaforo
    };
  });
}
