import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Called with the percentage received, when the server says how large the file is. */
  onPercent?: (percent: number) => void;
}

/** Downloads a file and returns the SHA-256 of what was written. */
export async function downloadFile(
  url: string,
  target: string,
  options: DownloadOptions = {},
): Promise<string> {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok || !response.body) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length'));
  const hash = createHash('sha256');
  let received = 0;
  let reported = -1;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      received += chunk.length;
      const percent = total > 0 ? Math.floor((received / total) * 100) : -1;
      if (percent > reported) {
        reported = percent;
        options.onPercent?.(percent);
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(target), {
    signal: options.signal,
  });
  return hash.digest('hex');
}
