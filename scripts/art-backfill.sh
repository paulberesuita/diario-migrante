#!/bin/zsh
# Run: scripts/art-backfill.sh 2026-09-17 [more dates]   (scene lines: scripts/art-backfill-sep9-17.json)
K=$(security find-generic-password -s diariomigrante-admin -w)
for D in "$@"; do
  BODY=$(python3 -c "import json,sys; print(json.dumps({'concepts': json.load(open('$(dirname $0)/art-backfill-sep9-17.json'))['$D']}))")
  echo "$D $(curl -s --max-time 600 -X POST "https://diariomigrante.com/api/backfill-images?date=$D" -H "X-API-Key: $K" -H 'Content-Type: application/json' -d "$BODY")"
done
