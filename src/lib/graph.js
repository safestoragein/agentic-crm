// Server-only Microsoft Graph client (app-only / client-credentials flow).
//
// The Entra app ("Safestorage Payment Mail") holds APPLICATION permissions
// (Mail.Read / Mail.ReadWrite / Mail.Send), so there is no signed-in user and no
// refresh token — we mint an app token straight from the tenant and call Graph
// as the app. Never import this from a client component: MS_CLIENT_SECRET must
// never reach the browser.
//
// Env (see .env.example):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET

const LOGIN_HOST = "https://login.microsoftonline.com";
export const GRAPH = "https://graph.microsoft.com/v1.0";

// Cached app token. Tokens live 60min; we refresh 5min early so a request never
// races the expiry. One cache per serverless instance — that's fine, a cold
// instance just mints its own.
let _token = null; // { value, expiresAt }
let _inflight = null; // dedupe concurrent mints on a cold instance

export function graphConfigured() {
  return Boolean(
    process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET
  );
}

export class GraphError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

async function mintToken() {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`${LOGIN_HOST}/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new GraphError(
      json?.error_description?.split("\n")[0] || `token request failed (${res.status})`,
      500,
      json?.error || "token_error"
    );
  }
  return {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 - 5 * 60 * 1000,
  };
}

export async function getToken() {
  if (!graphConfigured()) {
    throw new GraphError("Microsoft Graph is not configured (missing MS_* env vars)", 503, "not_configured");
  }
  if (_token && Date.now() < _token.expiresAt) return _token.value;
  if (!_inflight) {
    _inflight = mintToken()
      .then((t) => {
        _token = t;
        return t.value;
      })
      .finally(() => {
        _inflight = null;
      });
  }
  return _inflight;
}

// Call Graph. `path` is everything after /v1.0, e.g.
//   `/users/sales@safestorage.in/messages?$top=25`
// Returns parsed JSON, or null for 204 No Content. Throws GraphError otherwise.
export async function graph(path, { method = "GET", body, headers = {} } = {}) {
  const token = await getToken();
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : null),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 204) return null;

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error || {};
    throw new GraphError(err.message || `Graph request failed (${res.status})`, res.status, err.code);
  }
  return json;
}

// Fetch a raw binary Graph resource (attachment $value). Returns the Response so
// the caller can stream it straight through.
export async function graphRaw(path) {
  const token = await getToken();
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GraphError(`Graph request failed (${res.status})`, res.status, "raw_error");
  }
  return res;
}

// Turn any thrown error into a JSON Response. Graph's own messages are safe to
// surface to an admin UI (they say things like "mailbox not found").
export function graphErrorResponse(e) {
  const status = e instanceof GraphError ? e.status : 500;
  return Response.json(
    { error: e?.message || "Unexpected error", code: e?.code || null },
    { status: status >= 400 && status < 600 ? status : 500 }
  );
}
