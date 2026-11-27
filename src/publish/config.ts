import { messages } from '../messages';

/** What a launch configuration says about a publish. */
export interface Target {
  server: string;
  user: string;
  company: string;
  /** The page the browser opens; undefined: the server's start. */
  startupPageId: number | undefined;
  openBrowser: boolean;
}

export const DEFAULT_CONFIGURATION = {
  type: 'goeasyerp',
  request: 'launch',
  name: 'Local container',
  server: 'http://localhost:8080',
  company: 'main',
  user: 'ADMIN',
};

/** Reads a launch configuration. Throws with a text for the user when it cannot be used. */
export function readTarget(configuration: Record<string, unknown>): Target {
  const text = (name: string, fallback: string): string => {
    const value = configuration[name] ?? fallback;
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(messages.badSetting(name));
    }
    return value.trim();
  };
  const server = text('server', '').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new Error(messages.badSetting('server'));
  }
  // Only the server's address: a path would be left out of the requests.
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username) {
    throw new Error(messages.badSetting('server'));
  }
  const mode = configuration.schemaUpdateMode ?? 'synchronize';
  if (mode === 'recreate') {
    throw new Error(messages.noRecreate);
  }
  if (mode !== 'synchronize') {
    throw new Error(messages.badSetting('schemaUpdateMode'));
  }
  const page = configuration.startupPageId;
  if (page !== undefined && !(Number.isInteger(page) && (page as number) > 0)) {
    throw new Error(messages.badSetting('startupPageId'));
  }
  return {
    server,
    user: text('user', 'ADMIN'),
    company: text('company', 'main'),
    startupPageId: page as number | undefined,
    openBrowser: configuration.openBrowser !== false,
  };
}

/** The address the extension calls. A local container listens on 127.0.0.1 only. */
export function requestAddress(server: string): string {
  const url = new URL(server);
  if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1';
  }
  return url.origin;
}

export function startPage(target: Target): string {
  return target.startupPageId
    ? `${target.server}/pages/${target.startupPageId}`
    : `${target.server}/`;
}
