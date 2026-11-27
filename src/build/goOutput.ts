import { isAbsolute, join, relative } from 'node:path';

const LOCATION = /^(vet: )?(.+?\.(?:go|mod|work))(:\d+(?::\d+)?: .*)$/;

/**
 * Go names files relative to the folder it ran in. The editor's problem matcher reads them
 * relative to the workspace folder.
 */
export function relativeToWorkspace(output: string, root: string, appDirectory: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = LOCATION.exec(line);
      if (!match) {
        return line;
      }
      const [, vet = '', file = '', rest = ''] = match;
      const path = isAbsolute(file) ? file : join(appDirectory, file);
      const inside = relative(root, path);
      const shown = inside.startsWith('..') ? path : inside.replaceAll('\\', '/');
      return `${vet}${shown}${rest}`;
    })
    .join('\n');
}
