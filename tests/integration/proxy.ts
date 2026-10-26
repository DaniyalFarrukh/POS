import http from 'node:http';

export type ProxyMode = 'normal' | 'drop' | '503';

export interface TestNetworkProxy {
  url: string;
  port: number;
  setMode: (mode: ProxyMode) => void;
  setDelay: (ms: number) => void;
  setDropNextResponse: (enable: boolean) => void;
  setDropNextPushResponse: (enable: boolean) => void;
  close: () => Promise<void>;
}

/**
 * Creates a controllable in-process HTTP reverse proxy for testing network failures,
 * connection dropping, 503 outages, and simulated latency.
 */
export async function createNetworkProxy(targetUrl: string): Promise<TestNetworkProxy> {
  let mode: ProxyMode = 'normal';
  let delayMs = 0;
  let dropNextResponse = false;
  let dropNextPushResponse = false;

  const target = new URL(targetUrl);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (mode === 'drop') {
        // Drop client connection abruptly after receiving request
        req.socket.destroy();
        return;
      }

      if (mode === '503') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Service Unavailable (Proxy Simulated 503)' }));
        return;
      }

      // Normal mode: forward request to target Fastify server
      const body = Buffer.concat(chunks);
      const options: http.RequestOptions = {
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${target.hostname}:${target.port}`,
        },
      };

      const isPush = Boolean(req.url?.includes('/sync/push') && req.method === 'POST');
      const proxyReq = http.request(options, (proxyRes) => {
        if (dropNextPushResponse && isPush) {
          dropNextPushResponse = false;
          // Consume and discard target response so target Fastify server finishes cleanly
          proxyRes.resume();
          proxyRes.on('end', () => {
            req.socket.destroy();
          });
          return;
        }

        if (dropNextResponse) {
          dropNextResponse = false;
          // Consume response from target so target Fastify server finishes cleanly
          proxyRes.resume();
          proxyRes.on('end', () => {
            req.socket.destroy();
          });
          return;
        }

        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy forward error', message: err.message }));
        }
      });

      if (body.length > 0) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    port: address.port,
    setMode: (newMode: ProxyMode) => {
      mode = newMode;
    },
    setDelay: (ms: number) => {
      delayMs = ms;
    },
    setDropNextResponse: (enable: boolean) => {
      dropNextResponse = enable;
    },
    setDropNextPushResponse: (enable: boolean) => {
      dropNextPushResponse = enable;
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
