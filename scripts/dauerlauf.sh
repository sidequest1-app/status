#!/usr/bin/env bash
# Dauerlauf: ein Workflow-Lauf bleibt bis zu LAUFZEIT_MINUTEN aktiv und prüft darin alle ABSTAND_SEKUNDEN.
# Grund: GitHub verzögert oder streicht Zeitplan-Läufe bei hoher Last, ein kurzer Lauf „alle 10 Minuten“ kommt deshalb
# oft nur alle paar Stunden. Der stündliche Zeitplan sorgt nur dafür, dass immer ein Lauf aktiv ist oder bereitsteht.
# Im öffentlichen Repo kostet das keine Actions-Minuten.
set -uo pipefail

LAUFZEIT_MINUTEN="${LAUFZEIT_MINUTEN:-340}"
ABSTAND_SEKUNDEN="${ABSTAND_SEKUNDEN:-600}"
ende=$(( $(date +%s) + LAUFZEIT_MINUTEN * 60 ))
zweig="$(git rev-parse --abbrev-ref HEAD)"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

holen() {
  # Neuesten Stand holen: Daten des letzten Laufs und Änderungen an checks.json oder am Skript.
  git pull -q --rebase origin "$zweig" || { git rebase --abort 2>/dev/null; git fetch -q origin "$zweig" && git reset -q --hard FETCH_HEAD; }
}

speichern() {
  git add data
  if git diff --cached --quiet; then return 0; fi
  git commit -q -m "Status $(date -u +%Y-%m-%dT%H:%MZ)"
  for _ in 1 2 3; do
    git push -q origin "HEAD:$zweig" && return 0
    git pull -q --rebase origin "$zweig" || return 1
  done
  return 1
}

while :; do
  beginn=$(date +%s)
  holen
  node scripts/pruefen.mjs
  pruefung=$?
  speichern || { echo "::error::Stand konnte nicht gespeichert werden."; exit 1; }
  # Konnte ein Ausfall-Issue nicht angelegt werden, sofort mit Fehler enden: GitHub meldet den gescheiterten Lauf
  # per Mail, und der nächste Lauf versucht es wieder.
  if [ "$pruefung" -ne 0 ]; then exit "$pruefung"; fi
  naechste=$(( beginn + ABSTAND_SEKUNDEN ))
  if [ "$naechste" -ge "$ende" ]; then break; fi
  warten=$(( naechste - $(date +%s) ))
  if [ "$warten" -gt 0 ]; then sleep "$warten"; fi
done
echo "Dauerlauf regulär beendet, der nächste Lauf übernimmt."
