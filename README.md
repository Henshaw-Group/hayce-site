# Hayce Apps — Static Landing + Waitlist

A single, fast, accessible, mobile-first landing page to funnel visitors into two waitlists: **Hayce Hub** (Poster) and **Haycer** (Provider/Driver). Static, no server; deploy to GitHub Pages.

## Features
- Vanilla HTML/CSS/JS, dark mode, WCAG 2.1 AA contrast.
- Waitlist form with provider abstraction in `config.js`:
  - **Form endpoint** (Formspree/Getform) *or* **Firebase Firestore (Web SDK)**.
- Fields: name, email, phone (optional), city, role (Poster/Provider/Both), platform (iOS/Android), referral (optional), consent, and hidden honeypot.
- Client-side validation, success state + redirect to `thanks.html`.
- SEO: titles/meta, Open Graph + Twitter, favicons, JSON-LD (Organization + 2 apps).
- Lightweight analytics (Plausible or GA4) behind `CONFIG.enableAnalytics`.
- GitHub Actions workflow to deploy to Pages.

## Quick Start (Local Preview)
```bash
# Option A: Python
python3 -m http.server 5173

# Option B: Node (serve)
npx serve -l 5173 .

# Then open:
http://localhost:5173
