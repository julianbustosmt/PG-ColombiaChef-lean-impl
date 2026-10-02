/**
 * ============================================================
 *  EjecucionSesion.gs  —  Ejecución de una sesión (Fase 3)
 * ============================================================
 *  Flujo (secciones 10, 11, 27):
 *    Iniciar  -> estado 'En curso' + Hora_Inicio_Real + URL del Form
 *                prellenada con Ruta/Área/Módulo/Responsable/ID_Sesion.
 *    Finalizar-> vincula SES <-> INSP, estado 'Completada', duración real.
 *    Reprogramar / Cancelar -> actualizan la sesión conservando historial.
 *
 *  Trazabilidad: SESIÓN -> INSPECCIÓN -> DETALLE/HALLAZGOS (ya existente).
 * ============================================================
 */

/**
 * Inicia una sesión: la marca 'En curso', registra la hora real y devuelve
 * la URL del formulario de inspección pre-rellenada (Opción A).
 * Devuelve { ok, urlFormulario, idSesion } o { ok:false, error }.
 */
function iniciarSesion(idSesion) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado, reintenta.' };
  try {
    var s = buscarSesion(idSesion);
    if (!s) return { ok: false, error: 'Sesión no encontrada.' };
    if (s.estado === 'Completada') return { ok: false, error: 'La sesión ya está completada.' };
    if (s.estado === 'Cancelada') return { ok: false, error: 'La sesión está cancelada.' };

    var ahora = new Date();
    actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', idSesion, {
      Estado: 'En curso',
      Hora_Inicio_Real: horaTexto(ahora),
      Fecha_Ejecucion: fechaISO(ahora)
    });
    cacheLimpiar();

    return {
      ok: true,
      idSesion: idSesion,
      urlFormulario: construirUrlFormulario(s)
    };
  } catch (e) {
    log_('iniciarSesion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Finaliza una sesión: la vincula con su inspección y la marca 'Completada'.
 *
 * El inspector pudo haber enviado el Form (generando INSP-xxxx). Si se conoce
 * el idInspeccion se usa; si no, se intenta inferir la última inspección que
 * coincida por ruta/módulo/responsable creada tras el inicio de la sesión.
 */
function finalizarSesion(idSesion, idInspeccion) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado, reintenta.' };
  try {
    var s = buscarSesion(idSesion);
    if (!s) return { ok: false, error: 'Sesión no encontrada.' };

    var insp = limpiar(idInspeccion) || inferirInspeccion(s);
    var ahora = new Date();
    var dur = duracionMin(s.horaInicioReal, horaTexto(ahora));

    actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', idSesion, {
      Estado: 'Completada',
      ID_Inspeccion: insp || '',
      Hora_Fin_Real: horaTexto(ahora),
      Duracion_Real: dur !== null ? dur : ''
    });
    cacheLimpiar();
    return { ok: true, idSesion: idSesion, idInspeccion: insp, duracion: dur };
  } catch (e) {
    log_('finalizarSesion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reprograma una sesión conservando la trazabilidad (sección 15).
 * cambios: { nuevaFecha:'yyyy-MM-dd', nuevaHora:'HH:mm', motivo }
 */
function reprogramarSesion(idSesion, cambios) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var s = buscarSesion(idSesion);
    if (!s) return { ok: false, error: 'Sesión no encontrada.' };
    if (!cambios || !cambios.nuevaFecha) return { ok: false, error: 'Indica la nueva fecha.' };

    var usuario = (Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || 'web';
    actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', idSesion, {
      Fecha_Original: s.fecha,                       // conserva la fecha previa
      Fecha: cambios.nuevaFecha,
      Hora_Inicio_Programada: horaTexto(cambios.nuevaHora || s.horaInicioProg),
      Estado: 'Reprogramada',
      Motivo_Cambio: limpiar(cambios.motivo),
      Usuario_Cambio: usuario
    });
    cacheLimpiar();
    return { ok: true };
  } catch (e) {
    log_('reprogramarSesion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cancela una sesión (sección 16). Conserva el motivo y el usuario.
 */
function cancelarSesion(idSesion, motivo) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var s = buscarSesion(idSesion);
    if (!s) return { ok: false, error: 'Sesión no encontrada.' };

    var usuario = (Session.getActiveUser().getEmail && Session.getActiveUser().getEmail()) || 'web';
    actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', idSesion, {
      Estado: 'Cancelada',
      Motivo_Cambio: limpiar(motivo),
      Usuario_Cambio: usuario
    });
    cacheLimpiar();
    return { ok: true };
  } catch (e) {
    log_('cancelarSesion error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

// ---- Helpers -----------------------------------------------------------

/** Busca una sesión por ID (objeto tipado) o null. */
function buscarSesion(idSesion) {
  return cargarSesiones().filter(function (s) { return s.id === idSesion; })[0] || null;
}

/**
 * Construye la URL del Form de inspección pre-rellenada (Opción A).
 * Maneja:
 *   - fecha (ISO), hora, área, módulo, responsable  -> un parámetro c/u
 *   - ruta (CASILLAS) -> un parámetro 'entry' REPETIDO por cada ruta de la
 *     sesión, usando el texto EXACTO de la opción del Form (OPCIONES_RUTA).
 */
function construirUrlFormulario(s) {
  var cfg = CONFIG.FORM_INSPECCION;
  if (!cfg || !cfg.URL_BASE) return '';

  var base = cfg.URL_BASE.indexOf('?') === -1 ? cfg.URL_BASE + '?usp=pp_url'
                                              : cfg.URL_BASE + '&usp=pp_url';
  var e = cfg.ENTRIES || {};
  var partes = [];
  var add = function (entry, valor) {
    if (entry && valor) partes.push(entry + '=' + encodeURIComponent(valor));
  };

  add(e.fecha, s.fecha);
  add(e.hora, s.horaInicioProg);
  add(e.area, s.area);
  add(e.modulo, s.modulo);
  add(e.responsable, s.responsable);

  // Rutas (casillas múltiples). s.ruta puede ser 'R01' o 'R01, R02, R04'.
  if (e.ruta) {
    var mapa = cfg.OPCIONES_RUTA || {};
    extraerCodigosRuta(s.ruta).forEach(function (cod) {
      var texto = mapa[cod];
      if (texto) partes.push(e.ruta + '=' + encodeURIComponent(texto));
    });
  }

  return partes.length ? base + '&' + partes.join('&') : base;
}

/**
 * Infiere la inspección vinculada cuando el usuario no la indica:
 * la última inspección (por ID más alto) cuyos datos de módulo/responsable
 * coincidan con la sesión. Heurística best-effort; puede devolver '' si no
 * hay coincidencia clara (se podrá ajustar al añadir ID_Sesion al Form).
 */
function inferirInspeccion(s) {
  var insp = cargarInspecciones();
  var candidatas = insp.filter(function (i) {
    var mismoModulo = !s.modulo || clave(i.modulo) === clave(s.modulo);
    var mismoResp = !s.responsable || clave(i.responsable) === clave(s.responsable);
    return mismoModulo && mismoResp;
  });
  // Ordena por número de ID descendente y toma la más reciente.
  candidatas.sort(function (a, b) {
    return numId(b.id) - numId(a.id);
  });
  return candidatas.length ? candidatas[0].id : '';
}

/** Extrae la parte numérica de un ID 'INSP-0007' -> 7. */
function numId(id) {
  var m = String(id).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Vinculación AUTOMÁTICA sesión <-> inspección (sección 10).
 *
 * Si el Google Form de inspección incluye una pregunta "ID Sesion" (o similar),
 * su valor llega a Inspecciones_RAW. Esta función recorre las inspecciones que
 * traen ese dato y marca la sesión correspondiente como 'Completada',
 * guardando el ID_Inspeccion. Es idempotente: no re-vincula lo ya vinculado.
 *
 * Se invoca al final de reconstruirTodo(). Si el Form no tiene ese campo,
 * no hace nada (degradación limpia) y se usa el flujo manual "Finalizar".
 */
function vincularSesionesAutomatico() {
  try {
    var raw = leerHoja(CONFIG.HOJAS.INSPECCIONES_RAW);
    if (!raw.headers.length) return { vinculadas: 0 };

    var cId = buscarCol(raw.idx, raw.headers, ['ID']);
    var cSesion = buscarCol(raw.idx, raw.headers, ['ID Sesion', 'ID_Sesion', 'ID de sesión', 'ID de sesion']);
    if (cId < 0 || cSesion < 0) return { vinculadas: 0 }; // el Form no trae ID_Sesion

    // Mapa de sesiones ya vinculadas / estado actual.
    var sesiones = cargarSesiones();
    var porId = {};
    sesiones.forEach(function (s) { porId[s.id] = s; });

    var vinculadas = 0;
    raw.rows.forEach(function (fila) {
      var idInsp = limpiar(fila[cId]);
      var idSes = limpiar(fila[cSesion]);
      if (!idInsp || !idSes) return;
      var s = porId[idSes];
      if (!s) return;
      if (s.estado === 'Completada' && s.idInspeccion) return; // ya vinculada

      actualizarFilaPorId(CONFIG.HOJAS.SESIONES, 'ID_Sesion', idSes, {
        Estado: 'Completada',
        ID_Inspeccion: idInsp
      });
      vinculadas++;
    });
    if (vinculadas) cacheLimpiar();
    return { vinculadas: vinculadas };
  } catch (e) {
    log_('vincularSesionesAutomatico error: ' + e);
    return { vinculadas: 0 };
  }
}
