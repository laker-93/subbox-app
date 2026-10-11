// Maps the renderer's `/@/` imports to src/ for check scripts that load renderer code.
// tsx reads tsconfig paths, but not these: it takes `/@/...` for an absolute path.
//
// Usage: tsx --import ./scripts/renderer-alias.mjs scripts/check-....ts
import Module from 'node:module';
import path from 'node:path';

const src = path.join(import.meta.dirname, '..', 'src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    const mapped = request.startsWith('/@/') ? path.join(src, request.slice(3)) : request;
    return resolve.call(this, mapped, ...rest);
};
