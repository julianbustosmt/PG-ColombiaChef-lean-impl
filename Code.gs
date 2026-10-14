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
  // --- MODO DIAGNÓSTICO: abre la URL con ?test=1 para una página mínima.
  // Si ?test=1 CARGA pero la app normal NO, el problema está en el contenido
  // (Index/CSS/JS). Si ?test=1 TAMPOCO carga, el problema es despliegue/permisos.
  if (e && e.parameter && e.parameter.test === '1') {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">' +
      '<h2>✅ Prueba OK</h2><p>La Web App sirve HTML correctamente.</p>' +
      '<p id="r">Probando backend…</p>' +
      '<script>google.script.run.withSuccessHandler(function(v){' +
      'document.getElementById("r").textContent="Backend OK: "+v;})' +
      '.withFailureHandler(function(err){' +
      'document.getElementById("r").textContent="Backend ERROR: "+err;})' +
      '.pingBackend();</script>' +
      '</body></html>'
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Diagnóstico por partes: sirve SOLO el contenido indicado para aislar
  // cuál archivo rompe el sanitizador.  ?parte=css | js | cssjs | cdn
  if (e && e.parameter && e.parameter.parte) {
    var cual = e.parameter.parte;
    var cuerpo = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    // 'cdn' añade los scripts externos de Chart.js en el head (como la app real).
    if (cual === 'cdn' || cual === 'cssjs') {
      cuerpo += '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></scr' + 'ipt>';
      cuerpo += '<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@2.0.1/dist/chartjs-chart-matrix.min.js"></scr' + 'ipt>';
    }
    cuerpo += '</head><body>';
    cuerpo += '<h2>Diagnóstico: ' + cual + '</h2>';
    try {
      if (cual === 'css') cuerpo += include('CSS');
      else if (cual === 'js') cuerpo += include('JS');
      else if (cual === 'cssjs' || cual === 'cdn') { cuerpo += include('CSS'); cuerpo += include('JS'); }
      cuerpo += '<p>Si ves esto, "' + cual + '" NO rompe el sanitizador.</p>';
    } catch (err) {
      cuerpo += '<p>Error al incluir ' + cual + ': ' + err + '</p>';
    }
    cuerpo += '</body></html>';
    return HtmlService.createHtmlOutput(cuerpo)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appTitle = CONFIG.APP_TITLE;
  tpl.appSubtitle = CONFIG.APP_SUBTITLE;
  tpl.version = CONFIG.VERSION;
  // Diagnóstico: ?parte=soloindex sirve el Index SIN incluir CSS/JS, para
  // aislar si el markup del Index (por template) rompe el sanitizador.
  tpl.diagSoloIndex = !!(e && e.parameter && e.parameter.parte === 'soloindex');
  // ?parte=sinjs: Index + CSS pero SIN el JS (para ver si la combinación
  // Index+CSS por template está bien y el problema es sumar el JS).
  tpl.diagSinJS = !!(e && e.parameter && e.parameter.parte === 'sinjs');

  return tpl.evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
