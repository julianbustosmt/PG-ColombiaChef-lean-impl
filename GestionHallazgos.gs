/**
 * ============================================================
 *  GestionHallazgos.gs  —  Gestión integral del hallazgo
 * ============================================================
 *  Añade sobre el sistema existente (sin romperlo):
 *   - Estado GESTIONADO (híbrido): el usuario fija el estado y se guarda en
 *     Seguimiento_Hallazgos; si no se gestionó, se usa el estado calculado
 *     del ETL como fallback (datos históricos nunca quedan vacíos).
 *   - Acciones_Hallazgo    (1:N) — múltiples acciones por hallazgo.
 *   - Evidencias_Hallazgo  (1:N) — fotos/URLs clasificadas (Inicial/Corrección…).
 *   - Historial_Hallazgo   (1:N) — línea de tiempo de eventos.
 *
 *  Todas las hojas son TRANSACCIONALES: el ETL las respeta (no las regenera).
 *  Reutiliza: Seguimiento_Hallazgos, cargarHallazgos, hallazgosDeInspeccion,
 *  siguienteId, appendFila, actualizarFilaPorId.
 * ============================================================
 */

// ---- Encabezados de las hojas nuevas -----------------------------------

function headersAcciones() {
  return ['ID_Accion', 'ID_Hallazgo', 'Fecha', 'Tipo_Accion', 'Descripcion',
    'Responsable', 'Fecha_Limite', 'Estado', 'Comentario', 'Usuario', 'Fecha_Registro'];
}
function headersEvidencias() {
  return ['ID_Evidencia', 'ID_Hallazgo', 'Tipo_Evidencia', 'URL', 'Descripcion',
    'Fecha', 'Usuario'];
}
function headersHistorial() {
  return ['ID_Historial', 'ID_Hallazgo', 'Fecha', 'Evento', 'Detalle', 'Usuario'];
}

function asegurarHojasGestion() {
  asegurarHoja(CONFIG.HOJAS.ACCIONES, headersAcciones(), ['Fecha', 'Fecha_Limite', 'Fecha_Registro']);
  asegurarHoja(CONFIG.HOJAS.EVIDENCIAS, headersEvidencias(), ['Fecha']);
  asegurarHoja(CONFIG.HOJAS.HISTORIAL, headersHistorial(), ['Fecha']);
}

function usuarioActual() {
  return (Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || 'web';
}

// ---- Estado híbrido ----------------------------------------------------

/**
 * Lee el estado GESTIONADO de un hallazgo desde Seguimiento_Hallazgos.
 * Devuelve { estado, fechaCierre, comentario, usuario } o null si no existe.
 * Reutiliza la hoja existente, ampliando el uso de su columna Estado_Real.
 */
function leerEstadoGestionado(idHallazgo) {
  var d = leerHoja(CONFIG.HOJAS.SEGUIMIENTO);
  if (!d.headers.length) return null;
  var cId = buscarCol(d.idx, d.headers, ['ID Hallazgo', 'ID_Hallazgo']);
  var cEstado = buscarCol(d.idx, d.headers, ['Estado_Real', 'Estado real', 'Estado']);
  var cFecha = buscarCol(d.idx, d.headers, ['Fecha_Cierre', 'Fecha de cierre']);
  var cCom = buscarCol(d.idx, d.headers, ['Comentario_Cierre', 'Comentario']);
  var cUsr = buscarCol(d.idx, d.headers, ['Usuario_Cierre', 'Usuario']);
  if (cId < 0) return null;

  for (var r = 0; r < d.rows.length; r++) {
    if (limpiar(d.rows[r][cId]) === limpiar(idHallazgo)) {
      var est = cEstado >= 0 ? limpiar(d.rows[r][cEstado]) : '';
      if (!est) return null;
      return {
        estado: est,
        fechaCierre: cFecha >= 0 ? fechaISO(aFecha(d.rows[r][cFecha])) : '',
        comentario: cCom >= 0 ? limpiar(d.rows[r][cCom]) : '',
        usuario: cUsr >= 0 ? limpiar(d.rows[r][cUsr]) : ''
      };
    }
  }
  return null;
}

/**
 * Estado efectivo (híbrido) de un hallazgo:
 *   - si fue gestionado -> ese estado.
 *   - si no -> mapeo del estado calculado del ETL (fallback), y si está
 *     vencido por fecha, se marca como vencido mediante bandera aparte.
 * `h` es un objeto de cargarHallazgos().
 */
function estadoEfectivo(h, gestionado) {
  if (gestionado && gestionado.estado) return gestionado.estado;
  var mapa = CONFIG.HALLAZGO_CFG.MAPEO_LEGACY;
  return mapa[h.estado] || 'Abierto';
}

/** ¿El hallazgo está vencido? (fecha límite pasada y no cerrado). */
function estaVencido(h, estadoEff) {
  if (CONFIG.HALLAZGO_CFG.ESTADOS_CERRADOS.indexOf(estadoEff) !== -1) return false;
  var fl = aFecha(h.fechaLimite);
  return !!(fl && soloFecha(fl) < soloFecha(new Date()));
}

// ---- Guardar estado / cierre (Seguimiento_Hallazgos) -------------------

/**
 * Asegura que exista una fila para el hallazgo en Seguimiento_Hallazgos con
 * las columnas ampliadas (Usuario_Cierre). Devuelve la hoja.
 */
function asegurarFilaSeguimiento(idHallazgo) {
  var headers = ['ID Hallazgo', 'Estado_Real', 'Fecha_Cierre', 'Comentario_Cierre', 'Usuario_Cierre'];
  var sh = asegurarHoja(CONFIG.HOJAS.SEGUIMIENTO, headers);
  // Si la hoja existía sin la columna Usuario_Cierre, la añadimos.
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
  if (cab.indexOf('Usuario_Cierre') === -1) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue('Usuario_Cierre');
  }
  // Garantiza fila para el ID.
  var existe = false;
  if (sh.getLastRow() > 1) {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    existe = ids.some(function (f) { return limpiar(f[0]) === limpiar(idHallazgo); });
  }
  if (!existe) sh.appendRow([idHallazgo, '', '', '', '']);
  return sh;
}

