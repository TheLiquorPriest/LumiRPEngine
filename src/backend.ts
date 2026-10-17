// Backend entry (`dist/backend.js`): the host loads this module in the extension's worker.

import { startBackend } from "./backend/main";

startBackend();
