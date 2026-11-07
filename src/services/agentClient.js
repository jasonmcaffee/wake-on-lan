/**
 * Creates a small HTTP client for the wol-agent API.
 * @param config - client config (host, port, token)
 */
export function createAgentClient(config) {
  const base = `http://${config.host}:${config.port}`;

  /**
   * Performs a request and returns the raw Response; throws on network errors and timeouts.
   * @param method - HTTP method
   * @param path - request path
   * @param body - JSON body (optional)
   * @param timeoutMs - abort after this long
   */
  function request(method, path, body, timeoutMs = 10000) {
    const headers = { Authorization: `Bearer ${config.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  }

  /**
   * Performs a request and parses its JSON, throwing with the agent's error message on non-2xx.
   * @param method - HTTP method
   * @param path - request path
   * @param body - JSON body (optional)
   */
  async function requestJson(method, path, body) {
    const res = await request(method, path, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.error || res.statusText}`);
    return data;
  }

  return {
    /** True when GET /health answers within `timeoutMs`. @param timeoutMs - probe timeout */
    async isHealthy(timeoutMs = 2000) {
      try { return (await request('GET', '/health', undefined, timeoutMs)).ok; } catch { return false; }
    },
    /** Health payload. */
    health: () => requestJson('GET', '/health'),
    /** Configured jobs and recent runs. */
    listJobs: () => requestJson('GET', '/jobs'),
    /** Starts a job. @param body - `{ job }` or `{ command, cwd }` */
    startJob: (body) => requestJson('POST', '/jobs', body),
    /** One run. @param id - job id */
    getJob: (id) => requestJson('GET', `/jobs/${id}`),
    /** Cancels a run. @param id - job id */
    cancelJob: (id) => requestJson('POST', `/jobs/${id}/cancel`),
    /** Holds the Mac awake. @param seconds - lease length */
    keepAwake: (seconds) => requestJson('POST', '/keep-awake', { seconds }),
    /**
     * Reads log text from a byte offset.
     * @param id - job id
     * @param offset - byte offset
     */
    async readLog(id, offset) {
      const res = await request('GET', `/jobs/${id}/log?offset=${offset}`);
      if (!res.ok) throw new Error(`log ${id} -> ${res.status}`);
      return { text: await res.text(), nextOffset: Number(res.headers.get('x-next-offset') || offset), status: res.headers.get('x-job-status') };
    },
  };
}
