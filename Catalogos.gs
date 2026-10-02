/**
 * ============================================================
 *  Catalogos.gs  —  Catálogos maestros (Áreas, Módulos, Responsables)
 * ============================================================
 *  Fuente de verdad EDITABLE para los desplegables de planificación.
 *  Independiente del histórico de inspecciones: permite programar para
 *  módulos/responsables que aún no tienen inspecciones registradas.
 *
 *  Estructura de la hoja Catalogos_Maestros (un registro por fila):
 *    Tipo        | Valor        | Correo              | Activo
 *    Area        | Confección   |                     | Sí
 *    Modulo      | Módulo 2     |                     | Sí
 *    Responsable | Julian       | julian@empresa.com  | Sí
 *
 *  - 'Correo' solo aplica a Responsable (preparado para notificaciones).
 *  - 'Activo' permite ocultar un valor sin borrar su historial.
 *  - Es hoja transaccional: se usa append/update, nunca escribirHoja().
 * ============================================================
 */

var TIPOS_CATALOGO = ['Area', 'Modulo', 'Responsable'];

/** Encabezados canónicos del catálogo maestro. */
function headersCatalogosMaestros() {
  return ['Tipo', 'Valor', 'Correo', 'Activo'];
}

/** Garantiza que la hoja exista; si está recién creada, la siembra. */
function asegurarCatalogosMaestros() {
  var ss = ssActiva();
  var existia = !!ss.getSheetByName(CONFIG.HOJAS.CATALOGOS_MAESTROS);
  var sh = asegurarHoja(CONFIG.HOJAS.CATALOGOS_MAESTROS, headersCatalogosMaestros());
  if (!existia || sh.getLastRow() < 2) sembrarCatalogoDesdeHistorico(sh);
  return sh;
}

/**
 * Siembra inicial: vuelca las áreas/módulos/responsables que ya existan en
 * el histórico de inspecciones, para no empezar de cero. El usuario luego
 * agrega los que falten (módulos/responsables futuros).
 */
function sembrarCatalogoDesdeHistorico(sh) {
  var insp = cargarInspecciones();
  var filas = [];
  unicos(insp, 'area').forEach(function (v) { filas.push(['Area', v, '', 'Sí']); });
  unicos(insp, 'modulo').forEach(function (v) { filas.push(['Modulo', v, '', 'Sí']); });
  unicos(insp, 'responsable').forEach(function (v) { filas.push(['Responsable', v, '', 'Sí']); });
  if (filas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 4).setValues(filas);
  }
}

/** Carga el catálogo maestro como objetos tipados. */
function cargarCatalogosMaestros() {
  asegurarCatalogosMaestros();
  return leerHojaObjetos(CONFIG.HOJAS.CATALOGOS_MAESTROS).map(function (o) {
    return {
      tipo: limpiar(o['Tipo']),
      valor: limpiar(o['Valor']),
      correo: limpiar(o['Correo']),
      activo: o['Activo'] === '' ? true : esSi(o['Activo'])
    };
  }).filter(function (c) { return c.tipo && c.valor; });
}

/**
 * Devuelve las opciones para los desplegables de planificación.
 *  - areas / modulos: arrays de strings (solo activos).
 *  - responsables: array de { nombre, correo } (solo activos).
 */
function obtenerCatalogosParaFormulario() {
  var cat = cargarCatalogosMaestros().filter(function (c) { return c.activo; });
  var areas = [], modulos = [], responsables = [];
  cat.forEach(function (c) {
    if (c.tipo === 'Area') areas.push(c.valor);
    else if (c.tipo === 'Modulo') modulos.push(c.valor);
    else if (c.tipo === 'Responsable') responsables.push({ nombre: c.valor, correo: c.correo });
  });
  var ordA = function (a, b) { return a.localeCompare(b, 'es'); };
  areas.sort(ordA); modulos.sort(ordA);
  responsables.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return { areas: areas, modulos: modulos, responsables: responsables };
}

/** Devuelve el correo asociado a un responsable (o '' si no hay). */
function correoDeResponsable(nombre) {
  if (!nombre) return '';
  var r = cargarCatalogosMaestros().filter(function (c) {
    return c.tipo === 'Responsable' && clave(c.valor) === clave(nombre);
  })[0];
  return r ? r.correo : '';
}

// ---- CRUD del catálogo (para la pantalla de administración) ------------

/** Lista completa del catálogo (para administrar en la Web App). */
function obtenerCatalogosAdmin() {
  return { items: cargarCatalogosMaestros(), tipos: TIPOS_CATALOGO };
}

/**
 * Agrega o actualiza una entrada del catálogo.
 * Si ya existe (mismo Tipo+Valor), actualiza correo/activo; si no, la crea.
 * datos: { tipo, valor, correo, activo(bool) }
 */
