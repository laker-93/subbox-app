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

## They are drafts. Do not deploy them as they are.

Every unresolved fact is marked up as `.pending` (a highlighted inline span) or
`.pending-block` (a highlighted paragraph). They are styled loudly so that a page that
is not ready cannot be mistaken for one that is.

**The release gate: no `pending` class may remain in `src/renderer/public/legal/` when
these pages ship to production.** To check:

```sh
grep -rn 'class="pending' src/renderer/public/legal/ && echo "NOT READY"
```

### What has to be settled

Facts to fill in:

- Operator legal/trading name and geographic postal address (required in its own right
  under the e-Commerce Regulations, reg 6).
- Effective date for each of the three documents.
- ICO data protection fee registration number.
- DigitalOcean droplet region and Grafana Cloud region, then the international transfer
  mechanism that follows from them.
- Retention periods: account deletion, backup cycle, server logs, service metrics.
- Liability cap figure for business users.
- EU Article 27 representative (likely required, as the beta targets EU users).
- DMCA designated agent, registered at dmca.copyright.gov (the beta targets US users).

Mailboxes that must exist and be monitored before publishing: `abuse@sub-box.net`,
`privacy@sub-box.net`, `legal@sub-box.net`, `hello@sub-box.net`. An unmonitored abuse
address is worse than none — under reg 19 the clock for acting starts when the report
arrives, read or not.

Two engineering problems the drafting exposed, both flagged inline in the privacy
notice, both of which should be fixed rather than disclosed:

- **Account passwords are stored in a readable form.** `pymix`'s
  `db_controller.create_session` compares `user['password'] == password` against the
  stored column. The platform re-authenticates to each user's Navidrome on their behalf,
  which is why it is like this, but the privacy notice cannot claim passwords are hashed
  while they are not.
- **The app loads third-party analytics.** `src/renderer/index.html` injects
  `https://umami.jeffvli.org/script.js` — upstream Feishin's own Umami instance, with
  upstream's website ID. It is gated only on `localStorage['umami.disabled']`, so the
  `ANALYTICS_DISABLED` env var suppresses the *events* but not the script fetch, and the
  fetch alone discloses each user's IP and user-agent to a third party we have no
  processor agreement with.

## Editing them

Content changes require a client release, because the pages are baked into the image.
That is the trade-off accepted for keeping them in this repo; if legal text starts
changing more often than the app does, move them to their own static container behind
the same Traefik router.

Keep the plain-HTML style: no build step, no framework, no external assets. `legal.css`
is the only stylesheet and it is self-contained.
