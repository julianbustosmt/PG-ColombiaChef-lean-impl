/**
 * ============================================================
 *  Datos.gs  —  Capa de acceso a datos (Sheets) + Caché
 * ============================================================
 *  Reglas de rendimiento (sección 21 del requerimiento):
 *   - Leer rangos completos con getValues(), nunca celda a celda.
 *   - Procesar en memoria.
 *   - Cachear resultados agregados con CacheService.
 * ============================================================
 */

/**
 * ------------------------------------------------------------
 *  Memoización POR EJECUCIÓN (request-scoped).
 * ------------------------------------------------------------
 *  Apps Script crea una instancia nueva del script por cada
 *  invocación (cada google.script.run / doGet). Este caché vive
 *  SOLO durante esa invocación y se descarta al terminar, por lo
 *  que NUNCA devuelve datos obsoletos entre requests ni mezcla
 *  datos de usuarios distintos. Su único efecto es evitar que la
 *  MISMA hoja se lea dos o más veces dentro de la misma operación
 *  (p.ej. una vista que llama cargarHallazgos() y cargarDetalle()
 *  varias veces, o compararCumplimiento()).
 *
 *  Las funciones que ESCRIBEN en una hoja deben invalidar su
 *  entrada con olvidarHoja(nombre) para que una lectura posterior
 *  dentro de la misma ejecución vea el valor actualizado.
 */
var _MEMO_HOJAS = {};

/** Lee una hoja SIN pasar por el memo (acceso directo a Sheets). */
function leerHojaDirecto(nombre) {
  var sh = ssActiva().getSheetByName(nombre);
  if (!sh) return { headers: [], rows: [], idx: {} };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [], idx: {} };

  var valores = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = valores[0].map(limpiar);
  var rows = valores.slice(1);
  return { headers: headers, rows: rows, idx: indiceEncabezados(headers) };
}

/**
 * Lee una hoja completa y devuelve { headers:[], rows:[[...]], idx:{header:col} }.
 * Si la hoja no existe o está vacía, devuelve estructura vacía (no lanza error).
 *
 * Memoiza el resultado durante la ejecución actual: la segunda y
 * sucesivas llamadas con el mismo `nombre` devuelven lo ya leído, sin
 * volver a tocar Google Sheets.
 */
function leerHoja(nombre) {
  if (_MEMO_HOJAS.hasOwnProperty(nombre)) return _MEMO_HOJAS[nombre];
  var d = leerHojaDirecto(nombre);
  _MEMO_HOJAS[nombre] = d;
  return d;
}

/**
 * Invalida el memo de una hoja (o de todas si no se indica nombre).
 * Debe llamarse tras escribir/append/actualizar una hoja para que una
 * relectura posterior dentro de la MISMA ejecución vea los cambios.
 */
function olvidarHoja(nombre) {
  if (nombre === undefined) { _MEMO_HOJAS = {}; return; }
  delete _MEMO_HOJAS[nombre];
}

/**
 * Lee una hoja como array de objetos {header: valor}.
 * Útil para hojas normalizadas con nombres de columna estables.
 */
function leerHojaObjetos(nombre) {
  var d = leerHoja(nombre);
  return d.rows.map(function (fila) {
    var o = {};
    d.headers.forEach(function (h, i) { o[h] = fila[i]; });
    return o;
  });
}

/**
 * Escribe (reemplaza) una hoja normalizada con headers + filas.
 * Limpia la hoja y vuelca todo de una sola operación (rápido).
 * Crea la hoja si no existe.
 */
function escribirHoja(nombre, headers, filas) {
  var ss = ssActiva();
  var sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  sh.clearContents();
  if (!headers || !headers.length) return;

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (filas && filas.length) {
    sh.getRange(2, 1, filas.length, headers.length).setValues(filas);
  }
  // Formato de encabezado
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#263238')
    .setFontColor('#ffffff');
  sh.setFrozenRows(1);
  olvidarHoja(nombre); // el contenido cambió: invalida el memo de la ejecución
}

// ---- Acceso TRANSACCIONAL (datos primarios: Programacion/Sesiones) -----
//
// A diferencia de escribirHoja() (que BORRA y reescribe hojas derivadas del
// ETL), estos helpers modifican hojas que son FUENTE DE VERDAD editable por
// el usuario: nunca hacen clearContents(). Se usan para Programacion_Rutas y
// Sesiones_Ruta, cuyos datos no deben perderse al regenerar las derivadas.

/**
 * Asegura que una hoja exista con los encabezados dados.
 * Si no existe, la crea con la cabecera formateada. Si existe, la respeta.
 * Devuelve la hoja.
 */
