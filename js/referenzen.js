// Referenzen: Bild per Klick groß anzeigen (natives <dialog>, Esc und Klick daneben schließen)
(function () {
  const box = document.querySelector(".ref-box");
  if (!box || typeof box.showModal !== "function") return;
  const img = box.querySelector("img");
  const caption = box.querySelector(".ref-caption");

  document.querySelectorAll(".ref-open").forEach((btn) =>
    btn.addEventListener("click", () => {
      const thumb = btn.querySelector("img");
      img.src = btn.dataset.full;
      img.width = btn.dataset.w;
      img.height = btn.dataset.h;
      img.alt = thumb.alt;
      caption.textContent = thumb.alt;
      box.showModal();
    })
  );
  box.querySelector(".ref-close").addEventListener("click", () => box.close());
  box.addEventListener("click", (e) => { if (e.target === box) box.close(); });
})();
