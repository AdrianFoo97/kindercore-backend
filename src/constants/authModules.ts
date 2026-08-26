// The fixed catalog of Modules and Views an AuthRole can be granted.
// Deliberately code-level, not DB-driven — every module maps to a real
// Navbar dropdown wired to real routes, and every view maps to a real
// gated action in a real page component. Adding either always requires a
// code deploy anyway (new routes/components/gate call-sites), so a
// DB-driven catalog would only add indirection without removing any
// deploy step.
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

// Fine-grained actions within a module that not every AuthRole sharing
// that module should get. Keyed loosely by module for readability, but
// stored/checked as flat strings (matches AuthRoleView.view VARCHAR(50)).
export const VIEWS = {
  // Improvement Inbox approve/reject — the pilot case. Available to a
  // "Supervisor" AuthRole even though "Teacher" shares the OPERATION
  // module (Best Way Library) without this view.
  OPERATION_SOP_APPROVE: 'OPERATION_SOP_APPROVE',
} as const;
export type ViewKey = typeof VIEWS[keyof typeof VIEWS];
export const ALL_VIEW_KEYS: ViewKey[] = Object.values(VIEWS);
