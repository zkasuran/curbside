// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { createGetDb } from "@agent-native/core/db";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };
