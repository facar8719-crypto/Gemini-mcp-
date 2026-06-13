/**
 * Servidor MCP para Gemini (Nano Banana Pro + Veo)
 * Se despliega en Cloudflare Workers y se conecta a Claude.ai
 * como "Conector personalizado".
 *
 * Herramientas:
 *  - generar_imagen : imágenes con Nano Banana Pro
 *  - crear_video    : inicia un video con Veo (asíncrono)
 *  - estado_video   : consulta el video y entrega el enlace de descarga
 */

export interface Env {
  GEMINI_API_KEY: string;
  MCP_TOKEN?: string;      // opcional: protege la URL del conector
  IMAGE_MODEL?: string;    // por defecto: gemini-3-pro-image-preview
  VIDEO_MODEL?: string;    // por defecto: veo-3.1-generate-preview
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------- Definición de herramientas ----------
const TOOLS = [
  {
    name: "generar_imagen",
    description:
      "Genera una imagen con Nano Banana Pro (Gemini). Recibe un prompt en inglés, detallado y autocontenido (biblia de personaje, STYLE, AVOID).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt completo en inglés" },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"],
          description: "Relación de aspecto. Por defecto 1:1",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "crear_video",
    description:
      "Inicia la generación de un video con Veo (8 segundos, con audio). Devuelve un ID de operación. Luego usa estado_video para obtener el enlace. Prompt en inglés, autocontenido.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt completo en inglés" },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16"],
          description: "16:9 horizontal o 9:16 vertical (Reels). Por defecto 16:9",
        },
        negative_prompt: {
          type: "string",
          description: "Lo que se debe evitar en el video (opcional)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "editar_imagen",
    description:
      "Edita una imagen existente con Nano Banana Pro a partir de instrucciones de texto (cambiar fondo, ropa, agregar producto, etc.). La imagen debe estar accesible por URL pública (https).",
    inputSchema: {
      type: "object",
      properties: {
        imagen_url: {
          type: "string",
          description: "URL pública (https) de la imagen a editar",
        },
        instrucciones: {
          type: "string",
          description: "Instrucciones de edición en inglés, claras y específicas",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"],
          description: "Relación de aspecto del resultado (opcional)",
        },
      },
      required: ["imagen_url", "instrucciones"],
    },
  },
  {
    name: "imagen_a_video",
    description:
      "Anima una imagen existente con Veo (imagen-a-video, 8 s con audio). Ideal para dar movimiento a un guide image manteniendo la composición. La imagen debe estar accesible por URL pública (https). Devuelve un ID de operación; luego usa estado_video.",
    inputSchema: {
      type: "object",
      properties: {
        imagen_url: {
          type: "string",
          description: "URL pública (https) de la imagen inicial del video",
        },
        prompt: {
          type: "string",
          description: "Prompt en inglés describiendo el movimiento, cámara y audio",
        },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16"],
          description: "16:9 horizontal o 9:16 vertical. Por defecto 16:9",
        },
        negative_prompt: {
          type: "string",
          description: "Lo que se debe evitar (opcional)",
        },
      },
      required: ["imagen_url", "prompt"],
    },
  },
  {
    name: "estado_video",
    description:
      "Consulta el estado de un video iniciado con crear_video. Si ya terminó, devuelve el enlace de descarga del MP4. Si no, indica que se reintente en ~30 segundos.",
    inputSchema: {
      type: "object",
      properties: {
        operacion: {
          type: "string",
          description: "El ID de operación devuelto por crear_video (empieza por 'models/...').",
        },
      },
      required: ["operacion"],
    },
  },
];

