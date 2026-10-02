/**
 * ============================================================
 *  ETL.gs  —  Normalización RAW -> tablas del dashboard
 * ============================================================
 *  - Autogenera el catálogo de criterios leyendo los encabezados
 *    RAW que siguen el patrón: "Evaluacion R0X Nombre [Criterio]".
 *  - Construye: Detalle_Inspecciones, Inspecciones, Hallazgos.
 *  - NUNCA modifica Inspecciones_RAW ni Hallazgos_RAW.
 *  - Respeta la hoja editable Seguimiento_Hallazgos (Opción A).
 *
 *  Puntos de entrada:
 *    reconstruirTodo()        -> full rebuild (ejecutar manualmente)
 *    onFormSubmitInspeccion() -> trigger (incremental: reconstruye)
 *    onFormSubmitHallazgo()   -> trigger
 *    instalarTriggers()       -> crea los triggers una sola vez
 * ============================================================
 */

/**
 * Reconstruye todas las tablas normalizadas desde las RAW.
 * Es la función que debes ejecutar la primera vez y cuando cambie
 * la estructura de los formularios.
 */
function reconstruirTodo() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_('reconstruirTodo: no se obtuvo lock, otra ejecución en curso.');
    return;
  }
  try {
    var catalogo = construirCatalogoCriterios();   // autogenerado desde RAW
    guardarCatalogo(catalogo);

    var insp = normalizarInspecciones(catalogo);    // {resumen, detalle}
    escribirDetalle(insp.detalle);
    // 'resumen' necesita conteo de hallazgos -> se completa tras normalizar hallazgos.

    var hall = normalizarHallazgos();
    escribirHallazgos(hall);

    // Completar nº de hallazgos por inspección en el resumen.
    completarHallazgosEnResumen(insp.resumen, hall);
    escribirInspecciones(insp.resumen);

    asegurarHojaSeguimiento(hall); // Opción A: filas editables por ingeniería

    // Vinculación automática sesión<->inspección si el Form trae ID_Sesion
    // (Fase 3). Si no existe ese campo, no hace nada.
    vincularSesionesAutomatico();

    cacheLimpiar();
    log_('reconstruirTodo OK: ' + insp.resumen.length + ' inspecciones, ' +
         insp.detalle.length + ' filas detalle, ' + hall.length + ' hallazgos.');
  } finally {
    lock.releaseLock();
  }
}

// ---- 1. Catálogo de criterios (autogenerado) --------------------------

/**
 * Lee los encabezados de Inspecciones_RAW y extrae los criterios que
 * coinciden con el patrón. Devuelve array de:
 *   { codigoRuta, nombreRuta, codigoCriterio, nombreCriterio, encabezadoRAW, colIndex }
 */
function construirCatalogoCriterios() {
  var raw = leerHoja(CONFIG.HOJAS.INSPECCIONES_RAW);
  var catalogo = [];
  var contadorPorRuta = {};

  raw.headers.forEach(function (h, i) {
    var m = h.match(CONFIG.PATRON_CRITERIO);
    if (!m) return;
    var codigoRuta = m[1].toUpperCase();      // R01..R04
    var nombreCriterio = limpiar(m[2]);
    contadorPorRuta[codigoRuta] = (contadorPorRuta[codigoRuta] || 0) + 1;
    var n = contadorPorRuta[codigoRuta];
    catalogo.push({
      codigoRuta: codigoRuta,
      nombreRuta: CONFIG.RUTAS[codigoRuta] || codigoRuta,
      codigoCriterio: codigoRuta + '-' + (n < 10 ? '0' + n : n),
      nombreCriterio: nombreCriterio,
      encabezadoRAW: h,
      colIndex: i
    });
  });
  return catalogo;
}

/** Vuelca el catálogo autogenerado a la hoja Catalogos (bloque CRITERIOS). */
function guardarCatalogo(catalogo) {
  var headers = ['Codigo_Ruta', 'Nombre_Ruta', 'Codigo_Criterio',
                 'Nombre_Criterio', 'Encabezado_RAW'];
  var filas = catalogo.map(function (c) {
    return [c.codigoRuta, c.nombreRuta, c.codigoCriterio, c.nombreCriterio, c.encabezadoRAW];
  });
  escribirHoja(CONFIG.HOJAS.CATALOGOS, headers, filas);
}

