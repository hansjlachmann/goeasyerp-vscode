import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serverUrl } from '../container/store';
import { BASE_APP_ID } from './application';
import { type Range } from './series';

export interface NewApp {
  name: string;
  publisher: string;
  contact: string;
  prefix: string;
  /** The base release the app builds on. */
  baseVersion: string;
  series: Range;
  server?: string;
}

const PREFIX = /^[a-z][a-z0-9]{1,9}$/;
const LANGUAGES = ['en-US', 'nb-NO', 'da-DK'];

export function isPrefix(text: string): boolean {
  return PREFIX.test(text);
}

/** A folder and module name from an app's name: "Loyalty Points" → "loyalty-points". */
export function slug(name: string): string {
  const result = name
    .replaceAll(/[æÆ]/g, 'ae')
    .replaceAll(/[øØ]/g, 'o')
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return result || 'my-app';
}

/** The first letters of the name's words, or the start of a single word. */
export function proposedPrefix(name: string): string {
  const words = slug(name).split('-');
  const letters = words.length > 1 ? words.map((word) => word[0]).join('') : words[0];
  const prefix = letters.replace(/^[0-9]+/, '').slice(0, words.length > 1 ? 10 : 3);
  return isPrefix(prefix) ? prefix : 'app';
}

function packageName(name: string): string {
  const result = slug(name)
    .replaceAll('-', '')
    .replace(/^[0-9]+/, '');
  // "main" would make the app a program instead of a package.
  return result && result !== 'main' ? result : 'app';
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The files of a new app, by their path in its folder. */
export function appFiles(app: NewApp, id: string = randomUUID()): Record<string, string> {
  // JSON's quoted texts are YAML's too.
  const text = (value: string) => JSON.stringify(value);
  const range = `[{from: ${app.series.from}, to: ${app.series.to}}]`;
  return {
    'application.yaml': `application:
  id: ${id} # never changed
  name: ${text(app.name)}
  publisher: ${text(app.publisher)}
  contact: ${text(app.contact)}
  version: 1.0.0
  prefix: ${app.prefix} # the start of the app's own names
  number_series:
    objects: ${range}
    fields: ${range}
  dependencies:
    - id: ${BASE_APP_ID}
      name: GoEasyERP Base Application
      min_version: ${app.baseVersion}
`,
    'go.mod': `module example.com/${slug(app.name)}

go 1.26.0

// the base release the app builds on
require github.com/hansjlachmann/goeasyerp v${app.baseVersion}
`,
    'register.go': `// Package ${packageName(app.name)} is the Go code of the app.
package ${packageName(app.name)}

// Register registers the app's business logic. It runs at startup, after the base
// application's.
func Register() {}
`,
    // the extension's own folder (not committed): with it, opening the app prepares the base
    '.goeasyerp/state.json': `${JSON.stringify({ version: app.baseVersion })}\n`,
    '.vscode/launch.json': json({
      version: '0.2.0',
      configurations: [
        {
          type: 'goeasyerp',
          request: 'launch',
          name: 'Local container',
          server: app.server ?? serverUrl(8080),
          company: 'main',
          user: 'ADMIN',
          startupPageId: 22,
          openBrowser: true,
          schemaUpdateMode: 'synchronize',
        },
      ],
    }),
    '.vscode/tasks.json': json({
      version: '2.0.0',
      tasks: [
        {
          type: 'goeasyerp',
          task: 'compile',
          label: 'GoEasyERP: Compile',
          group: { kind: 'build', isDefault: true },
          problemMatcher: ['$go'],
        },
      ],
    }),
    // settings.json holds paths of this computer
    '.gitignore': '.goeasyerp/\ngo.work\ngo.work.sum\n.vscode/settings.json\n',
    'README.md': `# ${app.name.replaceAll('\n', ' ')}

A GoEasyERP extension app.

| Folder | Holds |
|---|---|
| \`tables/\` | Fields on base tables: \`<number>-<name>.extend.yaml\` |
| \`pages/\` | Fields, sections and buttons on base pages: \`<number>-<name>.extend.yaml\` |
| \`menus/\` | Main menu entries: \`<file>.extend.yaml\` |
| \`custom/tables/\`, \`custom/pages/\` | The app's own tables and pages |
| \`translations/<language>/\` | The app's texts |

How an app is written:
[EXTENSIONS.md](https://github.com/hansjlachmann/goeasyerp/blob/main/EXTENSIONS.md).
`,
  };
}

const FOLDERS = [
  'tables',
  'pages',
  'menus',
  'custom/tables',
  'custom/pages',
  ...LANGUAGES.map((language) => `translations/${language}`),
];

/** Writes a new app into a folder that is empty or does not exist. */
export async function writeApp(directory: string, app: NewApp): Promise<void> {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`The folder ${directory} is not empty`);
  }
  for (const folder of FOLDERS) {
    await mkdir(join(directory, folder), { recursive: true });
  }
  for (const [name, content] of Object.entries(appFiles(app))) {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, { flag: 'wx' });
  }
}
