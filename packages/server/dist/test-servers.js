import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
/** Test-owned loopback fixture: no external requests, no persistent resources. */
export async function localServer(options) {
    const server = createServer(options.http ??
        ((_request, response) => {
            response.writeHead(404).end();
        }));
    const sockets = new WebSocketServer({ server });
    if (options.ws)
        sockets.on('connection', options.ws);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing fixture address');
    return {
        url: `http://127.0.0.1:${address.port}`,
        async close() {
            for (const client of sockets.clients)
                client.terminate();
            await new Promise((resolve) => sockets.close(() => resolve()));
            server.closeAllConnections();
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
export async function jsonBody(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString());
}
export function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
//# sourceMappingURL=test-servers.js.map