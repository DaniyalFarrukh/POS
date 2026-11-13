import type { IncomingMessage, ServerResponse } from 'node:http';
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
    await new Promise<void>((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
      app.server.emit('request', req, res);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server initialization error', details: message }));
  }
}

