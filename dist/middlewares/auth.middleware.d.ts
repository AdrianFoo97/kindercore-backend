import { Request, Response, NextFunction } from 'express';
export interface AuthUser {
    id: string;
    email: string;
    role: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}
export declare function adminMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.middleware.d.ts.map