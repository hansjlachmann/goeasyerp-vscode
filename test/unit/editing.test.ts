import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { nextFree, readIdentity, usedFieldNumbers, usedObjectNumbers } from '../../src/app/numbers';
import { expand, missingImports, SNIPPETS, snippetsFor } from '../../src/snippets/snippets';
import { statusText } from '../../src/status';

const context = { prefix: 'lp', table: 50001, page: 50002, field: 50010 };

describe('free numbers', () => {
  let root: string;
  beforeEach(async () => (root = await mkdtemp(join(tmpdir(), 'goeasyerp-numbers-'))));
  afterEach(() => rm(root, { recursive: true, force: true }));
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  const series = [{ from: 50000, to: 50004 }];

  it('follow the highest one used, then fill gaps', () => {
    expect(nextFree(series, [])).toBe(50000);
    expect(nextFree(series, [50000, 50002])).toBe(50003);
    expect(nextFree(series, [50000, 50004])).toBe(50001);
    expect(nextFree(series, [50000, 50001, 50002, 50003, 50004])).toBeUndefined();
    expect(nextFree([{ from: 60000, to: 60001 }, ...series], [50004])).toBe(60000);
    expect(nextFree(series, [5, 99999])).toBe(50000);
  });

  it("come from the app's series", () => {
    const manifest = `application:
  prefix: lp
  number_series:
    objects: [{from: 50000, to: 50099}]
    fields: [{from: 51000, to: 51099}, {from: x}]
`;
    expect(readIdentity(manifest)).toEqual({
      prefix: 'lp',
      objects: [{ from: 50000, to: 50099 }],
      fields: [{ from: 51000, to: 51099 }],
    });
  });

  it('count the fields of tables and extensions, not comments', async () => {
    await put('tables/18-x.extend.yaml', 'fields:\n  - {name: a, no: 50000}\n  # no: 50009\n');
    await put(
      'custom/tables/t.yaml',
      'table:\n  id: 50000\n  fields:\n    - name: b\n      no: 50001 # x\n',
    );
    await put('translations/en-US/x.yaml', 'no: 50050\n');
    expect((await usedFieldNumbers(root)).sort()).toEqual([50000, 50001]);
  });

  it('count each type of object apart', async () => {
    await put('custom/tables/t.yaml', 'table:\n  id: 50003\n');
    await put('custom/pages/p.yaml', 'page:\n  id: 50007\n');
    await put('reports.go', 'package a\n\n// 50099 in a comment\nconst reportNo = 50004\n');
    await put('menus/m.extend.yaml', 'items:\n  - run_object: "report:50005"\n');
    expect(await usedObjectNumbers(root, 'table')).toEqual([50003]);
    expect(await usedObjectNumbers(root, 'page')).toEqual([50007]);
    expect(await usedObjectNumbers(root, 'report')).toEqual([50004, 50005]);
  });

  it('take unsaved text from the editor', async () => {
    await put('tables/a.extend.yaml', 'no: 50000\n');
    const read = () => Promise.resolve('no: 50042\n');
    expect(await usedFieldNumbers(root, read)).toEqual([50042]);
  });
});

describe('snippets', () => {
  it('fit the folder of the file', () => {
    const names = (path: string) => snippetsFor(path).map((snippet) => snippet.name);
    expect(names('tables/18-x.extend.yaml')).toEqual(['ge-tableext']);
    expect(names('custom/pages/p.yaml')).toEqual(['ge-list', 'ge-card']);
    expect(names('register.go')).toContain('ge-tablelogic');
    expect(names('application.yaml')).toEqual([]);
    expect(names('.goeasyerp/work/x.go')).toEqual([]);
  });

  it('give valid YAML with the prefix and numbers', () => {
    for (const snippet of SNIPPETS.filter((s) => s.where !== 'go')) {
      const text = expand(snippet.body(context));
      expect(text, snippet.name).not.toContain('$');
      expect(() => parse(text) as unknown, snippet.name).not.toThrow();
    }
    const table = parse(expand(SNIPPETS[0].body(context))) as { table: object };
    expect(table.table).toMatchObject({ id: 50001, name: 'LP_Group' });
  });

  it('fill repeated and chosen placeholders', () => {
    expect(expand('${1:a} $1 ${1} ${2|x,y|} $0')).toBe('a a a x ');
  });

  it('add the imports a Go file lacks', () => {
    const source = '// Doc\npackage a\n\nimport "fmt"\n';
    expect(missingImports(source, ['"fmt"', 'x "example.com/x"'])).toEqual({
      line: 2,
      text: '\nimport x "example.com/x"\n',
    });
    expect(missingImports(source, ['"fmt"'])).toBeUndefined();
  });
});

describe('the status bar', () => {
  it("shows the server's state", () => {
    const text = (state: Parameters<typeof statusText>[1]) =>
      statusText('http://localhost:8080', state);
    expect(text({ kind: 'offline' })).toContain('localhost:8080: offline');
    expect(text({ kind: 'running', build: 3 })).toContain('running build 3');
    expect(text({ kind: 'building', step: 'compile' })).toContain('Building… compile');
  });
});
