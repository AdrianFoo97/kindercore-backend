import { Request, Response } from 'express';
export declare function getPackages(req: Request, res: Response): Promise<void>;
export declare function getPackageYears(_req: Request, res: Response): Promise<void>;
export declare function getPackagesConfig(_req: Request, res: Response): Promise<void>;
export declare function createPackage(req: Request, res: Response): Promise<void>;
export declare function deletePackage(req: Request, res: Response): Promise<void>;
export declare function patchPackage(req: Request, res: Response): Promise<void>;
/** @deprecated kept for backwards compat — use patchPackage instead */
export declare const patchPackageName: typeof patchPackage;
export declare function upsertPackages(req: Request, res: Response): Promise<void>;
export declare function updateProgrammes(req: Request, res: Response): Promise<void>;
export declare function updateAges(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=packages.controller.d.ts.map