import { messages } from './messages';

const MIN_LENGTH = 10;

/**
 * The server's password rules that can be checked here; it also refuses common passwords.
 * Returns what is wrong, or undefined.
 */
export function passwordProblem(password: string, userId: string): string | undefined {
  if ([...password].length < MIN_LENGTH) {
    return messages.passwordTooShort(MIN_LENGTH);
  }
  if (password.toLowerCase().includes(userId.toLowerCase())) {
    return messages.passwordHasUserId(userId);
  }
  return undefined;
}

/** The key of a password in the secret storage. */
export function passwordKey(server: string, userId: string): string {
  return `goeasyerp.password:${server.replace(/\/+$/, '').toLowerCase()}:${userId.toUpperCase()}`;
}
