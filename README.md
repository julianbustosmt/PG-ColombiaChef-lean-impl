# Sistema de Gestión 5S — Dashboard Web (Google Apps Script)

Dashboard de gestión, seguimiento y análisis de la metodología **5S** para una planta de producción textil.
Construido como **Web App de Google Apps Script**, con **Google Sheets** como fuente de datos y **Google Forms** como origen de registros. Frontend en HTML/CSS/JS con **Chart.js**. **No usa Looker Studio.**

---

## 📂 Estructura de archivos

| Archivo | Rol |
|---------|-----|
| `Code.gs` | Punto de entrada Web App (`doGet`), menú del Spreadsheet, metadatos |
| `Config.gs` | Configuración central: nombres de hojas, ponderaciones, umbrales, rutas |
| `Utils.gs` | Utilidades: parseo robusto de fechas/horas, normalización de texto |
| `Datos.gs` | Capa de acceso a Sheets + caché (`CacheService`) |
| `ETL.gs` | **Normalización RAW → tablas**. Autogenera catálogo, construye `Detalle_Inspecciones`, `Inspecciones`, `Hallazgos`. Triggers de formulario |
| `Indicadores.gs` | **Cálculo centralizado** de KPIs y agregaciones (fuente única de verdad) |
| `Inspecciones.gs` | Carga + filtrado de inspecciones y detalle |
| `Hallazgos.gs` | Carga + filtrado de hallazgos; clasificación para seguimiento |
| `Dashboard.gs` | **API** que consume el frontend (`obtenerDashboard`, `obtenerHallazgos`, …) |
| `Index.html` | Layout, sidebar, barra de filtros, modal |
| `CSS.html` | Tema industrial (incluido en `Index`) |
| `JS.html` | Router SPA, estado de filtros, render de pantallas con Chart.js |

---

## 🗂️ Modelo de datos (hojas del Spreadsheet)

| Hoja | Origen | ¿Se edita a mano? |
|------|--------|-------------------|
| `Inspecciones_RAW` | Google Forms | ❌ Nunca (la escribe el Form) |
| `Hallazgos_RAW` | Google Forms | ❌ Nunca |
| `Catalogos` | **Autogenerada** por el ETL | ❌ (se regenera) |
| `Inspecciones` | ETL | ❌ (se regenera) |
| `Hallazgos` | ETL | ❌ (se regenera) |
| `Detalle_Inspecciones` | ETL | ❌ (se regenera) |
| `Seguimiento_Hallazgos` | ETL crea filas; **ingeniería edita** | ✅ Columnas `Estado_Real`, `Fecha_Cierre`, `Comentario_Cierre` |
| `Configuracion` | Manual (opcional) | ✅ Overrides de umbrales |

> **Opción A (cierre real de hallazgos):** la hoja `Seguimiento_Hallazgos` permite a ingeniería marcar `Estado_Real = Cerrado` y una `Fecha_Cierre`. El ETL la respeta y nunca la sobreescribe; solo agrega filas para IDs nuevos.

### Metodología de cálculo (centralizada en `Indicadores.gs`)

```
Cumple = 100 | Parcial = 50 | No cumple = 0 | N/A = excluido
Cumplimiento = promedio de Valor_Ponderado de filas con Es_Valido = TRUE

Es_Valido = TRUE  si resultado ∈ {Cumple, Parcial, No cumple}
                  Y el criterio pertenece a la ruta evaluada en esa inspección
          = FALSE si N/A, vacío, o criterio de otra ruta
```

### Estado calculado del hallazgo

```
corrección inmediata = Sí            → Corregido
cierre real registrado               → Corregido
no corregido y fecha límite < hoy    → Vencido
no corregido y tiene acción/responsable → En seguimiento
sin acción definida                  → Pendiente
```

---

## 🚀 Despliegue paso a paso

### 1. Abrir el editor de Apps Script
En tu Google Sheets (el que ya tiene las respuestas de ambos formularios unificados):
**Extensiones → Apps Script**.

### 2. Crear los archivos
Crea cada archivo con el **nombre exacto** indicado arriba y pega su contenido:
- Archivos `.gs`: botón **+ → Script**.
- Archivos `.html` (`Index`, `CSS`, `JS`): botón **+ → HTML**.

> ⚠️ En Apps Script los HTML se crean sin la extensión: escribe `Index`, `CSS`, `JS` (el editor añade `.html`).

### 3. Verificar los nombres de las hojas
Abre `Config.gs` y confirma que `HOJAS.INSPECCIONES_RAW` y `HOJAS.HALLAZGOS_RAW` coinciden con los nombres **reales** de tus pestañas de respuestas. Ajústalos si difieren.

