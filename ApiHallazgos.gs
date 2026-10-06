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
