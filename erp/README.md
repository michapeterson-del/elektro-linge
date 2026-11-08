# Elektro Linge ERP

Warenwirtschaft und Kundenverwaltung für Elektro Linge. Die Website wurde **nicht** verändert,
das ERP liegt komplett im Ordner `erp/`.

## Was es kann

| Bereich | Funktionen |
|---|---|
| **Anfragen & Kundenreise** | Board mit 7 Phasen (Neue Anfrage → Kontakt → Vor-Ort-Termin → Angebot verschickt → Auftrag → In Ausführung → Abgeschlossen, plus „Verloren“), Drag & Drop, Wiedervorlagen, Notizen/Anrufe/Termine als Verlauf, Termin als Kalenderdatei (.ics), Anruf-/WhatsApp-/E-Mail-Knöpfe |
| **Anfrage-Erkennung** | FormSubmit-E-Mail von der Website (oder WhatsApp-Text) einfügen: Name, E-Mail, Telefon, Thema und Nachricht werden automatisch erkannt |
| **Kunden** | Kundendatenbank mit fortlaufenden Kundennummern (K-10001 …), Umsatz, alle Belege und Anfragen je Kunde, Bestandskunden werden automatisch erkannt |
| **Angebote** | Fortlaufende Angebotsnummern (AN-2026-0001 …), Artikel per Suche einfügen, freie Positionen, Zwischenüberschriften, Rabatt, 19/7/0 % MwSt. (0 % für PV nach § 12 Abs. 3 UStG), Ausweis der Arbeitskosten nach § 35a EStG, PDF/Druck mit Briefkopf, E-Mail, Duplizieren |
| **Rechnungen** | Aus angenommenem Angebot mit einem Klick, lückenlose Rechnungsnummer erst beim Festschreiben, danach gesperrt (GoBD), Zahlungseingang, Storno, Überfällig-Hinweise |
| **Artikel & Leistungen** | Artikelstamm mit EK/VK/Aufschlag, Einheiten, Kategorien, Lohn/Material, CSV-Import und -Export, Beispielartikel zum Start |
| **Lager** | Bestände, Wareneingang, Entnahme, Inventur, Mindestbestand mit Bestellvorschlag, Reservierung für Aufträge, Material eines Auftrags mit einem Klick ausbuchen, Lagerwert |
| **Übersicht** | Kennzahlen, automatische Aufgabenliste (neue Anfragen, Wiedervorlagen, Angebote nachfassen, offene Rechnungen, Nachbestellen, Sicherung) |

Ablauf automatisch: Angebot versendet → Anfrage springt auf „Angebot verschickt“ + Wiedervorlage in 7 Tagen ·
Angebot angenommen → „Auftrag erteilt“ · Rechnung bezahlt → „Abgeschlossen“.

## Variante A: sofort im Browser (ohne Installation)

Nach dem Veröffentlichen ist das ERP unter **https://elektrolinge.de/erp/** erreichbar
(lokal: `python3 -m http.server 8000` im Hauptordner, dann http://localhost:8000/erp/).

- Die Daten liegen **nur im Browser dieses Geräts**, nicht auf dem Webserver. Auf GitHub Pages landet nichts.
- Unter *Einstellungen* eine **PIN** festlegen und regelmäßig **„Sicherung herunterladen“** (JSON-Datei).
  Mit „Sicherung einspielen“ kommt alles auf ein anderes Gerät.
- Website-Anfragen: die FormSubmit-Mail öffnen, Text kopieren → *Anfragen → E-Mail / Nachricht einfügen*.
- Die Seite ist mit `noindex` markiert, Google nimmt sie nicht auf.

## Variante B: mit Server (empfohlen für mehrere Geräte und automatische Leads)

Benötigt nur Node.js (ab Version 18), keine weiteren Pakete:

```bash
ERP_PASSWORT="ein-sicheres-passwort" node erp/server.js
```

Dann http://localhost:8080/erp/ öffnen und mit dem Passwort anmelden. Daten liegen in `erp/daten/`
(wird nicht ins Git übernommen), jeden Tag entsteht eine Sicherungskopie in `erp/daten/sicherungen/`.
Für den Betrieb im Internet den Server hinter HTTPS betreiben (z. B. Hetzner/Uberspace mit Caddy oder nginx).

| Variable | Bedeutung |
|---|---|
| `ERP_PASSWORT` | Pflicht, mindestens 6 Zeichen |
| `PORT` | Standard `8080` |
| `ERP_DATEN` | Datenordner, Standard `erp/daten` |
| `ERP_LEAD_ORIGINS` | Websites, die Anfragen schicken dürfen, Standard `https://elektrolinge.de,https://www.elektrolinge.de` |

### Website-Anfragen automatisch ins ERP

Der Server nimmt Anfragen unter `POST https://<ihr-erp-server>/api/leads` an (Felder wie im
Website-Formular: `name`, `email`, `phone`, `topic`, `message`, Spam-Falle `_honey`). Neue Anfragen
erscheinen spätestens nach 30 Sekunden unter „Anfragen“.

Damit das Kontaktformular **zusätzlich** zur E-Mail an das ERP sendet, braucht `js/main.js`
eine kleine Ergänzung. Die wurde absichtlich **nicht** vorgenommen, weil an der Website nichts geändert
werden sollte. Sobald gewünscht, im Absende-Teil des Formulars nach dem erfolgreichen FormSubmit-Versand
ergänzen:

```js
fetch("https://<ihr-erp-server>/api/leads", { method: "POST", body: new FormData(form) }).catch(() => {});
```

Die E-Mail über FormSubmit bleibt dabei unverändert bestehen.

## Dateien

```
erp/index.html   Oberfläche
erp/erp.css      Gestaltung (Farben und Schriften wie die Website)
erp/app.js       gesamte Logik
erp/server.js    optionaler Server (Datenbank + Lead-Eingang)
```
