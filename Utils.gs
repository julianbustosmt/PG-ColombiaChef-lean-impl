/**
 * ============================================================
 *  Utils.gs  —  Utilidades transversales
 * ============================================================
 *  Parseo robusto de fechas/horas, normalización de texto,
 *  helpers de arrays y acceso al Spreadsheet activo.
 *  Diseñado para tolerar datos sucios de Google Forms.
 * ============================================================
 */

/** Devuelve el Spreadsheet activo (donde vive este script). */
function ssActiva() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Normaliza texto: trim, colapsa espacios. Mantiene mayúsculas originales. */
function limpiar(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Normaliza para comparar: minúsculas, sin tildes, sin espacios extra. */
function clave(v) {
  return limpiar(v)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita acentos
}

/** ¿La cadena está vacía tras limpiar? */
function vacio(v) {
  return limpiar(v) === '';
}

/**
 * Parsea un valor a Date de forma robusta.
 * Acepta: objetos Date, "dd/mm/yyyy", "yyyy-mm-dd", "dd-mm-yyyy",
 * y timestamps. Devuelve null si no se puede interpretar.
 */
function aFecha(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (v === null || v === undefined || v === '') return null;

  if (typeof v === 'number') {
    var d0 = new Date(v);
    return isNaN(d0.getTime()) ? null : d0;
  }

  var s = limpiar(v);
  if (!s) return null;

  // dd/mm/yyyy  o  dd-mm-yyyy  (formato latino, día primero)
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    var dia = parseInt(m[1], 10);
    var mes = parseInt(m[2], 10) - 1;
    var anio = parseInt(m[3], 10);
    if (anio < 100) anio += 2000;
    var d = new Date(anio, mes, dia);
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd (ISO)
  var mi = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mi) {
    var d2 = new Date(parseInt(mi[1], 10), parseInt(mi[2], 10) - 1, parseInt(mi[3], 10));
    return isNaN(d2.getTime()) ? null : d2;
  }

  var d3 = new Date(s);
  return isNaN(d3.getTime()) ? null : d3;
}

/** Fecha sin componente horario (medianoche local). */
function soloFecha(d) {
  if (!(d instanceof Date)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Formatea Date a 'yyyy-MM-dd' (seguro para JSON y comparaciones). */
function fechaISO(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Normaliza CUALQUIER valor de fecha a texto ISO 'yyyy-MM-dd'.
 *  - Si es un Date         -> ISO.
 *  - Si ya es texto ISO    -> se devuelve igual.
 *  - Si es texto dd/mm/yyyy -> se convierte a ISO.
 *  - Si no se puede interpretar -> se devuelve limpio (texto tal cual).
 * Úsese al LEER celdas para que el frontend nunca reciba Date serializados
 * ("Thu Oct 01 2026 ... GMT-0500").
 */
function fechaTexto(v) {
  if (v instanceof Date) return fechaISO(v);
  var s = limpiar(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); // ya es ISO
  var d = aFecha(s);
  return d ? fechaISO(d) : s;
}

/** Diferencia en días completos entre dos fechas (b - a). */
function diasEntre(a, b) {
  var fa = soloFecha(a), fb = soloFecha(b);
  if (!fa || !fb) return null;
  return Math.round((fb.getTime() - fa.getTime()) / 86400000);
}

/**
 * Convierte "HH:mm" o Date-hora a minutos desde medianoche.
 * Devuelve null si no se puede interpretar.
 */
function aMinutosDelDia(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getHours() * 60 + v.getMinutes();
  }
  var s = limpiar(v);
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

/**
 * Normaliza cualquier representación de hora a texto 'HH:mm'.
 * Acepta: 'HH:mm', '8:00', o un Date (del que extrae hora/min).
 * Devuelve '' si no se puede interpretar. El resultado es SIEMPRE texto,
 * para evitar que Sheets lo convierta en una fecha base 1899.
 */
function horaTexto(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Usamos formatDate con la zona del script: es más fiable que getHours()
    // cuando el Date es un valor de solo-hora anclado a 1899 (offsets raros).
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  var s = limpiar(v);
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s; // deja el texto tal cual si no matchea
  var h = parseInt(m[1], 10);
  return (h < 10 ? '0' + h : h) + ':' + m[2];
}

/** Duración en minutos entre hora inicio y final (maneja cruce de medianoche). */
function duracionMin(inicio, fin) {
  var a = aMinutosDelDia(inicio);
  var b = aMinutosDelDia(fin);
  if (a === null || b === null) return null;
  var dif = b - a;
  if (dif < 0) dif += 24 * 60; // cruzó medianoche
  return dif;
}

/** Interpreta respuestas Sí/No de forma tolerante. */
function esSi(v) {
  var k = clave(v);
  return k === 'si' || k === 'sí' || k === 's' || k === 'yes' || k === 'true' || k === 'x';
}

/** Convierte a número de forma segura; null si no es numérico. */
function aNumero(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = limpiar(v).replace(',', '.');
  if (s === '') return null;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Redondea a N decimales. */
function redondear(n, dec) {
  if (n === null || n === undefined || isNaN(n)) return null;
  var f = Math.pow(10, dec || 0);
  return Math.round(n * f) / f;
}

/** Agrupa un array de objetos por el valor de una propiedad (o función). */
function agrupar(arr, por) {
  var fn = typeof por === 'function' ? por : function (x) { return x[por]; };
  var mapa = {};
  arr.forEach(function (item) {
    var k = fn(item);
    if (k === '' || k === null || k === undefined) k = '(sin dato)';
    (mapa[k] = mapa[k] || []).push(item);
  });
  return mapa;
}

/** Valores únicos no vacíos de una columna, ordenados. */
function unicos(arr, prop) {
  var set = {};
  arr.forEach(function (x) {
    var v = limpiar(x[prop]);
    if (v) set[v] = true;
  });
  return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'es'); });
}

/** Construye un índice {header: colIndex} desde una fila de encabezados. */
function indiceEncabezados(headerRow) {
  var idx = {};
  headerRow.forEach(function (h, i) {
    var key = limpiar(h);
    if (key && !(key in idx)) idx[key] = i; // primera ocurrencia gana
  });
  return idx;
}

/** Logger seguro (no rompe si Logger no está disponible). */
function log_(msg) {
  try { Logger.log(msg); } catch (e) {}
}