function guardarEntradaCatalogo(datos) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Sistema ocupado.' };
  try {
    var tipo = limpiar(datos.tipo), valor = limpiar(datos.valor);
    if (TIPOS_CATALOGO.indexOf(tipo) === -1) return { ok: false, error: 'Tipo inválido.' };
    if (!valor) return { ok: false, error: 'El valor no puede estar vacío.' };
    if (tipo === 'Responsable' && datos.correo && !validarCorreo(datos.correo)) {
      return { ok: false, error: 'Correo con formato inválido.' };
    }

    var sh = asegurarCatalogosMaestros();
    var cab = sh.getRange(1, 1, 1, 4).getValues()[0].map(limpiar);
    var datosFilas = sh.getLastRow() > 1
      ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues() : [];

    var cTipo = cab.indexOf('Tipo'), cValor = cab.indexOf('Valor'),
        cCorreo = cab.indexOf('Correo'), cActivo = cab.indexOf('Activo');

    for (var r = 0; r < datosFilas.length; r++) {
      if (limpiar(datosFilas[r][cTipo]) === tipo &&
          clave(datosFilas[r][cValor]) === clave(valor)) {
        // Ya existe -> actualizar.
        sh.getRange(r + 2, cCorreo + 1).setValue(datos.correo || '');
        sh.getRange(r + 2, cActivo + 1).setValue(datos.activo === false ? 'No' : 'Sí');
        cacheLimpiar();
        sincronizarFormSilencioso();
        return { ok: true, actualizado: true };
      }
    }

    // No existe -> crear.
    sh.appendRow([tipo, valor, datos.correo || '', datos.activo === false ? 'No' : 'Sí']);
    cacheLimpiar();
    sincronizarFormSilencioso(); // mantiene el Form al día (no falla si no hay FORM_ID)
    return { ok: true, creado: true };
  } catch (e) {
    log_('guardarEntradaCatalogo error: ' + e);
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/** Valida un correo de forma simple. */
function validarCorreo(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpiar(correo));
}

/**
 * Sincroniza el Form sin lanzar errores (uso tras editar el catálogo).
 * Si el Form no está configurado o falla, se registra y se continúa.
 */
function sincronizarFormSilencioso() {
  try {
    var cfg = CONFIG.FORM_INSPECCION || {};
    if (!cfg.FORM_ID || cfg.FORM_ID.indexOf('PEGAR') !== -1) return; // no configurado
    var r = sincronizarFormConCatalogo();
    if (!r.ok) log_('sincronizarFormSilencioso: ' + JSON.stringify(r.errores || r.error));
  } catch (e) {
    log_('sincronizarFormSilencioso error: ' + e);
  }
}

// ============================================================
//  Sincronización Catálogo Maestro -> opciones del Google Form
// ============================================================
//  Hace que los desplegables Responsable/Área/Módulo del Form reflejen
//  SIEMPRE los valores activos del catálogo. Así el pre-llenado (Fase 3)
//  nunca falla por desajuste de textos.
//
//  Requiere: CONFIG.FORM_INSPECCION.FORM_ID y permisos de FormApp.

/**
 * Sincroniza los desplegables del Form con el catálogo maestro.
 * Devuelve { ok, actualizados:[{pregunta, n}], errores:[...] }.
 */
function sincronizarFormConCatalogo() {
  var cfg = CONFIG.FORM_INSPECCION || {};
  if (!cfg.FORM_ID || cfg.FORM_ID.indexOf('PEGAR') !== -1) {
    return { ok: false, error: 'Falta configurar FORM_INSPECCION.FORM_ID en Config.gs.' };
  }

  var cat = obtenerCatalogosParaFormulario(); // {areas, modulos, responsables:[{nombre}]}
  var valores = {
    responsable: cat.responsables.map(function (r) { return r.nombre; }),
    area: cat.areas,
    modulo: cat.modulos
  };

  var form;
  try {
    form = FormApp.openById(cfg.FORM_ID);
  } catch (e) {
    return { ok: false, error: 'No se pudo abrir el Form (ID o permisos): ' + e };
  }

  var titulos = cfg.TITULOS_PREGUNTAS || {};
  var items = form.getItems();
  var actualizados = [], errores = [];

  Object.keys(titulos).forEach(function (clave_) {
    var titulo = titulos[clave_];
    var lista = valores[clave_] || [];
    if (!lista.length) { errores.push(titulo + ': catálogo vacío, se omite.'); return; }

    var item = buscarItemPorTitulo(items, titulo);
    if (!item) { errores.push('No se encontró la pregunta: "' + titulo + '".'); return; }

    try {
      aplicarOpciones(item, lista);
      actualizados.push({ pregunta: titulo, n: lista.length });
    } catch (e2) {
      errores.push(titulo + ': ' + e2);
    }
  });

  return { ok: errores.length === 0, actualizados: actualizados, errores: errores };
}

/** Busca un item del Form por su título (tolerante a mayúsculas/tildes). */
function buscarItemPorTitulo(items, titulo) {
  for (var i = 0; i < items.length; i++) {
    if (clave(items[i].getTitle()) === clave(titulo)) return items[i];
  }
  return null;
}

/**
 * Aplica una lista de opciones a un item de tipo lista desplegable o
 * selección múltiple del Form, preservando el tipo de la pregunta.
 */
function aplicarOpciones(item, opciones) {
  var tipo = item.getType();
  if (tipo === FormApp.ItemType.LIST) {
    item.asListItem().setChoiceValues(opciones);
  } else if (tipo === FormApp.ItemType.MULTIPLE_CHOICE) {
    item.asMultipleChoiceItem().setChoiceValues(opciones);
  } else if (tipo === FormApp.ItemType.CHECKBOX) {
    item.asCheckboxItem().setChoiceValues(opciones);
  } else {
    throw 'El tipo de pregunta no admite opciones (es texto u otro).';
  }
}
