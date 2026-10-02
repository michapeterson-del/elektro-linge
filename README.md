# Elektro Linge – Website

Statische Website für den Fachbetrieb für Elektroinstallationen **Elektro Linge**.
Kein Build-Schritt nötig – einfach `index.html` im Browser öffnen oder den Ordner auf einen beliebigen Webspace hochladen.

## Struktur

```
index.html        Startseite (Leistungen, Über uns, Ablauf, FAQ, Kontakt)
impressum.html    Impressum (Vorlage)
datenschutz.html  Datenschutzerklärung (Vorlage)
css/styles.css    Gestaltung (responsive)
js/main.js        Animationen, Navigation, Kontaktformular (Versand)
assets/logo-mark-white.png / logo-mark-navy.png   Logo-Zeichen (Lingese mit Blitz)
favicon.png, apple-touch-icon.png                 Browser-/Handy-Icon
```

## Kontaktformular → E-Mail

Anfragen aus dem Formular werden über [FormSubmit](https://formsubmit.co) an
**info@elektrolinge.de** geschickt (Adresse steht oben in `js/main.js`).

**Wichtig:** Beim allerersten Absenden schickt FormSubmit eine Bestätigungs-Mail an diese Adresse.
Den Link darin einmal anklicken – ab dann kommt jede Anfrage als E-Mail an. Mit „Antworten“
antwortet man direkt dem Kunden. Klappt der Versand nicht, bietet die Seite automatisch an,
die Anfrage per E-Mail-Programm zu senden.

## Fotos

Eigene/heruntergeladene Fotos liegen in `assets/img/` (Elektroinstallation, Altbausanierung, Wallbox, Smart Home, Beleuchtung – von Pexels, freie Lizenz).

Die Fotos kommen im Moment von Unsplash und Pexels (freie Lizenzen) und werden per Link geladen.
Lädt ein Bild nicht, erscheint eine gestreifte Ersatzfläche. **Besser: eigene Fotos** (Baustelle,
Team, Auto, Zählerschrank) nach `assets/img/` legen und die `src`- bzw. `data-img`-Adressen in
`index.html` ersetzen. Das wirkt echter und spart den Unsplash-Absatz in der Datenschutzerklärung.

## Vor dem Livegang anpassen

Platzhalter stehen in eckigen Klammern `[...]` bzw. als `0000 / 000 000`:

- Telefonnummer (auch in den `tel:`-Links `+490000000000`)
- Straße und Hausnummer
- Impressum: Inhaber, USt-ID, Handwerkskammer, Handwerksrolle, Installateurverzeichnis, Versicherung
- Datenschutz: Hosting-Anbieter; rechtlich prüfen lassen

## Beiträge (Blog)

Beiträge liegen unter `beitraege/<name>/index.html` und sind unter `elektrolinge.de/beitraege/<name>/` erreichbar.

Neuen Beitrag anlegen:
1. Einen vorhandenen Beitragsordner kopieren (z. B. `beitraege/wallbox-anmelden/`) und umbenennen – nur Kleinbuchstaben und Bindestriche.
2. In der neuen `index.html` Titel, Beschreibung (`description`, `og:…`), Datum, Text und den Block `application/ld+json` anpassen.
3. Den Beitrag in `beitraege/index.html` in die Liste eintragen.
4. Die Adresse in `sitemap.xml` ergänzen.

## SEO

- `sitemap.xml` und `robots.txt` im Hauptordner – Sitemap in der Google Search Console einreichen.
- Firmendaten für Google (schema.org „Electrician“) stehen im `<head>` der Startseite. Die Telefonnummer dort ergänzen (`"telephone": "+49 …"`), sobald es sie gibt.
- Vorschaubild für WhatsApp/Facebook: `assets/og-bild.jpg` (1200 × 630).

## Lokal ansehen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
