// Holt Sternebewertung und Rezensionen von Google (Places API, New) und speichert sie in
// data/google-bewertungen.json. Läuft täglich per GitHub Action (.github/workflows/google-bewertungen.yml).
// Benötigt den Secret GOOGLE_PLACES_KEY. Ohne Schlüssel wird nichts verändert.
import { writeFile, readFile } from "node:fs/promises";

const PLACE_ID = "ChIJnw0vNYxdICARYUA_l0e7p9s"; // Elektro Linge (Google-Unternehmensprofil)
const KEY = process.env.GOOGLE_PLACES_KEY;
const OUT = new URL("../data/google-bewertungen.json", import.meta.url);
const MIN_STARS = 4; // auf der Website nur Bewertungen ab 4 Sternen zeigen (Auswahl ist gekennzeichnet)

if (!KEY) {
  console.log("Kein GOOGLE_PLACES_KEY gesetzt – nichts zu tun.");
  process.exit(0);
}

const res = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}?languageCode=de`, {
  headers: {
    "X-Goog-Api-Key": KEY,
    "X-Goog-FieldMask": "rating,userRatingCount,reviews,googleMapsUri",
  },
});
if (!res.ok) {
  console.error(`Google antwortet mit ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const place = await res.json();

// Nachname abkürzen: "Max Mustermann" -> "Max M."
const shortName = (name = "") => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0] || "Google-Nutzer";
};

const data = {
  rating: place.rating ?? null,
  count: place.userRatingCount ?? 0,
  url: place.googleMapsUri ?? null,
  reviews: (place.reviews ?? [])
    .filter((r) => (r.rating ?? 0) >= MIN_STARS && (r.text?.text || r.originalText?.text))
    .map((r) => ({
      author: shortName(r.authorAttribution?.displayName),
      rating: r.rating,
      text: (r.text?.text || r.originalText?.text).trim(),
      date: r.publishTime ? r.publishTime.slice(0, 10) : null,
    })),
};

const json = JSON.stringify(data, null, 2) + "\n";
const old = await readFile(OUT, "utf8").catch(() => "");
// Nur Inhalt vergleichen, damit nicht jeden Tag ein leerer Commit entsteht
if (old === json) {
  console.log("Keine Änderung.");
} else {
  await writeFile(OUT, json);
  console.log(`Gespeichert: ${data.count} Bewertungen, Schnitt ${data.rating}, ${data.reviews.length} Texte.`);
}
