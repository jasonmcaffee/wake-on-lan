import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMagicPacket, sendMagicPackets } from '../src/utils/magicPacket.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'test-token-123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wol-test-'));
const ctx = { port: 0, agent: null, configPath: path.join(tmp, 'agent.json') };

/**
 * Finds a free TCP port on localhost.
 */
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/**
 * Writes the agent config used by the tests.
 * @param port - agent port
 */
function writeAgentConfig(port) {
  const config = {
    port, host: '127.0.0.1', token: TOKEN, advertiseBonjour: false, allowArbitraryCommands: true, keepAwakeSeconds: 30, dataDir: path.join(tmp, 'data'),
    jobs: { hello: { command: 'echo "hello from $PWD"; echo to-stderr 1>&2', cwd: tmp, description: 'says hello' }, fail: { command: 'echo boom; exit 3' }, slow: { command: 'sleep 30' } },
  };
  fs.writeFileSync(ctx.configPath, JSON.stringify(config));
}

/**
 * Starts the agent and resolves once it logs that it is listening.
 */
function startAgent() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'bin/wol-agent.js')], { env: { ...process.env, WOL_AGENT_CONFIG: ctx.configPath } });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(proc); });
    proc.on('exit', (code) => reject(new Error(`agent exited ${code}`)));
  });
}

/**
 * Runs the `wol` CLI against the test agent and collects its output.
 * @param args - CLI arguments
 */
function wol(args) {
  const env = { ...process.env, WOL_CONFIG: path.join(tmp, 'none.json'), WOL_HOST: '127.0.0.1', WOL_PORT: String(ctx.port), WOL_TOKEN: TOKEN };
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'bin/wol.js'), ...args], { env });
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  ctx.port = await freePort();
  writeAgentConfig(ctx.port);
  ctx.agent = await startAgent();
});

after(() => {
  ctx.agent?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('magic packet is 6x0xFF + MAC x16 and arrives over UDP', async () => {
  const packet = buildMagicPacket('02-00-00-00-00-01');
  assert.equal(packet.length, 102);
  assert.deepEqual([...packet.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  assert.equal(packet.subarray(96).toString('hex'), '020000000001');
  const listener = dgram.createSocket('udp4');
  await new Promise((r) => listener.bind(0, '127.0.0.1', r));
  const received = new Promise((r) => listener.once('message', r));
  const sent = await sendMagicPackets(['02:00:00:00:00:01'], ['127.0.0.1'], [listener.address().port]);
  assert.equal(sent, 1);
  assert.deepEqual(await received, packet);
  listener.close();
});

test('API rejects requests without the token, health stays open', async () => {
  const base = `http://127.0.0.1:${ctx.port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/jobs`)).status, 401);
  assert.equal((await fetch(`${base}/jobs`, { headers: { Authorization: 'Bearer wrong-token-12' } })).status, 401);
});

test('wol run streams a named job and exits 0', async () => {
  const { code, stdout, stderr } = await wol(['run', 'hello']);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /hello from /);
  assert.match(stdout, /to-stderr/);
  assert.match(stderr, /hello succeeded/);
});

test('wol run propagates a failing job exit code', async () => {
  const { code, stdout } = await wol(['run', 'fail']);
  assert.equal(code, 3);
  assert.match(stdout, /boom/);
});

test('unknown jobs are refused', async () => {
  const { code, stderr } = await wol(['run', 'nope']);
  assert.equal(code, 2);
  assert.match(stderr, /404.*Unknown job "nope"/);
});

test('wol exec runs an arbitrary command when allowed', async () => {
  const { code, stdout } = await wol(['exec', 'echo $((6*7))', '--cwd', tmp]);
  assert.equal(code, 0);
  assert.match(stdout, /42/);
});

test('a running job can be cancelled', async () => {
  const started = await wol(['run', 'slow', '--no-follow']);
  const { id } = JSON.parse(started.stdout);
  await wol(['cancel', id]);
  const logs = await wol(['logs', id]);
  assert.equal(logs.code, 1);
  const jobs = JSON.parse((await wol(['jobs'])).stdout);
  assert.equal(jobs.runs.find((r) => r.id === id).status, 'cancelled');
});

test('wol wake keeps probing until a late agent comes up (simulated wake)', async () => {
  ctx.agent.kill();
  await new Promise((r) => ctx.agent.once('exit', r));
  const waking = wol(['wake', '--timeout', '30', '--mac', '02:00:00:00:00:01', '--broadcast', '127.0.0.1']);
  await new Promise((r) => setTimeout(r, 4000));
  ctx.agent = await startAgent();
  const { code, stderr } = await waking;
  assert.equal(code, 0, stderr);
  assert.match(stderr, /sent \d+ magic packet/);
  assert.match(stderr, /woke after \d+s/);
});

test('wol status reports unreachable without waking', async () => {
  const env = ['status', '--port', String(await freePort())];
  const { code, stdout } = await wol(env);
  assert.equal(code, 0);
  assert.match(stdout, /asleep or unreachable/);
});
