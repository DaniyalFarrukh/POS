import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app';

let appPromise: Promise<ReturnType<typeof buildApp>> | null = null;

async function getFastifyApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = buildApp({
        logger: false,
        trustProxy: true,
      });
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const origin = (req.headers.origin as string) || '*';

  // Instant CORS preflight response
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Origin, X-Requested-With, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.end();
    return;
  }

  try {
    const app = await getFastifyApp();
    await app.ready();

    // Preserve original path across Vercel rewrites
    const matchedPath = req.headers['x-matched-path'];
    if (typeof matchedPath === 'string' && matchedPath.startsWith('/')) {
      req.url = matchedPath;
    }

    // Fastify handles native Node HTTP (req, res) directly
    app.server.emit('request', req, res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    res.statusCode = 500;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server initialization error', details: message }));
  }
}
