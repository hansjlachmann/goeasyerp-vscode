import { createServer } from 'node:net';

export const DEFAULT_PORT = 8080;

// Each address on its own: on some systems a listener on one of them does not block the others.
const ADDRESSES = ['127.0.0.1', '0.0.0.0', '::1', '::'];

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // A computer without IPv6 has nothing listening there.
      resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT');
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export async function isPortFree(port: number): Promise<boolean> {
  for (const address of ADDRESSES) {
    if (!(await canListen(port, address))) {
      return false;
    }
  }
  return true;
}

/** The first port from `from` that nothing listens on and that is not reserved. */
export async function findFreePort(
  from: number = DEFAULT_PORT,
  reserved: readonly number[] = [],
): Promise<number> {
  for (let port = from; port <= 65535; port++) {
    if (!reserved.includes(port) && (await isPortFree(port))) {
      return port;
    }
  }
  throw new Error('No free port');
}
