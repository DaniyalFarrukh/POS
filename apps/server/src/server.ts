import { buildApp } from './app';

const server = buildApp();
const port = 3001;

server.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`POS Cloud Server listening at ${address}`);
});
