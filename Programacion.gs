/**
 * ============================================================
 *  Programacion.gs  —  Módulo Programación de Rutas 5S (Fase 1)
 * ============================================================
 *  CRUD de PROGRAMACIONES (la REGLA de periodicidad) + utilidades
 *  de recurrencia que calculan las fechas de ejecución.
 *
 *  Principio (secciones 1 y 4 del requerimiento):
 *   - Una PROGRAMACIÓN es una regla ("R01 cada Lun/Mié/Vie 08:00").
 *   - NO se crea una fila por cada ejecución; eso son las SESIONES.
 *   - La hoja Programacion_Rutas es FUENTE DE VERDAD editable: se usa
 *     append/update puntual, nunca escribirHoja() (que borraría datos).
 * ============================================================
 */

/** Encabezados canónicos de la hoja Programacion_Rutas. */
function headersProgramacion() {
  return ['ID_Programacion', 'Estado', 'Ruta', 'Nombre_Ruta', 'Area', 'Modulo',
    'Responsable', 'Correo_Responsable', 'Tipo_Programacion', 'Frecuencia',
    'Dias_Semana', 'Dia_Mes', 'Hora_Inicio', 'Duracion_Estimada', 'Fecha_Inicio',
    'Fecha_Fin', 'Observaciones', 'Fecha_Creacion', 'Usuario_Creador',
    'Google_Calendar_Activo'];
}

/** Columnas que deben guardarse como TEXTO (evita conversión a Date/hora 1899). */
function columnasTextoProgramacion() {
  return ['Hora_Inicio', 'Fecha_Inicio', 'Fecha_Fin', 'Fecha_Creacion'];
}

/** Garantiza que la hoja exista con su cabecera y formatos de texto. */
function asegurarHojaProgramacion() {
  return asegurarHoja(CONFIG.HOJAS.PROGRAMACION, headersProgramacion(),
    columnasTextoProgramacion());
}

/**
 * Crea una o varias programaciones.
 *
 * Si `datos.rutas` trae varias rutas, se crea UNA PROGRAMACIÓN POR RUTA
 * (sección 6: medir cumplimiento individual por ruta).
 *
 * datos: {
 *   rutas: ['R01','R02'],  // una o varias
 *   area, modulo, responsable,
 *   tipo,                  // 'Una vez' | 'Diaria' | 'Semanal' | 'Mensual'
 *   diasSemana: ['Lunes','Miércoles'],  // para Semanal
 *   diaMes: 15,                          // para Mensual
 *   hora: '08:00',
 *   duracion: 15,
 *   fechaInicio: 'yyyy-MM-dd',
 *   fechaFin: 'yyyy-MM-dd',
 *   observaciones, calendarActivo (bool)
 * }
 * Devuelve { ok, ids:[...], sesionesCreadas }
 */
