/** The oldest base release with the development endpoint. */
export const MIN_BASE_VERSION = '0.1.194';

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function isVersion(text: string): boolean {
  return VERSION.test(text);
}

/** Negative when a is older than b, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function parts(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (!match) {
    throw new Error(`Not a version: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
