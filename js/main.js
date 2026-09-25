// Empfängeradresse für Kontaktanfragen
const CONTACT_EMAIL = "info@elektro-linge.de";

// Jahr im Footer
document.getElementById("year")?.replaceChildren(String(new Date().getFullYear()));

// Mobile Navigation
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("main-nav");

if (toggle && nav) {
  const setOpen = (open) => {
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
  };
  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
}

// Einblend-Animation beim Scrollen
const revealTargets = document.querySelectorAll(".card, .features li, .steps li, details, .contact-form");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealTargets.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
}

// Kontaktformular: Validierung + Versand über das E-Mail-Programm (mailto)
const form = document.getElementById("contact-form");
if (form) {
  const status = form.querySelector(".form-status");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let valid = true;

    form.querySelectorAll("[required]").forEach((field) => {
      const ok = field.type === "checkbox" ? field.checked : field.checkValidity() && field.value.trim() !== "";
      field.classList.toggle("invalid", !ok);
      if (!ok) valid = false;
    });

    if (!valid) {
      status.textContent = "Bitte füllen Sie alle Pflichtfelder (*) korrekt aus.";
      status.className = "form-status err";
      return;
    }

    const data = new FormData(form);
    const subject = `Anfrage: ${data.get("topic")} – ${data.get("name")}`;
    const body = [
      `Name: ${data.get("name")}`,
      `E-Mail: ${data.get("email")}`,
      `Telefon: ${data.get("phone") || "-"}`,
      `Anliegen: ${data.get("topic")}`,
      "",
      data.get("message"),
    ].join("\n");

    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = "Vielen Dank! Ihr E-Mail-Programm wird geöffnet, um die Anfrage zu senden.";
    status.className = "form-status ok";
  });

  form.querySelectorAll("input, textarea").forEach((field) =>
    field.addEventListener("input", () => field.classList.remove("invalid"))
  );
}
