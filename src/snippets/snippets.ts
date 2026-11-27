/** The values of the app a snippet is filled with. */
export interface Context {
  prefix: string;
  /** The next free numbers of the app's series. */
  table: number;
  page: number;
  field: number;
}

export interface Snippet {
  /** What the developer types. */
  name: string;
  description: string;
  /** Where it fits: a folder of the app for YAML, or Go files. */
  where: 'custom/tables' | 'tables' | 'custom/pages' | 'pages' | 'menus' | 'translations' | 'go';
  /** In the editor's snippet syntax. */
  body: (context: Context) => string;
  /** Go packages the code uses, as import specifications. */
  imports?: string[];
}

const BASE = 'github.com/hansjlachmann/goeasyerp/backend';
const TABLES = `gtables "${BASE}/generated/tables"`;
const RESULT = `fcodeunits "${BASE}/foundation/codeunits"`;
const FUNCTIONS = `"${BASE}/foundation/functions"`;
const SALES = `"${BASE}/business-logic/salesposting"`;

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const FIELD_TYPES = 'int,bool,types.Date,types.DateTime,types.Decimal';

export const SNIPPETS: Snippet[] = [
  {
    name: 'ge-table',
    description: "A table of the app's own",
    where: 'custom/tables',
    body: ({ prefix, table, field }) =>
      lines(
        'table:',
        `  id: ${table}`,
        `  name: "${prefix.toUpperCase()}_\${1:Group}"`,
        '  caption: "${2:Group}"',
        '  fields:',
        '    - name: code',
        `      no: ${field}`,
        '      type: types.Code',
        '      length: 10',
        '      primary_key: true',
        '    - name: description',
        `      no: ${field + 1}`,
        '      type: types.Text',
        '      length: 100',
        '  keys:',
        '    - name: Primary',
        '      fields: [code]',
        '      clustered: true$0',
      ),
  },
  {
    name: 'ge-tableext',
    description: 'Fields on a table of the base',
    where: 'tables',
    body: ({ prefix, field }) =>
      lines(
        'extends_table: ${1:18}',
        'fields:',
        `  - name: ${prefix}_\${2:points}`,
        `    no: ${field}`,
        `    type: \${3|${FIELD_TYPES}|}`,
        `    db_name: ${prefix}_\${2:points}`,
        '    caption: ${4:Points}$0',
      ),
  },
  {
    name: 'ge-list',
    description: 'A list page',
    where: 'custom/pages',
    body: ({ prefix, page }) =>
      lines(
        'page:',
        `  id: ${page}`,
        '  type: List',
        `  name: ${prefix.toUpperCase()} \${1:Groups}`,
        `  source_table: \${2:${prefix.toUpperCase()}_Group}`,
        '  caption: ${1:Groups}',
        '  editable: true',
        '  layout:',
        '    repeater:',
        '      fields:',
        '        - source: ${3:code}',
        '          width: 100',
        '        - source: ${4:description}',
        '          width: 250$0',
      ),
  },
  {
    name: 'ge-card',
    description: 'A card page',
    where: 'custom/pages',
    body: ({ prefix, page }) =>
      lines(
        'page:',
        `  id: ${page}`,
        '  type: Card',
        `  name: ${prefix.toUpperCase()} \${1:Group Card}`,
        `  source_table: \${2:${prefix.toUpperCase()}_Group}`,
        '  caption: ${1:Group Card}',
        '  editable: true',
        '  layout:',
        '    sections:',
        '      - name: General',
        '        caption: General',
        '        fields:',
        '          - source: ${3:code}',
        '          - source: ${4:description}$0',
      ),
  },
  {
    name: 'ge-pageext',
    description: 'Fields, a section and a button on a page of the base',
    where: 'pages',
    body: ({ prefix }) =>
      lines(
        'extends: ${1:21}',
        'layout:',
        '  sections:',
        '    - name: General',
        '      fields:',
        `        - source: ${prefix}_\${2:points}`,
        '          after: ${3:credit_limit_lcy}',
        '    - name: ${4:Extra}',
        '      caption: ${4:Extra}',
        '      fields:',
        `        - source: ${prefix}_\${5:status}`,
        'actions:',
        '  - name: ${6:Salespeople}',
        '    in: ${7:Customer}',
        '    run_page: ${8:14}$0',
      ),
  },
  {
    name: 'ge-menu',
    description: 'An entry of the main menu',
    where: 'menus',
    body: ({ page }) =>
      lines(
        'extends: ${1:admin.yaml}',
        'items:',
        '  - in: ${2:Sales}',
        '    after: ${3:Customers}',
        '    name: ${4:Groups}',
        `    page_id: \${5:${page}}$0`,
      ),
  },
  {
    name: 'ge-texts',
    description: "The app's texts in one language",
    where: 'translations',
    body: ({ prefix }) =>
      lines(
        'tables:',
        `  ${prefix}_\${1:group}:`,
        '    caption: "${2:Group}"',
        '    fields:',
        '      code: "${3:Code}"',
        '      description: "${4:Description}"$0',
      ),
  },
  {
    name: 'ge-register',
    description: "The function that registers the app's logic",
    where: 'go',
    body: () =>
      lines(
        "// Register registers the app's business logic. It runs at startup, after the base",
        "// application's.",
        'func Register() {',
        '\t$0',
        '}',
      ),
  },
  {
    name: 'ge-tablelogic',
    description: 'Triggers of a table',
    where: 'go',
    imports: [TABLES],
    body: () =>
      lines(
        '// Register it in Register: gtables.Register${1:Customer}Logic(${2:customer}Logic{})',
        'type ${2:customer}Logic struct{}',
        '',
        '// OnInsert runs before a new record is inserted',
        'func (${2:customer}Logic) OnInsert(rec *gtables.${1:Customer}) error {',
        '\treturn nil',
        '}',
        '',
        '// OnModify runs before a record is modified',
        'func (${2:customer}Logic) OnModify(rec *gtables.${1:Customer}) error {',
        '\t$0',
        '\treturn nil',
        '}',
        '',
        '// OnValidate_${3:Name} runs when the field is validated',
        'func (${2:customer}Logic) OnValidate_${3:Name}(rec *gtables.${1:Customer}) error {',
        '\treturn nil',
        '}',
        '',
        "// OnBeforeInsert runs first; *handled = true skips every OnInsert, the base's too",
        'func (${2:customer}Logic) OnBeforeInsert(rec *gtables.${1:Customer}, handled *bool) error {',
        '\treturn nil',
        '}',
      ),
  },
  {
    name: 'ge-function',
    description: "A function a page's button calls",
    where: 'go',
    imports: [TABLES, RESULT, FUNCTIONS],
    body: ({ prefix }) => {
      const name = `${capitalized(prefix)}\${2:Reset}`;
      return lines(
        '// register${2:Reset} makes the function: call it in Register. A button runs it with',
        `// run_object: "table:\${1:Customer}.${name}"`,
        'func register${2:Reset}() {',
        `\tfunctions.Register("table", gtables.\${1:Customer}TableName, "${name}", functions.For(\${3:reset}))`,
        '}',
        '',
        'func ${3:reset}(rec *gtables.${1:Customer}) (fcodeunits.Result, error) {',
        '\t$0',
        '\terr := rec.ModifyOrError(true)',
        '\tif err != nil {',
        '\t\treturn fcodeunits.Result{}, err',
        '\t}',
        '\treturn fcodeunits.Result{Success: true, Refresh: true}, nil',
        '}',
      );
    },
  },
  {
    name: 'ge-subscribe',
    description: 'Logic that runs after a sales document is posted',
    where: 'go',
    imports: [SALES],
    body: () =>
      lines(
        '// Subscribe it in Register: salesposting.OnAfterPost.Subscribe(${1:afterSalesPost})',
        "// It runs in the posting's transaction: its error undoes the posting.",
        'func ${1:afterSalesPost}(e *salesposting.AfterPost) error {',
        '\tif e.InvoiceNo == "" {',
        '\t\treturn nil',
        '\t}',
        '\t$0',
        '\treturn nil',
        '}',
      ),
  },
];

