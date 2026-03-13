import { Request, Response, NextFunction } from 'express';
type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): Handler;
export {};
//# sourceMappingURL=asyncHandler.d.ts.map