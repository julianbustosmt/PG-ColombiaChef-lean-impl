/**
 * ============================================================
 *  Sesiones.gs  —  Sesiones de ruta (ejecuciones concretas)
 * ============================================================
 *  Una SESIÓN es una ejecución concreta derivada de una PROGRAMACIÓN
 *  ("R01 el 07/10/2026 a las 08:00").
 *
 *  Responsabilidades:
 *   - generarSesionesProgramadas(): crea sesiones futuras SIN duplicar.
 *   - actualizarEstadosSesiones(): Programada -> Vencida cuando aplica.
 *   - iniciar / finalizar / reprogramar / cancelar (Fases 2-3).
 *
 *  Hoja Sesiones_Ruta = FUENTE DE VERDAD editable: append/update puntual,
 *  nunca escribirHoja().
 * ============================================================
 */

/** Encabezados canónicos de Sesiones_Ruta. */
function headersSesiones() {
  return ['ID_Sesion', 'ID_Programacion', 'Fecha', 'Hora_Inicio_Programada',
    'Hora_Fin_Programada', 'Ruta', 'Nombre_Ruta', 'Area', 'Modulo', 'Responsable',
    'Correo_Responsable', 'Estado', 'ID_Inspeccion', 'Fecha_Ejecucion',
    'Hora_Inicio_Real', 'Hora_Fin_Real', 'Duracion_Real', 'ID_Calendar',
    'Observaciones', 'Fecha_Creacion', 'Fecha_Original', 'Motivo_Cambio',
    'Usuario_Cambio'];
}

/** Columnas que deben guardarse como TEXTO (horas y fechas). */
function columnasTextoSesiones() {
  return ['Fecha', 'Hora_Inicio_Programada', 'Hora_Fin_Programada',
    'Fecha_Ejecucion', 'Hora_Inicio_Real', 'Hora_Fin_Real', 'Fecha_Creacion',
    'Fecha_Original'];
}

function asegurarHojaSesiones() {
  return asegurarHoja(CONFIG.HOJAS.SESIONES, headersSesiones(), columnasTextoSesiones());
}

/**
 * Genera las sesiones de las programaciones ACTIVAS para los próximos
 * CONFIG.PROGRAMACION_CFG.HORIZONTE_DIAS días. Idempotente: no crea una
 * sesión si ya existe otra con misma (ID_Programacion + Fecha + Hora).
 *
 * Devuelve { creadas: n }.
 */
