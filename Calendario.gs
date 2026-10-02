/**
 * ============================================================
 *  Calendario.gs  —  Integración con Google Calendar (Fase 4)
 * ============================================================
 *  Google Calendar es COMPLEMENTARIO: la fuente de verdad es Sheets
 *  (sección 1). Si Calendar falla o no está autorizado, el resto del
 *  sistema sigue funcionando (degradación limpia).
 *
 *  Reglas (secciones 13, 14, 16):
 *   - Crear evento solo si la sesión tiene Google_Calendar_Activo = Sí.
 *   - NO duplicar: antes de crear se comprueba ID_Calendar.
 *   - Reprogramar -> actualiza el evento existente (no crea otro).
 *   - Cancelar    -> elimina o marca el evento según CONFIG.
 *   - Se guarda ID_Calendar en Sesiones_Ruta.
 * ============================================================
 */

/**
 * Devuelve el CalendarApp del calendario configurado.
 * IMPORTANTE: NO atrapamos el error de permisos aquí. Si falta la
 * autorización de Calendar, el error debe propagarse para que Apps Script
 * muestre el diálogo de autorización (si lo atrapáramos, nunca lo pediría).
 */
function obtenerCalendar() {
  var id = (CONFIG.CALENDARIO && CONFIG.CALENDARIO.CALENDAR_ID) || 'primary';
  return id === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(id);
}

/**
 * Función de AUTORIZACIÓN explícita. Ejecútala UNA vez desde el editor de
 * Apps Script para forzar el diálogo de permisos de Calendar.
 * Hace una llamada mínima que requiere el scope, sin capturar el error.
 */
function autorizarCalendar() {
  var cal = CalendarApp.getDefaultCalendar();
  Logger.log('Calendar autorizado: ' + cal.getName());
  return 'OK: ' + cal.getName();
}

/** ¿La programación/sesión pide sincronización con Calendar? */
function calendarActivoDeSesion(s) {
  // La sesión hereda el flag de su programación. Lo resolvemos consultando
  // la programación origen (Google_Calendar_Activo).
  var prog = cargarProgramaciones().filter(function (p) {
    return p.id === s.idProgramacion;
  })[0];
  return !!(prog && prog.calendarActivo);
}

/**
 * Crea el evento de Calendar para una sesión (si procede) y guarda ID_Calendar.
 * Idempotente: si la sesión ya tiene ID_Calendar, no crea otro.
 * Devuelve el ID_Calendar (nuevo o existente) o '' si no aplica.
 */
function crearEventoSesion(s) {
  if (s.idCalendar) return s.idCalendar;        // ya existe -> no duplicar
  if (!calendarActivoDeSesion(s)) return '';     // la programación no lo pide

  var cal = obtenerCalendar();
  if (!cal) return '';

  var rango = rangoFechaHora(s);
  if (!rango) return '';

  try {
    var evento = cal.createEvent(tituloEvento(s), rango.inicio, rango.fin, {
      description: descripcionEvento(s),
      location: ubicacionEvento(s)
    });
    var idCal = evento.getId();
    actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', s.id, { ID_Calendar: idCal });
    return idCal;
  } catch (e) {
    log_('crearEventoSesion error (' + s.id + '): ' + e);
    return '';
  }
}

/**
 * Actualiza el evento de una sesión (p.ej. tras reprogramar). Si no existe
 * evento pero la programación lo pide, lo crea.
 */
function actualizarEventoSesion(s) {
  if (!s.idCalendar) {
    // No había evento: intenta crearlo si corresponde.
    return crearEventoSesion(s);
  }
  var cal = obtenerCalendar();
  if (!cal) return s.idCalendar;

  try {
    var evento = cal.getEventById(s.idCalendar);
    if (!evento) {
      // El evento fue borrado manualmente: limpiamos ID y recreamos.
      actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', s.id, { ID_Calendar: '' });
      s.idCalendar = '';
      return crearEventoSesion(s);
    }
    var rango = rangoFechaHora(s);
    if (rango) evento.setTime(rango.inicio, rango.fin);
    evento.setTitle(tituloEvento(s));
    evento.setDescription(descripcionEvento(s));
    evento.setLocation(ubicacionEvento(s));
    return s.idCalendar;
  } catch (e) {
    log_('actualizarEventoSesion error (' + s.id + '): ' + e);
    return s.idCalendar;
  }
}

