const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('.primary-navigation');
const dropdownTrigger = document.querySelector('.dropdown-trigger');
const dropdownMenu = document.querySelector('#services-menu');
const siteHeader = document.querySelector('.site-header');

function updateHeaderOnScroll() {
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 40);
}

window.addEventListener('scroll', updateHeaderOnScroll, { passive: true });
updateHeaderOnScroll();

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const revealTargets = document.querySelectorAll(
  '.intro-band > *, .section-heading, .service-item, .service-category, .why-grid article, .process-layout > *, .process-step, .feature-image, .feature-copy, .gallery-heading, .gallery-item, .sourcing-band > *, .advice-band > *, .vehicle-search-image, .vehicle-search-copy, .garage-guide, .client-feedback > *, .home-faq-heading, .home-faq-list details, .contact-band > *',
);

if (!prefersReducedMotion.matches && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });

  revealTargets.forEach((element, index) => {
    element.classList.add('reveal-on-scroll');
    element.style.setProperty('--reveal-delay', `${(index % 4) * 65}ms`);
    revealObserver.observe(element);
  });
} else {
  revealTargets.forEach((element) => element.classList.add('is-revealed'));
}

function closeDropdown() {
  dropdownTrigger.setAttribute('aria-expanded', 'false');
  dropdownMenu.hidden = true;
}

function closeNavigation() {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  primaryNavigation.classList.remove('is-open');
  closeDropdown();
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  primaryNavigation.classList.toggle('is-open', !isOpen);
});

dropdownTrigger.addEventListener('click', () => {
  const isOpen = dropdownTrigger.getAttribute('aria-expanded') === 'true';
  dropdownTrigger.setAttribute('aria-expanded', String(!isOpen));
  dropdownMenu.hidden = isOpen;
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-dropdown')) closeDropdown();
  if (!event.target.closest('.site-header')) closeNavigation();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNavigation();
    menuToggle.focus();
  }
});

primaryNavigation.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeNavigation);
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 800) closeNavigation();
});

document.querySelector('#year').textContent = new Date().getFullYear();
