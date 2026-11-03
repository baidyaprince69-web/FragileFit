# FragileFit optional GA4 analytics

This release adds an opt-in Google Analytics 4 layer. It is intentionally inactive until a real GA4 web-stream Measurement ID is supplied.

## Enablement

1. Create a GA4 property and a Web data stream for the FragileFit GitHub Pages URL.
2. Copy the stream's Measurement ID. It has the form \`G-XXXXXXXXXX\`.
3. Replace the empty \`GA4_MEASUREMENT_ID\` value at the top of \`analytics-consent.js\`.
4. Commit and deploy the change.

The Measurement ID is a public tag identifier, not a password or secret key. Never place a Google service-account key, OAuth client secret or other credential in this file.

## What is measured

- Page views (without query strings)
- Workspace section opens
- Packaging and delivery-cost calculator use (event name only; no entered values)
- Install-button clicks
- Browser-reported PWA installation events, where supported

The tag is not loaded before the visitor chooses Allow analytics. Reject optional analytics keeps it disabled. Visitors can reopen Privacy choices from the page footer.

No product, order, shipment, customer, address, financial, backup, token or password contents are intentionally sent by this integration.
