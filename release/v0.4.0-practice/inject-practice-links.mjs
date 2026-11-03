import fs from "node:fs";
import path from "node:path";

const site = process.argv[2] || "site";
const bannerCss = `
<style id="fragilefit-practice-banner-css">
.ff-practice-banner{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:11px 18px;background:linear-gradient(100deg,#eaf2ff,#edf8fb);border-bottom:1px solid #d2e1f5;color:#17365f;font:600 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.ff-practice-banner strong{font-weight:850}.ff-practice-banner p{margin:0;color:#546b87}.ff-practice-banner a{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;background:#245fce;color:#fff!important;text-decoration:none!important;font-weight:850;white-space:nowrap;box-shadow:0 4px 12px #245fce24}.ff-practice-banner a:hover{filter:brightness(1.08)}
@media(max-width:640px){.ff-practice-banner{justify-content:flex-start;padding:12px 15px}.ff-practice-banner p{flex-basis:100%}}
</style>`;
const banner = `
<aside class="ff-practice-banner" data-fragilefit-practice-banner>
  <p><strong>New to FragileFit?</strong> Try one sample order and packaging calculation. Nothing is saved.</p>
  <a href="practice.html">Start guided practice <span aria-hidden="true">→</span></a>
</aside>`;

for (const filename of ["index.html", "app.html"]) {
  const file = path.join(site, filename);
  if (!fs.existsSync(file)) throw new Error("Expected FragileFit page is missing: " + file);
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes("data-fragilefit-practice-banner")) {
    if (!/<body\b[^>]*>/i.test(html)) throw new Error("Could not locate body tag in " + filename);
    html = html.replace(/<\/head>/i, bannerCss + "\n</head>");
    html = html.replace(/(<body\b[^>]*>)/i, "$1\n" + banner);
    fs.writeFileSync(file, html, "utf8");
  }
}
console.log("Guided practice shortcut added to homepage and workspace.");
