/**
 * ============================================================
 *  Recurrencia.gs  —  Análisis de problemas recurrentes
 * ============================================================
 *  Detecta problemas que se repiten para identificar candidatos a
 *  estandarización / control visual / mejora física (secciones 11 y 16).
 *
 *  Enfoque (deliberadamente simple y transparente, sin IA):
 *   1. Normaliza la descripción (minúsculas, sin tildes, sin palabras vacías).
 *   2. Agrupa hallazgos por SIMILITUD de descripción dentro de un mismo
 *      módulo + 5S (índice de Jaccard sobre palabras clave).
 *   3. Calcula frecuencia temporal (repeticiones por semana) y severidad.
 *   4. Devuelve un ranking de candidatos a estandarizar.
 *
 *  No modifica datos. Opera sobre cargarHallazgos().
 * ============================================================
 */

// Palabras vacías que no aportan al significado (se ignoran al comparar).
var STOPWORDS_REC = {
  'de': 1, 'la': 1, 'el': 1, 'los': 1, 'las': 1, 'un': 1, 'una': 1, 'y': 1,
  'o': 1, 'en': 1, 'con': 1, 'sin': 1, 'por': 1, 'para': 1, 'del': 1, 'al': 1,
  'se': 1, 'su': 1, 'sus': 1, 'que': 1, 'a': 1, 'e': 1, 'es': 1, 'esta': 1,
  'este': 1, 'no': 1, 'ha': 1, 'hay': 1, 'muy': 1, 'mas': 1, 'menos': 1
};

/** Umbral de similitud para considerar dos descripciones "el mismo problema". */
var UMBRAL_SIMILITUD = 0.5; // Jaccard >= 0.5 (comparten >= la mitad de palabras clave)

/**
 * Convierte una descripción en un conjunto de palabras clave normalizadas.
 * Devuelve array de tokens únicos (sin tildes, sin stopwords, sin números solos).
 */
function tokensRec(texto) {
  var s = clave(texto); // minúsculas + sin tildes (helper existente)
  if (!s) return [];
  var crudos = s.split(/[^a-z0-9]+/);
  var set = {};
  crudos.forEach(function (w) {
    if (w.length < 3) return;         // descarta palabras muy cortas
    if (STOPWORDS_REC[w]) return;     // descarta stopwords
    if (/^\d+$/.test(w)) return;      // descarta números sueltos
    set[w] = true;
  });
  return Object.keys(set);
}

/** Índice de Jaccard entre dos arrays de tokens: |∩| / |∪|. */
function similitud(a, b) {
  if (!a.length || !b.length) return 0;
  var setA = {}; a.forEach(function (t) { setA[t] = true; });
  var inter = 0, union = {};
  a.forEach(function (t) { union[t] = true; });
  b.forEach(function (t) { if (setA[t]) inter++; union[t] = true; });
  return inter / Object.keys(union).length;
}

/**
 * Análisis de recurrencia. filtros: filtros globales de hallazgos.
 * Devuelve { grupos:[...], totalHallazgos, totalGrupos, cronicos, frecuentes }.
 */
function analizarRecurrencia(filtros) {
  var hall = filtrarHallazgos(cargarHallazgos(), filtros);

  // 1) Pre-agrupar por módulo + 5S (solo se compara dentro de ese ámbito).
  var ambitos = {};
  hall.forEach(function (h) {
    var k = clave(h.modulo) + '||' + clave(h.cincoS);
    (ambitos[k] = ambitos[k] || []).push(h);
  });

  var grupos = [];

  // 2) Dentro de cada ámbito, agrupar por similitud de descripción.
  Object.keys(ambitos).forEach(function (ak) {
    var items = ambitos[ak].map(function (h) {
      return { h: h, tokens: tokensRec(h.descripcion) };
    });
    var usados = [];
    for (var i = 0; i < items.length; i++) {
      if (usados[i]) continue;
      var cluster = [items[i].h];
      usados[i] = true;
      for (var j = i + 1; j < items.length; j++) {
        if (usados[j]) continue;
        if (similitud(items[i].tokens, items[j].tokens) >= UMBRAL_SIMILITUD) {
          cluster.push(items[j].h);
          usados[j] = true;
        }
      }
      if (cluster.length > 1) grupos.push(construirGrupoRecurrente(cluster));
    }
  });

  // 3) Ordenar por nº de ocurrencias y severidad.
  grupos.sort(function (a, b) {
    if (b.ocurrencias !== a.ocurrencias) return b.ocurrencias - a.ocurrencias;
    return b.frecuenciaSemanal - a.frecuenciaSemanal;
  });

  return {
    grupos: grupos,
    totalHallazgos: hall.length,
    totalGrupos: grupos.length,
    cronicos: grupos.filter(function (g) { return g.severidad === 'cronico'; }).length,
    frecuentes: grupos.filter(function (g) { return g.severidad === 'frecuente'; }).length
  };
}

