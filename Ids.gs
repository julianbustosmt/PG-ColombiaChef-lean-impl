/**
 * ============================================================
 *  Ids.gs  —  Generación de IDs de registros (Forms)
 * ============================================================
 *  Lógica original del proyecto, encapsulada en funciones
 *  reutilizables (NO contiene un onFormSubmit propio: el único
 *  trigger del proyecto vive en ETL.gs y orquesta todo).
 *
 *  Mejoras respecto a la versión inicial:
 *   - Idempotente: no reescribe un ID que ya existe (evita duplicados
 *     si el trigger se dispara más de una vez).
 *   - Usa la fila REAL del evento (e.range.getRow()), no getLastRow(),
 *     para ser seguro ante envíos concurrentes.
 *   - Formato de ID centralizado y reutilizable.
 * ============================================================
 */

/** Formatea un número a ID con prefijo y padding: ('INSP', 7) -> 'INSP-0007'. */
function formatearId(prefijo, numero) {
  return prefijo + '-' + String(numero).padStart(4, '0');
}

/**
 * Genera (si falta) el ID de una INSPECCIÓN en la fila indicada.
 *
 * ROBUSTO: el correlativo se calcula a partir del MÁXIMO ID ya presente en la
 * columna 'ID' de la hoja (no del número de fila). Así, borrar o reordenar
 * filas no provoca IDs duplicados. Protegido con LockService (concurrencia).
 * Idempotente: si la fila ya tiene ID, no se toca.
 */
function generarIdInspeccion(hoja, fila) {
  var colID = obtenerOCrearColumna(hoja, 'ID');
  var actual = limpiar(hoja.getRange(fila, colID).getValue());
  if (actual) return actual;

  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    // Reconfirma dentro del lock por si otro proceso ya lo escribió.
    actual = limpiar(hoja.getRange(fila, colID).getValue());
    if (actual) return actual;
    var id = siguienteIdEnColumna('INSP', hoja, colID);
    hoja.getRange(fila, colID).setValue(id);
    SpreadsheetApp.flush();
    log_('Inspección generada: ' + id + ' (fila ' + fila + ')');
    return id;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Genera (si faltan) el ID del HALLAZGO y vincula su inspección de origen.
 * ID robusto (máximo existente, no fila). Vínculo: ver obtenerIdUltimaRuta().
 */
function generarIdHallazgo(hoja, fila) {
  var colHall = obtenerOCrearColumna(hoja, 'ID Hallazgo');
  var colRuta = obtenerOCrearColumna(hoja, 'ID Ruta Vinculada');

  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    if (!limpiar(hoja.getRange(fila, colHall).getValue())) {
      var id = siguienteIdEnColumna('HALL', hoja, colHall);
      hoja.getRange(fila, colHall).setValue(id);
    }
    if (!limpiar(hoja.getRange(fila, colRuta).getValue())) {
      hoja.getRange(fila, colRuta).setValue(obtenerIdUltimaRuta());
    }
    SpreadsheetApp.flush();
    log_('Hallazgo generado en fila ' + fila);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Devuelve el siguiente ID correlativo (prefijo-NNNN) a partir del MÁXIMO
 * número ya presente en una columna de una hoja (por índice 1-based).
 * Lee toda la columna de una vez (eficiente) e ignora encabezado.
 */
function siguienteIdEnColumna(prefijo, hoja, colIndice) {
  var ultima = hoja.getLastRow();
  var max = 0;
  if (ultima >= 2) {
    var valores = hoja.getRange(2, colIndice, ultima - 1, 1).getValues();
    var re = new RegExp('^' + prefijo + '-(\\d+)$', 'i');
    for (var i = 0; i < valores.length; i++) {
      var m = re.exec(limpiar(valores[i][0]));
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return formatearId(prefijo, max + 1);
}

/**
 * Obtiene el ID de la inspección a la que se vincula un hallazgo recién
 * registrado.
 *
 * ROBUSTEZ: en vez de tomar literalmente "la última fila" (frágil si se
 * reordenan filas), toma la inspección con la MARCA TEMPORAL más reciente
 * que ya tenga ID asignado. Esto resiste reordenamientos y filas sin ID.
 *
 * NOTA de precisión: la vinculación 100% exacta cuando varios inspectores
 * registran a la vez solo se garantiza si el Form incluye "ID Sesion"
 * (ya soportado por vincularSesionesAutomatico en EjecucionSesion.gs). Esta
 * función es el mejor esfuerzo cuando ese campo no está presente.
 *
 * Devuelve 'SIN RUTA' si no hay inspecciones con ID.
 */
function obtenerIdUltimaRuta() {
  var hojaInsp = ssActiva().getSheetByName(CONFIG.HOJAS.INSPECCIONES_RAW);
  if (!hojaInsp) return 'SIN RUTA';
  var ultima = hojaInsp.getLastRow();
  if (ultima < 2) return 'SIN RUTA';

  var H = hojaInsp.getRange(1, 1, 1, hojaInsp.getLastColumn()).getValues()[0];
  var idx = indiceEncabezados(H.map(limpiar));
  var colID = buscarCol(idx, H, ['ID']);
  var colMarca = buscarCol(idx, H, ['Marca temporal']);
  if (colID < 0) return 'SIN RUTA';

  var datos = hojaInsp.getRange(2, 1, ultima - 1, hojaInsp.getLastColumn()).getValues();
  var mejorId = '';
  var mejorMarca = null;
  for (var i = 0; i < datos.length; i++) {
    var id = limpiar(datos[i][colID]);
    if (!id) continue;
    var marca = colMarca >= 0 ? aFecha(datos[i][colMarca]) : null;
    // Si no hay marca utilizable, usamos el orden de fila como desempate.
    var clave_ = marca ? marca.getTime() : i;
    if (mejorMarca === null || clave_ >= mejorMarca) {
      mejorMarca = clave_;
      mejorId = id;
    }
  }
  return mejorId || 'SIN RUTA';
}

/**
 * Genera el SIGUIENTE ID correlativo para una hoja transaccional
 * (Programacion_Rutas, Sesiones_Ruta), basándose en el máximo ID ya presente
 * en la columna indicada. Robusto ante filas borradas/reordenadas: no usa el
 * número de fila. Ej: siguienteId('PRG', 'Programacion_Rutas', 'ID_Programacion').
 */
function siguienteId(prefijo, nombreHoja, colId) {
  var filas = leerHojaObjetos(nombreHoja);
  var max = 0;
  var re = new RegExp('^' + prefijo + '-(\\d+)$', 'i');
  filas.forEach(function (f) {
    var m = re.exec(limpiar(f[colId]));
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  return formatearId(prefijo, max + 1);
}

/**
 * Busca una columna por nombre (case-insensitive); si no existe, la crea
 * al final y devuelve su índice (1-based).
 */
function obtenerOCrearColumna(hoja, nombreColumna) {
  var ultimaCol = hoja.getLastColumn();
  if (ultimaCol >= 1) {
    var encabezados = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0];
    for (var i = 0; i < encabezados.length; i++) {
      if (String(encabezados[i]).trim().toUpperCase() === nombreColumna.toUpperCase()) {
        return i + 1;
      }
    }
  }
  var nuevaColumna = hoja.getLastColumn() + 1;
  hoja.getRange(1, nuevaColumna).setValue(nombreColumna);
  return nuevaColumna;
}
