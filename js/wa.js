// WhatsApp-Chatfenster: Ein Klick auf den grünen Button öffnet zuerst ein kleines
// Begrüßungsfenster, von dort geht es zu WhatsApp. Ohne JavaScript führt der
// Button direkt zu WhatsApp.
(function () {
  const btn = document.querySelector(".wa-float");
  if (!btn) return;

  const waUrl = btn.getAttribute("href");
  const SEEN_KEY = "wa-seen";

  const panel = document.createElement("div");
  panel.className = "wa-panel";
  panel.id = "wa-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "WhatsApp-Chat mit Elektro Linge");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="wa-head">
      <img src="/apple-touch-icon.png" alt="" width="44" height="44">
      <div>
        <strong>Elektro Linge</strong>
        <span>Ihr Elektriker aus Marienheide</span>
      </div>
      <button type="button" class="wa-close" aria-label="Chatfenster schließen">&times;</button>
    </div>
    <div class="wa-body">
      <div class="wa-bubble">
        Hallo!<br><br>
        Hier ist Elektro Linge, Ihr Elektrofachbetrieb aus Marienheide.<br><br>
        <strong>Wobei können wir Ihnen helfen?</strong>
      </div>
    </div>
    <a class="wa-start" href="${waUrl}" target="_blank" rel="noopener">Chat auf WhatsApp starten</a>
    <p class="wa-note">Wir antworten so schnell wie möglich – meist noch am selben Tag.</p>
  `;
  document.body.append(panel);

  const setOpen = (open) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      btn.classList.remove("wa-unread");
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
    }
  };

  btn.setAttribute("aria-controls", "wa-panel");
  btn.setAttribute("aria-expanded", "false");
  try { if (!sessionStorage.getItem(SEEN_KEY)) btn.classList.add("wa-unread"); } catch (e) { btn.classList.add("wa-unread"); }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    setOpen(panel.hidden);
  });
  panel.querySelector(".wa-close").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
})();
