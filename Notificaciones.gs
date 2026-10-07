/**
 * ============================================================
 *  Notificaciones.gs  —  Avisos por correo (Fase 6)
 * ============================================================
 *  Envía recordatorios y alertas por Gmail (MailApp). Se dispara desde el
 *  trigger diario (tareasDiarias). Es OPCIONAL y degradable:
 *   - Si CONFIG.NOTIF.ACTIVO = false, no hace nada.
 *   - Si falla el envío, se registra y el resto del sistema no se afecta.
 *
 *  Usa el correo del responsable guardado en el catálogo maestro / sesiones.
 *  Agrupa por destinatario (un correo consolidado por persona, no uno por ítem)
 *  y respeta un tope de correos por ejecución (cuota de Gmail).
 * ============================================================
 */

/**
 * Punto de entrada: procesa y envía todas las notificaciones del día.
 * Devuelve un resumen { enviados, destinatarios, detalle }.
 */
function enviarNotificaciones() {
  var cfg = CONFIG.NOTIF || {};
  if (!cfg.ACTIVO) return { enviados: 0, motivo: 'Notificaciones desactivadas (CONFIG.NOTIF.ACTIVO=false).' };

  var hoyISO = fechaISO(soloFecha(new Date()));
  var sesiones = cargarSesiones();
  var hallazgos = cargarHallazgos();

  // Mapa responsable(normalizado) -> correo, desde el catálogo maestro.
  var correos = mapaCorreosResponsables();

  // Acumulador por destinatario: { correo: { nombre, rutasHoy:[], vencidas:[], acciones:[] } }
  var buzones = {};
  var añadir = function (correo, nombre, categoria, item) {
    if (!correo) return;
    if (!buzones[correo]) buzones[correo] = { nombre: nombre || '', rutasHoy: [], vencidas: [], acciones: [] };
    buzones[correo][categoria].push(item);
  };

  // 1) Recordatorio de rutas de HOY (sesiones programadas para hoy).
  if (cfg.ENVIAR.recordatorioRutasHoy) {
    sesiones.filter(function (s) {
      return s.fecha === hoyISO &&
        (s.estado === 'Programada' || s.estado === 'Pendiente' || s.estado === 'Reprogramada');
    }).forEach(function (s) {
      var correo = s.correoResponsable || correos[clave(s.responsable)] || '';
      añadir(correo, s.responsable, 'rutasHoy', s);
    });
  }

  // 2) Sesiones VENCIDAS (no ejecutadas, fecha pasada).
  if (cfg.ENVIAR.sesionesVencidas) {
    sesiones.filter(function (s) { return s.estado === 'Vencida'; }).forEach(function (s) {
      var correo = s.correoResponsable || correos[clave(s.responsable)] || '';
      añadir(correo, s.responsable, 'vencidas', s);
    });
  }

  // 3) Hallazgos/acciones VENCIDOS (no cerrados y fecha límite pasada).
  if (cfg.ENVIAR.accionesVencidas) {
    hallazgos.filter(function (h) { return h.vencido; }).forEach(function (h) {
      var correo = correos[clave(h.responsableAccion)] || '';
      añadir(correo, h.responsableAccion, 'acciones', h);
    });
  }

  // Enviar correos individuales por destinatario (consolidado).
  var enviados = 0, destinatarios = 0;
  var tope = cfg.MAX_CORREOS_POR_EJECUCION || 50;
  Object.keys(buzones).forEach(function (correo) {
    if (enviados >= tope) return;
    var b = buzones[correo];
    if (!b.rutasHoy.length && !b.vencidas.length && !b.acciones.length) return;
    try {
      MailApp.sendEmail({
        to: correo,
        name: cfg.NOMBRE_REMITENTE || 'Sistema 5S',
        subject: asuntoResponsable(b),
        htmlBody: cuerpoResponsable(b)
      });
      enviados++; destinatarios++;
    } catch (e) {
      log_('enviarNotificaciones (a ' + correo + '): ' + e);
    }
  });

  // 4) Resumen diario al supervisor.
  if (cfg.ENVIAR.resumenDiarioSupervisor && cfg.CORREO_SUPERVISOR && enviados < tope) {
    try {
      MailApp.sendEmail({
        to: cfg.CORREO_SUPERVISOR,
        name: cfg.NOMBRE_REMITENTE || 'Sistema 5S',
        subject: 'Resumen diario 5S · ' + fFechaBackend(hoyISO),
        htmlBody: cuerpoResumen(sesiones, hallazgos, hoyISO)
      });
      enviados++;
    } catch (e) {
      log_('enviarNotificaciones (supervisor): ' + e);
    }
  }

  return { enviados: enviados, destinatarios: destinatarios };
}

