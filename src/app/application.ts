import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

export const BASE_APP_ID = '760e20ec-7a66-4e3f-b6e5-83c94db5a4bd';

/** Where an app's application.yaml can be, relative to the workspace folder. */
const APP_FOLDERS = ['.', 'extensions'];

export interface App {
  /** The workspace folder. */
  root: string;
  /** The app's folder, relative to the root: "." or "extensions". */
  folder: string;
}

export function appDirectory(app: App): string {
  return join(app.root, app.folder);
}

/** Whether the text is the application.yaml of an extension app of the base. */
export function isExtensionApp(text: string): boolean {
  try {
    const file = parse(text) as {
      application?: { id?: unknown; dependencies?: { id?: unknown }[] };
    } | null;
    const application = file?.application;
    return (
      application?.id !== BASE_APP_ID &&
      Array.isArray(application?.dependencies) &&
      application.dependencies.some((dependency) => dependency?.id === BASE_APP_ID)
    );
  } catch {
    return false;
  }
}

/** The app of a workspace folder. A file that cannot be read as YAML counts when it names the base. */
export async function findApp(root: string): Promise<App | undefined> {
  for (const folder of APP_FOLDERS) {
    const text = await readFile(join(root, folder, 'application.yaml'), 'utf8').catch(() => '');
    // An app being edited may not be valid YAML for a moment: the dependency still shows it.
    const dependency = new RegExp(`-\\s*id:\\s*${BASE_APP_ID}`);
    if (isExtensionApp(text) || dependency.test(text)) {
      return { root, folder };
    }
  }
  return undefined;
}
