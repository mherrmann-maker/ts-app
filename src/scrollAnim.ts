import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { moveCameraTo } from './world'

gsap.registerPlugin(ScrollTrigger)

export function initScroll(): void {
  // ── Global camera driver ─────────────────────────────────────────────────
  ScrollTrigger.create({
    trigger: '#content',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      moveCameraTo(self.progress)
      // scroll-fill indicator
      const fill = document.getElementById('scroll-fill')
      if (fill) fill.style.height = `${self.progress * 100}%`
    },
  })

  // ── HERO: fade out on scroll ─────────────────────────────────────────────
  gsap.to('.hero-text', {
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      end: '+=80%',
      scrub: 1.2,
    },
    opacity: 0,
    y: -80,
    ease: 'none',
  })

  gsap.to('.scroll-hint', {
    scrollTrigger: {
      trigger: '#hero',
      start: 'top top',
      end: '+=30%',
      scrub: 1,
    },
    opacity: 0,
    ease: 'none',
  })

  // ── WORKS: header reveal ─────────────────────────────────────────────────
  gsap.from('.works-header', {
    scrollTrigger: {
      trigger: '#works',
      start: 'top 80%',
      end: 'top 35%',
      scrub: 1.2,
    },
    opacity: 0,
    y: 70,
    ease: 'none',
  })

  // Cards stagger
  gsap.from('.work-card', {
    scrollTrigger: {
      trigger: '.works-grid',
      start: 'top 80%',
      end: 'top 20%',
      scrub: 1.4,
    },
    opacity: 0,
    y: 50,
    stagger: 0.12,
    ease: 'none',
  })

  // ── ABOUT ────────────────────────────────────────────────────────────────
  const aboutTl = gsap.timeline({
    scrollTrigger: {
      trigger: '#about',
      start: 'top 75%',
      end: 'top 20%',
      scrub: 1.4,
    },
  })
  aboutTl
    .from('.about-label',  { opacity: 0, y: 28, ease: 'none' }, 0)
    .from('.about-title',  { opacity: 0, y: 60, ease: 'none' }, 0.05)
    .from('.about-body',   { opacity: 0, y: 36, ease: 'none' }, 0.15)
    .from('.stat',         { opacity: 0, y: 24, stagger: 0.08, ease: 'none' }, 0.25)

  // ── CONTACT ──────────────────────────────────────────────────────────────
  const contactTl = gsap.timeline({
    scrollTrigger: {
      trigger: '#contact',
      start: 'top 75%',
      end: 'top 20%',
      scrub: 1.4,
    },
  })
  contactTl
    .from('.contact-label', { opacity: 0, y: 28, ease: 'none' }, 0)
    .from('.contact-title', { opacity: 0, y: 70, ease: 'none' }, 0.05)
    .from('.contact-cta',   { opacity: 0, y: 36, ease: 'none' }, 0.2)
}
