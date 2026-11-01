#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# Build for Vercel, pin every function next to the Neon database (fra1, 300 s, 2 GB) and deploy to
# production. Run ./verify.sh first. Needs the Vercel CLI logged in to the zkasuran1 team.
set -euo pipefail
cd "$(dirname "$0")/.."
env -u OPENAI_API_KEY -u OPENAI_BASE_URL AGENT_NATIVE_VERCEL_CRON_SCHEDULE="0 9 * * *" NITRO_PRESET=vercel \
  pnpm -s build > /tmp/curbside-vercel-build.log 2>&1 || { tail -40 /tmp/curbside-vercel-build.log; exit 1; }
python3 - <<'PY'
import glob, json
for p in glob.glob(".vercel/output/functions/*.func/.vc-config.json"):
    c = json.load(open(p)); c["regions"] = ["fra1"]; c.setdefault("maxDuration", 300); c["memory"] = 2048
    json.dump(c, open(p, "w"), indent=2)
PY
vercel deploy --prebuilt --prod --yes 2>&1 | tail -3
