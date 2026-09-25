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
assets/logo.svg   Logo
favicon.svg       Browser-Icon
```

## Kontaktformular → E-Mail

Anfragen aus dem Formular werden über [FormSubmit](https://formsubmit.co) an
**samuel.foth@elektro-linge.de** geschickt (Adresse steht oben in `js/main.js`).

**Wichtig:** Beim allerersten Absenden schickt FormSubmit eine Bestätigungs-Mail an diese Adresse.
Den Link darin einmal anklicken – ab dann kommt jede Anfrage als E-Mail an. Mit „Antworten“
antwortet man direkt dem Kunden. Klappt der Versand nicht, bietet die Seite automatisch an,
die Anfrage per E-Mail-Programm zu senden.

## Fotos

Die Fotos kommen im Moment von Unsplash (freie Lizenz) und werden per Link geladen.
Lädt ein Bild nicht, erscheint eine gestreifte Ersatzfläche. **Besser: eigene Fotos** (Baustelle,
Team, Auto, Zählerschrank) nach `assets/img/` legen und die `src`- bzw. `data-img`-Adressen in
`index.html` ersetzen. Das wirkt echter und spart den Unsplash-Absatz in der Datenschutzerklärung.

## Vor dem Livegang anpassen

Platzhalter stehen in eckigen Klammern `[...]` bzw. als `0000 / 000 000`:

- Telefonnummer (auch in den `tel:`-Links `+490000000000`)
- Ort / Einzugsgebiet, Adresse
- Impressum: Inhaber, USt-ID, Handwerkskammer, Handwerksrolle, Installateurverzeichnis, Versicherung
- Datenschutz: Hosting-Anbieter; rechtlich prüfen lassen

## Lokal ansehen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
