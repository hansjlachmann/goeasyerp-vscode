import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPromise } from 'yauzl';
import { definitionsHash } from '../../src/base/definitions';
import { BaseWorkspace } from '../../src/base/workspace';
import { readAudit } from '../../src/build/audit';
import { relativeToWorkspace } from '../../src/build/goOutput';
import { buildPackage, LIMITS, writePackage } from '../../src/build/package';

let root: string;
beforeEach(async () => (root = await mkdtemp(join(tmpdir(), 'goeasyerp-build-'))));
afterEach(() => rm(root, { recursive: true, force: true }));

async function put(path: string, content = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function names(archive: string): Promise<string[]> {
  const zip = await openPromise(archive);
  const result: string[] = [];
  for await (const entry of zip.eachEntry()) {
    result.push(entry.fileName);
  }
  return result;
}

describe('the package', () => {
  beforeEach(() => put('application.yaml', 'application:\n  name: My App\n  version: 1.2.0\n'));

  it("holds the app's files and nothing else", async () => {
    const wanted = ['go.mod', 'go.sum', 'register.go', 'tables/18-x.extend.yaml', 'LICENSE'];
    const others = [
      'register_test.go',
      'go.work',
      'go.work.sum',
      'logo.png',
      '.gitignore',
      '.vscode/launch.json',
      '.git/config',
      '.goeasyerp/work/go.mod',
    ];
    for (const path of [...wanted, ...others]) {
      await put(path, path);
    }

    const path = await writePackage(root, root);

    expect(path).toBe(join(root, '.goeasyerp/out/my-app-1.2.0.zip'));
    expect(await names(path)).toEqual(['application.yaml', ...wanted].sort());
  });

  it('is the same for the same files', async () => {
    const first = await buildPackage(root);
    expect((await buildPackage(root)).equals(first)).toBe(true);
  });

  it('refuses links', async () => {
    await symlink(join(root, 'application.yaml'), join(root, 'linked.yaml'));
    await expect(buildPackage(root)).rejects.toThrow('linked.yaml');
  });

  it('refuses a file that is too large', async () => {
    await put('large.txt', 'x'.repeat(LIMITS.file + 1));
    await expect(buildPackage(root)).rejects.toThrow('large.txt is larger');
  });
});

describe('the audit', () => {
  it('places its findings in the files', () => {
    const output = JSON.stringify([
      {
        app: 'a',
        findings: [
          { rule: 'import', file: 'register.go', line: 3, key: 'os', detail: 'not allowed' },
          { rule: 'size', key: 'size', detail: 'too large', excepted: true },
        ],
        notes: ['seen'],
      },
      { app: 'b', findings: null },
    ]);
    expect(readAudit(output, root)).toEqual({
      findings: [
        {
          file: join(root, 'register.go'),
          line: 3,
          message: '[import] not allowed (os)',
          excepted: false,
        },
        {
          file: join(root, 'application.yaml'),
          line: 1,
          message: '[size] too large (size)',
          excepted: true,
        },
      ],
      notes: ['seen'],
    });
  });
});

describe("Go's output", () => {
  const output = '# example.com/app\n./register.go:5:2: undefined: x\nvet: ./sub/a.go:1:1: y';

  it('names files from the workspace folder', () => {
    expect(relativeToWorkspace(output, '/w', '/w')).toBe(
      '# example.com/app\nregister.go:5:2: undefined: x\nvet: sub/a.go:1:1: y',
    );
    expect(relativeToWorkspace(output, '/w', '/w/extensions')).toContain(
      '\nextensions/register.go:5:2: undefined: x\n',
    );
  });

  it('keeps the path of a file outside it', () => {
    expect(relativeToWorkspace('/go/src/x.go:1:2: z', '/w', '/w')).toBe('/go/src/x.go:1:2: z');
  });
});

describe('the definitions', () => {
  it('change with the YAML files and go.mod, not with Go code', async () => {
    await put('application.yaml', 'a');
    const first = await definitionsHash(root);
    await put('register.go', 'package a');
    await put('.goeasyerp/work/x.yaml', 'x');
    expect(await definitionsHash(root)).toBe(first);
    await put('tables/18-x.extend.yaml', 'x');
    const second = await definitionsHash(root);
    expect(second).not.toBe(first);
    await put('go.mod', 'module a');
    expect(await definitionsHash(root)).not.toBe(second);
  });
});

describe('the work copy', () => {
  it('is used by one task at a time, also after a failure', async () => {
    const workspace = new BaseWorkspace({ root, folder: '.' }, undefined!, undefined!);
    const order: string[] = [];
    const slow = workspace.exclusive(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first');
      throw new Error('failed');
    });
    const next = workspace.exclusive(() => Promise.resolve(order.push('second')));
    await expect(slow).rejects.toThrow('failed');
    await next;
    expect(order).toEqual(['first', 'second']);
  });
});
