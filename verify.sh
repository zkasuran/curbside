#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
# The release gate. Every step must pass; nothing is skipped silently.
#   ./verify.sh          static checks, unit and adversarial tests, audit, production build
#   ./verify.sh --e2e    also the live sandbox proof (needs `pnpm dev` running, see scripts/e2e-sandbox.mjs)
set -euo pipefail
cd "$(dirname "$0")"
step() { printf '\n== %s\n' "$*"; }

OURS=(actions/*.ts server/lib/*.ts server/db/*.ts server/plugins/db.ts server/plugins/secrets.ts server/plugins/agent-engine.ts server/plugins/agent-engine.ts
  app/components/survey/*.ts app/components/survey/*.tsx app/routes/survey.tsx server/middleware/0-security-headers.ts server/auth-page.ts tests/*.ts scripts/e2e-sandbox.mjs)

step "lockfile is complete and unchanged"
pnpm install --frozen-lockfile --prefer-offline >/dev/null

step "format (oxfmt --check)"
pnpm exec oxfmt --check "${OURS[@]}"

step "typecheck (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess)"
pnpm typecheck

step "agent-native doctor (scoping, credentials, migrations)"
pnpm agent-native:doctor

step "unit, property and adversarial tests"
pnpm test

step "supply chain: no high or critical advisories"
pnpm audit --audit-level high

step "licence header on every source file we wrote"
missing=0
for f in "${OURS[@]}" verify.sh; do
  case "$f" in actions/navigate.ts|actions/view-screen.ts|actions/run.ts|actions/provider-api-request.ts) continue ;; esac
  head -3 "$f" | grep -q "SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0" || { echo "no SPDX header: $f"; missing=1; }
done
[ "$missing" = 0 ]

step "no secrets tracked"
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'; then echo "an env file is tracked"; exit 1; fi
if git grep -n -I -E '(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{32,}|npg_[A-Za-z0-9]{10,})' -- . ':!pnpm-lock.yaml'; then echo "secret-shaped string tracked"; exit 1; fi

step "production build"
NITRO_PRESET=node pnpm build >/tmp/curbside-build.log 2>&1 || { tail -40 /tmp/curbside-build.log; exit 1; }

if [ "${1:-}" = "--e2e" ]; then
  step "live end-to-end proof against the OSM development sandbox"
  node scripts/e2e-sandbox.mjs "docs/evidence/e2e-$(date -u +%Y%m%dT%H%M%SZ)"
fi

printf '\nALL GREEN\n'
