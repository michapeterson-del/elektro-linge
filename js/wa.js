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
      <div class="wa-time"></div>
      <div class="wa-typing" aria-hidden="true"><span></span><span></span><span></span></div>
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

  const typing = panel.querySelector(".wa-typing");
  const bubble = panel.querySelector(".wa-bubble");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let greeted = false;

  // Beim ersten Öffnen: Uhrzeit, kurz "tippt …", dann erscheint die Nachricht
  const greet = () => {
    const now = new Date();
    panel.querySelector(".wa-time").textContent =
      now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
    if (greeted || reduceMotion) { typing.hidden = true; bubble.classList.add("show"); greeted = true; return; }
    greeted = true;
    typing.hidden = false;
    bubble.classList.remove("show");
    setTimeout(() => { typing.hidden = true; bubble.classList.add("show"); }, 1600);
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) greet();
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
