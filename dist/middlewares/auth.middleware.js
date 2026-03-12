import jwt from 'jsonwebtoken';
export function adminMiddleware(req, res, next) {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ message: 'Forbidden: Admin only' });
        return;
    }
    next();
}
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ message: 'Invalid token' });
    }
}
//# sourceMappingURL=auth.middleware.js.map