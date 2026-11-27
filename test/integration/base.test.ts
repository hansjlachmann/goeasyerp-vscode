/**
 * A new app against the real base: downloads the base and Go, merges, builds, and asks the
 * language server where a name of the base is defined. It needs the network and takes minutes.
 * BASE_VERSION picks the base release.
 */
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findApp } from '../../src/app/application';
import { writeApp } from '../../src/app/template';
import { compile } from '../../src/build/compile';
import { AppError } from '../../src/base/problems';
import { BaseWorkspace } from '../../src/base/workspace';
import { goEnvironment, GoToolchains, type GoToolchain } from '../../src/go/toolchain';
import { run } from '../../src/runner';
import { TESTED_BASE_VERSION } from './version';

const version = process.env.BASE_VERSION ?? TESTED_BASE_VERSION;

const FIELDS = `extends_table: 18
fields:
  - name: lp_points
    no: 50000
    type: int
    db_name: lp_points
    caption: Points
`;

const LOGIC = `package loyalty

import gtables "github.com/hansjlachmann/goeasyerp/backend/generated/tables"

// Register registers the app's business logic.
func Register() {
	gtables.RegisterCustomerLogic(customerLogic{})
}

type customerLogic struct{}

func (customerLogic) OnModify(rec *gtables.Customer) error {
	rec.Lp_points++
	return nil
}
`;

const PACKAGE_CHECK = `package main

import (
	"os"

	"github.com/hansjlachmann/goeasyerp/backend/foundation/apps"
)

func main() {
	data, err := os.ReadFile(os.Args[1])
	if err == nil {
		_, err = apps.ReadPackage(data)
	}
	if err != nil {
		panic(err)
	}
}
`;

