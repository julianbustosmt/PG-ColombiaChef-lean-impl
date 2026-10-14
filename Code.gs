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
  // Sello de versión para confirmar que /exec sirve el código ACTUAL.
  // Abre la URL con ?v=check -> debe mostrar "SELLO-34e89c3-OK".
  if (e && e.parameter && e.parameter.v === 'check') {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;font-size:20px">' +
      'SELLO-34e89c3-OK<br>Si ves esto, /exec SÍ tiene el código actual.' +
      '</body></html>'
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Composición estándar de Apps Script (misma que la versión funcional):
  // el Index es una plantilla que incluye CSS y JS con <?!= include() ?>.
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appTitle = CONFIG.APP_TITLE;
  tpl.appSubtitle = CONFIG.APP_SUBTITLE;
  tpl.version = CONFIG.VERSION;

  return tpl.evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * AUTORIZACIÓN TOTAL. Ejecutar desde el menú (o el editor) UNA vez para que
 * Google solicite TODOS los permisos que la app necesita, de golpe.
 * Toca cada servicio para forzar su scope. NO lleva try/catch: si falta un
 * permiso, el error se propaga y Apps Script muestra la pantalla de
 * autorización con todos los scopes pendientes.
 */
function autorizarTodo() {
  var reporte = [];

  // Sheets (spreadsheets.currentonly)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  reporte.push('Sheets: ' + ss.getName());

  // Drive
  var raiz = DriveApp.getRootFolder();
  reporte.push('Drive: ' + raiz.getName());

  // Calendar
  var cal = CalendarApp.getDefaultCalendar();
  reporte.push('Calendar: ' + cal.getName());

  // Gmail / envío de correo (cuota)
  reporte.push('Mail cuota: ' + MailApp.getRemainingDailyQuota());

  // Forms (abre el form configurado si existe)
  try {
    if (CONFIG.FORM_INSPECCION && CONFIG.FORM_INSPECCION.FORM_ID) {
      var f = FormApp.openById(CONFIG.FORM_INSPECCION.FORM_ID);
      reporte.push('Form: ' + f.getTitle());
    }
  } catch (e) { reporte.push('Form: (revisar ID) ' + e); }

  // Identidad / email
  reporte.push('Usuario: ' + Session.getActiveUser().getEmail());

  // Properties
  PropertiesService.getScriptProperties().getProperty('x');
  reporte.push('Properties: OK');

  var msg = 'Permisos verificados:\n\n' + reporte.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('✅ Autorización completa', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
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
    .addItem('✅ Autorizar TODOS los permisos', 'autorizarTodo')
    .addSeparator()
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
