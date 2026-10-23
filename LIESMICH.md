# Turnierplan

Web-App für Turniere (Tischtennis, Padel, Squash). Daten liegen in Firebase (Projekt `turnierplan-87c5c`).

## Hochladen auf GitHub
1. Neues öffentliches Repository `turnierplan` anlegen.
2. Alle Dateien und Ordner aus diesem ZIP über „Add file → Upload files“ hochladen, „Commit changes“.
3. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1–2 Minuten: `https://<github-name>.github.io/turnierplan/`

## Erster Start
Sofort selbst öffnen und den Admin anlegen (Name + PIN). Erst danach den Link weitergeben.

## Firestore-Regeln
Inhalt von `firestore.rules` muss in der Firebase-Konsole bei Firestore → Regeln veröffentlicht sein, sonst meldet die App „Kein Zugriff auf die Datenbank“.
