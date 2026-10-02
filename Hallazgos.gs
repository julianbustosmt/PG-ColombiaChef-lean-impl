/**
 * ============================================================
 *  Hallazgos.gs  —  Lectura + filtrado de hallazgos
 * ============================================================
 *  Carga la hoja normalizada Hallazgos (con estado ya calculado
 *  por el ETL) y aplica los filtros globales + filtros propios
 *  (estado, tipo, 5S).
 * ============================================================
 */

/** Carga Hallazgos como array de objetos tipados. */
function cargarHallazgos() {
  return leerHojaObjetos(CONFIG.HOJAS.HALLAZGOS).map(function (o) {
    return {
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
  });
}

/**
 * Aplica filtros globales + propios a hallazgos.
 * filtros: { desde, hasta, area, modulo, estado, tipo, cincoS }
 */
function filtrarHallazgos(items, filtros) {
  filtros = filtros || {};
  return items.filter(function (h) {
    return pasaFecha(h.fecha, filtros) &&
      pasaIgual(h.area, filtros.area) &&
      pasaIgual(h.modulo, filtros.modulo) &&
      pasaIgual(h.estado, filtros.estado) &&
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
