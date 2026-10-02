/**
 * ============================================================
 *  Code.gs  —  Punto de entrada de la Web App
 * ============================================================
 *  doGet() sirve el SPA. include() permite modularizar HTML/CSS/JS.
 *  También expone utilidades de mantenimiento invocables desde el
 *  editor de Apps Script.
 * ============================================================
 */

/** Sirve la aplicación web (SPA). */
function doGet(e) {
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appTitle = CONFIG.APP_TITLE;
  tpl.appSubtitle = CONFIG.APP_SUBTITLE;
  tpl.version = CONFIG.VERSION;

  return tpl.evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Incluye el contenido de otro archivo HTML (CSS.html, JS.html). */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/**
 * Menú de utilidades en el Spreadsheet (facilita operación).
 * Se ejecuta al abrir la hoja.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Gestión 5S')
    .addItem('Reconstruir tablas (ETL)', 'reconstruirTodo')
    .addItem('Instalar triggers', 'instalarTriggers')
    .addSeparator()
    .addItem('Generar sesiones programadas', 'generarSesionesProgramadas')
    .addItem('Actualizar estados de sesiones', 'actualizarEstadosSesiones')
    .addItem('Autorizar Google Calendar', 'autorizarCalendar')
    .addItem('Sincronizar Google Calendar', 'sincronizarCalendario')
    .addItem('Crear/sembrar catálogos maestros', 'asegurarCatalogosMaestros')
    .addItem('Sincronizar Form con catálogos', 'sincronizarFormConCatalogo')
    .addSeparator()
    .addItem('Limpiar caché', 'cacheLimpiar')
    .addToUi();
}

/**
 * Devuelve metadatos de la app para el frontend (título, versión,
 * y un diagnóstico rápido de si existen las tablas normalizadas).
 */
function obtenerMeta() {
  var ss = ssActiva();
  var tiene = function (n) {
    var sh = ss.getSheetByName(n);
    return !!(sh && sh.getLastRow() > 1);
  };
  return {
    titulo: CONFIG.APP_TITLE,
    subtitulo: CONFIG.APP_SUBTITLE,
    version: CONFIG.VERSION,
    datosListos: tiene(CONFIG.HOJAS.DETALLE_INSPECCIONES),
    rutas: CONFIG.RUTAS
  };
}
