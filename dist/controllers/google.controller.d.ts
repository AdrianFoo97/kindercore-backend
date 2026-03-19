import { Request, Response } from 'express';
export declare function getStatus(_req: Request, res: Response): Promise<void>;
export declare function connectToken(req: Request, res: Response): Promise<void>;
export declare function startAuth(req: Request, res: Response): void;
export declare function listCalendars(_req: Request, res: Response): Promise<void>;
export declare function setCalendar(req: Request, res: Response): Promise<void>;
export declare function handleCallback(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=google.controller.d.ts.map