function crearProgramacion(datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Sistema ocupado, reintenta.' };
  try {
    asegurarHojaProgramacion();
    var rutas = (datos.rutas && datos.rutas.length) ? datos.rutas : [datos.ruta];
    rutas = rutas.filter(function (r) { return !!r; });
    if (!rutas.length) return { ok: false, error: 'Debes seleccionar al menos una ruta.' };

    var tipo = datos.tipo || 'Una vez';
    if (!CONFIG.PROGRAMACION_CFG.TIPOS[tipo] || !CONFIG.PROGRAMACION_CFG.TIPOS[tipo].activo) {
      return { ok: false, error: 'Tipo de programación no soportado aún: ' + tipo };
    }

    var usuario = (Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || 'web';
    var hoy = fechaISO(new Date());
    var frecuencia = frecuenciaTexto(datos);
    var dias = (datos.diasSemana || []).join(', ');
    // Correo del responsable desde el catálogo maestro (para notificaciones).
    var correoResp = correoDeResponsable(datos.responsable);
    var ids = [];

    // Si agruparRutas = true, una SOLA programación recorre varias rutas en una
    // misma sesión (sección 12). Si no, se crea una programación por ruta
    // (comportamiento por defecto, para medir cumplimiento individual).
    var grupos = datos.agruparRutas ? [rutas] : rutas.map(function (r) { return [r]; });

    grupos.forEach(function (grupo) {
      var id = siguienteId('PRG', CONFIG.HOJAS.PROGRAMACION, 'ID_Programacion');
      id = asegurarIdUnicoPRG(id, ids);
      ids.push(id);

      var codigoRuta = grupo.join(', ');                 // 'R01' o 'R01, R02, R04'
      var nombreRuta = grupo.map(function (r) {
        return CONFIG.RUTAS[r] || r;
      }).join(' + ');

      appendFila(CONFIG.HOJAS.PROGRAMACION, headersProgramacion(), {
        ID_Programacion: id,
        Estado: 'Activa',
        Ruta: codigoRuta,
        Nombre_Ruta: nombreRuta,
        Area: limpiar(datos.area),
        Modulo: limpiar(datos.modulo),
        Responsable: limpiar(datos.responsable),
        Correo_Responsable: correoResp,
        Tipo_Programacion: tipo,
        Frecuencia: frecuencia,
        Dias_Semana: dias,
        Dia_Mes: datos.diaMes || '',
        Hora_Inicio: horaTexto(datos.hora),
        Duracion_Estimada: datos.duracion || '',
        Fecha_Inicio: datos.fechaInicio || hoy,
        Fecha_Fin: datos.fechaFin || '',
        Observaciones: limpiar(datos.observaciones),
        Fecha_Creacion: hoy,
        Usuario_Creador: usuario,
        Google_Calendar_Activo: datos.calendarActivo ? 'Sí' : 'No'
      });
    });

    // Generar las primeras sesiones inmediatamente (sección 7).
    var res = generarSesionesProgramadas();
    cacheLimpiar();
    return { ok: true, ids: ids, sesionesCreadas: res.creadas };
  } catch (e) {
    log_('crearProgramacion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/** Evita colisión de IDs PRG cuando se crean varias en el mismo lote. */
function asegurarIdUnicoPRG(id, yaUsados) {
  var n = parseInt(id.split('-')[1], 10);
  while (yaUsados.indexOf(formatearId('PRG', n)) !== -1) n++;
  return formatearId('PRG', n);
}

/** Texto legible de frecuencia a partir del tipo. */
function frecuenciaTexto(datos) {
  switch (datos.tipo) {
    case 'Diaria': return 'Diaria';
    case 'Semanal': return 'Semanal';
    case 'Mensual': return 'Mensual';
    case 'Una vez': return 'Única';
    default: return datos.tipo || '';
  }
}

/** Cambia el estado de una programación (Activa/Pausada/Finalizada). */
function cambiarEstadoProgramacion(idProgramacion, nuevoEstado) {
  if (CONFIG.PROGRAMACION_CFG.ESTADOS_PROGRAMACION.indexOf(nuevoEstado) === -1) {
    return { ok: false, error: 'Estado inválido.' };
  }
  var ok = actualizarFilaPorId(CONFIG.HOJAS.PROGRAMACION, 'ID_Programacion',
    idProgramacion, { Estado: nuevoEstado });
  cacheLimpiar();
  return { ok: ok };
}

/** Carga todas las programaciones como objetos tipados. */
function cargarProgramaciones() {
  return leerHojaObjetos(CONFIG.HOJAS.PROGRAMACION).map(function (o) {
    return {
      id: limpiar(o['ID_Programacion']),
      estado: limpiar(o['Estado']),
      ruta: limpiar(o['Ruta']),
      nombreRuta: limpiar(o['Nombre_Ruta']),
      area: limpiar(o['Area']),
      modulo: limpiar(o['Modulo']),
      responsable: limpiar(o['Responsable']),
      correoResponsable: limpiar(o['Correo_Responsable']),
      tipo: limpiar(o['Tipo_Programacion']),
      frecuencia: limpiar(o['Frecuencia']),
      diasSemana: limpiar(o['Dias_Semana']),
      diaMes: aNumero(o['Dia_Mes']),
      hora: horaTexto(o['Hora_Inicio']),
      duracion: aNumero(o['Duracion_Estimada']),
      fechaInicio: limpiar(o['Fecha_Inicio']),
      fechaFin: limpiar(o['Fecha_Fin']),
      observaciones: limpiar(o['Observaciones']),
      calendarActivo: esSi(o['Google_Calendar_Activo'])
    };
  }).filter(function (p) { return p.id; });
}

// ---- Cálculo de recurrencia -------------------------------------------

/**
 * Devuelve las fechas (Date) en que una programación debe ejecutarse dentro
 * del rango [desde, hasta], acotado también por [Fecha_Inicio, Fecha_Fin].
 * Soporta: Una vez, Diaria, Semanal (días), Mensual (día del mes).
 */
function fechasDeProgramacion(prog, desde, hasta) {
  var ini = aFecha(prog.fechaInicio) || desde;
  var fin = aFecha(prog.fechaFin);
  var lo = soloFecha(new Date(Math.max(soloFecha(desde).getTime(), soloFecha(ini).getTime())));
  var hi = soloFecha(new Date(fin ? Math.min(soloFecha(hasta).getTime(), soloFecha(fin).getTime())
                                  : soloFecha(hasta).getTime()));
  var fechas = [];
  if (lo > hi) return fechas;

  if (prog.tipo === 'Una vez') {
    var f = soloFecha(ini);
    if (f >= lo && f <= hi) fechas.push(f);
    return fechas;
  }

  if (prog.tipo === 'Diaria') {
    for (var d = new Date(lo); d <= hi; d.setDate(d.getDate() + 1)) fechas.push(new Date(d));
    return fechas;
  }

  if (prog.tipo === 'Semanal') {
    var objetivos = parsearDiasSemana(prog.diasSemana);
    for (var ds = new Date(lo); ds <= hi; ds.setDate(ds.getDate() + 1)) {
      if (objetivos.indexOf(ds.getDay()) !== -1) fechas.push(new Date(ds));
    }
    return fechas;
  }

  if (prog.tipo === 'Mensual') {
    var diaMes = prog.diaMes || soloFecha(ini).getDate();
    for (var m = new Date(lo.getFullYear(), lo.getMonth(), 1);
         m <= hi; m.setMonth(m.getMonth() + 1)) {
      var cand = new Date(m.getFullYear(), m.getMonth(),
        Math.min(diaMes, diasEnMes(m.getFullYear(), m.getMonth())));
      if (cand >= lo && cand <= hi) fechas.push(cand);
    }
    return fechas;
  }

  return fechas; // tipos aún no activos
}

/** Convierte 'Lunes, Miércoles' -> [1, 3] (0=Dom..6=Sáb), tolerante a tildes. */
function parsearDiasSemana(texto) {
  if (!texto) return [];
  var mapa = {};
  CONFIG.DIAS_SEMANA.forEach(function (nombre, idx) { mapa[clave(nombre)] = idx; });
  return limpiar(texto).split(',').map(function (t) {
    return mapa[clave(t)];
  }).filter(function (x) { return x !== undefined; });
}

function diasEnMes(anio, mes) { return new Date(anio, mes + 1, 0).getDate(); }
