# The legal pages

Subbox is a hosted service holding user accounts and user-uploaded music. These pages
are the published surface that goes with that: the terms users are bound by, what we do
with their data, and the route by which someone reports unlawful content.

Tracking issue: laker-93/subbox-workspace#8.

## Where they live and how they are served

`src/renderer/public/legal/` → Vite's default `publicDir` (the renderer root is
`src/renderer`, so `public/` is picked up with no config) → copied verbatim into
`out/web/legal/` on `pnpm run build:web` → baked into the nginx image by the
`Dockerfile` → served at `https://www.sub-box.net/legal/…`.

They are **static HTML, not SPA routes**, on purpose:

- a rightsholder or a regulator must be able to read them without an account, and
  without JavaScript;
- the desktop (Electron) build has no origin of its own, so the app links out to the
  hosted copy rather than rendering its own;
- they stay crawlable.

`ng.conf.template` sets no `index` directive, so a bare `/legal/` may fall through
`try_files` to the SPA's `index.html`. **Always link the explicit filename**
(`/legal/index.html`, `/legal/terms.html`, …). `src/shared/constants/legal-links.ts`
does this; use it rather than hardcoding URLs.

Linked from the login screen (`features/shared/components/legal-footer-links.tsx`) and
Settings → About (`features/settings/components/about/legal-settings.tsx`).

## The release gate

Unresolved facts are marked up as `.pending` (a highlighted inline span) or
`.pending-block` (a highlighted paragraph), styled loudly so that a page which is not
ready cannot be mistaken for one that is.

**No `pending` class may remain in `src/renderer/public/legal/` when these pages ship to
production.** To check:

```sh
grep -rn 'class="pending' src/renderer/public/legal/ && echo "NOT READY"
```

**As of 2026-08-12 this gate is clean.** The `.pending` CSS is deliberately kept in
`legal.css` for the next round of drafting.

### What was settled, and what was consciously dropped

Settled on 2026-08-11, and now filled in on the pages:

- **Operator: Luke Purnell, 2 Digby Crescent, London N4 2HR, United Kingdom** — a sole
  trader, not an incorporated company. Published under the e-Commerce Regulations, reg 6,
  which wants a geographic address rather than a PO box.
- **Effective date: 11 August 2026** on all three documents.
- **DigitalOcean region: London (LON1)** — UK, so hosting itself is not a transfer.
- **Cloudflare, Inc. fronts the site** (nameservers `dawn`/`aaron.ns.cloudflare.com`,
  `server: cloudflare` on responses). It terminates TLS, so it processes every visitor's
  IP and request metadata — a named processor and a US transfer that applies from the
  first anonymous visitor, before any account exists.
- **Google LLC (Gmail)** receives email correspondence. Also a US transfer.
- **Server log and service-metric retention: 14 days** each.
- **Contact address: `luke.a.purnell@gmail.com`, everywhere.** The pages previously
  referenced four `@sub-box.net` mailboxes (`abuse`, `privacy`, `legal`, `hello`); none
  of them exist, so every one was replaced with the personal address rather than
  published as a route that bounces. If those mailboxes are ever created — Cloudflare
  Email Routing is free and the DNS is already there — swap them back, because a
  role address is what a rightsholder or regulator expects to write to.

Settled on 2026-08-12:

- **Grafana Cloud region: United Kingdom.** Derived from DNS, without touching the
  droplet: `kindtaco3368.grafana.net` CNAMEs to `hg-gateway-cf-prod-gb-south-1`, and
  `gb-south-1` is Grafana's UK region. Worth confirming once in the Grafana console.
