"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = asyncHandler;
function asyncHandler(fn) {
    return (req, res, next) => fn(req, res).catch(next);
}
//# sourceMappingURL=asyncHandler.js.map