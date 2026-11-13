import type { NextFunction, Request, Response } from 'express';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE, SESSION_COOKIE, cookieValue } from '../services/session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery guard. The session cookie is sent by the
 * browser automatically, so a changing request (POST/PUT/PATCH/DELETE) that
 * rides on it must also carry the app's own header — which another website
 * can't add (CORS only allows the app's origin). Requests without the
 * session cookie (public forms, the RFID reader, Bearer scripts) aren't affected.
 */
export function requireAppRequest(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) { next(); return; }
  if (!cookieValue(req.headers.cookie, SESSION_COOKIE)) { next(); return; }
  if (req.headers[APP_REQUEST_HEADER] !== APP_REQUEST_VALUE) {
    res.status(403).json({ message: 'This request didn’t come from the app. Refresh the page and try again.' });
    return;
  }
  next();
}
