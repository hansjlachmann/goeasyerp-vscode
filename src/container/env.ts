import { randomBytes } from 'node:crypto';

/**
 * The variables the compose files read. The developer's environment must not set them: it would
 * take precedence over the container's .env file.
 */
export const COMPOSE_VARIABLES = [
  'BUILDER_DB_PASSWORD',
  'COMPANY_NAME',
  'COMPOSE_PROFILES',
  'DEMO_DATA',
  'GOEASYERP_BIND',
  'GOEASYERP_ORIGIN',
  'GOEASYERP_PORT',
  'JWT_SECRET',
  'OPENERP_ENCRYPTION_KEY',
  'OPENERP_ENCRYPTION_KEY_OLD',
  'POSTGRES_PASSWORD',
  'SESSION_IDLE_TIMEOUT',
  'SETUP_TOKEN',
];

function secret(hexLength: number): string {
  return randomBytes(hexLength / 2).toString('hex');
}

/** The content of a new container's .env file, with new random secrets. */
export function newEnvFile(port: number): string {
  const values: Record<string, string> = {
    JWT_SECRET: secret(64),
    POSTGRES_PASSWORD: secret(48),
    OPENERP_ENCRYPTION_KEY: secret(64),
    SETUP_TOKEN: secret(32),
    BUILDER_DB_PASSWORD: secret(48),
    COMPOSE_PROFILES: 'apps',
    GOEASYERP_BIND: '127.0.0.1',
    GOEASYERP_PORT: String(port),
    DEMO_DATA: 'SMALL',
  };
  return Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join('');
}

export function readEnvValue(content: string, name: string): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1);
}

export function composeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Windows treats the names of environment variables as case-insensitive.
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !COMPOSE_VARIABLES.includes(name.toUpperCase())),
  );
}