// ---- 2. Normalización de inspecciones ---------------------------------

/**
 * Busca el índice de una columna RAW por nombre aproximado (contiene).
 * Tolera variaciones menores de encabezado del Form.
 */
function buscarCol(idx, headers, candidatos) {
  // 1) match exacto
  for (var i = 0; i < candidatos.length; i++) {
    if (candidatos[i] in idx) return idx[candidatos[i]];
  }
  // 2) match por "contiene" (normalizado)
  for (var j = 0; j < headers.length; j++) {
    var hk = clave(headers[j]);
    for (var k = 0; k < candidatos.length; k++) {
      if (hk.indexOf(clave(candidatos[k])) !== -1) return j;
    }
  }
  return -1;
}

/**
 * Transforma Inspecciones_RAW en:
 *   - resumen: una fila por inspección (para la hoja Inspecciones)
 *   - detalle: una fila por criterio evaluado (Detalle_Inspecciones)
 */
function normalizarInspecciones(catalogo) {
  var raw = leerHoja(CONFIG.HOJAS.INSPECCIONES_RAW);
  var H = raw.headers, idx = raw.idx;

  var col = {
    id:        buscarCol(idx, H, ['ID']),
    fecha:     buscarCol(idx, H, ['Fecha de inspección', 'Fecha de inspeccion', 'Fecha']),
    hIni:      buscarCol(idx, H, ['Hora inicio']),
    hFin:      buscarCol(idx, H, ['Hora final', 'Hora fin']),
    resp:      buscarCol(idx, H, ['Responsable de la inspección', 'Responsable de la inspeccion', 'Responsable']),
    area:      buscarCol(idx, H, ['Área o proceso', 'Area o proceso', 'Área', 'Area']),
    modulo:    buscarCol(idx, H, ['Módulo, línea o zona', 'Modulo, linea o zona', 'Módulo', 'Modulo']),
    ruta:      buscarCol(idx, H, ['Ruta a inspeccionar', 'Ruta']),
    completada:buscarCol(idx, H, ['Ruta completada']),
    seguim:    buscarCol(idx, H, ['Requiere seguimiento']),
    obs:       buscarCol(idx, H, ['Observaciones generales', 'Observaciones'])
  };

  var resumen = [];
  var detalle = [];

  raw.rows.forEach(function (fila) {
    var id = col.id >= 0 ? limpiar(fila[col.id]) : '';
    if (!id) return; // sin ID no se procesa

    var fecha = col.fecha >= 0 ? aFecha(fila[col.fecha]) : null;
    var resp = col.resp >= 0 ? limpiar(fila[col.resp]) : '';
    var area = col.area >= 0 ? limpiar(fila[col.area]) : '';
    var modulo = normalizarModulo(col.modulo >= 0 ? fila[col.modulo] : '');
    var rutaTexto = col.ruta >= 0 ? limpiar(fila[col.ruta]) : '';
    var rutasEvaluadas = extraerCodigosRuta(rutaTexto); // ['R01','R03'] etc.

    // ---- Detalle: una fila por criterio -----------------------------
    var sumaValida = 0, nValidos = 0;
    catalogo.forEach(function (c) {
      var resultado = limpiar(fila[c.colIndex]);
      var perteneceARuta = rutasEvaluadas.length === 0
        ? true // si no se pudo determinar la ruta, se evalúa por el dato
        : rutasEvaluadas.indexOf(c.codigoRuta) !== -1;

      var valor = CONFIG.VALORES.hasOwnProperty(resultado) ? CONFIG.VALORES[resultado] : null;
      var esValido = (valor !== null) && perteneceARuta;

      // Solo generamos fila de detalle para criterios con dato o de la ruta evaluada.
      if (resultado === '' && !perteneceARuta) return;

      if (esValido) { sumaValida += valor; nValidos++; }

      detalle.push([
        id,
        fechaISO(fecha),
        resp,
        area,
        modulo,
        rutaTexto,
        c.codigoRuta,
        c.codigoCriterio,
        c.nombreCriterio,
        resultado || 'N/A',
        valor,
        esValido
      ]);
    });

    var cumplimiento = nValidos > 0 ? redondear(sumaValida / nValidos, 1) : null;
    var dur = (col.hIni >= 0 && col.hFin >= 0)
      ? duracionMin(fila[col.hIni], fila[col.hFin]) : null;

    resumen.push({
      id: id,
      fecha: fechaISO(fecha),
      responsable: resp,
      area: area,
      modulo: modulo,
      rutas: rutasEvaluadas.join(', ') || rutaTexto,
      horaInicio: col.hIni >= 0 ? limpiar(fila[col.hIni]) : '',
      horaFinal: col.hFin >= 0 ? limpiar(fila[col.hFin]) : '',
      duracionMin: dur,
      cumplimiento: cumplimiento,
      nValidos: nValidos,
      completada: col.completada >= 0 ? esSi(fila[col.completada]) : false,
      requiereSeguimiento: col.seguim >= 0 ? esSi(fila[col.seguim]) : false,
      numHallazgos: 0, // se completa luego
      observaciones: col.obs >= 0 ? limpiar(fila[col.obs]) : ''
    });
  });

  return { resumen: resumen, detalle: detalle };
}