- **Transfers (§5) rewritten around that.** Hosting and metrics are both UK, so the only
  outbound transfers are Cloudflare (traffic routing, IDTA/UK Addendum, which is part of
  Cloudflare's DPA) and Google (the mailbox). Much narrower than the draft assumed.
- **Liability cap: the greater of £100 or twelve months' fees.** A conventional
  formulation, not advice, and it applies to business users only.

### Dropped from the pages on 2026-08-12 — still owed

These were removed so the PR could merge, on the instruction not to block it
unnecessarily. **Removing the warning did not discharge the obligation.** Each one is
now tracked only here:

- **No qualified adviser has read these pages.** All three "draft pending review" blocks
  are gone. That was a deliberate call to ship rather than wait, not a review.
- **Account passwords are still stored in readable form** — `pymix`'s
  `db_controller.create_session` compares `user['password'] == password` against the
  stored column. The notice no longer flags this. It does not *claim* passwords are
  hashed, so nothing published is false, but the disclosure is now silent on a fact a
  regulator would expect to find. Fix the storage before the beta opens accounts.
- **No EU Article 27 representative is named.** If the Service is marketed to people in
  the EU, one is likely required and must be published in §1.
- **No DMCA designated agent is registered** at dmca.copyright.gov. DMCA notices now go
  to the general address, which is honest — but without a registered agent there is no
  section 512(c) safe harbour. This matters once users upload their own music; it does
  not matter for a demo serving only our own CC library.
- **The account-deletion window and backup cycle are stated as criteria, not periods.**
  §6 now says data is deleted on closure and backups "as those backups are rotated out",
  which is permitted by Article 13(2)(a) and avoids asserting a backup schedule that may
  not exist. Replace with real periods once they do.
- **The four `@sub-box.net` role mailboxes still do not exist.** Everything points at
  `luke.a.purnell@gmail.com`. Cloudflare Email Routing is free and the DNS is already
  there; a role address is what a rightsholder or regulator expects to write to.

### The ICO fee: no number on the page, but the fee is probably now owed

These are two separate things, and conflating them is the trap.

**The page.** The privacy notice originally claimed an ICO registration number. It no
longer does, and it should not — UK GDPR does not require one in a privacy notice.
Article 13 asks for the controller's identity and contact details, which are now filled
in. Nothing is blocked on this.

**The fee.** The [self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/)
returned "you don't need to pay a fee yet" on 2026-08-11, on the ground that *companies
that have not started trading* are exempt. **That answer was superseded the same day**,
when the operator was settled as a sole trader rather than a company. The exemption is
company-specific; a sole trader processing personal data — which includes server logs
carrying visitor IPs, with no sign-ups required — has no equivalent exemption. Expect
Tier 1: £40 by direct debit, £52 otherwise.

Registering is not a release gate for the pages, because no number needs to appear on
them. It is an operator obligation to discharge separately, and it should be done around
the time the demo is publicised, since that is when the log volume starts.

Unchanged either way: **none of this is an exemption from UK GDPR itself.** Lawful basis,
the rights in section 8, breach reporting and the retention periods still marked
`pending` apply in full, fee or no fee.

Mailboxes that must exist and be monitored before publishing: `abuse@sub-box.net`,
`privacy@sub-box.net`, `legal@sub-box.net`, `hello@sub-box.net`. An unmonitored abuse
address is worse than none — under reg 19 the clock for acting starts when the report
arrives, read or not.

Two engineering problems the drafting exposed, both of which should be fixed rather
than disclosed:

- **Account passwords are stored in a readable form.** `pymix`'s
  `db_controller.create_session` compares `user['password'] == password` against the
  stored column. The platform re-authenticates to each user's Navidrome on their behalf,
  which is why it is like this, but the privacy notice cannot claim passwords are hashed
  while they are not. Still open, and flagged inline in the notice.
- **The app loaded third-party analytics** — `src/renderer/index.html` injected upstream
  Feishin's own Umami instance, disclosing each user's IP and user-agent to a third
  party. **Fixed** (laker-93/subbox-app#99); the privacy notice now states plainly that
  there is no product analytics, which is only true while that stays fixed.

## Editing them

Content changes require a client release, because the pages are baked into the image.
That is the trade-off accepted for keeping them in this repo; if legal text starts
changing more often than the app does, move them to their own static container behind
the same Traefik router.

Keep the plain-HTML style: no build step, no framework, no external assets. `legal.css`
is the only stylesheet and it is self-contained.
