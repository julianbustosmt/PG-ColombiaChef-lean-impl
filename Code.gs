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
  // Prueba 1: página mínima con un script trivial. Si ESTE script se ejecuta
  // (ves "script OK"), entonces los <script> SÍ corren en tu Web App y el
  // problema está en el contenido grande. Si NO ("script NO ejecutó"), el
  // problema es de autorización/entorno (los scripts no corren).
  // Ensamblamos el documento con createHtmlOutput (NO con template.evaluate()).
  // Motivo: el evaluador de plantillas de HtmlService, con un documento grande,
  // corrompía el JS al reescribirlo ("Document.write: Unexpected identifier
  // 'style'"). createHtmlOutput NO reescribe de esa forma — es el método que
  // funcionó en todas las pruebas de diagnóstico (?parte=cssjs).
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent();

  // Resolvemos manualmente los scriptlets del Index:
  html = html
    .replace(/<\?= appTitle \?>/g, escaparHtml(CONFIG.APP_TITLE))
    .replace(/<\?= appSubtitle \?>/g, escaparHtml(CONFIG.APP_SUBTITLE))
    .replace(/<\?= version \?>/g, escaparHtml(CONFIG.VERSION))
    .replace(/<\?!= include\('CSS'\); \?>/g, HtmlService.createHtmlOutputFromFile('CSS').getContent())
    .replace(/<\?!= include\('JS'\); \?>/g, HtmlService.createHtmlOutputFromFile('JS').getContent());

  return HtmlService.createHtmlOutput(html)
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Escapa texto para insertarlo de forma segura en HTML. */
function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ping para el modo diagnóstico: confirma que el backend responde. */
function pingBackend() {
  return 'ok ' + (CONFIG && CONFIG.VERSION ? 'v' + CONFIG.VERSION : '');
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
    .addItem('Probar notificaciones (correo)', 'probarNotificaciones')
    .addItem('Diagnosticar notificaciones', 'diagnosticarNotificaciones')
    .addItem('Enviar correo de prueba (a mí)', 'enviarCorreoDePrueba')
    .addItem('Autorizar Google Drive', 'autorizarDrive')
    .addItem('Diagnosticar carpeta de Drive', 'diagnosticarDrive')
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