/** Construye el objeto de un grupo recurrente a partir de sus hallazgos. */
function construirGrupoRecurrente(cluster) {
  // Fechas para calcular el span temporal.
  var fechas = cluster.map(function (h) { return aFecha(h.fecha); })
    .filter(function (d) { return !!d; })
    .sort(function (a, b) { return a - b; });

  var spanDias = fechas.length >= 2
    ? Math.max(1, diasEntre(fechas[0], fechas[fechas.length - 1])) : 0;
  var spanSemanas = spanDias > 0 ? spanDias / 7 : 0;
  var frecuenciaSemanal = spanSemanas > 0 ? redondear(cluster.length / spanSemanas, 2) : 0;

  // Severidad: crónico si se repite ~semanal o más; frecuente si >=3; aislado si no.
  var sev = 'aislado';
  if (cluster.length >= 3 && frecuenciaSemanal >= 0.7) sev = 'cronico';
  else if (cluster.length >= 3) sev = 'frecuente';
  else sev = 'repetido';

  // Descripción representativa: la más larga (suele ser la más informativa).
  var ejemplo = cluster.reduce(function (a, b) {
    return (b.descripcion || '').length > (a.descripcion || '').length ? b : a;
  });

  // Módulos y abiertos.
  var modulos = {};
  var abiertos = 0;
  cluster.forEach(function (h) {
    if (h.modulo) modulos[h.modulo] = true;
    if (CONFIG.HALLAZGO_CFG.ESTADOS_CERRADOS.indexOf(h.estadoGestion) === -1) abiertos++;
  });

  return {
    descripcion: ejemplo.descripcion,
    modulo: ejemplo.modulo,
    modulos: Object.keys(modulos),
    tipo: ejemplo.tipo,
    cincoS: ejemplo.cincoS,
    ocurrencias: cluster.length,
    abiertos: abiertos,
    primeraFecha: fechas.length ? fechaISO(fechas[0]) : '',
    ultimaFecha: fechas.length ? fechaISO(fechas[fechas.length - 1]) : '',
    frecuenciaSemanal: frecuenciaSemanal,
    severidad: sev,
    recomendacion: recomendacionEstandar(ejemplo),
    ids: cluster.map(function (h) { return h.idHallazgo; })
  };
}

/**
 * Sugerencia de acción de estandarización según la 5S / tipo del problema.
 * Heurística orientativa (no prescriptiva).
 */
function recomendacionEstandar(h) {
  var s = clave(h.cincoS);
  var t = clave(h.tipo) + ' ' + clave(h.descripcion);
  if (s.indexOf('seiton') !== -1 || s.indexOf('orden') !== -1 || t.indexOf('ubicacion') !== -1 || t.indexOf('herramienta') !== -1)
    return 'Control visual / ubicación definida (p. ej. panel de sombras)';
  if (s.indexOf('seiso') !== -1 || s.indexOf('limpi') !== -1 || t.indexOf('suciedad') !== -1 || t.indexOf('residuo') !== -1)
    return 'Rutina de limpieza estandarizada / fuente de suciedad';
  if (s.indexOf('seiri') !== -1 || t.indexOf('innecesari') !== -1)
    return 'Criterio de clasificación / tarjeta roja';
  if (t.indexOf('pip') !== -1 || t.indexOf('identific') !== -1)
    return 'Control visual / etiquetado estándar';
  return 'Evaluar estándar, control visual o mejora física';
}
