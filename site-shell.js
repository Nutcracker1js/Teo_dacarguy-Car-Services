(() => {
  const isPage = document.body.classList.contains("subpage") || document.body.classList.contains("consultation-body");
  const preloader = document.createElement("div");
  preloader.className = "site-preloader";
  preloader.setAttribute("role", "status");
  preloader.setAttribute("aria-label", "Loading page");
  preloader.innerHTML = `<svg class="preloader-tire" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="#171717"/><circle cx="24" cy="24" r="15" fill="none" stroke="#444" stroke-width="2" stroke-dasharray="3 3"/><circle cx="24" cy="24" r="10" fill="#f5f4f0"/><circle cx="24" cy="24" r="5" fill="#e0080a"/><path d="M24 14v5m0 10v5M14 24h5m10 0h5M17 17l4 4m6 6 4 4m0-14-4 4m-6 6-4 4" stroke="#171717" stroke-width="2" stroke-linecap="round"/></svg>`;
  document.body.append(preloader);

  const preloaderStartedAt = performance.now();
  let preloaderClosing = false;
  function closePreloader() {
    if (preloaderClosing) return;
    preloaderClosing = true;
    const minimumDisplay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 520;
    const remaining = Math.max(0, minimumDisplay - (performance.now() - preloaderStartedAt));
    window.setTimeout(() => {
      preloader.classList.add("is-hidden");
      window.setTimeout(() => preloader.remove(), 500);
    }, remaining);
  }

  if (document.readyState !== "loading") closePreloader();
  else document.addEventListener("DOMContentLoaded", closePreloader, { once: true });
  window.setTimeout(closePreloader, 5000);

  const header = `
    <div class="topline">
      <div class="topline-actions">
        <span class="topline-label">FOLLOW OUR SOCIALS:</span>
        <nav class="social-links" aria-label="Social media">
          <a class="social-link" href="https://www.tiktok.com/@teo_dacarguy?_r=1&_t=ZS-9ADc2bzvKK5" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 8.2a7.1 7.1 0 0 1-4.3-1.5v7.1a6.1 6.1 0 1 1-5.3-6v3.4a2.8 2.8 0 1 0 2 2.7V2.8h3.3c.3 2 1.8 3.6 4.3 4z"/></svg></a>
          <a class="social-link" href="https://www.instagram.com/teo_dacarguy?stkn=MTFrczJ4OXd1eGhw&amp;utm_source=qr" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle class="social-dot" cx="17.7" cy="6.7" r="1"/></svg></a>
          <a class="social-link" href="https://snapchat.com/t/wefpPA4h" target="_blank" rel="noopener noreferrer" aria-label="Snapchat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c-3 0-4.6 2.3-4.6 5.2 0 .8.1 1.6.2 2.4-.7.5-1.6.7-2.4.6-.6-.1-1 .3-.7.8.4.7 1.1 1.1 2.2 1.3.4.1.4.6.1.9-.6.7-1.4 1.2-2.5 1.6-.5.2-.4.8.1 1 .8.3 1.8.3 2.4.8.4.3.3.8.6 1.2.5-.2 1-.4 1.5-.3.9.1 1.8 1.1 3.1 1.1s2.2-1 3.1-1.1c.5-.1 1 .1 1.5.3.3-.4.2-.9.6-1.2.6-.5 1.6-.5 2.4-.8.5-.2.6-.8.1-1-1.1-.4-1.9-.9-2.5-1.6-.3-.3-.3-.8.1-.9 1.1-.2 1.8-.6 2.2-1.3.3-.5-.1-.9-.7-.8-.8.1-1.7-.1-2.4-.6.1-.8.2-1.6.2-2.4 0-2.9-1.6-5.2-4.6-5.2z"/></svg></a>
          <a class="social-link" href="https://wa.link/sdnpdi" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><svg class="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 11.8a8.2 8.2 0 0 1-12.1 7.1L4 20l1.2-3.9a8.2 8.2 0 1 1 15-4.3z"/><path class="whatsapp-phone" d="M8.5 7.4c-.3-.4-.7-.4-1-.1l-.9.9c-.4.5-.4 1.3-.1 2 1.1 2.5 3.2 4.6 5.7 5.7.7.3 1.5.3 2-.1l.9-.9c.3-.3.3-.8-.1-1.1l-1.7-1.2c-.3-.2-.7-.2-1 .1l-.5.6c-1-.4-2-1.4-2.4-2.4l.6-.5c.3-.3.3-.7.1-1z"/></svg></a>
        </nav>
      </div>
    </div>
    <header class="site-header${isPage ? " is-page" : ""}">
      <a class="brand" href="index.html#home" aria-label="Teo_dacarguy Car Services home"><img class="brand-logo" src="images/logo-trimmed.png" alt="" width="200" height="78"></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Open navigation"><span></span><span></span></button>
      <nav class="primary-navigation" id="primary-navigation" aria-label="Main navigation">
          <a class="nav-link current" href="${isPage ? "index.html#home" : "#home"}">Home</a>
        <div class="nav-dropdown">
          <button
            class="nav-link dropdown-trigger"
            type="button"
            aria-expanded="false"
            aria-controls="services-menu"
          >
            Services <span class="chevron" aria-hidden="true"></span>
          </button>
          <div class="dropdown-menu" id="services-menu" hidden>
            <a href="services.html#maintenance"
              >Repairs & maintenance <span>01</span></a
            >
            <a href="services.html#parts">Parts sourcing <span>02</span></a>
            <a href="services.html#sales">Car sourcing <span>03</span></a>
            <a href="services.html#imports"
              >Import coordination <span>04</span></a
            >
          </div>
        </div>
        <a class="nav-link" href="projects.html">Our Gallery</a>
        <a class="nav-link" href="about.html">About Us</a>
        <a class="nav-link" href="contact.html">Contact</a>
        <a class="nav-link" href="faq.html">FAQs</a>
        <a class="button button-nav" href="booking.html"
          >Book a service <span aria-hidden="true">↗</span></a
        >
      </nav>
    </header>`;

  const previewNote = document.body.classList.contains("consultation-body")
    ? "<span>Customer details stay on this device in preview mode.</span>"
    : "";
  const footer = `
    <footer class="site-footer">
      <div class="footer-main">
        <a class="brand brand-footer" href="index.html#home" aria-label="Teo_dacarguy Car Services, back to top"><img class="brand-logo" src="images/logo-trimmed.png" alt="" width="200" height="78"></a>
        <p class="footer-note">We help coordinate repairs, maintenance, parts and vehicle sourcing through one clear point of contact.</p>
        <div class="footer-column"><h2>FIND US</h2><address><a href="https://maps.app.goo.gl/misNQjmHhxAYyMr57?g_st=is" target="_blank" rel="noopener noreferrer">Off 5 Junction, 38 Oro Street<br>Benin City 300282, Edo ↗</a></address></div>
        <div class="footer-column"><h2>SHOP HOURS</h2><p>Mon–Saturday, 8am–7pm<br>Sunday, 12pm–5pm</p></div>
        <div class="footer-column"><h2>ON THE MENU</h2><a href="services.html">Services</a><a href="index.html#process">How it works</a><a href="projects.html">Our work</a><a href="about.html">About us</a><a href="cars.html">Available cars</a><a href="faq.html">FAQs</a><a href="booking.html">Book a Service</a><a href="consultation.html">Make an Enquiry</a><a href="contact.html">Get in touch</a></div>
        <div class="footer-column"><h2>CONTACT</h2><a href="https://wa.link/sdnpdi" target="_blank" rel="noopener noreferrer">WhatsApp Us ↗</a><a href="contact.html">Contact page</a><a href="consultation.html">Make an Enquiry</a></div>
      </div>
      <div class="footer-bottom"><span>© <span id="year"></span> Teo_dacarguy Car Services.</span><div><a href="index.html#home">Back to top ↑</a>${previewNote}</div></div>
    </footer>`;

  const oldTopline = document.querySelector(".topline");
  const oldHeader = document.querySelector(".site-header, .subpage-header, .consultation-header");
  oldTopline?.remove();
  if (oldHeader) {
    oldHeader.insertAdjacentHTML("beforebegin", header);
    oldHeader.remove();
  } else {
    document.body.insertAdjacentHTML("afterbegin", header);
  }

  const currentPage = decodeURIComponent((window.location.pathname || "").split("/").pop() || "index.html");
  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach((link) => {
    if (link.classList.contains("dropdown-trigger")) {
      link.classList.toggle("current", currentPage === "services.html");
      return;
    }
    const href = (link.getAttribute("href") || "").split("#")[0] || "";
    const normalized = href === "" ? "index.html" : (href.split("/").pop() || "index.html");
    link.classList.toggle("current", normalized === currentPage);
  });

  const oldFooter = document.querySelector(".site-footer, .subpage-footer, .consultation-footer");
  if (oldFooter) {
    oldFooter.insertAdjacentHTML("beforebegin", footer);
    oldFooter.remove();
  } else {
    document.body.insertAdjacentHTML("beforeend", footer);
  }
})();
