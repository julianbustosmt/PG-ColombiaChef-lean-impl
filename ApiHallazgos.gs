/**
 * ============================================================
 *  ApiHallazgos.gs  —  API de gestión de hallazgos (frontend)
 * ============================================================
 *  Passthrough al dominio (GestionHallazgos.gs) para google.script.run.
 * ============================================================
 */

/** Ficha completa del hallazgo (datos + estado + inspección + acciones + evidencias + historial). */
function apiDetalleHallazgo(idHallazgo) {
  return obtenerDetalleHallazgo(idHallazgo);
}

/** Cambia el estado gestionado. datos: { idHallazgo, nuevoEstado, comentario } */
function apiCambiarEstadoHallazgo(datos) {
  return cambiarEstadoHallazgo(datos);
}

/** Cierra el hallazgo con trazabilidad. datos: { idHallazgo, comentario, evidenciaUrl? } */
function apiCerrarHallazgo(datos) {
  return cerrarHallazgo(datos);
}

/** Reabre un hallazgo. datos: { idHallazgo, comentario } */
function apiReabrirHallazgo(datos) {
  return reabrirHallazgo(datos);
}

/** Registra una acción. datos: { idHallazgo, tipoAccion, descripcion, responsable, fechaLimite, estado, comentario } */
function apiAgregarAccion(datos) {
  return agregarAccion(datos);
}

/** Agrega una evidencia por URL. datos: { idHallazgo, tipo, url, descripcion } */
function apiAgregarEvidencia(datos) {
  return agregarEvidencia(datos);
}

/** Sube un archivo a Drive y lo registra como evidencia.
 *  datos: { idHallazgo, tipo, descripcion, nombre, mimeType, base64 } */
function apiSubirEvidencia(datos) {
  return subirEvidencia(datos);
}

/**
 * Datos para el tablero KANBAN de seguimiento: hallazgos agrupados por estado
 * gestionado, respetando los filtros globales. Devuelve columnas en el orden
 * del flujo y, dentro de cada una, tarjetas ligeras.
 */
function obtenerKanbanHallazgos(filtros) {
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);
  var estados = CONFIG.HALLAZGO_CFG.ESTADOS; // orden del flujo
  var columnas = {};
  estados.forEach(function (e) { columnas[e] = []; });

  hall.forEach(function (h) {
    var est = h.estadoGestion || 'Abierto';
    if (!columnas[est]) columnas[est] = []; // por si hay un estado inesperado
    columnas[est].push({
      idHallazgo: h.idHallazgo,
      descripcion: h.descripcion,
      modulo: h.modulo,
      area: h.area,
      tipo: h.tipo,
      responsable: h.responsableAccion,
      fechaLimite: h.fechaLimite,
      vencido: h.vencido,
      diasAbiertos: h.diasAbiertos,
      ruta: h.idRutaVinculada
    });
  });

  return {
    estados: estados,
    columnas: columnas,
    total: hall.length
  };
}

/** Opciones de responsables (reutiliza el catálogo maestro) para los selects. */
function apiOpcionesGestion() {
  var cat;
  try { cat = obtenerCatalogosParaFormulario(); } catch (e) { cat = { responsables: [] }; }
  return {
    responsables: cat.responsables.map(function (r) { return r.nombre; }),
    estados: CONFIG.HALLAZGO_CFG.ESTADOS,
    tiposEvidencia: CONFIG.HALLAZGO_CFG.TIPOS_EVIDENCIA
  };
}
