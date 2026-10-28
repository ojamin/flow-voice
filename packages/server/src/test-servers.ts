import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

/** Test-owned loopback fixture: no external requests, no persistent resources. */
export async function localServer(options: {
  http?: (request: IncomingMessage, response: ServerResponse) => void;
  ws?: (socket: WebSocket, request: IncomingMessage) => void;
}) {
  const server = createServer(
    options.http ??
      ((_request, response) => {
        response.writeHead(404).end();
      }),
  );
  const sockets = new WebSocketServer({ server });
  if (options.ws) sockets.on('connection', options.ws);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