/** Extrae códigos de ruta (R01..R04) desde el texto "Ruta a inspeccionar". */
function extraerCodigosRuta(texto) {
  var found = [];
  var re = /R\d{2}/gi;
  var m;
  while ((m = re.exec(texto)) !== null) {
    var c = m[0].toUpperCase();
    if (found.indexOf(c) === -1) found.push(c);
  }
  return found;
}

/** Normaliza el módulo a una forma canónica (catálogo simple ampliable). */
function normalizarModulo(v) {
  var s = limpiar(v);
  if (!s) return '(sin módulo)';
  // Heurística: si contiene un número, lo canonizamos a "Módulo N".
  var m = s.match(/(\d+)/);
  if (m) return 'Módulo ' + m[1];
  return s;
}

function escribirDetalle(detalle) {
  var headers = ['ID_Inspeccion', 'Fecha', 'Responsable', 'Area', 'Modulo',
    'Ruta_Evaluada', 'Codigo_Ruta', 'Codigo_Criterio', 'Nombre_Criterio',
    'Resultado', 'Valor_Ponderado', 'Es_Valido'];
  escribirHoja(CONFIG.HOJAS.DETALLE_INSPECCIONES, headers, detalle);
}

function escribirInspecciones(resumen) {
  var headers = ['ID_Inspeccion', 'Fecha', 'Responsable', 'Area', 'Modulo',
    'Rutas_Evaluadas', 'Hora_Inicio', 'Hora_Final', 'Duracion_Min',
    'Cumplimiento_Pct', 'Num_Criterios_Validos', 'Ruta_Completada',
    'Requiere_Seguimiento', 'Num_Hallazgos', 'Observaciones'];
  var filas = resumen.map(function (r) {
    return [r.id, r.fecha, r.responsable, r.area, r.modulo, r.rutas,
      r.horaInicio, r.horaFinal, r.duracionMin, r.cumplimiento, r.nValidos,
      r.completada, r.requiereSeguimiento, r.numHallazgos, r.observaciones];
  });
  escribirHoja(CONFIG.HOJAS.INSPECCIONES, headers, filas);
}

function completarHallazgosEnResumen(resumen, hallazgos) {
  var conteo = {};
  hallazgos.forEach(function (h) {
    var ruta = h.idRutaVinculada;
    if (ruta) conteo[ruta] = (conteo[ruta] || 0) + 1;
  });
  resumen.forEach(function (r) { r.numHallazgos = conteo[r.id] || 0; });
}

// ---- 3. Normalización de hallazgos ------------------------------------

/**
 * Transforma Hallazgos_RAW en objetos normalizados con estado calculado.
 * Devuelve array de objetos (no filas) para poder cruzarlos con inspecciones.
 */
