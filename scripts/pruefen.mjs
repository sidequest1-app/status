// Erreichbarkeit prüfen, Stand und Verlauf schreiben, bei Ausfall ein GitHub-Issue öffnen (und bei Erholung schließen).
// Nur Node-Bordmittel und die GitHub CLI (`gh`, auf den GitHub-Runnern vorinstalliert). Keine Abhängigkeiten.
// Gespeichert werden nur Zeitpunkte, HTTP-Status, Antwortzeiten und kurze Fehlerarten, nie Antwortinhalte.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CONFIG = JSON.parse(readFileSync("checks.json", "utf8"));
const STATUS_DATEI = "data/status.json";
const VERLAUF_DATEI = "data/verlauf.json";
const TAGE = 90; // so lange bleiben Verlauf und Vorfälle stehen
const VERSUCHE = 3; // erst nach drei Fehlversuchen gilt ein Ziel als ausgefallen
const ZEITLIMIT_MS = 15_000;
const PAUSE_MS = 10_000;

const lesen = (datei, leer) => {
  try {
    return JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return leer;
  }
};
const tag = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const uhrzeit = (d) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(d);
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

async function einmal(ziel) {
  const start = performance.now();
  try {
    const res = await fetch(ziel.url, {
      redirect: "follow",
      headers: { "User-Agent": "sidequest-statusmonitor", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - start);
    const erwartet = ziel.erwartet ?? {};
    if (res.status !== (erwartet.status ?? 200)) return { ok: false, ms, fehler: `HTTP ${res.status}` };
    if (erwartet.enthaelt && !text.toLowerCase().includes(erwartet.enthaelt.toLowerCase()))
      return { ok: false, ms, fehler: "Antwort ohne erwarteten Inhalt" };
    return { ok: true, ms, fehler: null };
  } catch (err) {
    const zeit = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { ok: false, ms: null, fehler: zeit ? `Keine Antwort nach ${ZEITLIMIT_MS / 1000} s` : "Verbindung fehlgeschlagen" };
  }
}

async function pruefen(ziel) {
  let r;
  for (let i = 1; i <= VERSUCHE; i++) {
    r = await einmal(ziel);
    if (r.ok) return r;
    if (i < VERSUCHE) await schlafen(PAUSE_MS);
  }
  return r;
}

// GitHub-Issues: Wer das Repo beobachtet („Watch → Custom → Issues“), bekommt eine Benachrichtigung.
// Ohne GH_TOKEN (z. B. lokal) werden keine Issues angelegt.
let ghFehler = false;
const mitGitHub = Boolean(process.env.GH_TOKEN);
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function issueOeffnen(ziel, r, seit) {
  if (!mitGitHub) return null;
  try {
    gh(["label", "create", "ausfall", "--color", "D73A4A", "--description", "Automatische Ausfallmeldung", "--force"]);
    return gh([
      "issue", "create", "--label", "ausfall",
      "--title", `Ausfall: ${ziel.name}`,
      "--body",
      `**${ziel.name}** ist seit ${uhrzeit(seit)} Uhr nicht erreichbar (${r.fehler}, ${VERSUCHE} Versuche).\n\n` +
        `Automatische Meldung der Statusseite. Das Issue schließt sich, sobald die Prüfung wieder erfolgreich ist.`,
    ]);
  } catch (err) {
    console.error(`Issue für ${ziel.id} nicht angelegt: ${err.stderr || err.message}`);
    ghFehler = true;
    return null;
  }
}
function issueSchliessen(url, ziel, seit, jetzt) {
  if (!mitGitHub || !url) return;
  try {
    const minuten = Math.max(1, Math.round((jetzt - new Date(seit)) / 60_000));
    gh(["issue", "comment", url, "--body", `Wieder erreichbar seit ${uhrzeit(jetzt)} Uhr (Ausfall etwa ${minuten} min).`]);
    gh(["issue", "close", url]);
  } catch (err) {
    console.error(`Issue für ${ziel.id} nicht geschlossen: ${err.stderr || err.message}`);
    ghFehler = true;
  }
}

const jetzt = new Date();
const iso = jetzt.toISOString();
const alt = lesen(STATUS_DATEI, { ziele: {}, vorfaelle: [] });
const verlauf = lesen(VERLAUF_DATEI, { tage: {} });
const ergebnisse = await Promise.all(CONFIG.ziele.map(pruefen));

const ziele = {};
const vorfaelle = alt.vorfaelle ?? [];
CONFIG.ziele.forEach((ziel, i) => {
  const r = ergebnisse[i];
  const vorher = alt.ziele?.[ziel.id];
  const warOk = vorher?.ok ?? true;
  const neu = {
    name: ziel.name,
    ok: r.ok,
    seit: vorher && vorher.ok === r.ok ? vorher.seit : iso,
    ms: r.ms,
    fehler: r.fehler,
    issue: vorher?.issue ?? null,
  };
  if (warOk && !r.ok) {
    vorfaelle.unshift({ id: ziel.id, name: ziel.name, beginn: iso, ende: null, fehler: r.fehler, issue: null });
  }
  if (!r.ok && !neu.issue) {
    // Beim Beginn des Ausfalls, oder erneut, falls das Anlegen beim letzten Lauf scheiterte.
    neu.issue = issueOeffnen(ziel, r, new Date(neu.seit));
    const offen = vorfaelle.find((v) => v.id === ziel.id && !v.ende);
    if (offen) offen.issue = neu.issue;
  }
  if (!warOk && r.ok) {
    issueSchliessen(neu.issue ?? vorher?.issue, ziel, vorher?.seit ?? iso, jetzt);
    neu.issue = null;
    const offen = vorfaelle.find((v) => v.id === ziel.id && !v.ende);
    if (offen) offen.ende = iso;
  }
  ziele[ziel.id] = neu;

  const t = tag(jetzt);
  verlauf.tage[t] ??= {};
  const z = (verlauf.tage[t][ziel.id] ??= { n: 0, ok: 0, ms: 0 });
  z.n += 1;
  if (r.ok) {
    z.ok += 1;
    z.ms += r.ms;
  }
  console.log(`${ziel.id}: ${r.ok ? "ok" : "AUSFALL"}${r.ms != null ? `, ${r.ms} ms` : ""}${r.fehler ? `, ${r.fehler}` : ""}`);
});

const grenze = Date.now() - TAGE * 86_400_000;
const tage = Object.keys(verlauf.tage).sort().slice(-TAGE);
verlauf.tage = Object.fromEntries(tage.map((t) => [t, verlauf.tage[t]]));
const status = {
  stand: iso,
  intervall_minuten: CONFIG.intervall_minuten,
  ziele,
  vorfaelle: vorfaelle.filter((v) => !v.ende || Date.parse(v.beginn) > grenze).slice(0, 100),
};

mkdirSync("data", { recursive: true });
writeFileSync(STATUS_DATEI, JSON.stringify(status, null, 1) + "\n");
writeFileSync(VERLAUF_DATEI, JSON.stringify(verlauf) + "\n");
if (ghFehler) {
  console.error("GitHub-Issue konnte nicht angelegt oder geschlossen werden (Rechte des Workflows prüfen).");
  process.exitCode = 1;
}
