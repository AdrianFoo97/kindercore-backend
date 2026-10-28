import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze, parseRouteFile, namedImports, schemaTables } from '../../architecture/analyze.js';
import { buildFromDisk, GENERATED_PATH } from '../../architecture/generate.js';

// Admin → Backend Architecture is generated from the source code. These
// check the reader understands this codebase's conventions, and that the
// committed graph matches the code — so it can't go stale on `test`.

const FILES = {
  'db/schema.ts': `
    export const users = mysqlTable('User', { id: varchar('id') });
    export const leads = mysqlTable('Lead', { id: varchar('id') });
    export const teachers = mysqlTable(
      'Teacher', { id: varchar('id') });`,
  'routes/index.ts': `
    import { leadsRouter } from './leads.routes.js';
    import { meRouter } from './me.routes.js';
    export const router = Router();
    router.use('/leads', leadsRouter);
    router.use('/', meRouter);`,
  'routes/leads.routes.ts': `
    import { getLeads, deleteLead } from '../controllers/leads.controller.js';
    import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
    export const leadsRouter = Router();
    // leadsRouter.get('/commented-out', asyncHandler(getLeads));
    leadsRouter.get('/', authMiddleware, asyncHandler(getLeads));
    leadsRouter.delete(
      '/:id',
      authMiddleware,
      adminMiddleware,
      asyncHandler(deleteLead),
    );
    leadsRouter.post('/upload', authMiddleware, (req, res) => { res.json({ ok: true }); });`,
  'routes/me.routes.ts': `
    import { getMe } from '../controllers/me.controller.js';
    export const meRouter = Router();
    meRouter.get('/me', authMiddleware, requireModule(MODULES.HR), asyncHandler(getMe));`,
  'controllers/leads.controller.ts': `
    import { db } from '../db/client.js';
    import { leads, users } from '../db/schema.js';
    import { computeMonthlyRevenue } from '../services/revenue.service.js';`,
  'controllers/me.controller.ts': `
    import { teachers as T } from '../db/schema.js';
    import { getLeads } from './leads.controller.js';`,
  'services/revenue.service.ts': `
    import { leads } from '../db/schema.js';`,
};

const arch = analyze(FILES);
const endpoint = (method: string, path: string) =>
  arch.routeGroups.flatMap(g => g.endpoints).find(e => e.method === method && e.path === path);

describe('Backend Architecture — reading the code', () => {
  it('maps each Drizzle table export to its real table name', () => {
    expect(schemaTables(FILES['db/schema.ts'])).toEqual({ users: 'User', leads: 'Lead', teachers: 'Teacher' });
  });

  it('reads named imports, including multi-name and renamed ones', () => {
    expect(namedImports(FILES['controllers/me.controller.ts'])['../db/schema.js']).toEqual(['T']);
    expect(namedImports(FILES['controllers/leads.controller.ts'])['../db/schema.js']).toEqual(['leads', 'users']);
  });

  it('builds each endpoint\'s full path from where its router is mounted', () => {
    expect(endpoint('GET', '/api/leads')).toBeDefined();
    expect(endpoint('GET', '/api/me')).toBeDefined();
  });

  it('keeps each endpoint\'s middleware in order, including multi-line definitions', () => {
    expect(endpoint('DELETE', '/api/leads/:id')?.middleware).toEqual(['authMiddleware', 'adminMiddleware']);
    expect(endpoint('GET', '/api/me')?.middleware).toEqual(['authMiddleware', 'requireModule(MODULES.HR)']);
  });

  it('links each endpoint to the controller module its handler is imported from', () => {
    expect(endpoint('DELETE', '/api/leads/:id')).toMatchObject({ handler: 'deleteLead', controller: 'leads.controller' });
  });

  it('marks an inline handler as such, with no controller', () => {
    expect(endpoint('POST', '/api/leads/upload')).toMatchObject({ handler: '(inline)', controller: null });
  });

  it('ignores commented-out routes', () => {
    expect(endpoint('GET', '/api/leads/commented-out')).toBeUndefined();
  });

  it('records which services and tables each controller uses', () => {
    expect(arch.controllers.find(c => c.id === 'leads.controller')).toEqual({
      id: 'leads.controller', services: ['revenue.service'], controllers: [], tables: ['Lead', 'User'],
    });
  });

  it('resolves a renamed table import and a controller-to-controller import', () => {
    expect(arch.controllers.find(c => c.id === 'me.controller')).toMatchObject({ tables: ['Teacher'], controllers: ['leads.controller'] });
  });

  it('records which tables each service uses', () => {
    expect(arch.services).toEqual([{ id: 'revenue.service', services: [], controllers: [], tables: ['Lead'] }]);
  });

  it('parses router-wide middleware into every endpoint of that router', () => {
    const { endpoints } = parseRouteFile(`
      xRouter.use(authMiddleware);
      xRouter.get('/a', asyncHandler(a));`);
    expect(endpoints[0].middleware).toEqual(['authMiddleware']);
  });
});

describe('Backend Architecture — kept up to date', () => {
  it('matches the current code (run `npm run arch:gen` if this fails)', () => {
    // The committed graph must equal what the code produces right now —
    // otherwise the page would show an old design.
    expect(readFileSync(GENERATED_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(buildFromDisk());
  });
});
