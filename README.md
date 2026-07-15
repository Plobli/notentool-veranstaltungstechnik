# Notentool Veranstaltungstechnik

Web-App zur Bewertung der IHK-Prüfungen für "Fachkraft für Veranstaltungstechnik"
(Abschluss- und Zwischenprüfung): schriftliche Prüfungen (unabhängige Korrektur durch
mehrere Prüfer mit automatischem Vergleich), Projekt-/Fachgesprächs-Bewertungsbogen,
automatische Gesamtergebnis-Berechnung.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env
npm test
npm start
```

Ersten Admin-Nutzer anlegen:

```bash
node --env-file=.env scripts/create-admin.js "Dein Name" deine@email.de dein-passwort
```

Danach unter http://localhost:3000/login einloggen.

## Deployment (Docker)

1. In `Caddyfile` `:80` durch eure echte Domain ersetzen.
2. Starten:

```bash
docker compose up -d --build
```

3. Admin-Nutzer im laufenden Container anlegen:

```bash
docker compose exec app node scripts/create-admin.js "Dein Name" deine@email.de dein-passwort
```

## Backup

Die komplette Datenbank ist eine einzelne Datei im Docker-Volume `app-data`
(`/app/data/pruefung.sqlite`). Backup z.B. per Cronjob:

```bash
docker compose exec app sqlite3 /app/data/pruefung.sqlite ".backup /app/data/backup.sqlite"
docker cp $(docker compose ps -q app):/app/data/backup.sqlite ./backup-$(date +%F).sqlite
```

## Aufbau

- `src/lib/` – reine Berechnungsfunktionen (Divisor-Normierung, Gesamtergebnis,
  Sperrfach-Regel, MEP, Fachgespräch)
- `src/routes/` – Express-Routen je Bereich
- `src/views/` – EJS-Templates
- `src/db.js` / `src/schema.sql` – SQLite-Anbindung und Datenbankschema
