import { Request, Response } from 'express';
export declare function createLead(req: Request, res: Response): Promise<void>;
export declare function getLeads(req: Request, res: Response): Promise<void>;
export declare function getLeadStats(_req: Request, res: Response): Promise<void>;
export declare function updateLead(req: Request, res: Response): Promise<void>;
declare function roundUpTo30Min(date: Date): Date;
export declare function createAppointment(req: Request, res: Response, next: import('express').NextFunction): Promise<void>;
export declare function getUpcomingAppointments(_req: Request, res: Response): Promise<void>;
export declare function getAnalytics(req: Request, res: Response): Promise<void>;
export declare function getSalesAnalytics(req: Request, res: Response): Promise<void>;
export { roundUpTo30Min };
//# sourceMappingURL=leads.controller.d.ts.map