// ---- Construcción de correos -------------------------------------------

function asuntoResponsable(b) {
  var partes = [];
  if (b.rutasHoy.length) partes.push(b.rutasHoy.length + ' ruta(s) hoy');
  if (b.vencidas.length) partes.push(b.vencidas.length + ' vencida(s)');
  if (b.acciones.length) partes.push(b.acciones.length + ' acción(es) vencida(s)');
  return '5S · ' + partes.join(' · ');
}

function cuerpoResponsable(b) {
  var h = '<div style="font-family:Arial,sans-serif;color:#222">';
  h += '<h2 style="color:#1565c0">Hola ' + (b.nombre || '') + '</h2>';

  if (b.rutasHoy.length) {
    h += '<h3>🗓️ Rutas programadas para hoy</h3><ul>';
    b.rutasHoy.forEach(function (s) {
      h += '<li><b>' + s.horaInicioProg + '</b> — ' + s.ruta + ' ' + s.nombreRuta +
        ' · ' + (s.modulo || '') + '</li>';
    });
    h += '</ul>';
  }
  if (b.vencidas.length) {
    h += '<h3 style="color:#c62828">⚠️ Sesiones vencidas (sin ejecutar)</h3><ul>';
    b.vencidas.forEach(function (s) {
      h += '<li>' + fFechaBackend(s.fecha) + ' — ' + s.ruta + ' · ' + (s.modulo || '') + '</li>';
    });
    h += '</ul>';
  }
  if (b.acciones.length) {
    h += '<h3 style="color:#c62828">⏰ Hallazgos con acción vencida</h3><ul>';
    b.acciones.forEach(function (hh) {
      h += '<li><b>' + hh.idHallazgo + '</b> — ' + (hh.descripcion || '') +
        ' · límite ' + fFechaBackend(hh.fechaLimite) + '</li>';
    });
    h += '</ul>';
  }
  h += '<p style="color:#888;font-size:12px;margin-top:18px">Mensaje automático del Sistema de Gestión 5S.</p></div>';
  return h;
}

function cuerpoResumen(sesiones, hallazgos, hoyISO) {
  var hoy = sesiones.filter(function (s) { return s.fecha === hoyISO; }).length;
  var vencidasS = sesiones.filter(function (s) { return s.estado === 'Vencida'; }).length;
  var completadas = sesiones.filter(function (s) { return s.estado === 'Completada'; }).length;
  var hallVenc = hallazgos.filter(function (h) { return h.vencido; }).length;
  var hallAbiertos = hallazgos.filter(function (h) {
    return CONFIG.HALLAZGO_CFG.ESTADOS_CERRADOS.indexOf(h.estadoGestion) === -1;
  }).length;

  return '<div style="font-family:Arial,sans-serif;color:#222">' +
    '<h2 style="color:#1565c0">Resumen diario 5S · ' + fFechaBackend(hoyISO) + '</h2>' +
    '<ul>' +
    '<li>Sesiones programadas hoy: <b>' + hoy + '</b></li>' +
    '<li>Sesiones vencidas: <b style="color:#c62828">' + vencidasS + '</b></li>' +
    '<li>Sesiones completadas (histórico): <b>' + completadas + '</b></li>' +
    '<li>Hallazgos abiertos: <b>' + hallAbiertos + '</b></li>' +
    '<li>Hallazgos vencidos: <b style="color:#c62828">' + hallVenc + '</b></li>' +
    '</ul>' +
    '<p style="color:#888;font-size:12px">Mensaje automático del Sistema de Gestión 5S.</p></div>';
}

// ---- Helpers -----------------------------------------------------------

/** Mapa { clave(nombreResponsable): correo } desde el catálogo maestro. */
function mapaCorreosResponsables() {
  var mapa = {};
  try {
    cargarCatalogosMaestros().forEach(function (c) {
      if (c.tipo === 'Responsable' && c.correo) mapa[clave(c.valor)] = c.correo;
    });
  } catch (e) { log_('mapaCorreosResponsables: ' + e); }
  return mapa;
}

/** Formatea una fecha ISO a dd/MM/yyyy en el backend (para los correos). */
function fFechaBackend(iso) {
  var s = limpiar(iso);
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
}

/**
 * Prueba manual: envía las notificaciones del día ignorando el interruptor,
 * para validar la configuración. Ejecutar desde el editor.
 */
function probarNotificaciones() {
  var cfg = CONFIG.NOTIF;
  var previo = cfg.ACTIVO;
  cfg.ACTIVO = true;
  var r = enviarNotificaciones();
  cfg.ACTIVO = previo;
  log_('probarNotificaciones: ' + JSON.stringify(r));
  return r;
}
