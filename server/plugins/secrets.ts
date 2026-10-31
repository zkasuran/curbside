// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { registerRequiredSecret } from "@agent-native/core/secrets";
import { defineNitroPlugin } from "@agent-native/core/server";

export default defineNitroPlugin(() => {
  registerRequiredSecret({
    key: "OSM_SANDBOX_TOKEN",
    label: "OSM sandbox token (optional)",
    description:
      "An OAuth 2 access token for your own account on the OpenStreetMap development server (master.apis.dev.openstreetmap.org), with the write_api scope. Without one, uploads go to the sandbox under the shared Curbside demo account. Live OSM is never written.",
    docsUrl: "https://wiki.openstreetmap.org/wiki/OAuth",
    scope: "user",
    kind: "api-key",
    required: false,
  });
});
