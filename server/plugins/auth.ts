import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

import { renderCurbsideSignInPage } from "../auth-page";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  // The framework's marketing layout loads remote fonts that this app's CSP blocks and forces a
  // dark palette, so the Curbside brand panel is rendered around the stock form instead.
  marketing: false,
  renderSignInPage: renderCurbsideSignInPage,
});
