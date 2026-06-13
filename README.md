# Gemini MCP — Tu conector personal de Gemini para Claude

Servidor MCP que conecta **Claude.ai** con la **API de Gemini** para generar
**imágenes (Nano Banana Pro)** y **videos (Veo)** desde cualquier chat,
incluso desde el celular. Funciona igual que el conector de Higgsfield,
pero con tu propia API key de Google y pagando solo lo que uses.

## Herramientas que tendrá Claude

| Herramienta | Qué hace |
|---|---|
| `generar_imagen` | Imagen con Nano Banana Pro (1:1, 3:4, 9:16, 16:9, 21:9…) |
| `editar_imagen` | Edita una imagen existente (URL pública) con instrucciones |
| `imagen_a_video` | Anima un guide image con Veo manteniendo la composición |
| `crear_video` | Inicia un video de 8 s con Veo (16:9 o 9:16 con audio) |
| `estado_video` | Consulta el video y entrega el enlace MP4 de descarga |

---

## Instalación (todo se puede hacer desde el iPhone, en Safari)

### Paso 1 — API key de Google
1. Entra a **aistudio.google.com/apikey** con tu cuenta de Google.
2. Toca **"Create API key"** y cópiala (empieza por `AIza...`).
3. Para usar Veo y Nano Banana Pro la cuenta debe tener **facturación
   habilitada** (puedes vincular el mismo proyecto de Google Cloud que ya
   usas en Vertex AI).

### Paso 2 — Subir este código a GitHub
1. Entra a **github.com** → **New repository** → nombre: `gemini-mcp` →
   **privado** → Create.
2. Toca **"uploading an existing file"** y sube los archivos de este
   proyecto (puedes descomprimir el ZIP en la app Archivos del iPhone y
   subirlos: `package.json`, `wrangler.jsonc`, `tsconfig.json`,
   `.gitignore` y la carpeta `src` con `index.ts`).
   - Si GitHub web no te deja subir la carpeta, crea el archivo a mano:
     **Add file → Create new file** → escribe `src/index.ts` en el nombre
     y pega el contenido.

### Paso 3 — Desplegar en Cloudflare (gratis)
1. Crea cuenta en **dash.cloudflare.com**.
2. Menú **Compute (Workers)** → **Create** → **Import a repository**.
3. Conecta tu GitHub y elige el repo `gemini-mcp`. Deja la configuración
   por defecto (Cloudflare detecta Wrangler) y toca **Deploy**.
4. Cuando termine, tendrás una URL tipo:
   `https://gemini-mcp.TUUSUARIO.workers.dev`

### Paso 4 — Configurar la API key (secreto)
1. En el panel del Worker: **Settings → Variables and Secrets → Add**.
2. Tipo **Secret**, nombre `GEMINI_API_KEY`, valor: tu key de Google.
3. (Recomendado) Agrega otro secreto `MCP_TOKEN` con una clave inventada
   larga (ej. `fcz-2026-pereira-glow`). Esto protege tu conector para que
   nadie más gaste tu API.
4. Toca **Deploy** de nuevo para aplicar los cambios.

### Paso 5 — Conectar en Claude
1. En Claude (app o claude.ai): **Ajustes → Conectores → Agregar conector
   personalizado**.
2. Nombre: `Gemini` — URL:
   - Sin token: `https://gemini-mcp.TUUSUARIO.workers.dev/mcp`
   - Con token: `https://gemini-mcp.TUUSUARIO.workers.dev/mcp/TU_TOKEN`
3. Guardar. Listo: aparecerá como un conector más, igual que Higgsfield.

---

## Cómo se usa (desde el celular)

- **Imagen:** "Genera con mi conector Gemini una imagen de Sofía en la playa, 3:4."
- **Video:** "Crea con Gemini un video 9:16 de Sofía aplicándose el serum."
  1. Claude llama a `crear_video` → recibe un ID de operación.
  2. Espera ~1-3 minutos y pide: "consulta el estado del video".
  3. Claude llama a `estado_video` → te entrega un **enlace de descarga**.
  4. Abres el enlace en Safari → botón compartir → **Guardar video** en Fotos.

## Modelos y costos (aprox., verifica en ai.google.dev/pricing)

- Imagen Nano Banana Pro: centavos de dólar por imagen.
- Video Veo 3.1 (8 s con audio): unos pocos dólares por clip; existe la
  variante **fast** más económica. Para cambiar de modelo agrega variables
  (no secretas) en Cloudflare:
  - `IMAGE_MODEL` (por defecto `gemini-3-pro-image-preview`)
  - `VIDEO_MODEL` (por defecto `veo-3.1-generate-preview`, prueba
    `veo-3.1-fast-generate-preview` para ahorrar)

> Nota: tu suscripción Gemini Ultra **no** cubre la API; la API se factura
> aparte en Google Cloud. Los nombres de modelo cambian con el tiempo: si
> un modelo da error 404, revisa el nombre vigente en ai.google.dev.

## Solución de problemas

- **"No autorizado"** → la URL del conector no incluye el `MCP_TOKEN` correcto.
- **Error 400/403 de Gemini** → API key sin facturación o modelo no
  disponible en tu región/cuenta.
- **El video "aún se está generando"** → normal, Veo tarda 1-4 minutos;
  vuelve a pedir el estado.
