import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';

export async function installWorkbench(app: FastifyInstance, store: Store) {
  const sessions = new Map<string, number>(), tickets = new Map<string, number>();
  const assets: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const tokenMatches = (token: string) => {
    const a = Buffer.from(token), b = Buffer.from(process.env.API_TOKEN!);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const cookie = (token: string) => `dpi_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
  const createSession = () => { const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 28800000); return token; };
  const prune = () => { for (const map of [sessions, tickets]) for (const [key, expiry] of map) if (expiry <= Date.now()) map.delete(key); };
  const authorized = (req: FastifyRequest) => {
    prune();
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('dpi_session='))?.slice(12);
    if (!token || !sessions.has(token)) return false;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-dpi-workbench'] !== '1') return false;
    return true;
  };
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });
  for (const [path, file] of Object.entries(assets)) app.get(path, async (_req, reply) => reply.type(file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css').send(await readFile(new URL(`../public/${file}`, import.meta.url))));
  app.post('/session/login', async (req, reply) => {
    const body = z.object({ token: z.string().max(500) }).parse(req.body);
    if (!tokenMatches(body.token)) return reply.code(401).send({ error: 'Invalid local access token' });
    reply.header('Set-Cookie', cookie(createSession())); return { ok: true };
  });
  app.post('/session/logout', async (req, reply) => {
    const token = req.headers.cookie?.match(/(?:^|;\s*)dpi_session=([^;]+)/)?.[1];
    if (token) sessions.delete(token);
    reply.header('Set-Cookie', 'dpi_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true };
  });
  app.post('/workbench/ticket', async () => { prune(); const ticket = randomBytes(32).toString('hex'); tickets.set(ticket, Date.now() + 60000); return { ticket }; });
  app.get('/session/open', async (req, reply) => {
    prune(); const { ticket } = z.object({ ticket: z.string() }).parse(req.query);
    if (!tickets.delete(ticket)) return reply.code(401).send({ error: 'Launch link expired; run Open-Workbench.ps1 again' });
    reply.header('Set-Cookie', cookie(createSession())); return reply.redirect('/');
  });
  await store.pool.query(`CREATE TABLE IF NOT EXISTS connections (id uuid PRIMARY KEY, name text NOT NULL, target text NOT NULL, schema jsonb NOT NULL, created_at timestamptz DEFAULT now())`);
  app.get('/connections', async () => (await store.pool.query('SELECT * FROM connections ORDER BY created_at')).rows);
  app.post('/connections', async req => {
    const body = z.object({ name: z.string().min(1).max(80), target: z.enum(['simulator', 'phu', 'hospital', 'catalog-only']), schema: z.record(z.string(), z.unknown()) }).strict().parse(req.body);
    const { rows } = await store.pool.query('INSERT INTO connections(id,name,target,schema) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING *', [body.name, body.target, body.schema]);
    return rows[0];
  });
  app.post<{ Params: { id: string } }>('/connections/:id/test', async req => {
    const { rows } = await store.pool.query('SELECT target FROM connections WHERE id=$1', [z.string().uuid().parse(req.params.id)]);
    if (!rows[0]) throw new Error('Connection not found');
    const target = rows[0].target;
    if (target === 'simulator') return { ready: true, detail: 'Local synthetic assessment endpoint available; independent reference contract' };
    if (target === 'catalog-only') return { ready: false, detail: 'Catalog entry only; no runtime adapter configured' };
    const base = target === 'phu' ? process.env.OPENMRS_BASE_URL : process.env.HOSPITAL_OPENMRS_BASE_URL;
    if (!base) return { ready: false, detail: 'Server-side endpoint is not configured' };
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/session`, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return { ready: false, detail: 'OpenMRS initializing or unavailable' };
      const data: any = await response.json();
      return { ready: typeof data.authenticated === 'boolean', detail: 'Session API reachable; this does not verify write access or delivery' };
    } catch { return { ready: false, detail: 'Endpoint did not respond within 8 seconds' }; }
  });
  return { authorized, publicPath: (url: string) => Object.hasOwn(assets, url) || url === '/health' || url === '/session/login' || url.startsWith('/session/open?') };
}
