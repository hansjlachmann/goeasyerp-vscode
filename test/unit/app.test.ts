import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BASE_APP_ID, findApp, isExtensionApp } from '../../src/app/application';
import { freeSeries, parseSeries } from '../../src/app/series';
import { appFiles, proposedPrefix, slug, writeApp, type NewApp } from '../../src/app/template';
import { goWork, requiredBaseVersion, writeGoWork } from '../../src/base/gowork';
import { launchServer } from '../../src/base/launch';
import { errorMessages, locate } from '../../src/base/problems';
import { LatestQueue } from '../../src/queue';

const app: NewApp = {
  name: 'Loyalty: "Points"',
  publisher: 'My Company',
  contact: 'https://example.com',
  prefix: 'lp',
  baseVersion: '0.1.194',
  series: { from: 50100, to: 50199 },
};

let root: string;
beforeEach(async () => (root = await mkdtemp(join(tmpdir(), 'goeasyerp-app-'))));
afterEach(() => rm(root, { recursive: true, force: true }));

describe('a new app', () => {
  it('has a valid application.yaml', () => {
    const files = appFiles(app);
    const { application } = parse(files['application.yaml']) as { application: object };
    expect(application).toMatchObject({
      name: app.name,
      prefix: 'lp',
      number_series: { objects: [app.series], fields: [app.series] },
      dependencies: [{ id: BASE_APP_ID, min_version: '0.1.194' }],
    });
    expect((application as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isExtensionApp(files['application.yaml'])).toBe(true);
    expect(requiredBaseVersion(files['go.mod'])).toBe('v0.1.194');
    expect(JSON.parse(files['.goeasyerp/state.json'])).toEqual({ version: '0.1.194' });
    expect(files['register.go']).toContain('package loyaltypoints\n');
    const launch = JSON.parse(files['.vscode/launch.json']) as { configurations: unknown };
    expect(launchServer(launch.configurations)).toBe('http://localhost:8080');
  });

  it('has names made from its name', () => {
    expect(slug('Blåbær Ønske')).toBe('blabaer-onske');
    expect(slug('***')).toBe('my-app');
    expect(proposedPrefix('Loyalty Points')).toBe('lp');
    expect(proposedPrefix('Warranty')).toBe('war');
    expect(proposedPrefix('1')).toBe('app');
  });

  it('takes numbers nothing uses', () => {
    expect(freeSeries([])).toEqual({ from: 50000, to: 50099 });
    const used = parseSeries('1–999, 50000–50099, 50150–50160');
    expect(freeSeries(used)).toEqual({ from: 50200, to: 50299 });
  });

  it('is written only into an empty folder, and found there', async () => {
    const directory = join(root, 'new');
    await writeApp(directory, app);
    expect(await findApp(directory)).toEqual({ root: directory, folder: '.' });
    await expect(writeApp(directory, app)).rejects.toThrow('not empty');
  });

  it('is found in extensions/, also while its YAML is broken', async () => {
    await mkdir(join(root, 'extensions'));
    const broken = `${appFiles(app)['application.yaml']}  name: [\n`;
    await writeFile(join(root, 'extensions/application.yaml'), broken);
    expect(await findApp(root)).toEqual({ root, folder: 'extensions' });
  });

  it("is not another program's application.yaml, nor the base's", async () => {
    await writeFile(join(root, 'application.yaml'), 'server:\n  port: 80\n');
    expect(await findApp(root)).toBeUndefined();
    expect(isExtensionApp(`application:\n  id: ${BASE_APP_ID}\n`)).toBe(false);
  });
});

describe('go.work', () => {
  it('uses the app and the merged base', () => {
    const content = goWork('extensions', '.goeasyerp/work', '1.26.0', 'v0.0.0');
    expect(content).toContain('\t./extensions\n\t./.goeasyerp/work\n');
    expect(content).toContain('goeasyerp v0.0.0 => ./.goeasyerp/work\n');
  });

  it('reads a requirement inside a block', () => {
    const goMod = 'require (\n\tgithub.com/hansjlachmann/goeasyerp v0.1.194 // base\n)\n';
    expect(requiredBaseVersion(goMod)).toBe('v0.1.194');
  });

  it("does not replace a developer's own", async () => {
    expect(await writeGoWork(root, goWork('.', 'w', '1.26.0', 'v1.0.0'))).toBe(true);
    expect(await writeGoWork(root, goWork('.', 'w', '1.26.0', 'v1.0.0'))).toBe(false);
    expect(await writeGoWork(root, goWork('.', 'w', '1.26.0', 'v1.0.1'))).toBe(true);
    await writeFile(join(root, 'go.work'), 'go 1.26.0\n');
    await expect(writeGoWork(root, 'x')).rejects.toThrow('not written by this extension');
    expect(await readFile(join(root, 'go.work'), 'utf8')).toBe('go 1.26.0\n');
  });
});

describe('launch.json', () => {
  it('gives the server of the first GoEasyERP configuration', () => {
    expect(
      launchServer([
        { type: 'go', server: 'http://other' },
        { type: 'goeasyerp', server: 'file:///x' },
        { type: 'goeasyerp', server: 'http://localhost:8090' },
      ]),
    ).toBe('http://localhost:8090');
    expect(launchServer(undefined)).toBeUndefined();
  });
});

describe('merge errors', () => {
  const place = async (message: string) => {
    const problem = await locate(message, root, 'lp');
    return [problem.file.slice(root.length + 1), problem.line];
  };
  beforeEach(async () => {
    await mkdir(join(root, 'tables'));
    await mkdir(join(root, 'custom/tables'), { recursive: true });
    await writeFile(join(root, 'application.yaml'), '');
    await writeFile(join(root, 'tables/18-customer.extend.yaml'), 'fields:\n  - name: lp_points\n');
    await writeFile(join(root, 'custom/tables/50000-tier.yaml'), '');
  });

  it('are read from the output of the tools', () => {
    expect(errorMessages('Error: yaml: bad\n  line 2: x\nexit status 1\n')).toEqual([
      'yaml: bad\n  line 2: x',
    ]);
    expect(errorMessages('✓ a\n✗ customer.yaml: bad type\nexit status 1')).toEqual([
      'customer.yaml: bad type',
    ]);
    expect(errorMessages('go: no network')).toEqual([]);
  });

  it('are placed in the file they name', async () => {
    const path = join(root, 'tables/18-customer.extend.yaml');
    expect(await place(`App: failed to merge ${path}: yaml: line 3: bad`)).toEqual([
      'tables/18-customer.extend.yaml',
      3,
    ]);
    expect(await place('App: 50000-tier.yaml: table number 1 is outside')).toEqual([
      'custom/tables/50000-tier.yaml',
      1,
    ]);
  });

  it('are placed where the name they quote is', async () => {
    expect(await place('table 18: extension field lp_points needs a field number')).toEqual([
      'tables/18-customer.extend.yaml',
      2,
    ]);
  });

  it('are placed in application.yaml otherwise', async () => {
    expect(await place('the object series 1–2 of App overlaps')).toEqual(['application.yaml', 1]);
  });
});

describe('the queue', () => {
  it('runs one task at a time, and of the waiting ones the newest', async () => {
    const queue = new LatestQueue();
    const ran: number[] = [];
    let active = 0;
    const task = (id: number) => async () => {
      expect(++active).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      ran.push(id);
      active--;
    };
    const first = queue.add(task(1));
    await Promise.resolve();
    await Promise.resolve();
    void queue.add(task(2));
    await queue.add(task(3));
    await first;
    expect(ran).toEqual([1, 3]);
  });

  it('goes on after a task that fails', async () => {
    const queue = new LatestQueue();
    await expect(queue.add(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    let ran = false;
    await queue.add(() => Promise.resolve(void (ran = true)));
    expect(ran).toBe(true);
  });
});
