# FragileFit

**Packaging Intelligence & Profitability Platform** for fragile-goods businesses.

FragileFit helps terracotta, ceramics, glassware and handmade-product sellers understand packaging costs, outer-carton volumetric freight, multi-line order profitability and shipment damage.

## Current release

- Version: 0.1.0
- Architecture: TypeScript modules compiled to browser JavaScript
- Storage: IndexedDB, local to the user's browser
- Backup: JSON export/import and password-encrypted AES-GCM backup using PBKDF2
- Hosting target: GitHub Pages
- Runtime: Static web app / installable PWA

## Add the application source archive

The repository deployment workflow expects the source archive at:

`release/FragileFit-GitHub-source-fixed.zip`

Download **FragileFit-GitHub-source-fixed.zip** from the project handoff in ChatGPT, then upload it to this exact path:

1. Open this repository on GitHub.
2. Select **Add file → Upload files**.
3. Upload the ZIP inside a folder named `release` and ensure the final path is `release/FragileFit-GitHub-source.zip`.
4. Commit the upload to `main`.

The GitHub Actions workflow prioritizes the corrected archive and will then:
- Extract the source archive into a clean build directory.
- Install the TypeScript development dependency.
- Run `npm test` (TypeScript build plus critical calculation and encryption tests).
- Publish the built static application to GitHub Pages.

The first workflow run before the ZIP is uploaded will safely skip deployment.

## Run locally

Requirements: Node.js 20 or later.

```bash
npm install
npm test
```

Open `index.html` through a local HTTP server (not `file://`) to test IndexedDB, service-worker and Web Crypto features.

## Important product rules

- Courier volumetric weight uses **only the final outer shipping carton's external dimensions**.
- Inner boxes and protective materials contribute to actual packaged weight and material cost, not outer-carton volume.
- Orders support multiple line items.
- An order can have multiple linked shipments, each with its own parcel and delivery result.
- Actual linked shipment expenses replace corresponding order estimates; never count both.
- Courier divisors and freight rates are editable user settings, not universal carrier claims.
- Sample records must remain clearly labelled as sample data.

## Privacy and limitations

The first release stores workspace data locally in the browser. It does not provide user accounts or automatic cloud synchronization. Users should export backups regularly and keep encrypted backup passwords safe. Losing the password means the encrypted backup cannot be recovered.

FragileFit is an operational recordkeeping and estimation tool, not courier, marketplace, accounting or tax advice. Users must verify carrier rules, fees and tax treatment for their own contracts and jurisdiction.

## Deployment

GitHub Actions deploys the contents of the source archive to GitHub Pages after the archive is committed at the path above. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** if GitHub asks for a Pages source selection.
