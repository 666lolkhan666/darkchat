const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FILE_PATH = /^\/attachments\/([A-Za-z0-9_-]{1,128})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim());
  const allowed = allowedOrigins.includes(origin) || origin === "http://localhost:5173";
  return allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    : { "Vary": "Origin" };
}

function reply(request, env, body, status, extraHeaders = {}) {
  const headers = new Headers(corsHeaders(request, env));
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  if (body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(body, { status, headers });
}

async function authenticatedUid(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || match[1].length > 8192) return null;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: match[1] })
    }
  );
  if (!response.ok) return null;
  const account = await response.json();
  return account.users?.[0]?.localId || null;
}

function allowedFileType(value) {
  const type = (value || "").toLowerCase().split(";")[0].trim();
  if (/^image\/(jpeg|png|gif|webp|avif)$/.test(type)) return type;
  if (/^video\/(mp4|webm)$/.test(type)) return type;
  if (/^audio\/(mpeg|ogg|wav|mp4|webm)$/.test(type)) return type;
  if (type === "application/pdf") return type;
  return "application/octet-stream";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request, env);
      if (!headers["Access-Control-Allow-Origin"]) {
        return reply(request, env, "Origin is not allowed.", 403);
      }
      return new Response(null, { status: 204, headers });
    }

    const match = FILE_PATH.exec(new URL(request.url).pathname);
    if (!match) return reply(request, env, "Invalid file path.", 400);
    if (!["GET", "PUT", "DELETE"].includes(request.method)) {
      return reply(request, env, "Method not allowed.", 405, { Allow: "GET, PUT, DELETE, OPTIONS" });
    }
    if (!env.FILES || !env.FIREBASE_API_KEY || !env.OWNER_UID || !env.ALLOWED_ORIGINS) {
      return reply(request, env, "File service is not configured.", 503);
    }

    let uid;
    try {
      uid = await authenticatedUid(request, env);
    } catch {
      return reply(request, env, "Authentication service unavailable.", 502);
    }
    if (!uid) return reply(request, env, "Valid Firebase sign-in required.", 401);

    const [, threadId, fileId] = match;
    if (uid !== env.OWNER_UID && uid !== threadId) {
      return reply(request, env, "You cannot access this conversation's files.", 403);
    }

    const key = `attachments/${threadId}/${fileId}`;
    if (request.method === "PUT") {
      const size = Number(request.headers.get("Content-Length"));
      if (
        !request.body ||
        (request.headers.has("Content-Length") && (!Number.isSafeInteger(size) || size < 1)) ||
        size > MAX_FILE_BYTES
      ) {
        return reply(request, env, "Files must be between 1 byte and 50 MB.", 413);
      }
      let received = 0;
      const boundedBody = request.body?.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_FILE_BYTES) throw new RangeError("File exceeds the 50 MB limit.");
          controller.enqueue(chunk);
        }
      }));
      let object;
      try {
        object = await env.FILES.put(key, boundedBody, {
          httpMetadata: {
            contentType: allowedFileType(request.headers.get("Content-Type"))
          }
        });
      } catch (error) {
        if (received > MAX_FILE_BYTES) {
          return reply(request, env, "Files must be between 1 byte and 50 MB.", 413);
        }
        console.error("R2 upload failed:", error);
        return reply(request, env, "Upload failed.", 502);
      }
      if (received < 1) return reply(request, env, "Files cannot be empty.", 413);
      if (!object) return reply(request, env, "Upload failed.", 500);
      return reply(request, env, "Uploaded.", 201);
    }

    if (request.method === "DELETE") {
      try {
        await env.FILES.delete(key);
      } catch (error) {
        console.error("R2 delete failed:", error);
        return reply(request, env, "File removal failed.", 502);
      }
      return reply(request, env, null, 204);
    }

    let object;
    try {
      object = await env.FILES.get(key);
    } catch (error) {
      console.error("R2 download failed:", error);
      return reply(request, env, "File download failed.", 502);
    }
    if (!object) return reply(request, env, "File not found.", 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Disposition", "attachment");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Cache-Control", "private, no-store");
    return reply(request, env, object.body, 200, Object.fromEntries(headers));
  }
};
