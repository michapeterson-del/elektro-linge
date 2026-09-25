# Elektro Linge – Website

Statische Website für den Fachbetrieb für Elektroinstallationen **Elektro Linge**.
Kein Build-Schritt nötig – einfach `index.html` im Browser öffnen oder den Ordner auf einen beliebigen Webspace hochladen.

## Struktur

```
index.html        Startseite (Leistungen, Über uns, Ablauf, FAQ, Kontakt)
impressum.html    Impressum (Vorlage)
datenschutz.html  Datenschutzerklärung (Vorlage)
css/styles.css    Gestaltung (responsive)
js/main.js        Mobile Navigation, Animationen, Kontaktformular
assets/logo.svg   Logo
favicon.svg       Browser-Icon
```

## Vor dem Livegang anpassen

Alle Platzhalter stehen in eckigen Klammern `[...]` bzw. als `0000 / 000 000`:

- Telefonnummer (auch in den `tel:`-Links `+490000000000`)
- Adresse, Einzugsgebiet (FAQ), Öffnungszeiten
- E-Mail-Adresse (`info@elektro-linge.de`, auch in `js/main.js`)
- Impressum: Inhaber, USt-ID, Handwerkskammer, Handwerksrolle, Installateurverzeichnis, Versicherung
- Datenschutz: Hosting-Anbieter; rechtlich prüfen lassen

Das Kontaktformular öffnet derzeit das E-Mail-Programm des Besuchers (mailto). Für echten Formularversand
kann später ein Dienst wie Formspree oder ein PHP-Skript beim Hoster angebunden werden.

## Lokal ansehen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
