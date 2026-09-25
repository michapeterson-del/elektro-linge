// Kontaktanfragen gehen an diese Adresse (Versand über formsubmit.co).
// Beim allerersten Absenden schickt FormSubmit eine Bestätigungs-Mail an diese
// Adresse – den Link darin einmal anklicken, danach kommen alle Anfragen an.
const CONTACT_EMAIL = "info@elektro-linge.de";
const FORM_ENDPOINT = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

document.getElementById("year")?.replaceChildren(String(new Date().getFullYear()));

// ---------- Fotos: Ersatzfläche, falls ein Bild nicht lädt ----------
document.querySelectorAll(".photo img").forEach((img) => {
  const markMissing = () => {
    // Ersatzbild aus dem Projekt verwenden, falls angegeben
    if (img.dataset.fallback && img.getAttribute("src") !== img.dataset.fallback) {
      img.src = img.dataset.fallback;
      return;
    }
    img.closest(".photo").classList.add("missing");
  };
  if (img.complete && img.naturalWidth === 0) markMissing();
  img.addEventListener("error", markMissing);
});

// ---------- Header: Hintergrund beim Scrollen, beim Runterscrollen ausblenden ----------
const header = document.querySelector(".site-header");
const bar = document.querySelector(".progress span");
let lastY = window.scrollY;

function onScroll() {
  const y = window.scrollY;
  header.classList.toggle("scrolled", y > 40);
  header.classList.toggle("hidden", y > lastY && y > 400 && !nav.classList.contains("open"));
  lastY = y;

  const max = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;

  if (!reduceMotion) {
    document.querySelectorAll("[data-parallax]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * parseFloat(el.dataset.parallax);
      el.style.transform = `translate3d(0, ${-offset}px, 0)`;
    });
  }
}

// ---------- Mobile Navigation ----------
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("main-nav");
const setNav = (open) => {
  nav.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
  document.body.style.overflow = open ? "hidden" : "";
};
toggle?.addEventListener("click", () => setNav(!nav.classList.contains("open")));
nav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setNav(false)));

let ticking = false;
window.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { onScroll(); ticking = false; });
}, { passive: true });
onScroll();

// ---------- Überschriften wortweise aufbauen ----------
document.querySelectorAll(".split-title").forEach((title) => {
  let i = 0;
  const wrap = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.TEXT_NODE) return;
      const frag = document.createDocumentFragment();
      child.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(" "); return; }
        const w = document.createElement("span");
        w.className = "w";
        const inner = document.createElement("span");
        inner.textContent = part;
        inner.style.setProperty("--i", i++);
        w.append(inner);
        frag.append(w);
      });
      child.replaceWith(frag);
    });
  };
  wrap(title);
  title.setAttribute("aria-label", title.textContent.trim());
});

// ---------- Elemente beim Scrollen einblenden ----------
// .clip-reveal ist anfangs weggeclippt und zählt dann nicht als sichtbar – deshalb den Container beobachten
const inViewTargets = new Set([
  ...document.querySelectorAll(".split-title, .timeline"),
  ...[...document.querySelectorAll(".clip-reveal")].map((el) => el.parentElement),
]);
const reveal = (el) => {
  el.classList.add("in");
  el.querySelectorAll(":scope > .clip-reveal").forEach((c) => c.classList.add("in"));
};
if ("IntersectionObserver" in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); }
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
  inViewTargets.forEach((el) => io.observe(el));
} else {
  inViewTargets.forEach(reveal);
}

// ---------- Leistungen: Foto klappt rechts neben der Zeile auf ----------
if (finePointer) {
  document.querySelector(".service-list")?.classList.add("thumbs");
  document.querySelectorAll(".service[data-img]").forEach((row) => {
    const thumb = document.createElement("div");
    thumb.className = "service-thumb";
    thumb.setAttribute("aria-hidden", "true");
    row.append(thumb);
    // Bild erst beim ersten Hover laden
    row.addEventListener("mouseenter", () => {
      if (thumb.firstChild) return;
      const img = new Image();
      img.alt = "";
      img.onerror = () => thumb.remove();
      img.src = row.dataset.img;
      thumb.append(img);
    }, { once: true });
  });
}

// ---------- Kontaktformular ----------
const form = document.getElementById("contact-form");
if (form) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector("button[type=submit]");
  const setStatus = (text, type) => { status.textContent = text; status.className = `form-status ${type}`; };

  const mailtoFallback = (data) => {
    const body = `Name: ${data.name}\nE-Mail: ${data.email}\nTelefon: ${data.phone || "-"}\nAnliegen: ${data.topic}\n\n${data.message}`;
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Anfrage: ${data.topic}`)}&body=${encodeURIComponent(body)}`;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    let valid = true;
    form.querySelectorAll("[required]").forEach((field) => {
      const ok = field.type === "checkbox" ? field.checked : field.checkValidity() && field.value.trim() !== "";
      (field.type === "checkbox" ? field.closest(".checkbox") : field).classList.toggle("invalid", !ok);
      if (!ok) valid = false;
    });
    if (!valid) { setStatus("Bitte die markierten Felder ausfüllen.", "err"); return; }

    const data = Object.fromEntries(new FormData(form));
    if (data._honey) return; // Spam-Bot

    const showError = (text) => {
      status.className = "form-status err";
      status.replaceChildren(`${text} `);
      const a = document.createElement("a");
      a.href = mailtoFallback(data);
      a.textContent = "Anfrage stattdessen per E-Mail senden";
      a.style.color = "inherit";
      status.append(a);
    };

    // FormSubmit funktioniert nur, wenn die Seite über einen Webserver aufgerufen wird
    if (location.protocol === "file:") {
      showError("Das Formular funktioniert erst, wenn die Website online ist (nicht als lokal geöffnete Datei).");
      return;
    }

    button.disabled = true;
    setStatus("Wird gesendet …", "");

    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Name: data.name,
          "E-Mail": data.email,
          Telefon: data.phone || "-",
          Anliegen: data.topic,
          Nachricht: data.message,
          _replyto: data.email,
          _subject: `Neue Anfrage über die Website: ${data.topic} – ${data.name}`,
          _template: "table",
          _captcha: "false",
        }),
      });
      const json = await res.json().catch(() => ({}));
      const msg = String(json.message || "");

      if (res.ok && String(json.success) === "true") {
        form.reset();
        setStatus("Danke! Ihre Anfrage ist angekommen – wir melden uns schnellstmöglich.", "ok");
      } else if (/activat/i.test(msg)) {
        // Erstes Absenden: FormSubmit hat eine Aktivierungs-Mail an CONTACT_EMAIL geschickt
        setStatus(`Fast geschafft: Das Formular muss einmalig aktiviert werden. Bitte im Postfach von ${CONTACT_EMAIL} auf „Activate Form“ klicken und dann erneut senden.`, "err");
      } else if (/web server|HTML files/i.test(msg)) {
        showError("Das Formular funktioniert erst, wenn die Website online ist (nicht als lokal geöffnete Datei).");
      } else {
        console.warn("Formularversand fehlgeschlagen:", res.status, msg);
        showError(`Das hat leider nicht geklappt${msg ? ` (${msg})` : ""}.`);
      }
    } catch (err) {
      console.warn("Formularversand fehlgeschlagen:", err);
      showError("Das hat leider nicht geklappt – keine Verbindung zum Mail-Dienst.");
    } finally {
      button.disabled = false;
    }
  });

  form.querySelectorAll("input, textarea").forEach((field) =>
    field.addEventListener("input", () => {
      field.classList.remove("invalid");
      field.closest(".checkbox")?.classList.remove("invalid");
    })
  );
}
