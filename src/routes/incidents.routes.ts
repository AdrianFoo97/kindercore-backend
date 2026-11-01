import { Router } from 'express';
import {
  addIncidentLog, createIncident, listIncidents, listIncidentStudentOptions, listMyIncidents, updateIncident,
} from '../controllers/incidents.controller.js';
import { authMiddleware, requireView } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const incidentsRouter = Router();

// Two levels:
//  - any staff member can file a report and see the ones they filed;
//  - incident managers (supervisors / principal — the OPERATION_INCIDENT_MANAGE
//    view, granted per role in Admin → Views; Admins always) see every report,
//    correct details, move the status and add to the follow-up log.
incidentsRouter.post('/incidents', authMiddleware, asyncHandler(createIncident));
incidentsRouter.get('/incidents/mine', authMiddleware, asyncHandler(listMyIncidents));
incidentsRouter.get('/incidents/student-options', authMiddleware, asyncHandler(listIncidentStudentOptions));
incidentsRouter.get('/incidents', authMiddleware, requireView('OPERATION_INCIDENT_MANAGE'), asyncHandler(listIncidents));
incidentsRouter.patch('/incidents/:id', authMiddleware, requireView('OPERATION_INCIDENT_MANAGE'), asyncHandler(updateIncident));
incidentsRouter.post('/incidents/:id/log', authMiddleware, requireView('OPERATION_INCIDENT_MANAGE'), asyncHandler(addIncidentLog));
