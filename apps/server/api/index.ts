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
  const app = await getFastifyApp();
  app.server.emit('request', req, res);
}

