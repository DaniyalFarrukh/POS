import { buildApp } from './app';
import { getJwtSecret } from './auth/jwt';

// Ensure JWT_SECRET is properly configured on startup (fails fast in production)
getJwtSecret();

const server = buildApp();
const port = Number(process.env.PORT) || 3000;

server.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`POS Cloud Server listening at ${address}`);
});
