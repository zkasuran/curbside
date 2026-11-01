// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The branded sign-in and sign-up page. The framework's own AuthPage markup is kept byte for byte
// (it hydrates on the client and owns every field, message and request). Around it we add, in front:
// a <style> with the Curbside skin, a tiny theme script and an <aside> brand panel. React hydrates the
// root container in "root" mode, which skips over elements that do not match the first expected node,
// so these additions are left in place and the form hydrates exactly as before.
import { renderAuthPage } from "@agent-native/toolkit/app/auth/server";

type AuthPageProps = Parameters<typeof renderAuthPage>[0];

/** The product site from the web brief (Job A). Change this one line if it deploys elsewhere. */
export const PRODUCT_SITE_URL = "https://curbside-street.vercel.app";

const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem('theme');var d=m==='dark'||((m===null||m==='system'||m==='auto')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-cs-theme',d?'dark':'light');document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`;

const MARK = `<svg class="cs-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#1c1917"/><path d="M19 45 L23 12 A34 34 0 0 1 52 29 Z" fill="#f59e0b"/><path d="M19 45 L23 12 A34 34 0 0 1 52 29 Z" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linejoin="round"/><circle cx="19" cy="45" r="6.5" fill="#fbfaf7"/><circle cx="44.5" cy="45.5" r="10" fill="#10b981" stroke="#1c1917" stroke-width="3"/><path d="M39.6 45.7 l3.3 3.3 l6.4 -6.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

const BRAND = `<aside class="cs-brand" aria-label="About Curbside">
<div class="cs-brand-top"><span class="cs-logo">${MARK}<span>Curbside</span></span><span class="cs-sandbox">OSM development sandbox</span></div>
<div class="cs-brand-body">
<p class="cs-headline">The agent reads the street. <span>You approve the map fixes.</span></p>
<ul class="cs-proof">
<li>${CHECK}<span>Reads every shop sign in open street photos without seeing the map names.</span></li>
<li>${CHECK}<span>Drafts each fix beside its photo, with the sign boxed where it was read.</span></li>
<li>${CHECK}<span>Nothing uploads until you approve. Edits go to the OSM development sandbox.</span></li>
</ul>
<figure class="cs-visual">
<div class="cs-photo"><img src="/brand/street-monaco-800.webp" width="800" height="457" alt="Street photo of Passage Thiéré in Paris with the red Bar Monaco awning"><span class="cs-lock"></span><span class="cs-read"><small>read on the street</small>Bar Monaco</span></div>
<div class="cs-diff"><span class="cs-tag">name</span><s>Monaco Bar</s><svg class="cs-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg><b>Bar Monaco</b><span class="cs-approve">${CHECK}Approve</span></div>
<figcaption>Illustration of a real review. Photo: Panoramax, immergis, Etalab 2.0.</figcaption>
</figure>
</div>
<p class="cs-brand-foot"><a href="${PRODUCT_SITE_URL}" target="_blank" rel="noopener">See how Curbside works</a><span>Map data © OpenStreetMap contributors, ODbL.</span></p>
</aside>`;

const STYLE = `<style data-curbside-auth>
@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url("/fonts/inter-latin-wght-normal.woff2") format("woff2-variations")}
html{--cs-bg:#fbfaf7;--cs-panel:#f3f0ea;--cs-surface:#fff;--cs-surface-2:#f7f5f1;--cs-text:#1c1917;--cs-muted:#57534e;--cs-line:#e7e2da;--cs-line-strong:#d6cfc4;--cs-accent:#f59e0b;--cs-accent-text:#a74b06;--cs-accent-soft:rgba(245,158,11,.14);--cs-green:#047857;--cs-rose:#be123c;--cs-btn:#1c1917;--cs-btn-fg:#fff;--cs-btn-hover:#3a3532;--cs-shadow:0 1px 2px rgba(28,25,23,.06),0 24px 60px -24px rgba(28,25,23,.25);color-scheme:light}
html[data-cs-theme=dark]{--cs-bg:#0f0e0d;--cs-panel:#151311;--cs-surface:#1c1a17;--cs-surface-2:#23201c;--cs-text:#f5f3ef;--cs-muted:#b5aea6;--cs-line:#2e2a26;--cs-line-strong:#3d3833;--cs-accent-text:#fbbf24;--cs-accent-soft:rgba(245,158,11,.16);--cs-green:#34d399;--cs-rose:#fb7185;--cs-btn:#f5f3ef;--cs-btn-fg:#1c1917;--cs-btn-hover:#fff;--cs-shadow:0 1px 2px rgba(0,0,0,.4),0 24px 60px -24px rgba(0,0,0,.7);color-scheme:dark}
html body{display:block;min-height:100vh;padding:0;background:var(--cs-bg);color:var(--cs-text);font-family:"Inter Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
#agent-native-auth-root.auth-root{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);min-height:100vh;min-height:100svh}
.cs-brand{position:relative;display:flex;flex-direction:column;gap:32px;padding:40px clamp(28px,5vw,72px);background:var(--cs-panel);border-inline-end:1px solid var(--cs-line);overflow:hidden}
.cs-brand::before{content:"";position:absolute;inset:-30% -20% auto auto;width:70%;aspect-ratio:1;background:radial-gradient(closest-side,var(--cs-accent-soft),transparent 70%);pointer-events:none}
.cs-brand>*{position:relative}
.cs-brand-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
.cs-logo{display:inline-flex;align-items:center;gap:10px;font-size:19px;font-weight:700;letter-spacing:-.02em}
.cs-mark{width:30px;height:30px;border-radius:8px;flex:none}
.cs-sandbox{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border:1px solid var(--cs-line);border-radius:999px;background:var(--cs-surface);color:var(--cs-muted);font-size:12.5px;font-weight:500}
.cs-sandbox::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--cs-accent);box-shadow:0 0 0 3px var(--cs-accent-soft)}
.cs-brand-body{display:flex;flex:1;flex-direction:column;justify-content:center;gap:26px;max-width:560px}
.cs-headline{font-size:clamp(30px,3.2vw,44px);font-weight:750;line-height:1.05;letter-spacing:-.035em;text-wrap:balance}
.cs-headline span{color:var(--cs-accent-text)}
.cs-proof{display:grid;gap:10px;list-style:none;font-size:15.5px;line-height:1.45;color:var(--cs-muted)}
.cs-proof li{display:grid;grid-template-columns:20px 1fr;gap:10px}
.cs-proof svg{width:20px;height:20px;padding:3px;border-radius:50%;background:var(--cs-accent-soft);fill:none;stroke:var(--cs-accent-text);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;margin-top:1px}
.cs-visual{margin:0;padding:8px;border-radius:16px;background:var(--cs-surface);border:1px solid var(--cs-line);box-shadow:var(--cs-shadow)}
.cs-photo{position:relative;overflow:hidden;border-radius:10px;aspect-ratio:7/4;font-size:clamp(10px,1vw,13px)}
.cs-photo img{display:block;width:100%;height:100%;object-fit:cover}
.cs-lock{position:absolute;left:32.86%;top:30%;width:9.29%;height:10.63%;border:2px solid var(--cs-accent);border-radius:4px;box-shadow:0 0 0 3px rgba(245,158,11,.3)}
.cs-read{position:absolute;left:43.4%;top:25.5%;display:grid;padding:.4em .7em .45em;border-radius:7px;background:#f59e0b;color:#1c1917;font-weight:700;font-size:1.1em;line-height:1.2;box-shadow:0 8px 20px -8px rgba(0,0,0,.45)}
.cs-read small{font-size:.62em;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.8}
.cs-diff{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 6px 4px;font:500 13.5px/1.3 ui-monospace,"SFMono-Regular",Menlo,monospace}
.cs-tag{padding:1px 7px;border-radius:5px;background:var(--cs-surface-2);color:var(--cs-muted);font-size:12px}
.cs-diff s{color:var(--cs-rose)}
.cs-diff b{color:var(--cs-green)}
.cs-arrow{width:14px;height:14px;fill:none;stroke:var(--cs-muted);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.cs-approve{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:6px 11px;border-radius:7px;background:#047857;color:#fff;font:600 13px/1 "Inter Variable",system-ui,sans-serif}
.cs-approve svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.cs-visual figcaption{padding:6px 6px 2px;font-size:12px;color:var(--cs-muted)}
.cs-brand-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 20px;font-size:13px;color:var(--cs-muted)}
.cs-brand-foot a{color:var(--cs-accent-text);font-weight:600;text-decoration:none}
.cs-brand-foot a:hover{text-decoration:underline;text-underline-offset:3px}
@media (prefers-reduced-motion:no-preference){
.cs-lock{animation:cs-lock 6s cubic-bezier(.2,.8,.2,1) infinite}
.cs-read{animation:cs-read 6s cubic-bezier(.2,.8,.2,1) infinite}
.cs-diff s,.cs-diff b,.cs-arrow,.cs-approve{animation:cs-diff 6s cubic-bezier(.2,.8,.2,1) infinite}
.cs-approve{animation-name:cs-approve}
}
@keyframes cs-lock{0%,8%{opacity:0;transform:scale(1.8)}16%{opacity:1;transform:scale(.95)}20%,90%{opacity:1;transform:none}100%{opacity:0;transform:none}}
@keyframes cs-read{0%,18%{opacity:0;transform:translateX(-6px)}26%,90%{opacity:1;transform:none}100%{opacity:0}}
@keyframes cs-diff{0%,30%{opacity:0;transform:translateY(4px)}40%,90%{opacity:1;transform:none}100%{opacity:0}}
@keyframes cs-approve{0%,44%{opacity:0;transform:translateY(4px)}52%,62%{opacity:1;transform:none}65%{transform:scale(.92)}68%,90%{opacity:1;transform:none}100%{opacity:0}}
.auth-page{background:transparent;padding:40px 24px}
.auth-wave-background{display:none}
.auth-page input,.auth-page button,.auth-page h1,.auth-page p,.auth-page label{font-family:inherit}
.auth-page .card{max-width:420px;padding:32px;background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:18px;box-shadow:var(--cs-shadow)}
.auth-page h1{color:var(--cs-text);font-size:26px;font-weight:720;letter-spacing:-.025em;margin-bottom:6px}
.auth-page .subtitle{color:var(--cs-muted);font-size:14.5px;line-height:1.45;margin-bottom:24px}
.auth-page .tabs{background:var(--cs-surface-2);border:1px solid var(--cs-line);border-radius:10px}
.auth-page .tab{color:var(--cs-muted);font-size:14px;border-radius:7px;padding:8px 12px}
.auth-page .tab.active{background:var(--cs-surface);color:var(--cs-text);box-shadow:0 1px 2px rgba(28,25,23,.12),0 0 0 1px var(--cs-line)}
.auth-page .tab:hover:not(.active){color:var(--cs-text)}
.auth-page label{color:var(--cs-muted);font-size:13.5px;font-weight:500}
.auth-page input{background:var(--cs-surface);border:1px solid var(--cs-line-strong);border-radius:9px;color:var(--cs-text);font-size:15px;padding:10px 12px;transition:border-color .2s,box-shadow .2s}
.auth-page input::placeholder{color:var(--cs-muted);opacity:.7}
.auth-page input:focus{border-color:var(--cs-accent);box-shadow:0 0 0 3px var(--cs-accent-soft)}
.auth-page button[type=submit],.auth-page .btn-primary{background:var(--cs-btn);color:var(--cs-btn-fg);border-radius:999px;padding:11px;font-size:15px;font-weight:600;transition:background-color .2s,transform .2s}
.auth-page button[type=submit]:hover,.auth-page .btn-primary:hover{background:var(--cs-btn-hover)}
.auth-page .btn-secondary{color:var(--cs-muted);border-color:var(--cs-line-strong);border-radius:999px}
.auth-page .btn-secondary:hover{color:var(--cs-text);border-color:var(--cs-muted)}
.auth-page .btn-google{background:var(--cs-surface);color:var(--cs-text);border:1px solid var(--cs-line-strong);border-radius:999px}
.auth-page .btn-google:hover{background:var(--cs-surface-2)}
.auth-page .divider{color:var(--cs-muted)}
.auth-page .divider::before,.auth-page .divider::after{background:var(--cs-line)}
.auth-page .link-button,.auth-page .back,.auth-page .legal-note,.auth-page .legal-note a{color:var(--cs-muted)}
.auth-page .link-button:hover,.auth-page .legal-note a:hover{color:var(--cs-text)}
.auth-page .msg.error,.auth-page .google-error{color:var(--cs-rose)}
.auth-page .msg.success,.auth-page .verification-kicker{color:var(--cs-green)}
.auth-page .verification-panel,.auth-page .upgrade-note,.auth-page .signup-local-mode-note{background:var(--cs-surface-2);border-color:var(--cs-line);color:var(--cs-muted)}
.auth-page .verification-copy,.auth-page .verification-copy strong,.auth-page .magic-link-success-copy{color:var(--cs-text)}
.auth-page .progress-step{color:var(--cs-muted)}
.auth-page .progress-step span{background:var(--cs-surface);border-color:var(--cs-line-strong);color:var(--cs-muted)}
.auth-page .progress-step.current span{background:var(--cs-btn);border-color:var(--cs-btn);color:var(--cs-btn-fg)}
.auth-page .locale-trigger{color:var(--cs-muted)}
.auth-page .locale-menu{background:var(--cs-surface);border-color:var(--cs-line)}
.auth-page .locale-menu-item{color:var(--cs-muted)}
.auth-page .locale-menu-item:hover,.auth-page .locale-menu-item[aria-checked=true]{background:var(--cs-surface-2);color:var(--cs-text)}
.auth-page :focus-visible{outline:2px solid var(--cs-accent);outline-offset:2px}
@media (max-width:900px){
#agent-native-auth-root.auth-root{grid-template-columns:1fr;grid-template-rows:auto 1fr}
.cs-brand{gap:14px;padding:20px 20px 22px;border-inline-end:0;border-bottom:1px solid var(--cs-line)}
.cs-brand-body{gap:12px}
.cs-headline{font-size:24px}
.cs-proof,.cs-visual,.cs-brand-foot span{display:none}
.cs-brand-foot{font-size:13px}
.auth-page{min-height:auto;padding:24px 16px 40px;justify-content:flex-start}
.auth-page .card{padding:24px 20px}
}
@media (max-width:420px){.cs-sandbox{display:none}}
</style>`;

export function renderCurbsideSignInPage(props: AuthPageProps): string {
  return `${STYLE}<script>${THEME_SCRIPT}</script>${BRAND}${renderAuthPage(props)}`;
}
