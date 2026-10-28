// npm run arch:gen — regenerate src/architecture/architecture.generated.ts
import { writeGenerated, GENERATED_PATH } from '../src/architecture/generate.js';

writeGenerated();
console.log(`Architecture graph written to ${GENERATED_PATH}`);
