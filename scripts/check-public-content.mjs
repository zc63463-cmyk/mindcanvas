import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:node_modules|dist|\.forge|\.workbuddy|\.zcode|\.cursor|\.codebase-memory|\.local|\.venv|outputs|idb-profile|browser-profile)(\/|$)/;
const secretFile = /(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|kdbx|sqlite|sqlite3|db))$/i;
const template = /(^|\/)\.env\.(?:example|sample|template)$/;
const issues = [];
for (const path of paths) {
  if (forbidden.test(path) || (secretFile.test(path) && !template.test(path))) issues.push(`Private/generated path: ${path}`);
  if (statSync(path).size > 10 * 1024 * 1024) issues.push(`File exceeds 10 MiB: ${path}`);
}
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else console.log(`Public content paths checked: ${paths.length}`);
