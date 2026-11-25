#!/usr/bin/env bash
# Dauerlauf: ein Workflow-Lauf bleibt bis zu LAUFZEIT_MINUTEN aktiv und prüft darin alle ABSTAND_SEKUNDEN.
# Grund: GitHub verzögert oder streicht Zeitplan-Läufe bei hoher Last, ein kurzer Lauf „alle 10 Minuten“ kommt deshalb
# oft nur alle paar Stunden. Der stündliche Zeitplan sorgt nur dafür, dass immer ein Lauf aktiv ist oder bereitsteht.
# Im öffentlichen Repo kostet das keine Actions-Minuten.
#
# Sicherheit: Ausgeführt wird pruefen.mjs aus demselben Ordner wie dieses Skript. Der Workflow kopiert beide vor dem
# Start aus dem ausgecheckten Commit nach $RUNNER_TEMP; git pull holt danach nur Daten und checks.json, ein dabei
# geholtes Skript wird erst im nächsten Lauf (nach neuem Checkout) ausgeführt.
# Der Token (STATUS_TOKEN) wird nur an git push und an pruefen.mjs (GitHub CLI für die Issues) weitergegeben, nicht in
# .git/config gespeichert. Holen geht ohne Token (öffentliches Repo). Lokal ohne STATUS_TOKEN: normale git-Anmeldung.
set -uo pipefail

code="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
token="${STATUS_TOKEN:-}"
unset STATUS_TOKEN
auth=""
if [ -n "$token" ]; then
  auth="$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
  echo "::add-mask::$auth"
fi

LAUFZEIT_MINUTEN="${LAUFZEIT_MINUTEN:-340}"
ABSTAND_SEKUNDEN="${ABSTAND_SEKUNDEN:-600}"
ende=$(( $(date +%s) + LAUFZEIT_MINUTEN * 60 ))
zweig="$(git rev-parse --abbrev-ref HEAD)"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

holen() {
  # Neuesten Stand holen: Daten des letzten Laufs und Änderungen an checks.json (Skripte laufen aus $code, siehe oben).
  git pull -q --rebase origin "$zweig" || { git rebase --abort 2>/dev/null; git fetch -q origin "$zweig" && git reset -q --hard FETCH_HEAD; }
}

pushen() {
  if [ -z "$auth" ]; then git push -q origin "HEAD:$zweig"; return; fi
  # Token nur für diesen einen git-Aufruf, als HTTP-Header über die Umgebung (nicht in .git/config, nicht in der
  # Befehlszeile). Der base64-Wert ist im Log maskiert (oben).
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" git push -q origin "HEAD:$zweig"
}

pruefen() {
  if [ -n "$token" ]; then GH_TOKEN="$token" node "$code/pruefen.mjs"; else node "$code/pruefen.mjs"; fi
}

speichern() {
  git add data
  if git diff --cached --quiet; then return 0; fi
  git commit -q -m "Status $(date -u +%Y-%m-%dT%H:%MZ)"
  for _ in 1 2 3; do
    pushen && return 0
    git pull -q --rebase origin "$zweig" || return 1
  done
  return 1
}

while :; do
  beginn=$(date +%s)
  holen
  pruefen
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
