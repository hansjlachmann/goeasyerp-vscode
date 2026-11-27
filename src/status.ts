import { messages } from './messages';

export type ServerState =
  { kind: 'offline' } | { kind: 'running'; build: number } | { kind: 'building'; step?: string };

/** The status bar's text for the server of a launch configuration. */
export function statusText(server: string, state: ServerState): string {
  const host = server.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  switch (state.kind) {
    case 'offline':
      return `$(debug-disconnect) ${host}: ${messages.offline}`;
    case 'running':
      return `$(server) ${host}: ${messages.runningBuild(state.build)}`;
    case 'building':
      return `$(sync~spin) ${host}: ${messages.building(state.step ?? '')}`.trimEnd();
  }
}