/**
 * Cambia el estado gestionado de un hallazgo (y registra en historial).
 * datos: { idHallazgo, nuevoEstado, comentario }
 */
function cambiarEstadoHallazgo(datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var id = limpiar(datos.idHallazgo);
    var nuevo = limpiar(datos.nuevoEstado);
    if (!id) return { ok: false, error: 'Falta ID de hallazgo.' };
    if (CONFIG.HALLAZGO_CFG.ESTADOS.indexOf(nuevo) === -1) {
      return { ok: false, error: 'Estado inválido: ' + nuevo };
    }

    asegurarFilaSeguimiento(id);
    var cambios = { Estado_Real: nuevo };
    actualizarFilaPorId(CONFIG.HOJAS.SEGUIMIENTO, 'ID Hallazgo', id, cambios);

    registrarHistorial(id, 'Cambio de estado', 'Estado → ' + nuevo +
      (datos.comentario ? ' · ' + datos.comentario : ''));
    cacheLimpiar();
    return { ok: true, estado: nuevo };
  } catch (e) {
    log_('cambiarEstadoHallazgo error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cierra un hallazgo con trazabilidad (sección 17).
 * datos: { idHallazgo, comentario, evidenciaUrl? }
 * Exige comentario de cierre (configurable).
 */
function cerrarHallazgo(datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var id = limpiar(datos.idHallazgo);
    if (!id) return { ok: false, error: 'Falta ID de hallazgo.' };
    var comentario = limpiar(datos.comentario);
    if (CONFIG.HALLAZGO_CFG.EXIGIR_COMENTARIO_CIERRE && !comentario) {
      return { ok: false, error: 'Debes indicar un comentario de cierre.' };
    }

    asegurarFilaSeguimiento(id);
    actualizarFilaPorId(CONFIG.HOJAS.SEGUIMIENTO, 'ID Hallazgo', id, {
      Estado_Real: 'Cerrado',
      Fecha_Cierre: fechaISO(new Date()),
      Comentario_Cierre: comentario,
      Usuario_Cierre: usuarioActual()
    });

    // Evidencia de cierre opcional.
    if (datos.evidenciaUrl) {
      agregarEvidencia({ idHallazgo: id, tipo: 'Verificación',
        url: datos.evidenciaUrl, descripcion: 'Evidencia de cierre' });
    }

    registrarHistorial(id, 'Hallazgo cerrado', comentario);
    cacheLimpiar();
    return { ok: true };
  } catch (e) {
    log_('cerrarHallazgo error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/** Reabre un hallazgo cerrado (sección 15). */
function reabrirHallazgo(datos) {
  var id = limpiar(datos.idHallazgo);
  if (!id) return { ok: false, error: 'Falta ID de hallazgo.' };
  asegurarFilaSeguimiento(id);
  actualizarFilaPorId(CONFIG.HOJAS.SEGUIMIENTO, 'ID Hallazgo', id, {
    Estado_Real: 'Reabierto', Fecha_Cierre: '', Comentario_Cierre: ''
  });
  registrarHistorial(id, 'Hallazgo reabierto', limpiar(datos.comentario));
  cacheLimpiar();
  return { ok: true };
}

// ---- Acciones (1:N) ----------------------------------------------------

/**
 * Registra una acción del hallazgo (no sobrescribe históricas, sección 20).
 * datos: { idHallazgo, tipoAccion, descripcion, responsable, fechaLimite, estado, comentario }
 */
function agregarAccion(datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var id = limpiar(datos.idHallazgo);
    if (!id) return { ok: false, error: 'Falta ID de hallazgo.' };
    asegurarHojasGestion();

    var idAccion = siguienteId('ACC', CONFIG.HOJAS.ACCIONES, 'ID_Accion');
    appendFila(CONFIG.HOJAS.ACCIONES, headersAcciones(), {
      ID_Accion: idAccion,
      ID_Hallazgo: id,
      Fecha: fechaISO(new Date()),
      Tipo_Accion: limpiar(datos.tipoAccion) || 'Correctiva',
      Descripcion: limpiar(datos.descripcion),
      Responsable: limpiar(datos.responsable),
      Fecha_Limite: datos.fechaLimite || '',
      Estado: limpiar(datos.estado) || 'En proceso',
      Comentario: limpiar(datos.comentario),
      Usuario: usuarioActual(),
      Fecha_Registro: fechaISO(new Date())
    });
    registrarHistorial(id, 'Acción registrada', (limpiar(datos.descripcion) || '').slice(0, 120));
    cacheLimpiar();
    return { ok: true, idAccion: idAccion };
  } catch (e) {
    log_('agregarAccion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/** Carga las acciones de un hallazgo (orden cronológico). */
function accionesDeHallazgo(idHallazgo) {
  return leerHojaObjetos(CONFIG.HOJAS.ACCIONES)
    .filter(function (o) { return limpiar(o['ID_Hallazgo']) === limpiar(idHallazgo); })
    .map(function (o) {
      return {
        id: limpiar(o['ID_Accion']), fecha: fechaTexto(o['Fecha']),
        tipo: limpiar(o['Tipo_Accion']), descripcion: limpiar(o['Descripcion']),
        responsable: limpiar(o['Responsable']), fechaLimite: fechaTexto(o['Fecha_Limite']),
        estado: limpiar(o['Estado']), comentario: limpiar(o['Comentario']),
        usuario: limpiar(o['Usuario'])
      };
    });
}

// ---- Evidencias (1:N) --------------------------------------------------

/**
 * Agrega una evidencia (por URL de Drive). datos:
 * { idHallazgo, tipo, url, descripcion }
 */
function agregarEvidencia(datos) {
  var id = limpiar(datos.idHallazgo);
  if (!id) return { ok: false, error: 'Falta ID de hallazgo.' };
  var url = limpiar(datos.url);
  if (!url) return { ok: false, error: 'Falta la URL de la evidencia.' };
  asegurarHojasGestion();

  var tipo = limpiar(datos.tipo);
  if (CONFIG.HALLAZGO_CFG.TIPOS_EVIDENCIA.indexOf(tipo) === -1) tipo = 'Adicional';

  var idEv = siguienteId('EVD', CONFIG.HOJAS.EVIDENCIAS, 'ID_Evidencia');
  appendFila(CONFIG.HOJAS.EVIDENCIAS, headersEvidencias(), {
    ID_Evidencia: idEv,
    ID_Hallazgo: id,
    Tipo_Evidencia: tipo,
    URL: url,
    Descripcion: limpiar(datos.descripcion),
    Fecha: fechaISO(new Date()),
    Usuario: usuarioActual()
  });
  registrarHistorial(id, 'Evidencia agregada', tipo + (datos.descripcion ? ' · ' + datos.descripcion : ''));
  cacheLimpiar();
  return { ok: true, idEvidencia: idEv };
}

/**
 * Evidencias de un hallazgo. Combina:
 *   - la evidencia INICIAL del Form (campo Evidencia_Foto del hallazgo), y
 *   - las evidencias registradas en Evidencias_Hallazgo.
 */
function evidenciasDeHallazgo(idHallazgo, hallazgo) {
  var lista = [];
  // Evidencia inicial proveniente del formulario (si existe).
  if (hallazgo && hallazgo.evidenciaFoto) {
    normalizarUrlsDrive(hallazgo.evidenciaFoto).forEach(function (u) {
      lista.push({ id: '', tipo: 'Inicial', url: u, descripcion: 'Evidencia del formulario',
        fecha: hallazgo.fecha, usuario: '', origen: 'form' });
    });
  }
  // Evidencias gestionadas en la app.
  leerHojaObjetos(CONFIG.HOJAS.EVIDENCIAS)
    .filter(function (o) { return limpiar(o['ID_Hallazgo']) === limpiar(idHallazgo); })
    .forEach(function (o) {
      lista.push({
        id: limpiar(o['ID_Evidencia']), tipo: limpiar(o['Tipo_Evidencia']),
        url: limpiar(o['URL']), descripcion: limpiar(o['Descripcion']),
        fecha: fechaTexto(o['Fecha']), usuario: limpiar(o['Usuario']), origen: 'app'
      });
    });
  return lista;
}

/**
 * Convierte texto con una o varias URLs de Drive (el Form puede guardar
 * varias separadas por coma/espacio) en un array de URLs limpias.
 */
function normalizarUrlsDrive(texto) {
  var s = limpiar(texto);
  if (!s) return [];
  return s.split(/[\s,]+/).filter(function (u) { return /^https?:\/\//.test(u); });
}

// ---- Historial (1:N) ---------------------------------------------------

function registrarHistorial(idHallazgo, evento, detalle) {
  try {
    asegurarHojasGestion();
    var idH = siguienteId('HIS', CONFIG.HOJAS.HISTORIAL, 'ID_Historial');
    appendFila(CONFIG.HOJAS.HISTORIAL, headersHistorial(), {
      ID_Historial: idH,
      ID_Hallazgo: idHallazgo,
      Fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
      Evento: evento,
      Detalle: detalle || '',
      Usuario: usuarioActual()
    });
  } catch (e) {
    log_('registrarHistorial error: ' + e);
  }
}

/** Historial de un hallazgo (más reciente primero). */
function historialDeHallazgo(idHallazgo) {
  return leerHojaObjetos(CONFIG.HOJAS.HISTORIAL)
    .filter(function (o) { return limpiar(o['ID_Hallazgo']) === limpiar(idHallazgo); })
    .map(function (o) {
      return {
        fecha: limpiar(o['Fecha']), evento: limpiar(o['Evento']),
        detalle: limpiar(o['Detalle']), usuario: limpiar(o['Usuario'])
      };
    })
    .sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
}

// ---- Detalle completo del hallazgo (para el frontend) ------------------

/**
 * Devuelve la ficha completa de un hallazgo por ID: datos propios + estado
 * híbrido + inspección de origen (resumen) + acciones + evidencias + historial.
 */
function obtenerDetalleHallazgo(idHallazgo) {
  var id = limpiar(idHallazgo);
  var h = cargarHallazgos().filter(function (x) { return x.idHallazgo === id; })[0];
  if (!h) return { ok: false, error: 'Hallazgo no encontrado: ' + id };

  var gestionado = leerEstadoGestionado(id);
  var estado = estadoEfectivo(h, gestionado);
  var vencido = estaVencido(h, estado);

  // Inspección de origen (resumen de contexto, no reemplaza al hallazgo).
  var insp = null;
  if (h.idRutaVinculada && h.idRutaVinculada !== 'SIN RUTA') {
    var i = cargarInspecciones().filter(function (x) { return x.id === h.idRutaVinculada; })[0];
    if (i) {
      insp = {
        id: i.id, fecha: i.fecha, ruta: i.rutas, area: i.area,
        modulo: i.modulo, responsable: i.responsable, cumplimiento: i.cumplimiento
      };
    }
  }

  return {
    ok: true,
    hallazgo: {
      idHallazgo: h.idHallazgo,
      estado: estado,
      estadoGestionado: !!(gestionado && gestionado.estado),
      vencido: vencido,
      tipo: h.tipo,
      fecha: h.fecha,
      area: h.area,
      modulo: h.modulo,
      ruta: h.idRutaVinculada,
      descripcion: h.descripcion,
      ubicacion: h.ubicacion,
      cincoS: h.cincoS,
      intervencion: h.intervencion,
      accionPropuesta: h.accion,
      responsableAccion: h.responsableAccion,
      fechaLimite: h.fechaLimite,
      areaResponsable: h.areaResponsable,
      requiereOtraArea: h.requiereOtraArea,
      recurrente: h.recurrente,
      correccionInmediata: h.correccionInmediata,
      tiempoCorreccionMin: h.tiempoCorreccionMin,
      requiereEstandarizacion: h.requiereEstandarizacion,
      observaciones: h.observaciones,
      diasAbiertos: h.diasAbiertos,
      cierre: gestionado && gestionado.estado === 'Cerrado' ? {
        fecha: gestionado.fechaCierre, comentario: gestionado.comentario, usuario: gestionado.usuario
      } : null
    },
    inspeccion: insp,
    acciones: accionesDeHallazgo(id),
    evidencias: evidenciasDeHallazgo(id, h),
    historial: historialDeHallazgo(id),
    estadosDisponibles: CONFIG.HALLAZGO_CFG.ESTADOS,
    tiposEvidencia: CONFIG.HALLAZGO_CFG.TIPOS_EVIDENCIA
  };
}
