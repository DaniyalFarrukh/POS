import type { IncomingMessage, ServerResponse } from 'node:http';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../src/app';

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
  try {
    const app = await getFastifyApp();
    await app.ready();

    const rawUrl = req.url || '/';
    let targetUrl = rawUrl;
    if (targetUrl === '/api' || targetUrl === '/api/index' || targetUrl === '/api/') {
      const forwarded = req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
      if (typeof forwarded === 'string' && forwarded.startsWith('/')) {
        targetUrl = forwarded;
      } else {
        targetUrl = '/';
      }
    }

    // Fastify inject handles request and returns response object with zero native event timing bugs
    const injectOpts: InjectOptions = {
      method: (req.method || 'GET') as InjectOptions['method'],
      url: targetUrl,
      headers: req.headers,
      payload: req,
    };
    const response = await app.inject(injectOpts);

    res.statusCode = response.statusCode;
    for (const [key, val] of Object.entries(response.headers)) {
      if (val !== undefined) {
        res.setHeader(key, val);
      }
    }
    res.end(response.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server initialization error', details: message }));
  }
}

