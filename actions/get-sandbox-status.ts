// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { osmBase, sandboxToken, whoAmI } from "../server/lib/osm-client.js";

export default defineAction({
  description:
    "Which OSM server edits go to (always the development sandbox) and which sandbox account uploads them.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    try {
      const base = osmBase();
      const [user, token] = await Promise.all([whoAmI(), sandboxToken()]);
      return {
        ok: true,
        live: false,
        ownAccount: token.own,
        apiBase: base,
        account: user.displayName,
        accountUrl: `${base}/user/${encodeURIComponent(user.displayName)}`,
      };
    } catch (error) {
      return {
        ok: false,
        live: false,
        ownAccount: false,
        apiBase: null,
        account: null,
        accountUrl: null,
        problem: error instanceof Error ? error.message : "unavailable",
      };
    }
  },
});
