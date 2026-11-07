import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';

const VERSION = '1.0.0';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Creates the agent's HTTP server. Every request (even unauthenticated health checks) extends the keep-awake
 * lease, because the first request after a dark wake is what has to stop the Mac going straight back to sleep.
 *
 * Routes:
 *   GET  /health                -> liveness, no auth
 *   GET  /jobs                  -> configured job names + recent runs
 *   POST /jobs                  -> start `{ job }` or `{ command, cwd }`
 *   GET  /jobs/:id              -> one run
 *   GET  /jobs/:id/log?offset=N -> log text from byte N (`X-Next-Offset` header)
 *   POST /jobs/:id/cancel       -> cancel a run
 *   POST /keep-awake            -> `{ seconds }` hold the Mac awake without running anything
 * @param config - agent config
 * @param jobService - job service
 * @param keepAwake - keep-awake manager
 */
export function createAgentServer(config, jobService, keepAwake) {
  return http.createServer((req, res) => {
    keepAwake.extend(config.keepAwakeSeconds);
    handleRequest(config, jobService, keepAwake, req, res).catch((err) => {
      sendJson(res, err.status || 500, { error: err.message });
    });
  });
}

/**
 * Authenticates and dispatches a single request.
 * @param config - agent config
 * @param jobService - job service
 * @param keepAwake - keep-awake manager
 * @param req - incoming request
 * @param res - response
 */
async function handleRequest(config, jobService, keepAwake, req, res) {
  const url = new URL(req.url, 'http://agent');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, hostname: os.hostname(), version: VERSION, uptimeSeconds: Math.round(os.uptime()) });
  }
  if (!isAuthorized(config.token, req.headers.authorization)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (parts[0] === 'keep-awake' && req.method === 'POST') {
    const { seconds = config.keepAwakeSeconds } = await readJsonBody(req);
    keepAwake.extend(Math.min(Number(seconds) || 0, 6 * 3600));
    return sendJson(res, 200, { ok: true, seconds: Number(seconds) });
  }
  if (parts[0] !== 'jobs') return sendJson(res, 404, { error: 'Not found' });
  return routeJobs(config, jobService, req, res, parts.slice(1), url);
}

/**
 * Handles every /jobs route.
 * @param config - agent config
 * @param jobService - job service
 * @param req - incoming request
 * @param res - response
 * @param parts - path segments after `/jobs`
 * @param url - parsed URL
 */
async function routeJobs(config, jobService, req, res, parts, url) {
  const [id, action] = parts;
  if (!id && req.method === 'GET') {
    const definitions = Object.fromEntries(Object.entries(config.jobs).map(([name, def]) => [name, def.description || def.command]));
    return sendJson(res, 200, { jobs: definitions, allowArbitraryCommands: config.allowArbitraryCommands, runs: jobService.list() });
  }
  if (!id && req.method === 'POST') return sendJson(res, 202, jobService.start(await readJsonBody(req)));
  const record = jobService.get(id);
  if (!record) return sendJson(res, 404, { error: `No job ${id}` });
  if (!action && req.method === 'GET') return sendJson(res, 200, record);
  if (action === 'log' && req.method === 'GET') {
    const { text, nextOffset } = jobService.readLog(id, Number(url.searchParams.get('offset') || 0));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Next-Offset': String(nextOffset), 'X-Job-Status': record.status });
    return res.end(text);
  }
  if (action === 'cancel' && req.method === 'POST') return sendJson(res, 200, jobService.cancel(id));
  return sendJson(res, 404, { error: 'Not found' });
}

/**
 * Constant-time bearer token comparison.
 * @param token - configured secret
 * @param header - Authorization header value
 */
export function isAuthorized(token, header) {
  const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Reads and parses a JSON request body (empty body -> `{}`), rejecting bodies over 64KB.
 * @param req - incoming request
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) reject(Object.assign(new Error('Body too large'), { status: 413 }));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
  });
}

/**
 * Writes a JSON response.
 * @param res - response
 * @param status - HTTP status
 * @param payload - body
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}