/** The snippets that fit a file, given its path from the app's folder (forward slashes). */
export function snippetsFor(path: string): Snippet[] {
  if (path.split('/').some((part) => part.startsWith('.'))) {
    return [];
  }
  if (path.endsWith('.go')) {
    return SNIPPETS.filter((snippet) => snippet.where === 'go');
  }
  return /\.ya?ml$/.test(path)
    ? SNIPPETS.filter((snippet) => snippet.where !== 'go' && path.startsWith(`${snippet.where}/`))
    : [];
}

/** The text and place of the imports a Go file lacks: after its package line. */
export function missingImports(
  source: string,
  imports: readonly string[],
): { line: number; text: string } | undefined {
  const rows = source.split('\n');
  const line = rows.findIndex((row) => /^package\s+\w+/.test(row));
  const missing = imports.filter((spec) => !source.includes(spec.slice(spec.indexOf('"'))));
  if (line < 0 || missing.length === 0) {
    return undefined;
  }
  return { line: line + 1, text: `\n${missing.map((spec) => `import ${spec}\n`).join('')}` };
}

/** The text a snippet gives when every placeholder keeps its proposal. */
export function expand(body: string): string {
  const values = new Map<string, string>();
  for (const [, index, value = ''] of body.matchAll(/\$\{(\d+):([^}]*)\}/g)) {
    values.set(index, value);
  }
  for (const [, index, choices = ''] of body.matchAll(/\$\{(\d+)\|([^|]*)\|\}/g)) {
    values.set(index, choices.split(',')[0]);
  }
  return body.replaceAll(
    /\$\{(\d+)(?::[^}]*|\|[^|]*\|)?\}|\$(\d+)/g,
    (_match, braced: string | undefined, plain: string | undefined) =>
      values.get(braced ?? plain!) ?? '',
  );
}