function asegurarHoja(nombre, headers, columnasTexto) {
  var ss = ssActiva();
  var sh = ss.getSheetByName(nombre);

  if (!sh) {
    // Si existe una hoja por defecto vacía ("Hoja 1" / "Sheet1"), la
    // reutilizamos renombrándola, en vez de dejarla huérfana en el Sheet.
    var defecto = hojaPorDefectoVacia(ss);
    if (defecto) {
      defecto.setName(nombre);
      sh = defecto;
    } else {
      sh = ss.insertSheet(nombre);
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#263238').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }

  // Fuerza formato TEXTO en las columnas indicadas (por nombre de encabezado),
  // para que valores como '08:00' o '2026-10-02' NO se conviertan en Date/hora
  // base 1899. Se aplica a toda la columna.
  if (columnasTexto && columnasTexto.length) {
    var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
    columnasTexto.forEach(function (h) {
      var c = cab.indexOf(h);
      if (c >= 0) sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

/**
 * Detecta una hoja por defecto vacía creada automáticamente por Google
 * ("Hoja 1", "Hoja1", "Sheet1", "Sheet 1") sin contenido, para reutilizarla.
 */
function hojaPorDefectoVacia(ss) {
  var patrones = /^(hoja|sheet)\s?1$/i;
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    var h = hojas[i];
    if (patrones.test(limpiar(h.getName())) &&
        h.getLastRow() === 0 && h.getLastColumn() <= 1) {
      return h;
    }
  }
  return null;
}

/**
 * Añade una fila al final de una hoja transaccional, respetando el orden de
 * sus encabezados actuales. `obj` es {Encabezado: valor}.
 */
function appendFila(nombre, headers, obj) {
  var sh = asegurarHoja(nombre, headers);
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
  var fila = cab.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sh.appendRow(fila);
  olvidarHoja(nombre); // se añadió una fila: invalida el memo de la ejecución
  return sh.getLastRow();
}

/**
 * Actualiza (merge) una fila identificada por el valor de `colId` = `idValor`.
 * Solo escribe las columnas presentes en `cambios` (no pisa el resto).
 * Devuelve true si encontró y actualizó la fila.
 */
function actualizarFilaPorId(nombre, colId, idValor, cambios) {
  var sh = ssActiva().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return false;
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
  var cId = cab.indexOf(colId);
  if (cId < 0) return false;

  var datos = sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).getValues();
  for (var r = 0; r < datos.length; r++) {
    if (limpiar(datos[r][cId]) === limpiar(idValor)) {
      // Aplica todos los cambios sobre la fila en memoria y la reescribe en
      // UNA sola operación setValues (antes: un setValue por columna). Reduce
      // las llamadas a Sheets de N (columnas cambiadas) a 1.
      var fila = datos[r];
      var huboCambio = false;
      Object.keys(cambios).forEach(function (k) {
        var c = cab.indexOf(k);
        if (c >= 0) { fila[c] = cambios[k]; huboCambio = true; }
      });
      if (huboCambio) {
        sh.getRange(r + 2, 1, 1, cab.length).setValues([fila]);
        olvidarHoja(nombre); // la fila cambió: invalida el memo de la ejecución
      }
      return true;
    }
  }
  return false;
}

// ---- Caché de agregaciones --------------------------------------------

function _cache() { return CacheService.getScriptCache(); }

/** Devuelve objeto cacheado o null. */
function cacheGet(key) {
  var raw = _cache().get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** Guarda objeto en caché (serializado). */
function cachePut(key, obj) {
  try {
    _cache().put(key, JSON.stringify(obj), CONFIG.CACHE_TTL_SEG);
  } catch (e) {
    // El valor puede exceder el límite de 100KB del cache; se ignora.
    log_('cachePut omitido para ' + key + ': ' + e);
  }
}

/** Invalida toda la caché del dashboard (llamar tras un ETL). */
function cacheLimpiar() {
  // CacheService no permite "flush all"; usamos un sello de versión.
  PropertiesService.getScriptProperties()
    .setProperty('CACHE_STAMP', String(Date.now()));
}

/** Sello actual de caché (se incorpora a las claves para invalidar). */
function cacheStamp() {
  var p = PropertiesService.getScriptProperties().getProperty('CACHE_STAMP');
  return p || '0';
}

/** Construye una clave de caché a partir de nombre + filtros + sello. */
function cacheKey(nombre, filtros) {
  return nombre + '|' + cacheStamp() + '|' + JSON.stringify(filtros || {});
}
