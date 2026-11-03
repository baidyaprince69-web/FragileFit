import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../analytics-consent.js", import.meta.url), "utf8");
const policy = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");

for (const fragment of [
  'const GA4_MEASUREMENT_ID = "";',
  'fragilefit.analytics-consent.v1',
  'https://www.googletagmanager.com/gtag/js?id=',
  'Allow analytics',
  'Reject optional analytics',
  'Privacy choices',
  'workspace_view_opened',
  'calculator_used',
  'install_app_clicked',
  'app_installed',
  'send_page_view: false'
]) {
  assert.ok(source.includes(fragment), "Missing analytics feature: " + fragment);
}

assert.ok(source.includes('if (!/^G-[A-Z0-9]+$/.test(GA4_MEASUREMENT_ID)) return;'),
  "Analytics must remain disabled until a valid GA4 Measurement ID is configured.");
assert.ok(!source.includes("new FormData"), "Analytics must not read form values.");
assert.ok(!source.includes("location.search"), "Analytics must not send query-string values.");
assert.ok(policy.includes("Optional website analytics"), "Privacy policy must describe optional analytics.");
assert.ok(policy.includes("not loaded and analytics requests are not sent"), "Policy must explain the pre-consent state.");
assert.ok(policy.includes("does not intentionally send values entered into forms"), "Policy must explain that business form values are excluded.");

console.log("FragileFit analytics consent and privacy checks passed.");
