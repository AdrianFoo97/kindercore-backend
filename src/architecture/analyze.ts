// Derives the backend's layered architecture — Routes → Controllers →
// Services → Tables — from the source code itself, for the Admin →
// Backend Architecture page. Pure functions over { path: contents }, so it
// is testable without touching the disk; see generate.ts for the disk side.
//
// It's a reader of THIS codebase's conventions, not a general TS parser:
//   routes/index.ts       router.use('/prefix', xRouter)   (mounted at /api)
//   routes/*.routes.ts    xRouter.get('/path', mw…, asyncHandler(fn))
//   controllers/*.ts      import { … } from '../services/…' | '../db/schema.js'
//   services/*.ts         same
//   db/schema.ts          export const users = mysqlTable('User', …)

export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full path as served, e.g. /api/leads/:id */
  path: string;
  /** Middleware in order, as written (e.g. authMiddleware, requireModule(MODULES.TOOLS)). */
  middleware: string[];
  /** Handler function name, or '(inline)' for an inline function. */
  handler: string;
  /** Controller module the handler comes from (e.g. leads.controller), or null. */
  controller: string | null;
}

export interface RouteGroup {
  id: string;          // e.g. leads.routes
  mount: string;       // e.g. /api/leads
  endpoints: Endpoint[];
}

export interface CodeModule {
  id: string;          // e.g. leads.controller, payroll.service
  services: string[];  // service modules it imports
  controllers: string[]; // other controller modules it imports
  tables: string[];    // DB tables (real names, e.g. User) it imports from the schema
}

export interface Architecture {
  routeGroups: RouteGroup[];
  controllers: CodeModule[];
  services: CodeModule[];
  tables: string[];
}

type Files = Record<string, string>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop()!.replace(/\.(ts|js)$/, '');

/** Strips // and /* *\/ comments (enough for our source; strings with // are rare in these files). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * Named imports per module specifier: { '../services/x.js': ['a','b'] }.
 * For `import { teachers as T }`, 'local' gives T (what the file calls it —
 * used to match route handlers) and 'imported' gives teachers (what the
 * module exports — used to look up schema tables).
 */
export function namedImports(src: string, which: 'local' | 'imported' = 'local'): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of stripComments(src).matchAll(re)) {
    const names = m[1].split(',').map(s => {
      const parts = s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map(p => p.trim());
      return which === 'local' ? parts[parts.length - 1] : parts[0];
    }).filter(Boolean);
    out[m[2]] = [...(out[m[2]] ?? []), ...names];
  }
  return out;
}

/** Drizzle export name → real table name, from db/schema.ts. */
export function schemaTables(schemaSrc: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of schemaSrc.matchAll(/export const (\w+)\s*=\s*mysqlTable\(\s*['"](\w+)['"]/g)) out[m[1]] = m[2];
  return out;
}

/** Splits a call's argument text on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { cur += c; if (c === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Text between the '(' at `open` and its matching ')'. */
function callBody(s: string, open: number): string {
  let depth = 0, quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return s.slice(open + 1, i);
  }
  return s.slice(open + 1);
}

const compact = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Endpoints declared in one routes file (paths relative to its mount). */
export function parseRouteFile(src: string): { endpoints: Omit<Endpoint, 'controller'>[]; routerMiddleware: string[] } {
  const code = stripComments(src);
  const routerMiddleware: string[] = [];
  for (const m of code.matchAll(/\b\w+[Rr]outer\.use\(/g)) {
    const args = splitArgs(callBody(code, m.index! + m[0].length - 1));
    // xRouter.use(mw) / xRouter.use('/p', mw) — router-wide middleware only.
    for (const a of args) if (!/^['"`]/.test(a)) routerMiddleware.push(compact(a));
  }
  const endpoints: Omit<Endpoint, 'controller'>[] = [];
  const re = new RegExp(`\\b\\w+[Rr]outer\\.(${METHODS.join('|')})\\(`, 'g');
  for (const m of code.matchAll(re)) {
    const args = splitArgs(callBody(code, m.index! + m[0].length - 1));
    const pathArg = args[0]?.match(/^['"`]([^'"`]*)['"`]$/);
    if (!pathArg) continue;
    const last = args[args.length - 1] ?? '';
    const wrapped = last.match(/^asyncHandler\(\s*(\w+)\s*\)$/);
    const handler = wrapped ? wrapped[1] : /^\w+$/.test(last) ? last : '(inline)';
    endpoints.push({
      method: m[1].toUpperCase() as Endpoint['method'],
      path: pathArg[1],
      middleware: [...routerMiddleware, ...args.slice(1, -1).map(compact)],
      handler,
    });
  }
  return { endpoints, routerMiddleware };
}

const joinPath = (...parts: string[]) =>
  ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** The whole architecture from the backend's src files ({ 'routes/leads.routes.ts': '…', … }). */
export function analyze(files: Files): Architecture {
  const norm: Files = {};
  for (const [p, c] of Object.entries(files)) norm[p.replace(/\\/g, '/')] = c;

  const tableOf = schemaTables(norm['db/schema.ts'] ?? '');
  const isIn = (dir: string) => (p: string) => p.startsWith(`${dir}/`) && p.endsWith('.ts');

  // Mounts: routerVar → prefix, routerVar → routes file.
  const index = norm['routes/index.ts'] ?? '';
  const varToFile: Record<string, string> = {};
  for (const [spec, names] of Object.entries(namedImports(index))) {
    for (const n of names) varToFile[n] = baseName(spec);
  }
  const mounts: Record<string, string> = {};
  for (const m of stripComments(index).matchAll(/\brouter\.use\(\s*['"`]([^'"`]*)['"`]\s*,\s*(\w+)\s*\)/g)) {
    if (varToFile[m[2]]) mounts[varToFile[m[2]]] = m[1];
  }

  const routeGroups: RouteGroup[] = Object.keys(norm).filter(isIn('routes')).filter(p => p !== 'routes/index.ts')
    .sort().map(p => {
      const id = baseName(p);
      const src = norm[p];
      const handlerModule: Record<string, string> = {};
      for (const [spec, names] of Object.entries(namedImports(src))) {
        if (/controllers\//.test(spec)) for (const n of names) handlerModule[n] = baseName(spec);
      }
      const mount = joinPath('api', mounts[id] ?? '');
      const { endpoints } = parseRouteFile(src);
      return {
        id,
        mount,
        endpoints: endpoints.map(e => ({ ...e, path: joinPath(mount, e.path), controller: handlerModule[e.handler] ?? null })),
      };
    });

  const moduleOf = (p: string): CodeModule => {
    const imports = namedImports(norm[p]);
    const pick = (re: RegExp) => [...new Set(Object.keys(imports).filter(s => re.test(s)).map(baseName))].sort();
    const tables = [...new Set(Object.entries(namedImports(norm[p], 'imported'))
      .filter(([s]) => /db\/schema(\.js)?$/.test(s))
      .flatMap(([, names]) => names.map(n => tableOf[n]).filter(Boolean)))].sort();
    return {
      id: baseName(p),
      services: pick(/services\//),
      controllers: pick(/(controllers\/|^\.\/[\w.-]+\.controller)/).filter(c => c !== baseName(p)),
      tables,
    };
  };

  const controllers = Object.keys(norm).filter(isIn('controllers')).sort().map(moduleOf);
  const services = Object.keys(norm).filter(isIn('services')).sort().map(moduleOf);
  return { routeGroups, controllers, services, tables: Object.values(tableOf).sort() };
}
