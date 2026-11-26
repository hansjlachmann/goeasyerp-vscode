import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'));
}

const manifest = readJson('package.json') as Record<string, unknown>;
const texts = readJson('package.nls.json') as Record<string, string>;

const usedKeys = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((match) => match[1]);

describe('extension manifest', () => {
  it('keeps the Marketplace identity', () => {
    expect(manifest).toMatchObject({
      name: 'goeasyerp',
      publisher: 'erp-development',
      license: 'MIT',
    });
  });

  it('has a text for every key package.json uses', () => {
    expect(usedKeys.filter((key) => !(key in texts))).toEqual([]);
  });

  it('has no unused texts', () => {
    expect(Object.keys(texts).filter((key) => !usedKeys.includes(key))).toEqual([]);
  });
});
