/**
 * ============================================================
 *  Config.gs  —  Configuración central del Sistema de Gestión 5S
 * ============================================================
 *  Fuente única de verdad para nombres de hojas, umbrales,
 *  valores de ponderación y constantes de la aplicación.
 *  NO contiene lógica; solo configuración.
 * ============================================================
 */

var CONFIG = {

  VERSION: '1.0.0',
  APP_TITLE: 'Sistema de Gestión 5S',
  APP_SUBTITLE: 'Planta de Producción Textil',

  // ---- Nombres de hojas -------------------------------------------------
  // RAW: escritas por Google Forms. NUNCA se modifican por el sistema.
  // Ajusta estos nombres a los reales de tu Spreadsheet si difieren.
  HOJAS: {
    // RAW = pestañas que escriben los Google Forms (nombres reales del proyecto).
    INSPECCIONES_RAW: 'Inspeccion y Seguimiento de Rutas 5S (respuestas)',
    HALLAZGOS_RAW: 'Registro de Hallazgos 5S (respuestas)',

    // Normalizadas: generadas por el ETL. Se reconstruyen; no editar a mano.
    INSPECCIONES: 'Inspecciones',
    HALLAZGOS: 'Hallazgos',
    DETALLE_INSPECCIONES: 'Detalle_Inspecciones',

    // Editable por ingeniería (Opción A). El ETL la respeta, no la pisa.
    SEGUIMIENTO: 'Seguimiento_Hallazgos',

    // Configuración y catálogos.
    CATALOGOS: 'Catalogos',
    CONFIGURACION: 'Configuracion',

    // ---- Módulo Programación & Calendario (datos PRIMARIOS/transaccionales).
    // IMPORTANTE: estas hojas NO se regeneran con escribirHoja(); son fuente de
    // verdad editable por el usuario. Se modifican con append/update puntuales.
    PROGRAMACION: 'Programacion_Rutas',
    SESIONES: 'Sesiones_Ruta',
    CONFIG_CALENDARIO: 'Config_Calendario',

    // Catálogos maestros editables (áreas, módulos, responsables + correo).
    // Fuente de verdad para los desplegables de planificación, independiente
    // del histórico de inspecciones.
    CATALOGOS_MAESTROS: 'Catalogos_Maestros'
  },

  // ---- Ponderación de resultados de criterios ---------------------------
  VALORES: {
    'Cumple': 100,
    'Parcial': 50,
    'No cumple': 0
    // 'N/A' y vacío => excluidos del cálculo (Es_Valido = FALSE)
  },

  // Resultados que SÍ cuentan en el denominador de cumplimiento.
  RESULTADOS_VALIDOS: ['Cumple', 'Parcial', 'No cumple'],

  // ---- Patrón de los encabezados RAW de criterios -----------------------
  // Formato real detectado:
  //   "Evaluacion R01 Orden y Organizacion [Herramientas de uso frecuente...]"
  // El grupo 1 captura el código de ruta (R01..R99) y el grupo 2 el criterio.
  PATRON_CRITERIO: /^Evaluaci[oó]n\s+(R\d{2})\b.*\[(.+)\]\s*$/i,

  // ---- Catálogo de rutas (nombre legible) -------------------------------
  RUTAS: {
    R01: 'Orden y Organización',
    R02: 'Limpieza y Condiciones',
    R03: 'Control de PIP',
    R04: 'Condiciones Locativas'
  },

  // ---- Catálogo 5S (para normalizar "5S principalmente relacionada") -----
  CINCO_S: {
    S1: 'Seiri (Clasificar)',
    S2: 'Seiton (Ordenar)',
    S3: 'Seiso (Limpiar)',
    S4: 'Seiketsu (Estandarizar)',
    S5: 'Shitsuke (Disciplina)'
  },

  // ---- Caché ------------------------------------------------------------
  CACHE_TTL_SEG: 300, // 5 min. Las agregaciones se cachean para no recalcular.

  // ---- Umbrales de cumplimiento (semáforos) -----------------------------
  UMBRALES: {
    CUMPLIMIENTO_BUENO: 85,     // verde  >=
    CUMPLIMIENTO_MEDIO: 70,     // amarillo >=
    // < medio => rojo
    PROXIMO_VENCER_DIAS: 3      // amarillo si vence en <= N días
  },

  // ---- Programación de rutas -------------------------------------------
  PROGRAMACION_CFG: {
    // Horizonte de generación de sesiones (días hacia adelante).
    HORIZONTE_DIAS: 30,

    // Tipos de programación. Fase 1 implementa los marcados activos:true.
    // El resto queda declarado para habilitarse después (arquitectura lista).
    TIPOS: {
      'Una vez':   { activo: true },
      'Diaria':    { activo: true },
      'Semanal':   { activo: true },
      'Mensual':   { activo: true },
      'Quincenal': { activo: false },
      'Dias especificos': { activo: false },
      'Personalizada':    { activo: false }
    },

    // Estados posibles de una SESIÓN.
    ESTADOS_SESION: ['Programada', 'En curso', 'Completada', 'Pendiente',
                     'Vencida', 'Cancelada', 'Reprogramada'],

    // Estados posibles de una PROGRAMACIÓN (la regla).
    ESTADOS_PROGRAMACION: ['Activa', 'Pausada', 'Finalizada']
  },

  // Días de la semana (orden JS: 0=Domingo ... 6=Sábado).
  DIAS_SEMANA: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],

  // ---- Formulario de inspección (Opción A: pre-llenado por URL) ----------
  // Fase 3. Valores reales obtenidos del "vínculo prerrellenado" del Form.
  FORM_INSPECCION: {
    URL_BASE: 'https://docs.google.com/forms/d/e/1FAIpQLSem0ES8CbbCJKVwmqui3BjLYs8eJDcNxt8qdC10Hj7k5HOrQw/viewform',
    ENTRIES: {
      fecha:       'entry.850983604',    // Fecha de inspección (ISO yyyy-MM-dd)
      hora:        'entry.883256501',    // Hora inicio (HH:mm)
      responsable: 'entry.2101458263',   // Responsable de la inspección
      area:        'entry.1016927364',   // Área o proceso
      modulo:      'entry.666511265',    // Módulo, línea o zona
      ruta:        'entry.2085190762'    // Ruta (CASILLAS: admite varias)
    },

    // El campo Ruta es de casillas; para marcarlas, el valor pre-rellenado
    // debe coincidir EXACTAMENTE con el texto de cada opción del Form.
    // Mapa: código de ruta -> texto literal de la opción en el formulario.
    OPCIONES_RUTA: {
      R01: 'R01 Orden y organizacion',
      R02: 'R02 Limpieza y condiciones',
      R03: 'R03 Control de PIP',
      R04: 'R04 Inspeccion 5S y condiciones locativas'
    },

    // ID del Form (modo edición: /forms/d/ESTE_ID/edit), para sincronizar las
    // opciones de los desplegables Responsable/Área/Módulo desde el catálogo.
    FORM_ID: '1c2dezceZt7eq3LRECz-3G8GP8qQm7WCDaVb-JPMqNog',

    // Títulos EXACTOS de las preguntas desplegables a sincronizar en el Form.
    // Deben coincidir con el texto de la pregunta tal cual aparece en el Form.
    TITULOS_PREGUNTAS: {
      responsable: 'Responsable de la inspección',
      area: 'Área o proceso',
      modulo: 'Módulo, línea o zona'
    }
  }
};

/**
 * Lee overrides opcionales desde la hoja "Configuracion" (clave | valor).
 * Permite ajustar umbrales sin tocar código. Devuelve CONFIG mezclado.
 */
function obtenerConfig() {
  try {
    var sh = ssActiva().getSheetByName(CONFIG.HOJAS.CONFIGURACION);
    if (!sh || sh.getLastRow() < 2) return CONFIG;
    var filas = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    filas.forEach(function (f) {
      var clave = String(f[0]).trim();
      var valor = f[1];
      if (!clave) return;
      // Overrides soportados de umbrales numéricos.
      if (clave === 'CUMPLIMIENTO_BUENO') CONFIG.UMBRALES.CUMPLIMIENTO_BUENO = Number(valor);
      if (clave === 'CUMPLIMIENTO_MEDIO') CONFIG.UMBRALES.CUMPLIMIENTO_MEDIO = Number(valor);
      if (clave === 'PROXIMO_VENCER_DIAS') CONFIG.UMBRALES.PROXIMO_VENCER_DIAS = Number(valor);
    });
  } catch (e) {
    // Si no existe la hoja, se usan los defaults.
  }
  return CONFIG;
}