/**
 * Maneja la cancelación del evento (sección 16): elimina o marca según CONFIG.
 */
function cancelarEventoSesion(s) {
  if (!s.idCalendar) return;
  var cal = obtenerCalendar();
  if (!cal) return;
  try {
    var evento = cal.getEventById(s.idCalendar);
    if (!evento) return;

    if (CONFIG.CALENDARIO.AL_CANCELAR === 'eliminar') {
      evento.deleteEvent();
      actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', s.id, { ID_Calendar: '' });
    } else {
      // Marcar conservando trazabilidad.
      var pref = CONFIG.CALENDARIO.PREFIJO_CANCELADA;
      var titulo = evento.getTitle();
      if (titulo.indexOf(pref) !== 0) evento.setTitle(pref + titulo);
    }
  } catch (e) {
    log_('cancelarEventoSesion error (' + s.id + '): ' + e);
  }
}

/**
 * Sincroniza en lote los eventos de todas las sesiones pendientes que tengan
 * Calendar activo y aún no tengan ID_Calendar. Se llama tras generar sesiones
 * y desde el trigger diario. Devuelve { creados }.
 */
function sincronizarCalendario() {
  var creados = 0;
  var hoyISO = fechaISO(soloFecha(new Date()));
  cargarSesiones().forEach(function (s) {
    if (s.idCalendar) return;
    if (s.estado === 'Cancelada' || s.estado === 'Completada') return;
    if (s.fecha < hoyISO) return;                 // no crear eventos en el pasado
    var id = crearEventoSesion(s);
    if (id) creados++;
  });
  return { creados: creados };
}

// ---- Helpers de construcción del evento --------------------------------

/** Título: "5S — R01 Orden y Organización — Módulo 2" (sección 13). */
function tituloEvento(s) {
  return '5S — ' + s.ruta + ' ' + s.nombreRuta + (s.modulo ? ' — ' + s.modulo : '');
}

/** Descripción con toda la trazabilidad (sección 13). */
function descripcionEvento(s) {
  return [
    'ID sesión: ' + s.id,
    'ID programación: ' + s.idProgramacion,
    'Ruta: ' + s.ruta + ' ' + s.nombreRuta,
    'Área: ' + (s.area || '—'),
    'Módulo: ' + (s.modulo || '—'),
    'Responsable: ' + (s.responsable || '—'),
    'Duración estimada: ' + (duracionMin(s.horaInicioProg, s.horaFinProg) || CONFIG.CALENDARIO.DURACION_DEFECTO_MIN) + ' min'
  ].join('\n');
}

function ubicacionEvento(s) {
  return [s.area, s.modulo].filter(function (x) { return x; }).join(' · ');
}

/**
 * Calcula el rango Date de inicio/fin del evento a partir de la fecha y hora
 * programadas de la sesión. Si no hay hora, usa un evento de día completo
 * (devuelve null para que el llamador decida; aquí usamos 08:00 por defecto).
 */
function rangoFechaHora(s) {
  var f = aFecha(s.fecha);
  if (!f) return null;
  var ini = aMinutosDelDia(s.horaInicioProg);
  if (ini === null) ini = 8 * 60; // 08:00 por defecto si falta la hora

  var durNombre = duracionMin(s.horaInicioProg, s.horaFinProg);
  var dur = durNombre || CONFIG.CALENDARIO.DURACION_DEFECTO_MIN;

  var inicio = new Date(f.getFullYear(), f.getMonth(), f.getDate(),
    Math.floor(ini / 60), ini % 60, 0);
  var fin = new Date(inicio.getTime() + dur * 60000);
  return { inicio: inicio, fin: fin };
}
