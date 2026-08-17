import path from 'path';
import { _electron as electron } from 'playwright';

import { forceFreshLogin, isLoggedOut, resolveAppEntry, ROOT } from '../ui-snapshot-shared.mjs';

// QA driver: closes out the pause-era "Invite funnel" README row
// (`features/invite/`: RequestInviteModal, DemoBanner, InviteLockedPanel,
// useRequestInvite, invite-request-store).
//
// Only the two entry points reachable WITHOUT a demo session are driven here —
// the landing page's own "Request an invite" link (source=landing) and the
// "Request an invite" link inside the Create Account form (source=createAccount,
// the one that has to stack above the auth modal it's opened from). DemoBanner
// (source=demoBanner) and InviteLockedPanel (source=blockedAction, on Sync ->
// Upload/Watch) both gate on useIsDemoSession — there is no demo login on the
// local dev stack, so those are out of scope here (same caveat the README's
// separate "Demo session restrictions" row already carries).
//
// Writes 2 real rows to pymix's invite_request_table (unauthenticated endpoint,
// scratch emails) — clean these up after via psql, same convention pymix-qa
// uses for its own scratch DB rows.
//
// Requires a development-mode Electron build (out/main/index.js). Usage:
//   node scripts/qa/invite-funnel-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');
const STAMP = Date.now();

const log = (...a) => console.log('[invite-funnel]', ...a);

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('networkidle');
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    // Land on the logged-out landing page regardless of any persisted session.
    if (!(await isLoggedOut(page))) {
        await forceFreshLogin(page);
        await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(500);

    // ---------------------------------------------------------------
    // 1. Landing page footer -> "Request an invite" (source: landing)
    // ---------------------------------------------------------------
    await page.getByRole('button', { name: /request an invite/i }).click();
    // A stable locator across this modal's whole lifecycle (form -> error -> success) —
    // only one dialog is open during this section, so the generic role suffices; a
    // hasText filter keyed on the intro copy would stop matching once that copy is
    // replaced by an error or the success screen.
    const modal = page.getByRole('dialog');
    await modal.getByRole('heading', { name: /request an invite/i }).waitFor({ timeout: 5000 });
    const introLanding = await modal.getByText(/send your invite/i).textContent();
    log('landing intro text:', JSON.stringify(introLanding));
    await page.screenshot({ path: path.join(SNAP, `qa-invite-landing-open-${STAMP}.png`) });

    // Backend-invalid-but-HTML5-valid email ("a@b" has no dot/TLD, passes the
    // <input type=email> native check but fails pydantic's EmailStr) -> a real 400
    // from pymix, mapped to the inline field error (see pymix-controller.ts
    // requestInvite: only status 400 -> reason 'invalid').
    await modal.getByLabel(/email/i).fill('a@b');
    await modal.getByRole('button', { name: /^request an invite$/i }).click();
    const inlineError = await modal
        .getByText(/doesn't look like a valid email/i)
        .waitFor({ timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    log('server-rejected email (a@b) shows inline field error?', inlineError);
    await page.screenshot({
        path: path.join(SNAP, `qa-invite-landing-invalid-email-${STAMP}.png`),
    });

    // Valid email, dj_software=other with free text -> success screen.
    const landingEmail = `qa-invite-landing-${STAMP}@example.com`;
    await modal.getByLabel(/email/i).fill(landingEmail);
    await modal.getByLabel(/what do you dj on/i).click();
    await page.getByRole('option', { name: /something else/i }).click();
    await modal.getByLabel(/which one/i).fill('Traktor');
    await modal.getByRole('button', { name: /^request an invite$/i }).click();
    await modal.getByText(/you're on the list/i).waitFor({ timeout: 8000 });
    const successEchoesEmail = await modal
        .getByText(landingEmail)
        .isVisible()
        .catch(() => false);
    log(
        'landing submit (dj_software=other) -> success screen shown, echoes email?',
        successEchoesEmail,
    );
    await page.screenshot({ path: path.join(SNAP, `qa-invite-landing-success-${STAMP}.png`) });
    await modal.getByRole('button', { name: /^close$/i }).click();
    await page.waitForTimeout(500);

    // ---------------------------------------------------------------
    // 2. Landing page -> "Create account" -> the invite link inside that
    //    form (source: createAccount) — must stack ABOVE the auth modal.
    // ---------------------------------------------------------------
    await page.getByRole('button', { name: /^create account$/i }).click();
    // "Username" is unique to the create-account form; the invite-request modal's own
    // intro copy ("Don't have an invite token yet?") also matches a naive /invite token/i
    // filter, so that alone isn't specific enough once both dialogs are open.
    const authModal = page.getByRole('dialog').filter({ hasText: /username/i });
    await authModal.waitFor({ timeout: 5000 });
    await authModal.getByText('Request an invite', { exact: true }).click();

    // A stable locator across this modal's whole lifecycle (form -> success) that still
    // excludes authModal: authModal always has a "Username" field, the invite modal
    // never does.
    const inviteModal2 = page.getByRole('dialog').filter({ hasNotText: /username/i });
    await inviteModal2
        .getByRole('heading', { name: /request an invite/i })
        .waitFor({ timeout: 5000 });
    const introCreate = await inviteModal2.getByText(/invite token yet/i).textContent();
    log('createAccount intro text:', JSON.stringify(introCreate));
    // Both dialogs should be visible at once — the stacking is the whole point of the
    // zIndex=400 bump documented in request-invite-modal.tsx.
    const bothVisible = (await authModal.isVisible()) && (await inviteModal2.isVisible());
    log('auth modal + invite modal both visible at once (correct stacking)?', bothVisible);
    await page.screenshot({
        path: path.join(SNAP, `qa-invite-createaccount-stacked-${STAMP}.png`),
    });

    const createEmail = `qa-invite-createaccount-${STAMP}@example.com`;
    await inviteModal2.getByLabel(/email/i).fill(createEmail);
    await inviteModal2.getByRole('button', { name: /^request an invite$/i }).click();
    await inviteModal2.getByText(/you're on the list/i).waitFor({ timeout: 8000 });
    log('createAccount submit (dj_software=rekordbox default) -> success screen shown');
    await page.screenshot({
        path: path.join(SNAP, `qa-invite-createaccount-success-${STAMP}.png`),
    });
    await inviteModal2.getByRole('button', { name: /^close$/i }).click();
    await page.waitForTimeout(500);

    // Don't actually submit the create-account form itself — cancel out without
    // creating a real user.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await electronApp.close();
    log('done. scratch emails written (clean up via psql):', landingEmail, createEmail);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
