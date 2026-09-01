/**
 * IMP-005 / AUDIT-CONTEXT SPIKE — Candidate C: controlled server wrapper.
 * LOCAL ONLY. Binds 127.0.0.1. Started/stopped by run.mjs as a child process.
 *
 * The wrapper is a stand-in for a future Edge Function / server boundary:
 *  - validates the caller's Supabase access token against local GoTrue
 *  - derives trusted identity ONLY from the validated token
 *  - generates request_id / correlation_id server-side
 *  - observes connection metadata (socket IP, user-agent) itself
 *  - forwards the mutation to PostgREST RPC with the USER's token
 *    (RLS + live membership validation still enforced by the database)
 *  - holds the ONLY copy of the service-role key and the wrapper secret;
 *    browser code can never reach the service-actor path
 *
 * Required env (injected by run.mjs from `supabase status -o env`):
 *   API_URL, ANON_KEY, SERVICE_ROLE_KEY, WRAPPER_SECRET, WRAPPER_PORT
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY, WRAPPER_SECRET } = process.env;
const PORT = Number(process.env.WRAPPER_PORT || 5499);
for (const k of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'WRAPPER_SECRET']) {
  if (!process.env[k]) {
    console.error(`wrapper: missing env ${k}`);
    process.exit(1);
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function validateToken(token) {
  const res = await fetch(`${API_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json(); // GoTrue-validated user object
}

async function rpc(token, fn, args, extraHeaders = {}) {
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let payload = {};
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return json(res, 400, { error: 'invalid JSON body' });
    }
  }

  // --- Server-only service actor path -------------------------------------
  // Requires the wrapper secret (server config, never shipped to clients).
  // Uses the service-role key INSIDE this process only.
  if (url.pathname === '/wrap/service-event' && req.method === 'POST') {
    if (req.headers['x-wrapper-secret'] !== WRAPPER_SECRET) {
      return json(res, 403, { error: 'service path requires server credentials' });
    }
    const out = await rpc(SERVICE_ROLE_KEY, 'audctx_service_event', {
      p_firm_id: payload.firm_id ?? null,
      p_action: payload.action ?? 'SERVICE_EVENT',
      p_object_type: payload.object_type ?? 'audctx_resource',
      p_object_id: payload.object_id ?? null,
      p_service_name: 'audctx-spike-wrapper', // fixed by the server, not the caller
      p_correlation_id: payload.correlation_id ?? randomUUID(),
    });
    return json(res, out.status, out.body);
  }

  // --- Authenticated human path -------------------------------------------
  if (url.pathname === '/wrap/resource' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
    if (!token) return json(res, 401, { error: 'missing bearer token' });
    const user = await validateToken(token);
    if (!user?.id) return json(res, 401, { error: 'invalid or expired token' });

    // Trusted identity = validated token's user id. Arbitrary caller headers
    // such as x-actor-user-id / x-actor-type are NEVER consulted.
    const requestId = randomUUID();
    const correlationId =
      typeof req.headers['x-correlation-id'] === 'string'
        ? req.headers['x-correlation-id']
        : randomUUID();
    const out = await rpc(token, 'audctx_c_create_resource', {
      p_firm_id: payload.firm_id,
      p_name: payload.name,
      p_amount: payload.amount,
      p_client_key: payload.client_key ?? null,
      p_correlation_id: correlationId,
      p_request_id: requestId,
      p_ip: req.socket.remoteAddress ?? null, // wrapper-observed, not client-asserted
      p_user_agent: req.headers['user-agent'] ?? null,
      // RLS active-firm context: forwarded as UNTRUSTED context only; the
      // database live-validates it against FirmMembership (DEC-J).
    }, { 'x-active-firm': String(payload.firm_id ?? '') });
    return json(res, out.status, { request_id: requestId, correlation_id: correlationId, rpc: out.body });
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`audctx wrapper listening on http://127.0.0.1:${PORT}`);
});