function normalizarHallazgos() {
  var raw = leerHoja(CONFIG.HOJAS.HALLAZGOS_RAW);
  var H = raw.headers, idx = raw.idx;
  var hoy = soloFecha(new Date());

  // Mapa de cierres reales desde Seguimiento_Hallazgos (Opción A).
  var cierres = leerCierresSeguimiento();

  var col = {
    marca:     buscarCol(idx, H, ['Marca temporal']),
    fecha:     buscarCol(idx, H, ['Fecha del hallazgo', 'Fecha']),
    tipo:      buscarCol(idx, H, ['Tipo de hallazgo']),
    desc:      buscarCol(idx, H, ['Descripción del hallazgo', 'Descripcion del hallazgo']),
    ubic:      buscarCol(idx, H, ['Ubicación específica', 'Ubicacion especifica']),
    s5:        buscarCol(idx, H, ['5S principalmente relacionada', '5S relacionada']),
    recurrente:buscarCol(idx, H, ['actividad recurrente']),
    interv:    buscarCol(idx, H, ['Tipo de intervención requerida', 'Tipo de intervencion requerida']),
    foto:      buscarCol(idx, H, ['Evidencia fotográfica', 'Evidencia fotografica']),
    corrInm:   buscarCol(idx, H, ['corregido inmediatamente']),
    tiempo:    buscarCol(idx, H, ['Tiempo empleado en la corrección', 'Tiempo empleado en la correccion', 'minutos']),
    accion:    buscarCol(idx, H, ['Acción realizada o propuesta', 'Accion realizada o propuesta']),
    respAcc:   buscarCol(idx, H, ['Responsable de la acción', 'Responsable de la accion']),
    fLimite:   buscarCol(idx, H, ['Fecha límite de la acción', 'Fecha limite de la accion', 'Fecha límite', 'Fecha limite']),
    otraArea:  buscarCol(idx, H, ['requiere intervención de otra área', 'requiere intervencion de otra area']),
    areaResp:  buscarCol(idx, H, ['Área responsable de la intervención', 'Area responsable de la intervencion']),
    estandar:  buscarCol(idx, H, ['medición de tiempo y posible estandarización', 'medicion de tiempo', 'estandarizacion']),
    obs:       buscarCol(idx, H, ['Observaciones adicionales']),
    evidExtra: buscarCol(idx, H, ['Evidencia adicional']),
    idHall:    buscarCol(idx, H, ['ID Hallazgo']),
    idRuta:    buscarCol(idx, H, ['ID Ruta Vinculada'])
  };

  var out = [];
  raw.rows.forEach(function (fila) {
    var idHall = col.idHall >= 0 ? limpiar(fila[col.idHall]) : '';
    if (!idHall) return;

    var fecha = col.fecha >= 0 ? aFecha(fila[col.fecha]) : null;
    var fLimite = col.fLimite >= 0 ? aFecha(fila[col.fLimite]) : null;
    var corrInm = col.corrInm >= 0 ? esSi(fila[col.corrInm]) : false;
    var accion = col.accion >= 0 ? limpiar(fila[col.accion]) : '';
    var respAcc = col.respAcc >= 0 ? limpiar(fila[col.respAcc]) : '';

    var cierre = cierres[idHall] || null; // {cerrado:bool, fechaCierre:Date}
    var estado = calcularEstadoHallazgo({
      corrInm: corrInm,
      cierre: cierre,
      fLimite: fLimite,
      accion: accion,
      respAcc: respAcc,
      hoy: hoy
    });

    var fechaRefCierre = corrInm ? fecha : (cierre && cierre.cerrado ? cierre.fechaCierre : null);
    var diasAbiertos = (estado === 'Corregido' && fechaRefCierre)
      ? diasEntre(fecha, fechaRefCierre)
      : diasEntre(fecha, hoy);

    out.push({
      idHallazgo: idHall,
      idRutaVinculada: col.idRuta >= 0 ? limpiar(fila[col.idRuta]) : '',
      fecha: fechaISO(fecha),
      tipo: col.tipo >= 0 ? limpiar(fila[col.tipo]) : '',
      descripcion: col.desc >= 0 ? limpiar(fila[col.desc]) : '',
      ubicacion: col.ubic >= 0 ? limpiar(fila[col.ubic]) : '',
      cincoS: col.s5 >= 0 ? limpiar(fila[col.s5]) : '',
      recurrente: col.recurrente >= 0 ? esSi(fila[col.recurrente]) : false,
      intervencion: col.interv >= 0 ? limpiar(fila[col.interv]) : '',
      evidenciaFoto: col.foto >= 0 ? limpiar(fila[col.foto]) : '',
      correccionInmediata: corrInm,
      tiempoCorreccionMin: col.tiempo >= 0 ? aNumero(fila[col.tiempo]) : null,
      accion: accion,
      responsableAccion: respAcc,
      fechaLimite: fechaISO(fLimite),
      requiereOtraArea: col.otraArea >= 0 ? esSi(fila[col.otraArea]) : false,
      areaResponsable: col.areaResp >= 0 ? limpiar(fila[col.areaResp]) : '',
      requiereEstandarizacion: col.estandar >= 0 ? esSi(fila[col.estandar]) : false,
      observaciones: col.obs >= 0 ? limpiar(fila[col.obs]) : '',
      evidenciaExtra: col.evidExtra >= 0 ? limpiar(fila[col.evidExtra]) : '',
      estado: estado,
      diasAbiertos: diasAbiertos
    });
  });

  // Enriquecer con Área/Módulo heredados de la inspección vinculada.
  enriquecerHallazgosConInspeccion(out);
  return out;
}

