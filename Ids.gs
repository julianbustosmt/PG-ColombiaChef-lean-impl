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
 * Devuelve el ID (nuevo o existente).
 */
function generarIdInspeccion(hoja, fila) {
  var colID = obtenerOCrearColumna(hoja, 'ID');
  var actual = limpiar(hoja.getRange(fila, colID).getValue());
  if (actual) return actual; // ya tiene ID -> no se toca

  var id = formatearId('INSP', fila - 1); // fila 2 => INSP-0001
  hoja.getRange(fila, colID).setValue(id);
  log_('Inspección generada: ' + id + ' (fila ' + fila + ')');
  return id;
}

/**
 * Genera (si faltan) el ID del HALLAZGO y vincula la última ruta ejecutada.
 */
function generarIdHallazgo(hoja, fila) {
  var colHall = obtenerOCrearColumna(hoja, 'ID Hallazgo');
  var colRuta = obtenerOCrearColumna(hoja, 'ID Ruta Vinculada');

  if (!limpiar(hoja.getRange(fila, colHall).getValue())) {
    hoja.getRange(fila, colHall).setValue(formatearId('HALL', fila - 1));
  }
  if (!limpiar(hoja.getRange(fila, colRuta).getValue())) {
    hoja.getRange(fila, colRuta).setValue(obtenerIdUltimaRuta());
  }
  log_('Hallazgo generado en fila ' + fila);
}

/**
 * Obtiene el ID del último registro de la hoja de Inspecciones.
 * Devuelve 'SIN RUTA' si aún no hay inspecciones.
 */
function obtenerIdUltimaRuta() {
  var hojaInsp = ssActiva().getSheetByName(CONFIG.HOJAS.INSPECCIONES_RAW);
  if (!hojaInsp) return 'SIN RUTA';

  var ultimaFila = hojaInsp.getLastRow();
  if (ultimaFila < 2) return 'SIN RUTA';

  var colID = obtenerOCrearColumna(hojaInsp, 'ID');
  return limpiar(hojaInsp.getRange(ultimaFila, colID).getValue()) || 'SIN RUTA';
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