function generarSesionesProgramadas(horizonteDias) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { creadas: 0, error: 'ocupado' };
  try {
    asegurarHojaSesiones();
    var horizonte = horizonteDias || CONFIG.PROGRAMACION_CFG.HORIZONTE_DIAS;
    var desde = soloFecha(new Date());
    var hasta = new Date(desde.getTime() + horizonte * 86400000);

    var progs = cargarProgramaciones().filter(function (p) { return p.estado === 'Activa'; });

    // Índice de sesiones existentes para control de duplicados.
    var existentes = indiceSesionesExistentes();

    var nuevas = [];
    progs.forEach(function (prog) {
      var fechas = fechasDeProgramacion(prog, desde, hasta);
      fechas.forEach(function (f) {
        var fISO = fechaISO(f);
        var clv = prog.id + '|' + fISO + '|' + (prog.hora || '');
        if (existentes[clv]) return; // ya existe -> no duplicar
        existentes[clv] = true;

        var id = siguienteIdSesion(nuevas.length);
        nuevas.push({
          ID_Sesion: id,
          ID_Programacion: prog.id,
          Fecha: fISO,
          Hora_Inicio_Programada: horaTexto(prog.hora),
          Hora_Fin_Programada: calcularHoraFin(prog.hora, prog.duracion),
          Ruta: prog.ruta,
          Nombre_Ruta: prog.nombreRuta,
          Area: prog.area,
          Modulo: prog.modulo,
          Responsable: prog.responsable,
          Correo_Responsable: prog.correoResponsable || '',
          Estado: 'Programada',
          ID_Inspeccion: '',
          Fecha_Ejecucion: '',
          Hora_Inicio_Real: '',
          Hora_Fin_Real: '',
          Duracion_Real: '',
          ID_Calendar: '',
          Observaciones: '',
          Fecha_Creacion: fechaISO(new Date()),
          Fecha_Original: '',
          Motivo_Cambio: '',
          Usuario_Cambio: ''
        });
      });
    });

    // Escritura por lotes (append en bloque = rápido).
    if (nuevas.length) escribirSesionesEnLote(nuevas);
    cacheLimpiar();

    // Fase 4: crear eventos de Calendar para las sesiones con sincronización
    // activa (degradable: si Calendar falla, no afecta la generación).
    if (nuevas.length) {
      try { sincronizarCalendario(); } catch (e) { log_('sync calendar tras generar: ' + e); }
    }
    return { creadas: nuevas.length };
  } catch (e) {
    log_('generarSesionesProgramadas error: ' + e);
    return { creadas: 0, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/** Mapa { 'PRG|fecha|hora': true } de todas las sesiones ya existentes. */
function indiceSesionesExistentes() {
  var idx = {};
  cargarSesiones().forEach(function (s) {
    idx[s.idProgramacion + '|' + s.fecha + '|' + s.horaInicioProg] = true;
  });
  return idx;
}

/** Siguiente ID de sesión considerando también las que están por insertarse. */
function siguienteIdSesion(offset) {
  var base = siguienteId('SES', CONFIG.HOJAS.SESIONES, 'ID_Sesion');
  var n = parseInt(base.split('-')[1], 10) + (offset || 0);
  return formatearId('SES', n);
}

/** Añade varias sesiones de una vez al final de la hoja. */
function escribirSesionesEnLote(nuevas) {
  var sh = asegurarHojaSesiones();
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
  var matriz = nuevas.map(function (obj) {
    return cab.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, matriz.length, cab.length).setValues(matriz);
}

/** Suma duración (min) a una hora 'HH:mm' -> 'HH:mm'. '' si no hay datos. */
function calcularHoraFin(hora, duracionMin) {
  var m = aMinutosDelDia(hora);
  if (m === null || !duracionMin) return '';
  var total = (m + Number(duracionMin)) % (24 * 60);
  var hh = Math.floor(total / 60), mm = total % 60;
  return (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm);
}

// ---- Estados automáticos (sección 17) ---------------------------------

/**
 * Recorre las sesiones y marca como 'Vencida' las que estaban 'Programada'
 * o 'Pendiente' y cuya fecha ya pasó (a partir del día siguiente, según la
 * decisión del usuario). No toca Completada/Cancelada/En curso/Reprogramada.
 *
 * Definición:
 *   Programada : fecha de la sesión >= hoy.
 *   Vencida    : fecha de la sesión < hoy (ya pasó el día) sin ejecución.
 */
function actualizarEstadosSesiones() {
  var sh = ssActiva().getSheetByName(CONFIG.HOJAS.SESIONES);
  if (!sh || sh.getLastRow() < 2) return { actualizadas: 0 };
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(limpiar);
  var cFecha = cab.indexOf('Fecha');
  var cEstado = cab.indexOf('Estado');
  if (cFecha < 0 || cEstado < 0) return { actualizadas: 0 };

  var hoy = soloFecha(new Date());
  var datos = sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).getValues();
  var cambios = 0;

  for (var r = 0; r < datos.length; r++) {
    var estado = limpiar(datos[r][cEstado]);
    if (estado !== 'Programada' && estado !== 'Pendiente') continue;
    var f = aFecha(datos[r][cFecha]);
    if (f && soloFecha(f) < hoy) {
      sh.getRange(r + 2, cEstado + 1).setValue('Vencida');
      cambios++;
    }
  }
  if (cambios) cacheLimpiar();
  return { actualizadas: cambios };
}

// ---- Carga / filtrado --------------------------------------------------

/** Carga todas las sesiones como objetos tipados. */
function cargarSesiones() {
  return leerHojaObjetos(CONFIG.HOJAS.SESIONES).map(function (o) {
    return {
      id: limpiar(o['ID_Sesion']),
      idProgramacion: limpiar(o['ID_Programacion']),
      fecha: limpiar(o['Fecha']),
      horaInicioProg: horaTexto(o['Hora_Inicio_Programada']),
      horaFinProg: horaTexto(o['Hora_Fin_Programada']),
      ruta: limpiar(o['Ruta']),
      nombreRuta: limpiar(o['Nombre_Ruta']),
      area: limpiar(o['Area']),
      modulo: limpiar(o['Modulo']),
      responsable: limpiar(o['Responsable']),
      correoResponsable: limpiar(o['Correo_Responsable']),
      estado: limpiar(o['Estado']),
      idInspeccion: limpiar(o['ID_Inspeccion']),
      fechaEjecucion: limpiar(o['Fecha_Ejecucion']),
      horaInicioReal: limpiar(o['Hora_Inicio_Real']),
      horaFinReal: limpiar(o['Hora_Fin_Real']),
      duracionReal: aNumero(o['Duracion_Real']),
      idCalendar: limpiar(o['ID_Calendar']),
      observaciones: limpiar(o['Observaciones'])
    };
  }).filter(function (s) { return s.id; });
}

/** Filtra sesiones por los filtros globales + propios del calendario. */
function filtrarSesiones(items, filtros) {
  filtros = filtros || {};
  return items.filter(function (s) {
    return pasaFecha(s.fecha, filtros) &&
      pasaIgual(s.area, filtros.area) &&
      pasaIgual(s.modulo, filtros.modulo) &&
      pasaIgual(s.responsable, filtros.responsable) &&
      pasaIgual(s.estado, filtros.estado) &&
      // Soporta sesiones multi-ruta ('R01, R02'): coincide si contiene la ruta.
      (!filtros.ruta || clave(s.ruta).indexOf(clave(filtros.ruta)) !== -1);
  });
}
