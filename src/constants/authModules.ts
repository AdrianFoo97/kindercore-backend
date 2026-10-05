// The fixed catalog of Modules an AuthRole can be granted. Deliberately
// code-level, not DB-driven — every module maps to a real Navbar dropdown
// wired to real routes, so adding one always requires a code deploy
// anyway (new routes/components), and a DB-driven catalog would only add
// indirection without removing that deploy step.
//
// This file is hand-mirrored on the frontend at
// kindercore-frontend/src/constants/authModules.ts — keep both in sync.

// One entry per Navbar dropdown currently shown to any authenticated user
// with zero role gating: Leads, Students, HR, Finance, Operation, Analysis,
// Tools. Settings/Admin/Dev stay hard-gated to ADMIN/SUPERADMIN as before —
// they are NOT part of this catalog, since that tier sits above AuthRole
// entirely.
export const MODULES = {
  LEADS: 'LEADS',
  STUDENTS: 'STUDENTS',
  HR: 'HR',
  FINANCE: 'FINANCE',
  OPERATION: 'OPERATION',
  ANALYSIS: 'ANALYSIS',
  TOOLS: 'TOOLS',
} as const;
export type ModuleKey = typeof MODULES[keyof typeof MODULES];
export const ALL_MODULE_KEYS: ModuleKey[] = Object.values(MODULES);

// Views (fine-grained actions within a module, e.g. OPERATION_SOP_APPROVE)
// used to live here as a hardcoded object too. They're now a real,
// admin-managed DB catalog instead — see db/schema.ts's authViews table
// and controllers/auth-views.controller.ts. A view created there still
// does nothing on its own until a developer hardcodes a matching
// requireView(...)/hasView(...) call somewhere, same as before; the
// catalog just makes the key/label/description part admin-editable
// without a deploy.