### 4. Generar las tablas normalizadas (primera vez)
Recarga el Spreadsheet → aparecerá el menú **⚙️ Gestión 5S**.
- Clic en **Reconstruir tablas (ETL)** → autoriza permisos → se crean `Catalogos`, `Inspecciones`, `Hallazgos`, `Detalle_Inspecciones`, `Seguimiento_Hallazgos`.
- Revisa la hoja `Catalogos`: debe listar los criterios R01–R04 autodetectados desde los encabezados.

### 5. Instalar el trigger automático
Menú **⚙️ Gestión 5S → Instalar triggers de formulario**.
Desde ahí, cada envío de formulario reconstruye las tablas automáticamente.

### 6. Publicar como Web App
**Implementar → Nueva implementación → Tipo: Aplicación web**.
- *Ejecutar como:* **Yo** (el propietario).
- *Quién tiene acceso:* según tu organización (ver Seguridad).
- Clic en **Implementar** → copia la **URL de la Web App**.

---

## 🔒 Seguridad y acceso

- Para restringir a tu organización: *Quién tiene acceso* → **Usuarios de tu dominio Workspace**.
- El dashboard es **solo de consulta**: no escribe en las hojas RAW ni en las normalizadas desde la UI.
- El único punto de edición manual es `Seguimiento_Hallazgos` (cierres reales), fuera de la Web App.

---

## ⚡ Recomendaciones de rendimiento (ya aplicadas)

- Lectura de hojas por **rangos completos** (`getValues()`), nunca celda a celda.
- Procesamiento **en memoria**; agregaciones **cacheadas** (`CacheService`, TTL 5 min).
- El dashboard lee **tablas normalizadas**, no recalcula desde RAW en cada carga.
- El ETL usa `LockService` para evitar reconstrucciones solapadas.
- Invalidación de caché por **sello de versión** tras cada ETL.
- Si el volumen crece mucho: pasar el trigger de *rebuild completo* a *incremental* (preparado en `ETL.gs`).

---

## 🧭 Pantallas incluidas (v1)

Dashboard · Cumplimiento 5S · Criterios · Hallazgos · Seguimiento · Estandarización · Mapa 5S · Tendencias.
Prioridad v1: **Dashboard → Cumplimiento → Hallazgos → Seguimiento → Detalle de inspección** (las demás ya quedan operativas sobre la misma arquitectura).

---

## 🔜 Próximos pasos sugeridos (v2)

- Análisis de recurrencia con matching más fino (hoy agrupa por tipo + 5S + módulo).
- Exportación CSV / reporte de hallazgos / PDF.
- Mapa 5S con plano real de planta (la arquitectura ya separa datos de representación).
- Kanban de seguimiento (Pendiente → En proceso → Cerrado) cuando exista el estado "En proceso".

---

# 🧩 Extensión: Inspecciones + Gestión integral de Hallazgos

Extensión incremental (no reemplaza nada existente) que separa claramente
**Inspección** (ejecución de ruta + resultados) de **Hallazgo** (anomalía y su
gestión), y añade acciones, evidencias, historial y cierre con trazabilidad.

## Archivos modificados / creados

| Archivo | Estado | Qué aporta |
|---------|--------|-----------|
| `GestionHallazgos.gs` | **Nuevo** | Estado híbrido, acciones, evidencias, historial, `obtenerDetalleHallazgo` |
| `ApiHallazgos.gs` | **Nuevo** | API de gestión (detalle, estado, cierre, reapertura, acción, evidencia) |
| `Config.gs` | Modificado | Hojas `ACCIONES`/`EVIDENCIAS`/`HISTORIAL`; bloque `HALLAZGO_CFG` (estados, mapeo legacy, tipos de evidencia) |
| `Hallazgos.gs` | Modificado | `cargarHallazgos` enriquece con `estadoGestion` (híbrido) + `vencido`; filtro por `idInspeccion`; `mapaEstadosGestionados` |
| `Indicadores.gs` | Modificado | `kpisHallazgos` ampliado (En proceso, Cerrados, Reabiertos, % cierre, tiempo prom. cierre) sobre estado efectivo |
| `Dashboard.gs` | Modificado | `obtenerInspecciones` (listado + KPIs); tabla de hallazgos expone estado efectivo + `vencido` |
| `ETL.gs` | Modificado | Asegura las hojas de gestión en `reconstruirTodo` (no las regenera) |
| `Index.html` | Modificado | Ítem de menú **Inspecciones** |
| `JS.html` | Modificado | Vista Inspecciones; **fix del bug** (clic abre el hallazgo); ficha de hallazgo con tabs (Info/Evidencias/Gestión/Historial); navegación bidireccional |
| `CSS.html` | Modificado | Estilos de ficha, galería, timeline, chips |

