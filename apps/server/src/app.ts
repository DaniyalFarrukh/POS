import Fastify, { type FastifyInstance } from 'fastify';
import { getSharedInfo } from '@pos/shared';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const sharedInfo = getSharedInfo();

  app.get('/health', async () => {
    return {
      ok: true,
      app: sharedInfo.appName,
      version: sharedInfo.version,
    };
  });

  return app;
}
