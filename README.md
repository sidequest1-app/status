# SideQuest Status

Öffentliche Statusseite für SideQuest: Erreichbarkeit von Portal und API, Verlauf der letzten 90 Tage und Störungen.

- **Prüfung:** alle 10 Minuten per GitHub Actions (`.github/workflows/pruefen.yml`, Ziele in `checks.json`). Ein Ziel gilt
  erst nach drei Fehlversuchen im Abstand von 10 Sekunden als gestört. Der Zeitplan von GitHub kann sich um einige Minuten verzögern.
- **Daten:** `data/status.json` (aktueller Stand, Störungen) und `data/verlauf.json` (Tageswerte). Gespeichert werden nur
  Zeitpunkte, HTTP-Status, Antwortzeiten und die Art des Fehlers, keine Antwortinhalte und keine personenbezogenen Daten.
- **Benachrichtigung:** Bei einer Störung legt der Workflow ein Issue mit dem Label `ausfall` an und schließt es, sobald die
  Prüfung wieder klappt. Wer das Repo mit „Watch → Custom → Issues“ beobachtet, bekommt eine GitHub-Benachrichtigung.
- **Seite:** `index.html`, statisch über GitHub Pages. Keine Cookies, kein Speicher im Browser, keine Drittanbieter, kein Tracking.
- **Abhängigkeiten:** keine. Node und die GitHub CLI sind auf den Runnern vorhanden; `actions/checkout` ist per Commit-SHA
  gepinnt und wird von Dependabot nach frühestens 14 Tagen aktualisiert.

Ein neues Ziel kommt in `checks.json` (`id`, `name`, `url`, erwarteter Status und ein Textstück, das die Antwort enthalten muss).