## Hojas creadas (transaccionales — el ETL NO las regenera)

- **`Acciones_Hallazgo`**: `ID_Accion, ID_Hallazgo, Fecha, Tipo_Accion, Descripcion, Responsable, Fecha_Limite, Estado, Comentario, Usuario, Fecha_Registro`
- **`Evidencias_Hallazgo`**: `ID_Evidencia, ID_Hallazgo, Tipo_Evidencia, URL, Descripcion, Fecha, Usuario`
- **`Historial_Hallazgo`**: `ID_Historial, ID_Hallazgo, Fecha, Evento, Detalle, Usuario`
- **`Seguimiento_Hallazgos`** (existente): se amplía con columna `Usuario_Cierre`; su `Estado_Real` ahora admite los 6 estados gestionados.

## Nuevos estados de hallazgo

`Abierto · En proceso · Corregido · Cerrado · No aplica · Reabierto` (+ bandera derivada **Vencido**).

**Estado híbrido:** si el hallazgo fue gestionado en la app → se usa ese estado; si no → se mapea el estado calculado del ETL (legacy) para no romper el histórico.

## Nuevas relaciones

```
Inspección → Hallazgo        (ID_Ruta_Vinculada)   — navegación bidireccional
Hallazgo   → Acción          (Acciones_Hallazgo, 1:N)
Hallazgo   → Evidencia       (Evidencias_Hallazgo, 1:N)
Hallazgo   → Historial       (Historial_Hallazgo, 1:N)
```

## Nuevas funciones backend

`obtenerDetalleHallazgo`, `cambiarEstadoHallazgo`, `cerrarHallazgo`, `reabrirHallazgo`,
`agregarAccion`, `accionesDeHallazgo`, `agregarEvidencia`, `evidenciasDeHallazgo`,
`registrarHistorial`, `historialDeHallazgo`, `leerEstadoGestionado`, `estadoEfectivo`,
`mapaEstadosGestionados`, `obtenerInspecciones`, y los passthrough `api*` en `ApiHallazgos.gs`.

## Estado de implementación

| Funcionalidad | Estado |
|---------------|--------|
| Sección Inspecciones (listado, filtros, KPIs, detalle, criterios, hallazgos asociados) | ✅ Implementado |
| Fix: clic en hallazgo abre la ficha del hallazgo (no la inspección) | ✅ Implementado |
| Ficha de hallazgo (info, inspección de origen, navegación bidireccional) | ✅ Implementado |
| Galería de evidencias (inicial del Form + gestionadas, miniaturas Drive) | ✅ Implementado |
| Gestión de estado + cierre con trazabilidad + reapertura | ✅ Implementado |
| Acciones del hallazgo (1:N, no sobrescribe históricas) | ✅ Implementado |
| Historial / línea de tiempo | ✅ Implementado |
| Filtro por ID de inspección en Hallazgos | ✅ Implementado |
| KPIs de hallazgos ampliados | ✅ Implementado |
| Tolerancia a datos históricos (sin estado/responsable/evidencia) | ✅ Implementado |
| Agregar evidencias por **URL** de Drive | ✅ Implementado |
| **Subida directa de archivos** desde la app (sin pegar URL) | ⏳ Pendiente (arquitectura lista: tabla `Evidencias_Hallazgo` + `agregarEvidencia`) |

### Robustez y notificaciones (bloques B y A)

| Mejora | Estado |
|--------|--------|
| IDs de inspección/hallazgo robustos (máximo existente + LockService, no número de fila) | ✅ Implementado |
| Vínculo hallazgo→inspección por marca temporal más reciente (no "última fila") | ✅ Implementado |
| **Notificaciones por correo** (`Notificaciones.gs`): recordatorio de rutas de hoy, sesiones vencidas, acciones vencidas, resumen diario al supervisor | ✅ Implementado (desactivado por defecto: `CONFIG.NOTIF.ACTIVO=false`) |

**Activar notificaciones:** pon `CONFIG.NOTIF.ACTIVO = true`, define `CORREO_SUPERVISOR` si quieres el resumen, y asegúrate de que los responsables tengan correo en `Catalogos_Maestros`. Requiere el scope `script.send_mail` (ya en `appsscript.json`) y reautorizar. El envío ocurre en el trigger diario `tareasDiarias`. Prueba manual: menú **⚙️ → Probar notificaciones**.

> **Nota evidencias:** se reutiliza el mecanismo actual (Google Forms guarda la foto
> en Drive y su URL llega al hallazgo). En la app se agregan evidencias **pegando la
> URL** de Drive. La subida directa de archivos queda preparada para una fase posterior.
