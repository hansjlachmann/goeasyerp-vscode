/** The server of the first GoEasyERP launch configuration. */
export function launchServer(configurations: unknown): string | undefined {
  if (!Array.isArray(configurations)) {
    return undefined;
  }
  for (const configuration of configurations as { type?: unknown; server?: unknown }[]) {
    const server = configuration?.server;
    if (
      configuration?.type === 'goeasyerp' &&
      typeof server === 'string' &&
      /^https?:\/\/[^/]/i.test(server)
    ) {
      return server;
    }
  }
  return undefined;
}
