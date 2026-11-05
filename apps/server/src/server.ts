import { buildApp } from './app';
import { getJwtSecret } from './auth/jwt';
import { getDatabaseUrl } from './db';

// Ensure JWT_SECRET and DATABASE_URL are properly configured on startup (fails fast in production)
getJwtSecret();
getDatabaseUrl();

const server = buildApp();
const port = Number(process.env.PORT) || 3000;

server.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`POS Cloud Server listening at ${address}`);
});