/**
 * Lógica CENTRALIZADA del estado del hallazgo (sección 9 del requerimiento).
 *   Corregido      -> corrección inmediata = Sí, o cierre real registrado.
 *   Vencido        -> no corregido y fecha límite < hoy.
 *   En seguimiento -> no corregido y existe acción/responsable.
 *   Pendiente      -> no corregido y sin acción definida.
 */
function calcularEstadoHallazgo(p) {
  if (p.corrInm) return 'Corregido';
  if (p.cierre && p.cierre.cerrado) return 'Corregido';
  if (p.fLimite && soloFecha(p.fLimite) < p.hoy) return 'Vencido';
  if (p.accion || p.respAcc) return 'En seguimiento';
  return 'Pendiente';
}

/** Lee cierres reales desde Seguimiento_Hallazgos: {idHallazgo: {cerrado, fechaCierre}}. */
function leerCierresSeguimiento() {
  var mapa = {};
  var d = leerHoja(CONFIG.HOJAS.SEGUIMIENTO);
  if (!d.headers.length) return mapa;
  var cId = buscarCol(d.idx, d.headers, ['ID Hallazgo', 'ID_Hallazgo']);
  var cEstado = buscarCol(d.idx, d.headers, ['Estado_Real', 'Estado real', 'Estado']);
  var cFecha = buscarCol(d.idx, d.headers, ['Fecha_Cierre', 'Fecha de cierre', 'Fecha cierre']);
  if (cId < 0) return mapa;

  d.rows.forEach(function (f) {
    var id = limpiar(f[cId]);
    if (!id) return;
    var estado = cEstado >= 0 ? clave(f[cEstado]) : '';
    var cerrado = estado === 'cerrado' || estado === 'corregido' || estado === 'cerrada';
    mapa[id] = { cerrado: cerrado, fechaCierre: cFecha >= 0 ? aFecha(f[cFecha]) : null };
  });
  return mapa;
}

/** Hereda Área y Módulo del detalle de inspección vinculada a cada hallazgo. */
function enriquecerHallazgosConInspeccion(hallazgos) {
  var insp = leerHojaObjetos(CONFIG.HOJAS.INSPECCIONES);
  var mapa = {};
  insp.forEach(function (i) {
    mapa[limpiar(i['ID_Inspeccion'])] = { area: i['Area'], modulo: i['Modulo'] };
  });
  hallazgos.forEach(function (h) {
    var ref = mapa[h.idRutaVinculada];
    h.area = ref ? ref.area : '';
    h.modulo = ref ? ref.modulo : '';
  });
}

function escribirHallazgos(hallazgos) {
  var headers = ['ID_Hallazgo', 'ID_Ruta_Vinculada', 'Fecha', 'Area', 'Modulo',
    'Tipo', 'Descripcion', 'Ubicacion', '5S_Relacionada', 'Recurrente',
    'Tipo_Intervencion', 'Correccion_Inmediata', 'Tiempo_Correccion_Min',
    'Accion', 'Responsable_Accion', 'Fecha_Limite', 'Requiere_Otra_Area',
    'Area_Responsable', 'Requiere_Estandarizacion', 'Estado', 'Dias_Abiertos',
    'Evidencia_Foto', 'Observaciones'];
  var filas = hallazgos.map(function (h) {
    return [h.idHallazgo, h.idRutaVinculada, h.fecha, h.area, h.modulo, h.tipo,
      h.descripcion, h.ubicacion, h.cincoS, h.recurrente, h.intervencion,
      h.correccionInmediata, h.tiempoCorreccionMin, h.accion, h.responsableAccion,
      h.fechaLimite, h.requiereOtraArea, h.areaResponsable, h.requiereEstandarizacion,
      h.estado, h.diasAbiertos, h.evidenciaFoto, h.observaciones];
  });
  escribirHoja(CONFIG.HOJAS.HALLAZGOS, headers, filas);
}

