// Fichiers WebAssembly du défi Cap (@cap.js/wasm, version exacte de package-lock.json) copiés dans public/cap/wasm :
// servis par le site lui-même (CSP connect-src 'self'), jamais par un CDN (lib/verification.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("@cap.js/wasm/package.json")), "browser");
const out = new URL("../public/cap/wasm/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const f of ["cap_wasm_bg.wasm", "hashwx.wasm"]) copyFileSync(join(src, f), join(out, f));
console.log("cap-wasm : 2 fichiers copiés dans public/cap/wasm");