// ---------- Utilidades ----------
function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rpcResult(id: unknown, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

function textContent(text: string) {
  return { content: [{ type: "text", text }] };
}

async function gemini(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data: any = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Error ${res.status} de la API de Gemini`;
    throw new Error(msg);
  }
  return data;
}

// Descarga una imagen pública y la convierte a base64
async function imagenABase64(url: string): Promise<{ data: string; mimeType: string }> {
  if (!url || !url.startsWith("https://")) {
    throw new Error("La imagen debe ser una URL pública https://");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    throw new Error(`La URL no es una imagen (content-type: ${mimeType})`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error("Imagen demasiado grande (máx 15 MB)");
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return { data: btoa(binary), mimeType };
}

// ---------- Implementación de herramientas ----------
async function generarImagen(env: Env, args: any) {
  const model = env.IMAGE_MODEL || "gemini-3-pro-image-preview";
  const body = {
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: args.aspect_ratio || "1:1" },
    },
  };
  const data = await gemini(env, `models/${model}:generateContent`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const content: any[] = [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      content.push({
        type: "image",
        data: p.inlineData.data,
        mimeType: p.inlineData.mimeType || "image/png",
      });
    } else if (p.text) {
      content.push({ type: "text", text: p.text });
    }
  }
  if (content.length === 0) {
    return textContent(
      "La API no devolvió imagen. Puede ser un bloqueo de seguridad del prompt o un error del modelo. Intenta reformular el prompt."
    );
  }
  return { content };
}

async function editarImagen(env: Env, args: any) {
  const model = env.IMAGE_MODEL || "gemini-3-pro-image-preview";
  const img = await imagenABase64(args.imagen_url);
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: img.mimeType, data: img.data } },
          { text: args.instrucciones },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(args.aspect_ratio ? { imageConfig: { aspectRatio: args.aspect_ratio } } : {}),
    },
  };
  const data = await gemini(env, `models/${model}:generateContent`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const content: any[] = [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      content.push({
        type: "image",
        data: p.inlineData.data,
        mimeType: p.inlineData.mimeType || "image/png",
      });
    } else if (p.text) {
      content.push({ type: "text", text: p.text });
    }
  }
  if (content.length === 0) {
    return textContent("La API no devolvió imagen editada. Reformula las instrucciones.");
  }
  return { content };
}

async function imagenAVideo(env: Env, args: any) {
  const model = env.VIDEO_MODEL || "veo-3.1-generate-preview";
  const img = await imagenABase64(args.imagen_url);
  const body = {
    instances: [
      {
        prompt: args.prompt,
        image: { bytesBase64Encoded: img.data, mimeType: img.mimeType },
      },
    ],
    parameters: {
      aspectRatio: args.aspect_ratio || "16:9",
      ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
    },
  };
  const data = await gemini(env, `models/${model}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const op = data?.name;
  if (!op) throw new Error("La API no devolvió un ID de operación.");
  return textContent(
    `Video (imagen-a-video) en proceso. ID de operación:\n${op}\n\nTarda entre 1 y 4 minutos. Usa estado_video con este ID para obtener el enlace.`
  );
}

async function crearVideo(env: Env, args: any) {
  const model = env.VIDEO_MODEL || "veo-3.1-generate-preview";
  const body = {
    instances: [{ prompt: args.prompt }],
    parameters: {
      aspectRatio: args.aspect_ratio || "16:9",
      ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
    },
  };
  const data = await gemini(env, `models/${model}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const op = data?.name;
  if (!op) throw new Error("La API no devolvió un ID de operación.");
  return textContent(
    `Video en proceso. ID de operación:\n${op}\n\nEl video tarda entre 1 y 4 minutos. Usa la herramienta estado_video con este ID para obtener el enlace de descarga.`
  );
}

async function estadoVideo(env: Env, args: any, origin: string) {
  const op = String(args.operacion || "").trim();
  if (!op) throw new Error("Falta el ID de operación.");
  const data = await gemini(env, op, { method: "GET" });

  if (!data.done) {
    return textContent("El video aún se está generando. Vuelve a consultar en unos 30 segundos.");
  }
  if (data.error) {
    throw new Error(`La generación falló: ${data.error.message || JSON.stringify(data.error)}`);
  }
  const uri =
    data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    data?.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) {
    return textContent(
      `El video terminó pero no se encontró el archivo. Respuesta cruda:\n${JSON.stringify(data.response).slice(0, 1500)}`
    );
  }
  const token = env.MCP_TOKEN ? `&t=${encodeURIComponent(env.MCP_TOKEN)}` : "";
  const link = `${origin}/descargar?uri=${encodeURIComponent(uri)}${token}`;
  return textContent(
    `¡Video listo! Descárgalo aquí (enlace temporal):\n${link}\n\nÁbrelo en Safari y guárdalo en Fotos con el botón de compartir.`
  );
}

// ---------- Worker ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Proxy de descarga de videos (oculta la API key)
    if (url.pathname === "/descargar" && req.method === "GET") {
      if (env.MCP_TOKEN && url.searchParams.get("t") !== env.MCP_TOKEN) {
        return new Response("No autorizado", { status: 401 });
      }
      const uri = url.searchParams.get("uri");
      if (!uri || !uri.startsWith("https://generativelanguage.googleapis.com/")) {
        return new Response("URI inválida", { status: 400 });
      }
      const upstream = await fetch(uri, {
        headers: { "x-goog-api-key": env.GEMINI_API_KEY },
      });
      if (!upstream.ok) {
        return new Response(`Error al descargar el video (${upstream.status})`, { status: 502 });
      }
      return new Response(upstream.body, {
        headers: {
          "content-type": "video/mp4",
          "content-disposition": 'attachment; filename="video.mp4"',
        },
      });
    }

    // Endpoint MCP: /mcp  (o /mcp/<MCP_TOKEN> si configuraste el token)
    const expectedPath = env.MCP_TOKEN ? `/mcp/${env.MCP_TOKEN}` : "/mcp";
    if (url.pathname !== expectedPath && url.pathname !== "/mcp") {
      return new Response("OK - Servidor MCP de Gemini activo. Endpoint: " + expectedPath, { status: 200 });
    }
    if (env.MCP_TOKEN && url.pathname !== expectedPath) {
      return new Response("No autorizado", { status: 401 });
    }
    if (req.method === "GET") {
      return new Response("Método no permitido. El MCP usa POST.", { status: 405 });
    }
    if (req.method !== "POST") {
      return new Response("Método no permitido", { status: 405 });
    }

    let msg: any;
    try {
      msg = await req.json();
    } catch {
      return rpcError(null, -32700, "JSON inválido");
    }

    // Notificaciones (sin id): aceptar y no responder cuerpo
    if (msg && msg.method && msg.id === undefined) {
      return new Response(null, { status: 202 });
    }

    const { id, method, params } = msg || {};

    try {
      switch (method) {
        case "initialize":
          return rpcResult(id, {
            protocolVersion: params?.protocolVersion || "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "gemini-mcp", version: "1.0.0" },
          });

        case "ping":
          return rpcResult(id, {});

        case "tools/list":
          return rpcResult(id, { tools: TOOLS });

        case "tools/call": {
          const name = params?.name;
          const args = params?.arguments || {};
          let result;
          if (name === "generar_imagen") result = await generarImagen(env, args);
          else if (name === "editar_imagen") result = await editarImagen(env, args);
          else if (name === "crear_video") result = await crearVideo(env, args);
          else if (name === "imagen_a_video") result = await imagenAVideo(env, args);
          else if (name === "estado_video") result = await estadoVideo(env, args, url.origin);
          else return rpcError(id, -32602, `Herramienta desconocida: ${name}`);
          return rpcResult(id, result);
        }

        default:
          return rpcError(id, -32601, `Método no soportado: ${method}`);
      }
    } catch (e: any) {
      // Errores de herramienta: se devuelven como resultado con isError
      if (method === "tools/call") {
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${e.message || e}` }],
          isError: true,
        });
      }
      return rpcError(id, -32603, e.message || String(e));
    }
  },
};