/**
 * Asegura que exista Seguimiento_Hallazgos con una fila por hallazgo.
 * Añade solo los IDs nuevos; NO sobreescribe lo que ingeniería ya editó.
 */
function asegurarHojaSeguimiento(hallazgos) {
  var ss = ssActiva();
  var sh = ss.getSheetByName(CONFIG.HOJAS.SEGUIMIENTO);
  var headers = ['ID Hallazgo', 'Estado_Real', 'Fecha_Cierre', 'Comentario_Cierre'];

  if (!sh) {
    sh = ss.insertSheet(CONFIG.HOJAS.SEGUIMIENTO);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#1b5e20').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }

  var existentes = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { existentes[limpiar(r[0])] = true; });
  }

  var nuevos = [];
  hallazgos.forEach(function (h) {
    if (!existentes[h.idHallazgo]) nuevos.push([h.idHallazgo, '', '', '']);
  });
  if (nuevos.length) {
    sh.getRange(sh.getLastRow() + 1, 1, nuevos.length, headers.length).setValues(nuevos);
  }
}

// ---- 4. Triggers -------------------------------------------------------

/**
 * Ejecutar UNA vez para instalar el trigger de formulario.
 * Elimina triggers previos de onFormSubmit (y nombres antiguos) para no
 * duplicar, y crea un único trigger onFormSubmit a nivel de Spreadsheet.
 */
function instalarTriggers() {
  var gestionados = ['onFormSubmit', 'onFormSubmitInspeccion', 'onFormSubmitHallazgo',
                     'tareasDiarias'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (gestionados.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  var ss = ssActiva();

  // Trigger de formulario (inspecciones + hallazgos).
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();

  // Trigger diario del módulo Programación: genera sesiones futuras y
  // actualiza estados (Programada -> Vencida). Se ejecuta de madrugada.
  ScriptApp.newTrigger('tareasDiarias').timeBased().everyDays(1).atHour(5).create();

  log_('Triggers instalados: onFormSubmit + tareasDiarias (diario 05:00).');
}

/**
 * Tareas diarias del módulo Programación (trigger por tiempo).
 *  - Genera las sesiones de los próximos N días (sin duplicar).
 *  - Actualiza estados vencidos.
 *  - (Fase 4) sincronización con Google Calendar.
 */
function tareasDiarias() {
  try {
    generarSesionesProgramadas();
    actualizarEstadosSesiones();
  } catch (e) {
    log_('tareasDiarias error: ' + e);
  }
}

/**
 * ÚNICO trigger onFormSubmit del proyecto (ambos formularios comparten el
 * mismo evento a nivel de Spreadsheet).
 *
 * Orden de ejecución (CRÍTICO):
 *   1) Generar el ID del registro recién enviado (Ids.gs).
 *   2) Reconstruir las tablas normalizadas (ya con el ID escrito).
 */
function onFormSubmit(e) {
  try {
    var hoja = e.range.getSheet();
    var nombre = hoja.getName();
    var fila = e.range.getRow(); // fila REAL del registro enviado

    // 1º — Generar ID según el formulario de origen.
    if (nombre === CONFIG.HOJAS.INSPECCIONES_RAW) {
      generarIdInspeccion(hoja, fila);
    } else if (nombre === CONFIG.HOJAS.HALLAZGOS_RAW) {
      generarIdHallazgo(hoja, fila);
    }
  } catch (err) {
    log_('onFormSubmit (IDs) error: ' + err);
    // No abortamos: aun si falla el ID, intentamos reconstruir.
  }

  // 2º — Reconstruir tablas del dashboard (con el ID ya presente).
  reconstruirTodo();
}