describe(`a new app on base ${version}`, () => {
  let temporary: string;
  let root: string;
  let workspace: BaseWorkspace;
  let toolchain: GoToolchain;
  const options = { onOutput: (text: string) => process.stdout.write(text) };

  const go = async (args: string[], cwd = root, work = '') => {
    const env = goEnvironment(toolchain, process.env, { GOWORK: work });
    const result = await run(join(toolchain.goroot, 'bin/go'), args, { cwd, env });
    expect(result.code, result.stderr).toBe(0);
    return result.stdout;
  };

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'goeasyerp-base-'));
    root = join(temporary, 'loyalty');
    await writeApp(root, {
      name: 'Loyalty',
      publisher: 'Tests',
      contact: 'https://example.com',
      prefix: 'lp',
      baseVersion: version,
      series: { from: 50000, to: 50099 },
    });
    const toolchains = new GoToolchains(join(temporary, 'go'), run);
    workspace = new BaseWorkspace({ root, folder: '.' }, toolchains, run);
  });

  afterAll(async () => {
    // Go's module cache is outside; the downloaded toolchain may hold read-only files.
    await rm(temporary, { recursive: true, force: true });
  });

  it('merges an empty app', async () => {
    const result = await workspace.sync(version, options);
    toolchain = result.toolchain;
    expect(result.changed).toBe(true);
    await go(['build', './...']);
  });

  it("knows the app's own fields on base tables", async () => {
    await writeFile(join(root, 'tables/18-customer.extend.yaml'), FIELDS);
    await writeFile(join(root, 'register.go'), LOGIC);
    expect((await workspace.sync(version, options)).changed).toBe(false);
    await go(['build', './...']);
    await go(['vet', './...']);
  });

  it('resolves a name of the base for the language server', async () => {
    const lines = LOGIC.split('\n');
    const line = lines.findIndex((text) => text.includes('RegisterCustomerLogic'));
    const column = lines[line].indexOf('RegisterCustomerLogic') + 1; // a tab counts 1
    // the newest language server that builds with the base's Go
    const output = await go([
      'run',
      'golang.org/x/tools/gopls@v0.23.0',
      'definition',
      `register.go:${line + 1}:${column}`,
    ]);
    expect(relative(root, output.split(':')[0])).toBe(
      '.goeasyerp/work/backend/generated/tables/customer_gen.go',
    );
  });

  it("places the app's errors in its files, and keeps the last good merge", async () => {
    const file = join(root, 'tables/18-customer.extend.yaml');
    await writeFile(file, FIELDS.replace('no: 50000', 'no: 5'));
    const error = await workspace.sync(version, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).problems[0]).toMatchObject({ file });
    await go(['build', './...']);
  });

  it('forgets what the app no longer has', async () => {
    await rm(join(root, 'tables/18-customer.extend.yaml'));
    await writeFile(
      join(root, 'custom/tables/50000-lp-tier.yaml'),
      `table:
  id: 50000
  name: "LP_Tier"
  fields:
    - name: code
      no: 50000
      type: types.Code
      length: 10
      primary_key: true
  keys:
    - name: Primary
      fields: [code]
      clustered: true
`,
    );
    await writeFile(
      join(root, 'register.go'),
      'package loyalty\n\n// Register does nothing.\nfunc Register() {}\n',
    );
    await workspace.sync(version, options);
    await go(['build', './...']);
    await rm(join(root, 'custom/tables/50000-lp-tier.yaml'));
    await workspace.sync(version, options);
    await go(['build', './...']);
    const customer = join(root, '.goeasyerp/work/backend/generated/tables/customer_gen.go');
    expect(await readFile(customer, 'utf8')).not.toContain('Lp_points');
  });

  describe('compiling', () => {
    const lines: string[] = [];
    const compileApp = () =>
      compile(workspace, version, run, { write: (text) => lines.push(text) });
    beforeEach(() => (lines.length = 0));

    it('writes a package the server accepts', async () => {
      const result = await compileApp();
      expect(result.findings).toEqual([]);
      expect(result.package, lines.join('\n')).toBeDefined();

      // the server's own reader of uploaded packages
      const check = join(workspace.work, 'cmd/zz-package-check');
      await mkdir(check, { recursive: true });
      await writeFile(join(check, 'main.go'), PACKAGE_CHECK);
      await go(['run', './cmd/zz-package-check', result.package!], workspace.work, 'off');
      await rm(check, { recursive: true });
    });

    it('reports what the audit refuses, on its line', async () => {
      await writeFile(
        join(root, 'register.go'),
        'package loyalty\n\nimport "os"\n\n// Register reads the environment.\nfunc Register() { _ = os.Args }\n',
      );
      const result = await compileApp();
      expect(result.package).toBeUndefined();
      expect(result.findings).toContainEqual(
        expect.objectContaining({ file: join(root, 'register.go'), line: 3, excepted: false }),
      );
    });

    it("reports Go's errors with their place", async () => {
      await writeFile(
        join(root, 'register.go'),
        'package loyalty\n\n// Register does not compile.\nfunc Register() { missing() }\n',
      );
      expect((await compileApp()).package).toBeUndefined();
      expect(lines.join('\n')).toMatch(/^register\.go:4:19: undefined: missing$/m);
    });

    it("reports go vet's findings", async () => {
      await writeFile(
        join(root, 'register.go'),
        'package loyalty\n\nimport "fmt"\n\n// Register prints wrongly.\nfunc Register() { fmt.Printf("%d", "x") }\n',
      );
      expect((await compileApp()).package).toBeUndefined();
      expect(lines.join('\n')).toMatch(/register\.go:6:\d+: .*Printf/);
    });
  });

  it("merges the base's test app in an extensions folder", async () => {
    const repository = join(temporary, 'repository');
    const sample = join(root, '.goeasyerp/base', version, 'testdata/apps/loyalty-points');
    await cp(sample, join(repository, 'extensions'), { recursive: true });
    const app = await findApp(repository);
    expect(app).toEqual({ root: repository, folder: 'extensions' });

    const toolchains = new GoToolchains(join(temporary, 'go'), run);
    await new BaseWorkspace(app!, toolchains, run).sync(version, options);

    await go(['build', './...'], join(repository, 'extensions'));
    await go(['test', './...'], join(repository, 'extensions'));
    const work = join(repository, '.goeasyerp/work');
    await access(join(work, 'translations/nb-NO/lp-tables.yaml'));
    await access(join(work, 'backend/installedapps/apps_gen.go'));
  });
});
