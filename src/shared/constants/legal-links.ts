// The legal pages are static HTML served out of the web image alongside the app
// (src/renderer/public/legal/, copied to out/web/legal/ by Vite's publicDir), not
// routes inside the SPA. They are linked absolutely rather than relatively because
// the desktop build has no sub-box.net origin of its own — an Electron user opening
// "Terms of Service" has to be sent to the hosted copy.
const LEGAL_BASE_URL = 'https://www.sub-box.net/legal';

export const LegalLinks = {
    index: `${LEGAL_BASE_URL}/`,
    noticeAndAction: `${LEGAL_BASE_URL}/notice-and-action.html`,
    privacy: `${LEGAL_BASE_URL}/privacy.html`,
    terms: `${LEGAL_BASE_URL}/terms.html`,
} as const;
