import { isAbsolute, join, relative } from 'node:path';
import type { Problem } from '../base/problems';

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

/** The places in Go's output, as relativeToWorkspace writes it. */
export function goProblems(output: string, root: string): Problem[] {
  return output.split('\n').flatMap((line) => {
    const match = /^(?:vet: )?(.+?\.(?:go|mod|work)):(\d+)(?::\d+)?: (.*)$/.exec(line);
    if (!match) {
      return [];
    }
    const [, file = '', row, message = ''] = match;
    return [{ file: isAbsolute(file) ? file : join(root, file), line: Number(row), message }];
  });
}
