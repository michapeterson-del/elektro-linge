// Zeigt die echten Google-Bewertungen aus data/google-bewertungen.json an
// (wird täglich per GitHub Action von Google geholt). Ohne Bewertungen bleibt alles ausgeblendet.
(function () {
  const badge = document.querySelector(".g-badge");
  const box = document.querySelector(".g-reviews");
  if (!badge && !box) return;

  const stars = (n) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
  const fmtDate = (d) => new Date(d).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const rating = (r) => r.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  fetch("/data/google-bewertungen.json", { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !data.count || !data.rating) return;
      const url = data.url || "https://www.google.com/search?q=Elektro+Linge+Marienheide";
      const label = `${data.count} Google-Bewertung${data.count === 1 ? "" : "en"}`;

      if (badge) {
        badge.href = url;
        badge.querySelector(".g-stars").textContent = stars(data.rating);
        badge.querySelector(".g-score").textContent = rating(data.rating);
        badge.querySelector(".g-count").textContent = label;
        badge.setAttribute("aria-label", `${rating(data.rating)} von 5 Sternen, ${label} – auf Google ansehen`);
        badge.hidden = false;
      }

      if (box && data.reviews && data.reviews.length) {
        const list = box.querySelector(".g-list");
        data.reviews.slice(0, 3).forEach((r) => {
          const li = document.createElement("li");
          li.innerHTML = '<div class="g-stars" aria-hidden="true"></div><blockquote></blockquote><p class="g-meta"></p>';
          li.querySelector(".g-stars").textContent = stars(r.rating);
          li.querySelector("blockquote").textContent = r.text.length > 320 ? r.text.slice(0, 300).trim() + " …" : r.text;
          li.querySelector(".g-meta").textContent = r.date ? `${r.author} · ${fmtDate(r.date)}` : r.author;
          li.setAttribute("aria-label", `${r.rating} von 5 Sternen`);
          list.append(li);
        });
        box.querySelector(".g-all").href = url;
        box.querySelector(".g-summary").textContent = `${rating(data.rating)} von 5 Sternen · ${label}`;
        box.hidden = false;
      }
    })
    .catch(() => {});
})();
