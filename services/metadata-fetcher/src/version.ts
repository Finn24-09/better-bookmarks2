import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the package.json version at module load. `import.meta.dirname` resolves
// to src/ during `tsx` dev and dist/ in the built container — both one level
// below the package root, so `../package.json` is correct in either case.
// Reading synchronously at module init keeps `VERSION` a plain constant
// throughout the rest of the process and avoids an async hop on the startup
// banner. No HTTP route exposes this; the value is for log output only.

const pkgPath = join(import.meta.dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };

export const VERSION: string = typeof pkg.version === 'string' ? pkg.version : 'unknown';
