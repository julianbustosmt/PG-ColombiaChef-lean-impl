# 🔄 Guía de `clasp` — Sincronizar el repo con Google Apps Script

`clasp` (Command Line Apps Script) es la herramienta oficial de Google para subir
y bajar código de un proyecto de Apps Script desde tu máquina. Con esto, en vez de
copiar/pegar 20 archivos a mano, haces `clasp push` y suben todos de una vez.

---

## 📋 Requisitos previos

- **Node.js** instalado (v14 o superior). Verifica con: `node -v`
- Tu proyecto de Apps Script **ya existente** (el que está vinculado a tu Google Sheets).

---

## 1️⃣ Instalar clasp

```bash
npm install -g @google/clasp
```

Verifica:
```bash
clasp --version
```

---

## 2️⃣ Iniciar sesión en Google

```bash
clasp login
```

- Se abrirá el navegador → inicia sesión con la **misma cuenta de Google** dueña del Sheets/Apps Script.
- Acepta los permisos. Al terminar, verás *"Logged in!"*.

> Si estás en un servidor sin navegador: `clasp login --no-localhost` y sigue las instrucciones.

---

## 3️⃣ Obtener el Script ID de tu proyecto

1. Abre tu Google Sheets → **Extensiones → Apps Script**.
2. En el editor, ve a **⚙️ Configuración del proyecto** (ícono de engranaje, menú izquierdo).
3. Copia el **"ID de secuencia de comandos"** (Script ID). Es una cadena larga.

---

## 4️⃣ Clonar el repo y vincularlo con Apps Script

```bash
# Clona el repositorio
git clone https://github.com/julianbustosmt/PG-ColombiaChef-lean-impl.git
cd PG-ColombiaChef-lean-impl
```

Ahora crea el archivo de vínculo `.clasp.json` **manualmente** (o con el comando de abajo),
apuntando a tu Script ID:

```bash
# Reemplaza TU_SCRIPT_ID por el ID copiado en el paso 3
echo '{"scriptId":"TU_SCRIPT_ID","rootDir":"."}' > .clasp.json
```

> `rootDir: "."` indica que los archivos del proyecto están en la raíz del repo.

---

## 5️⃣ Subir el código a Apps Script

```bash
clasp push
```

- Sube **los 20 archivos** (.gs y .html) + `appsscript.json` a tu proyecto.
- Si pregunta por sobrescribir el manifiesto, confirma con **sí** (`y`).

> ⚠️ `clasp push` **reemplaza** el contenido del proyecto en Apps Script con el del repo.
> Como el repo es ahora tu fuente de verdad, esto es lo que queremos.

---

## 6️⃣ (Opcional) Bajar cambios hechos en el editor web

Si alguna vez editas algo directamente en el editor de Apps Script y quieres traerlo al repo:

```bash
clasp pull
```

Luego lo commiteas a GitHub:
```bash
git add . && git commit -m "cambios desde el editor" && git push
```

---

## 🔁 Flujo de trabajo recomendado

```
Kiro edita archivos  →  commit + push a GitHub
        ↓
En tu máquina:  git pull   (bajas los cambios)
        ↓
clasp push                 (los subes a Apps Script)
        ↓
Publicas nueva versión de la Web App  →  recargas la URL
```

---

## ⚠️ Notas importantes

### Sobre los nombres de archivo
En Apps Script, los archivos HTML no llevan extensión en el editor, pero en el repo sí
(`Index.html`, `CSS.html`, `JS.html`). `clasp` maneja esto automáticamente: sube
`Index.html` como el archivo HTML `Index`. ✅

### Sobre `appsscript.json` (el manifiesto)
Este archivo declara los **permisos (scopes)** que la app necesita. Incluye:
- `spreadsheets.currentonly` — leer/escribir el Sheets.
- `script.container.ui` — menú en el Sheets.
- `forms` — sincronizar los desplegables del Form (Fase 3).
- `calendar` — integración con Google Calendar (Fase 4).
- `script.external_request` — cargar Chart.js por CDN.
- `userinfo.email` — identificar al usuario creador.

> La **zona horaria** está puesta en `America/Bogota`. Ajústala si tu operación está en otra.

### Primer push: reautorización
Como el manifiesto declara permisos nuevos (Forms, Calendar), la **primera vez** que
ejecutes una función que los use, Google pedirá autorizar de nuevo. Es normal.

### Script container-bound
Tu proyecto está **vinculado al Spreadsheet** (container-bound). `clasp push` funciona
igual con el Script ID. No necesitas `clasp clone` si ya creaste el `.clasp.json` del paso 4.

---

## 🆘 Problemas comunes

| Síntoma | Solución |
|---------|----------|
| `User has not enabled the Apps Script API` | Entra a https://script.google.com/home/usersettings y activa la **API de Apps Script**. |
| `clasp: command not found` | Reinstala global: `npm install -g @google/clasp`. Revisa que npm global esté en el PATH. |
| `Push failed. Errors: ...` por sintaxis | Hay un error en algún `.gs`. El mensaje indica el archivo; corrígelo y reintenta. |
| Pide sobrescribir `appsscript.json` | Confirma `y` (el del repo es el correcto). |
