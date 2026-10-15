# Auditoría técnica y optimización de rendimiento — Sistema de Gestión 5S

Rama: `optimizacion/rendimiento-5s` · Base: `main` (árbol limpio, referencia funcional conservada)

Este documento resume la auditoría, los cambios implementados y la **evidencia medida**
de la mejora. No se modificaron reglas de negocio, el esquema de hojas, triggers,
permisos ni se publicó nada en producción.

---

## 1. Mapa de arquitectura (verificado en código)

| Capa | Archivos | Rol |
|------|----------|-----|
| Entrada | `Code.gs` (`doGet`→`Index`), `include()` inyecta `CSS.html`+`JS.html` | SPA en un solo HTML |
| API frontend | `Dashboard.gs`, `ApiHallazgos.gs`, `ApiProgramacion.gs`, `GestionHallazgos.gs`, `Catalogos.gs` | Funciones `google.script.run` que reciben `filtros` |
| Carga de datos | `Datos.gs`, `Inspecciones.gs`, `Hallazgos.gs`, `Sesiones.gs` | Lectura de hojas normalizadas |
| Cálculo | `Indicadores.gs`, `IndicadoresProgramacion.gs`, `Recurrencia.gs` | KPIs puros en memoria |
| ETL | `ETL.gs` (bajo demanda / `onFormSubmit`) | RAW → `Inspecciones`/`Detalle_Inspecciones`/`Hallazgos` |
| Integraciones | `Calendario.gs`, `Notificaciones.gs`, Drive, Forms | Google Workspace |

**Hallazgo central:** `leerHoja()` leía Google Sheets de golpe (bien), pero **no memoizaba**:
la misma hoja se releía entera varias veces por petición en las vistas no cacheadas, y
solo 3 de ~14 funciones API aplicaban caché de agregación.

---

## 2. Cambios implementados (pequeños, verificables y reversibles)

### B1 — Memoización de lecturas por ejecución (`Datos.gs`)
- `leerHoja()` ahora cachea su resultado en una variable de ámbito de ejecución
  (`_MEMO_HOJAS`). Apps Script crea una instancia nueva del script por cada petición,
  así que **este caché vive solo durante esa petición**: nunca devuelve datos obsoletos
  entre requests ni mezcla datos de usuarios distintos.
- Nuevas funciones: `leerHojaDirecto()` (acceso sin memo) y `olvidarHoja(nombre)`
  (invalidación). Las funciones de escritura (`escribirHoja`, `appendFila`,
  `actualizarFilaPorId`) invalidan el memo tras escribir, para que una relectura dentro
  de la misma ejecución sea consistente.

### B2 — Caché de agregación en las APIs de solo lectura (`Dashboard.gs`)
Se añadió el patrón `cacheKey`/`cacheGet`/`cachePut` (ya existente) a:
`obtenerCumplimiento`, `obtenerCumplimientoPorCriterio`, `obtenerHallazgos`,
`obtenerInspecciones`, `obtenerTendencias`, `obtenerActividadesEstandarizacion`,
`obtenerMapa5S`.
- **Invalidación:** todas las mutaciones y el ETL ya llaman `cacheLimpiar()`, que
  incrementa `CACHE_STAMP`; como el stamp forma parte de la clave, cualquier cambio de
  datos invalida la caché automáticamente. TTL techo: 5 min (igual que el dashboard).
- Se dejaron **sin caché** a propósito las vistas sensibles al tiempo o a mutaciones
  frecuentes: `obtenerAccionesPendientes` (bandeja de acción), `obtenerDetalleInspeccion`
  y `apiDetalleHallazgo`.

### B3 — Escrituras en lote (`Datos.gs`, `Sesiones.gs`)
- `actualizarFilaPorId`: aplica los cambios sobre la fila en memoria y la reescribe en
  **un solo `setValues`** (antes: un `setValue` por columna).
- `actualizarEstadosSesiones`: construye la columna Estado en memoria y escribe en
  **un solo `setValues`** (antes: un `setValue` por cada sesión vencida dentro del bucle).

### F1 — Paralelizar las peticiones del Dashboard (`JS.html`)
`renderDashboard` lanza `obtenerDashboard` y `obtenerDashboardProgramacion` **en paralelo**
(antes eran secuenciales, sumando latencias). La banda de programación es secundaria: si
falla, no rompe el dashboard.

### F2 — Arranque no bloqueante (`JS.html`)
El arranque ya no espera (`await`) a `cargarOpcionesFiltros()` antes de pintar la primera
vista: los selects de filtros se llenan cuando llegan, sin retrasar el primer render.

---

## 3. Evidencia medida

Verificación headless cargando los `.gs` **reales** en Node con mocks de
`SpreadsheetApp`/`CacheService`/etc. que **cuentan** las llamadas a
`getValues`/`setValue`/`setValues`. Dataset: 20 inspecciones, 300 filas de detalle,
60 hallazgos, 40 sesiones.

Suite de regresión: **17/17 pruebas pasan** (memoización, invalidación, caché de
agregación, correctitud de KPIs y escritura en lote).

Comparación directa **main (baseline) vs optimizado**, mismo dataset y mismos escenarios:

| Escenario | BASELINE (main) | OPTIMIZADO | Mejora |
|---|---|---|---|
| Navegación: 5 vistas + 2 revisitas | **15** lecturas a Sheets | **4** lecturas | **−73%** |
| `actualizarEstadosSesiones` (20 vencidas) | **20** `setValue` celda a celda | **1** `setValues` en lote | **−95%** escrituras |

Cada operación de Sheets en GAS tiene un coste de red fijo (decenas–cientos de ms), por lo
que reducir el número de operaciones reduce directamente la latencia. Las revisitas de una
vista ya cacheada cuestan **0 lecturas**.

> La validación es funcional/comportamental sobre el código real; no sustituye a una
> medición en el despliegue real de Apps Script, que depende de la red y del tamaño de las
> hojas de producción.

---

## 4. Hallazgo reportado NO modificado (requiere decisión)

- **D1 — Semáforos con estado legacy:** `clasificarSeguimiento`, `obtenerMapa5S` y
  `topModulosProblema` comparan contra `h.estado` (estado calculado legacy) en vez de
  `h.estadoGestion` (estado efectivo gestionado por el usuario). Esto puede desalinear los
  semáforos con los KPIs que ya usan el estado efectivo. **No se cambió** porque alteraría
  el significado de estados/semáforos (una regla de negocio); queda documentado para que
  el equipo decida si debe unificarse.

---

## 5. Garantías

- No se modificó el esquema de hojas, triggers, permisos, calendarios ni datos reales.
- No se añadieron dependencias externas.
- Las interfaces de backend invocadas desde el frontend se mantienen compatibles.
- Cambios acotados: 4 archivos, +150/−28 líneas.
