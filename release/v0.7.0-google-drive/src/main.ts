import { calculateExpectedDeliveryCost, calculateOrderFinancials, calculatePackaging, damageRate, estimateCourierCharge, getPackagingEvidence, runCriticalTests } from './calculations.js';
import { clearWorkspace, deleteEntity, getAllData, getStorageProtectionStatus, initializeDatabase, replaceAllData, requestStorageProtection, resetSampleData, saveEntity, saveSettings, type StorageProtectionStatus } from './db.js';
import { exportEncryptedBackup, exportPlainBackup, importBackupFile } from './backup.js';
import { runCryptoTests } from './security.js';
import type { AppData, Category, CourierSetting, Order, OrderLine, PackagingConfig, Product, Shipment, ShipmentLine } from './types.js';
import { GOOGLE_DRIVE_BACKUP_FOLDER_NAME, GOOGLE_DRIVE_BACKUP_SCOPE, connectGoogleDrive, disconnectGoogleDrive, downloadEncryptedDriveBackup, getGoogleDrivePreparationStatus, listEncryptedDriveBackups, parseDriveEncryptedBackupText, preloadGoogleIdentityServices, uploadEncryptedDriveBackup, type DriveBackupMetadata } from './drive.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('FragileFit application root was not found.');

let data: AppData;
let activeView = 'dashboard';
let packagingOutput = '';
let searchTerm = '';
let toastTimer: number | undefined;
let deferredInstallPrompt: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
let storageProtection: StorageProtectionStatus = { supported: false, persistent: null };
let googleDriveBackups: DriveBackupMetadata[] = [];

const TOUR_STEPS = [
  { view: 'dashboard', label: '01 · Overview', title: 'Start with the business picture', body: 'The overview brings products, orders, shipments, recorded damage and order profit into one place. The numbers at first are demonstration records, not your company results.', bullets: ['Read the SAMPLE DATA labels before interpreting any figures.', 'Use the recent-shipment table to understand what has been recorded.', 'The guided tour never changes your saved business records.'] },
  { view: 'products', label: '02 · Products', title: 'Create a reliable product catalogue', body: 'Each product stores its dimensions, physical weight, production cost and selling price. Those details feed the packaging calculator and order economics.', bullets: ['Measure the product itself, not its shipping carton.', 'Enter actual production cost and selling price.', 'Keep SKU values unique so products are easy to identify.'] },
  { view: 'packaging', label: '03 · Packaging lab', title: 'Model how each parcel is packed', body: 'A recipe records single-box or dual-box protection, material weights and material costs. The freight volume always comes from the external dimensions of the final outer carton.', bullets: ['Inner and outer box weights contribute to actual weight.', 'Only the outer carton dimensions determine volumetric weight.', 'Courier divisors and charges are editable assumptions.'] },
  { view: 'roi', label: '04 · Packaging ROI', title: 'Compare total cost per successful delivery', body: 'The ROI simulator compares packaging cost, courier cost and the expected cost of damage. It uses a sufficiently large history when available; otherwise it asks you to enter an explicit scenario assumption.', bullets: ['Use “Load illustrative scenario” only to learn the model.', 'Replace assumptions with your own evidence before making a buying decision.', 'The lowest modelled cost is not a guarantee of safer delivery.'] },
  { view: 'orders', label: '05 · Orders', title: 'Understand the money behind every order', body: 'An order can contain several product lines. FragileFit calculates revenue, manufacturing cost, platform fees, fulfilment cost, returns and operating profit.', bullets: ['An order can remain provisional while fulfilment is incomplete.', 'Linked shipment actuals replace order estimates; they are not added together.', 'Tax reserve is shown separately from operating profit.'] },
  { view: 'shipments', label: '06 · Shipments', title: 'Record each parcel separately', body: 'One order can be delivered in multiple parcels. Each shipment has its own courier, recipe, contents, actual costs and delivery outcome.', bullets: ['Record actual packaging and shipping amounts when known.', 'Mark damaged or returned parcels accurately.', 'Tracking references are stored, but live courier tracking is not connected.'] },
  { view: 'intelligence', label: '07 · Intelligence', title: 'Learn from recorded delivery outcomes', body: 'The intelligence section compares packaging recipes using your real, non-sample shipment records. It avoids ranking a recipe when there is too little evidence.', bullets: ['At least 10 real resolved observations are required for a displayed damage rate.', 'Preloaded demo shipments are excluded from reliability evidence.', 'Small real-world samples are labelled insufficient rather than treated as proof.'] },
  { view: 'reports', label: '08 · Reports & backups', title: 'Keep a copy of your business records', body: 'Reports lets you export CSV tables, make plain JSON backups, create password-encrypted backups and run the calculation/security test suite.', bullets: ['Plain JSON is readable and is not encrypted.', 'Encrypted backups need the original password to restore.', 'Export a backup before testing restore or clearing records.'] },
  { view: 'settings', label: '09 · Settings', title: 'Configure your own workspace', body: 'Settings contains your business profile, currency, courier divisor/rate presets, sample-data controls and local privacy information.', bullets: ['Courier divisors and prices must match your own courier agreement.', 'Business records stay in this browser profile; there is no cloud sync in this release.', 'Reset sample data preserves custom records; Clear workspace removes business records.'] }
];

const money = (value: number): string => {
  const currency = data?.settings?.currency ?? 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0); }
  catch { return `₹${(value || 0).toFixed(2)}`; }
};
const number = (value: number, digits = 2): string => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: digits });
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const id = (): string => crypto.randomUUID ? crypto.randomUUID() : `ff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const dateToday = (): string => new Date().toISOString().slice(0, 10);
const num = (form: FormData, key: string): number => {
  const value = String(form.get(key) ?? '').trim();
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNum = (form: FormData, key: string): number | undefined => {
  const value = String(form.get(key) ?? '').trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const value = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();
const isSample = (record: { isSample?: boolean }): string => record.isSample ? '<span class="sample-tag">SAMPLE DATA</span>' : '';
const badge = (text: string, style = ''): string => `<span class="status ${style}">${esc(text)}</span>`;
const empty = (title: string, detail: string, action = ''): string => `<div class="empty-state"><div class="empty-mark">＋</div><h3>${esc(title)}</h3><p>${esc(detail)}</p>${action}</div>`;
const button = (label: string, action: string, style = 'primary', extra = ''): string => `<button class="btn ${style}" data-action="${action}" ${extra}>${label}</button>`;
const selectOptions = (items: Array<{ value: string; label: string }>, selected = ''): string => items.map(item => `<option value="${esc(item.value)}" ${item.value === selected ? 'selected' : ''}>${esc(item.label)}</option>`).join('');

function notify(message: string, kind = 'success'): void {
  let element = document.querySelector<HTMLElement>('.toast');
  if (!element) { element = document.createElement('div'); element.className = 'toast'; document.body.append(element); }
  element.textContent = message;
  element.dataset.kind = kind;
  element.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element?.classList.remove('visible'), 3200);
}

function appShell(): string {
  const navGroups = [
    { label: 'WORKSPACE', items: [['dashboard', '◫', 'Overview']] },
    { label: 'BUILD', items: [['products', '▦', 'Products'], ['packaging', '◇', 'Packaging']] },
    { label: 'OPERATE', items: [['orders', '≡', 'Orders'], ['shipments', '⇢', 'Shipments']] },
    { label: 'OPTIMISE', items: [['roi', '◎', 'Delivery cost'], ['intelligence', '⌁', 'Intelligence']] },
    { label: 'MANAGE', items: [['reports', '▤', 'Reports'], ['settings', '⚙', 'Settings'], ['data-safety', '◈', 'Data safety']] }
  ];
  const nav = navGroups.flatMap(group => group.items);
  const mobileNav = [['dashboard', '◫', 'Home'], ['products', '▦', 'Products'], ['packaging', '◇', 'Pack'], ['orders', '≡', 'Orders'], ['shipments', '⇢', 'Shipments']];
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="./index.html" aria-label="FragileFit website home">
        <span class="brand-symbol"><span></span><span></span><span></span></span>
        <span><strong>FragileFit</strong><small>PACKAGING INTELLIGENCE</small></span>
      </a>
      <nav class="side-nav" aria-label="Main navigation">
        ${navGroups.map(group => `<div class="nav-group"><div class="nav-group-label">${group.label}</div>${group.items.map(([key, glyph, label]) => `<button class="nav-item ${activeView === key ? 'active' : ''}" data-view="${key}" ${activeView === key ? 'aria-current="page"' : ''}><span class="nav-glyph" aria-hidden="true">${glyph}</span><span>${label}</span>${key === 'shipments' ? `<span class="nav-count">${data.shipments.length}</span>` : ''}</button>`).join('')}</div>`).join('')}
      </nav>
      <div class="sidebar-bottom">
        <div class="local-note"><span class="live-dot"></span><span>LOCAL WORKSPACE</span></div>
        <div class="sidebar-foot">Your records stay in this browser.</div>
        <a class="version-link" href="#reports" data-view="reports">FragileFit · v0.6.0</a>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="crumb"><a href="./index.html">FragileFit</a><i>/</i><strong>${esc(nav.find(x => x[0] === activeView)?.[2] ?? 'Overview')}</strong></div>
        <div class="top-actions">
          <span class="secure-label"><span class="live-dot"></span> LOCAL DATA</span>
          <a class="text-button top-home" href="./index.html">Website home</a>
          <button class="text-button tour-button" data-action="start-tour">Guided tour</button>
          <button class="text-button install-button" data-action="install-app">Install app</button>
          <button class="text-button top-reset" data-action="reset-samples">Refresh samples</button>
          <button class="icon-button" data-action="export-plain" title="Export backup" aria-label="Export backup">↓</button>
          <button class="avatar" data-view="settings" title="Settings" aria-label="Open settings">${(data.settings.businessName || 'F').slice(0,1).toUpperCase()}</button>
        </div>
      </header>
      <div class="global-storage-warning" role="note" aria-label="Important local data warning">
        <span class="storage-warning-symbol" aria-hidden="true">!</span>
        <div><strong>This workspace is stored on this device only.</strong><p>Clearing this site's browser data or losing this device can make these records unavailable. Another device has a separate workspace; live sync is not available yet.</p></div>
        <button class="text-button" data-view="data-safety">Data safety &amp; backups</button>
      </div>
      <main class="content" id="view-content">${renderView()}</main>
      <footer class="app-footer"><span>FRAGILEFIT</span><span>Private by design · Local-first · No bank connection</span><span><a href="./index.html">Website</a> · <a href="./demo.html">Demo</a> · <a href="./about.html">About</a> · <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a></span></footer>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      ${mobileNav.map(([key, glyph, label]) => `<button class="mobile-nav-item ${activeView === key ? 'active' : ''}" data-view="${key}" ${activeView === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${glyph}</span><small>${label}</small></button>`).join('')}
      <button class="mobile-nav-item" data-action="mobile-more"><span aria-hidden="true">•••</span><small>More</small></button>
    </nav>
  </div>`;
}

function pageHeading(eyebrow: string, title: string, description: string, actions = ''): string {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function metric(label: string, valueText: string, foot: string, icon: string, accent = ''): string {
  return `<article class="metric-card ${accent}"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><strong>${valueText}</strong><small>${foot}</small></article>`;
}
function renderDashboard(): string {
  // Business KPIs intentionally exclude every preloaded sample record.
  const actualProducts = data.products.filter(record => !record.isSample);
  const actualPackaging = data.packaging.filter(record => !record.isSample);
  const actualOrders = data.orders.filter(record => !record.isSample);
  const actualShipments = data.shipments.filter(record => !record.isSample);
  const ordersFinancials = actualOrders.map(order => calculateOrderFinancials(order, actualShipments.filter(shipment => shipment.orderId === order.id)));
  const finalizedOrders = ordersFinancials.filter(financials => !financials.provisional);
  const profit = ordersFinancials.reduce((sum, financials) => sum + financials.operatingProfit, 0);
  const shipmentsWithPackCost = actualShipments.filter(shipment => shipment.actualPackagingCost != null);
  const packAvg = shipmentsWithPackCost.length
    ? shipmentsWithPackCost.reduce((sum, shipment) => sum + (shipment.actualPackagingCost ?? 0), 0) / shipmentsWithPackCost.length
    : undefined;
  const damages = actualShipments.filter(shipment => shipment.outcome === 'Damaged' || shipment.outcome === 'Replaced').length;
  const resolvedActual = actualShipments.filter(shipment => ['Delivered safely', 'Damaged', 'Replaced'].includes(shipment.outcome));
  const actualDamageRate = resolvedActual.length ? damageRate(resolvedActual) : undefined;
  const recent = [...actualShipments].sort((a,b) => b.dispatchDate.localeCompare(a.dispatchDate)).slice(0,4);
  const byPackage = actualPackaging.map(pack => ({
    name: pack.name,
    count: actualShipments.filter(shipment => shipment.packagingConfigId === pack.id && ['Delivered safely', 'Damaged', 'Replaced', 'Returned'].includes(shipment.outcome)).length,
    damages: actualShipments.filter(shipment => shipment.packagingConfigId === pack.id && (shipment.outcome === 'Damaged' || shipment.outcome === 'Replaced')).length
  }));
  const sampleProducts = data.products.filter(record => record.isSample).length;
  const sampleRecipes = data.packaging.filter(record => record.isSample).length;
  const sampleOrders = data.orders.filter(record => record.isSample).length;
  const sampleShipments = data.shipments.filter(record => record.isSample).length;
  const hasSampleRecords = sampleProducts + sampleRecipes + sampleOrders + sampleShipments > 0;
  const hasActualRecords = actualProducts.length + actualPackaging.length + actualOrders.length + actualShipments.length > 0;
  const actualRevenue = ordersFinancials.reduce((sum, financials) => sum + financials.grossRevenue, 0);
  const actualPackagingSpend = ordersFinancials.reduce((sum, financials) => sum + financials.packagingCost, 0);
  const actualShippingSpend = ordersFinancials.reduce((sum, financials) => sum + financials.shippingCost, 0);
  return `${pageHeading('BUSINESS OVERVIEW', 'Your business, at a glance.', 'A clear view of your own products, orders and delivery outcomes. Demonstration records are kept separate from these figures.', button('＋ Add product', 'add-product') + button('＋ New order', 'add-order', 'secondary'))}
    ${hasSampleRecords ? `<section class="notice demo-notice sample-overview"><span class="notice-icon" aria-hidden="true">✳</span><div class="sample-overview-copy"><strong>Illustrative sample records are available.</strong><p>Sample products, recipes, orders and shipments are shown in their own sections to help you learn the workflow. They are excluded from every business KPI, chart and profit figure on this overview.</p><div class="sample-counts"><span>${sampleProducts} sample products</span><span>${sampleRecipes} sample recipes</span><span>${sampleOrders} sample orders</span><span>${sampleShipments} sample shipments</span></div></div><button class="text-button" data-action="reset-samples">Refresh sample data</button></section>` : ''}
    ${!hasActualRecords ? `<section class="getting-started panel"><div class="getting-started-copy"><span class="eyebrow">YOUR FIRST STEPS</span><h2>Start with your own business records.</h2><p>Your dashboard will fill with real delivery economics as you add products, packaging recipes, orders and shipments. Sample records never enter these business figures.</p><div class="getting-started-actions">${button('＋ Add your first product','add-product')}${button('Explore the guided tour','start-tour','secondary')}</div></div><div class="getting-started-steps"><div><span>01</span><strong>Add a product</strong><small>Dimensions, weight and costs</small></div><div><span>02</span><strong>Build a packaging recipe</strong><small>Materials and outer-carton size</small></div><div><span>03</span><strong>Record real shipments</strong><small>Actual courier and delivery outcomes</small></div></div></section>` : ''}
    <section class="metric-grid dashboard-metrics">
      ${metric('YOUR PRODUCTS', String(actualProducts.length), 'Non-sample catalogue items', '▦')}
      ${metric('YOUR ORDERS', String(actualOrders.length), `${actualOrders.filter(order => order.status === 'Pending').length} pending`, '≡')}
      ${metric('YOUR SHIPMENTS', String(actualShipments.length), `${actualShipments.filter(shipment => shipment.outcome === 'Delivered safely').length} safely delivered`, '⇢')}
      ${metric('OBSERVED DAMAGE RATE', actualDamageRate == null ? '—' : `${number(actualDamageRate,1)}%`, actualDamageRate == null ? 'Needs resolved real shipments' : `${damages} damage or replacement incidents`, '⌁', 'metric-warning')}
    </section>
    <section class="dashboard-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">DELIVERY OUTCOMES</span><h2>Real shipment observations</h2></div><span class="muted small">Sample records excluded</span></div>
        ${byPackage.some(item => item.count) ? `<div class="bar-chart">${byPackage.filter(item => item.count).map(item => `<div class="bar-row"><div class="bar-label">${esc(item.name)}</div><div class="bar-track"><span style="width:${Math.max(3,item.damages/item.count*100)}%" class="bar-fill ${item.damages ? 'bar-fill-alert' : ''}"></span></div><div class="bar-value">${item.damages}/${item.count}</div></div>`).join('')}</div><div class="chart-legend"><span><i class="legend-dot good"></i> No damage recorded</span><span><i class="legend-dot alert"></i> Damage incidents</span></div>` : empty('Your delivery chart will appear here','Add packaging recipes and record real, resolved shipments. Sample shipments are not used in this chart.')}
      </article>
      <article class="panel profit-panel"><div class="panel-heading"><div><span class="eyebrow">ORDER ECONOMICS</span><h2>Your profit snapshot</h2></div><span class="panel-mark">₹</span></div>
        <div class="profit-big">${actualOrders.length ? money(profit) : '—'}</div><div class="muted small">${actualOrders.length ? `${finalizedOrders.length} finalized · ${ordersFinancials.length-finalizedOrders.length} provisional · sample orders excluded` : 'Your profit appears after you record your own orders.'}</div>
        <div class="profit-breakdown"><div><span>Gross order revenue</span><strong>${actualOrders.length ? money(actualRevenue) : '—'}</strong></div><div><span>Packaging expenses</span><strong>${actualOrders.length ? money(actualPackagingSpend) : '—'}</strong></div><div><span>Shipping expenses</span><strong>${actualOrders.length ? money(actualShippingSpend) : '—'}</strong></div><div><span>Avg. recorded packaging / shipment</span><strong>${packAvg == null ? '—' : money(packAvg)}</strong></div></div>
        <button class="text-button" data-view="orders">Open your order economics ↗</button>
      </article>
    </section>
    <section class="panel recent-panel"><div class="panel-heading"><div><span class="eyebrow">LATEST ACTIVITY</span><h2>Your recent shipments</h2></div><button class="text-button" data-view="shipments">View all ↗</button></div>
      ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>TRACKING REF</th><th>COURIER</th><th>DISPATCHED</th><th>OUTCOME</th><th>PACKAGING</th></tr></thead><tbody>${recent.map(shipment => `<tr><td><strong>${esc(shipment.trackingRef)}</strong></td><td>${esc(shipment.courierName)}</td><td>${esc(shipment.dispatchDate || '—')}</td><td>${outcomeBadge(shipment.outcome)}</td><td>${esc(data.packaging.find(pack => pack.id === shipment.packagingConfigId)?.name ?? '—')}</td></tr>`).join('')}</tbody></table></div>` : empty('No real shipments recorded yet','When you add shipments, your latest activity will appear here. Sample records are intentionally excluded.',button('＋ Add shipment','add-shipment'))}
    </section>`;
}

function outcomeBadge(outcome: string): string {
  const cls = outcome === 'Delivered safely' ? 'good' : outcome === 'Damaged' || outcome === 'Replaced' ? 'bad' : outcome === 'Dispatched' ? 'blue' : 'neutral';
  return badge(outcome, cls);
}

function renderProducts(): string {
  const filtered = data.products.filter(p => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(searchTerm.toLowerCase()));
  return `${pageHeading('CATALOGUE', 'Product library', 'Keep product dimensions, production costs and selling prices in one place.', button('＋ Add product','add-product'))}
    <section class="panel"><div class="panel-toolbar"><div class="search-wrap"><span>⌕</span><input id="product-search" type="search" placeholder="Search products or SKU…" value="${esc(searchTerm)}"></div><span class="muted small">${filtered.length} of ${data.products.length} products</span></div>
    ${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>DIMENSIONS</th><th>WEIGHT</th><th>PRODUCTION</th><th>SELLING</th><th></th></tr></thead><tbody>${filtered.map(p => `<tr><td><strong>${esc(p.name)}</strong><small class="cell-sub">${esc(p.sku || 'No SKU')} ${isSample(p)}</small></td><td>${esc(p.category)}</td><td>${number(p.lengthCm)} × ${number(p.widthCm)} × ${number(p.heightCm)} cm</td><td>${number(p.actualWeightG,0)} g</td><td>${money(p.productionCost)}</td><td><strong>${money(p.sellingPrice)}</strong></td><td class="row-actions"><button data-action="edit-product" data-id="${p.id}" class="mini-button">Edit</button><button data-action="delete-product" data-id="${p.id}" class="mini-button danger">Delete</button></td></tr>`).join('')}</tbody></table></div>` : empty('No products found','Add a product with dimensions and costs to begin.',button('＋ Add product','add-product'))}</section>`;
}

function renderPackaging(): string {
  const productOptions = data.products.map(p => ({ value: p.id, label: `${p.name} · ${number(p.actualWeightG,0)}g` }));
  const configOptions = data.packaging.map(p => ({ value: p.id, label: p.name }));
  const courierOptions = data.couriers.map(c => ({ value: c.id, label: `${c.name} · ${c.divisor.toLocaleString('en-IN')}` }));
  return `${pageHeading('PACKAGING LAB', 'Build a safer, leaner parcel.', 'Model single-box or nested packaging. Freight volume always uses the final outer carton only.', button('＋ New packaging recipe','add-packaging'))}
    <section class="panel calculator-panel"><div class="panel-heading"><div><span class="eyebrow">LIVE CALCULATOR</span><h2>Packaging & chargeable weight</h2><p class="muted small">Enter a product, recipe and courier rule to see the calculation.</p></div><span class="calc-symbol">⌗</span></div>
      ${data.products.length && data.packaging.length && data.couriers.length ? `<form id="pack-calc-form" class="form-grid compact-grid"><label>Product<select name="productId" required>${selectOptions(productOptions)}</select></label><label>Packaging recipe<select name="packagingId" required>${selectOptions(configOptions)}</select></label><label>Courier rule<select name="courierId" required>${selectOptions(courierOptions)}</select></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required></label><div class="form-actions full-span"><button class="btn primary" type="submit">Calculate package ↗</button></div></form><div id="pack-calc-output" class="calc-output ${packagingOutput ? 'show' : ''}">${packagingOutput}</div>` : empty('Add your first product, recipe and courier','The calculator uses your saved catalogue, packaging recipes and courier rules.')}
    </section>
    <section class="panel"><div class="panel-heading"><div><span class="eyebrow">SAVED RECIPES</span><h2>Packaging configurations</h2></div><span class="muted small">${data.packaging.length} recipes</span></div>
      ${data.packaging.length ? `<div class="recipe-grid">${data.packaging.map(p => `<article class="recipe-card"><div class="recipe-card-top"><span class="recipe-icon">${p.mode === 'dual' ? '▣' : '□'}</span>${isSample(p)}</div><h3>${esc(p.name)}</h3><p>${p.mode === 'dual' ? 'Dual-box · inner + outer protection' : 'Single outer carton'}</p><div class="recipe-dims">Outer carton <strong>${number(p.outerLengthCm)} × ${number(p.outerWidthCm)} × ${number(p.outerHeightCm)} cm</strong></div><div class="recipe-cost">${money(p.innerWrapCost+p.cushioningCost+p.protectiveWrapCost+p.otherCost)} <small>materials / parcel</small></div><div class="recipe-actions"><button class="btn secondary small-btn" data-action="edit-packaging" data-id="${p.id}">Edit recipe</button><button class="mini-button danger" data-action="delete-packaging" data-id="${p.id}">Delete</button></div></article>`).join('')}</div>` : empty('No packaging recipes yet','Create your first recipe with inner and outer box dimensions.',button('＋ Create recipe','add-packaging'))}
    </section>`;
}

function renderRoiSimulator(): string {
  const productOptions = data.products.map(p => ({ value: p.id, label: `${p.name} · ${number(p.actualWeightG, 0)} g` }));
  const courierOptions = data.couriers.map(c => ({ value: c.id, label: `${c.name} · D${c.divisor.toLocaleString('en-IN')}` }));
  const riskFields = data.packaging.map((recipe, index) => {
    const evidence = getPackagingEvidence(data.shipments, recipe.id);
    const hasEvidence = evidence.observedCount >= 10;
    const observedRate = evidence.damageRatePercent;
    return `<label class="roi-risk-control"><span><strong>${esc(recipe.name)}</strong><small>${evidence.observedCount} real resolved observations · ${hasEvidence ? 'observed rate' : 'scenario assumption required'}</small></span><span class="roi-risk-input"><input name="risk${index}" type="number" min="0" max="99.9" step="0.1" ${hasEvidence ? `value="${number(observedRate, 1)}" readonly` : 'required placeholder="e.g. 5"'}><small>%</small></span>${hasEvidence ? badge('Observed', 'good') : badge('Assumed', 'neutral')}</label>`;
  }).join('');
  const ratesConfigured = data.couriers.some(c => c.baseRate != null && c.perKgRate != null);
  return `${pageHeading('DECISION SUPPORT · SCENARIO MODEL', 'Packaging ROI simulator', 'Compare the modelled cost of getting one product safely delivered using each saved packaging recipe.', '')}
    <div class="notice"><span class="notice-icon">◎</span><div><strong>This is a planning simulator, not a prediction.</strong><p>When a recipe has at least 10 real, non-sample resolved shipment observations, its observed damage rate is used. Otherwise, enter an explicit scenario assumption. The simulator does not invent delivery results.</p></div></div>
    ${data.products.length && data.packaging.length && data.couriers.length ? `<section class="panel roi-panel"><div class="panel-heading"><div><span class="eyebrow">DEFINE YOUR DELIVERY SCENARIO</span><h2>Compare packaging recipes</h2><p class="muted small">One selected product per parcel. All costs are per parcel and use the workspace currency.</p></div><span class="calc-symbol">◎</span></div>
      <form id="roi-form" class="form-grid"><label>Product<select name="productId" required>${selectOptions(productOptions)}</select></label><label>Courier rule<select name="courierId" required>${selectOptions(courierOptions)}</select></label><label>Units in each parcel<input name="quantity" type="number" min="1" step="1" value="1" required></label><label>Additional cost of one damage incident<input name="incidentCost" type="number" min="0" step="0.01" required placeholder="Enter replacement / reship cost"><small>Enter the additional cost for this whole parcel if damaged. Do not include normal packaging or freight again.</small></label><label class="full-span">Manual shipping estimate per parcel<input name="manualShipping" type="number" min="0" step="0.01" placeholder="Required only if courier rates are not configured"><small>${ratesConfigured ? 'A selected courier with configured base and per-kg rates will be used automatically; otherwise this manual estimate is used.' : 'No courier rates are configured yet. Enter your own estimated freight charge for a meaningful comparison.'}</small></label>
      <div class="form-section full-span"><strong>Damage-rate inputs for each packaging recipe</strong><small>Recipes with 10 or more real, non-sample resolved records use their observed rate. Other recipes need a scenario assumption. Sample assumptions are not real results.</small></div>
      <div class="roi-risk-list full-span">${riskFields}</div>
      <div class="form-actions full-span roi-actions"><button class="btn secondary" type="button" data-action="roi-demo">Load illustrative demo assumptions</button><button class="btn primary" type="submit">Compare delivered cost ↗</button></div></form><div id="roi-output" class="roi-output"></div></section>` : empty('Add a product, packaging recipe and courier rule', 'The ROI simulator compares your saved catalogue and packaging recipes.')}
    <section class="panel roi-method"><div class="panel-heading"><div><span class="eyebrow">HOW THE MODEL WORKS</span><h2>Cost per successful delivery</h2></div></div><p>For each recipe, FragileFit adds packaging cost, courier cost and the expected damage-incident cost. It then adjusts for the assumed or observed chance that a parcel does not arrive successfully.</p><div class="formula-strip"><code>(Packaging + Freight + Damage probability × Incident cost) ÷ (1 − Damage probability)</code></div><p class="muted small">This simplified model assumes a damaged parcel is an unsuccessful delivery and that the incident cost is an additional cost. It does not include every possible business, customer-service, tax or return scenario. Validate assumptions with real records and packing trials.</p></section>`;
}

function orderLineSummary(order: Order): string {
  return order.items.map(line => `${line.quantity} × ${esc(line.productName)}`).join('<br>');
}
function renderOrders(): string {
  const rows = data.orders.map(order => {
    const shipments = data.shipments.filter(s => s.orderId === order.id);
    const f = calculateOrderFinancials(order, shipments);
    return `<tr><td><strong>${esc(order.orderNumber)}</strong>${isSample(order)}<small class="cell-sub">${esc(order.date)}</small></td><td>${orderLineSummary(order)}</td><td>${order.items.reduce((a,b)=>a+b.quantity,0)}</td><td>${money(f.grossRevenue)}</td><td>${money(f.packagingCost+f.shippingCost)}</td><td><strong class="${f.operatingProfit >= 0 ? 'positive' : 'negative'}">${money(f.operatingProfit)}</strong><small class="cell-sub">${number(f.marginPercent,1)}% margin</small></td><td>${badge(f.provisional ? 'Provisional' : 'Finalized', f.provisional ? 'warning' : 'good')}<small class="cell-sub">${esc(order.status)}</small></td><td class="row-actions"><button class="mini-button" data-action="view-order" data-id="${order.id}">Details</button><button class="mini-button" data-action="edit-order" data-id="${order.id}">Edit</button><button class="mini-button danger" data-action="delete-order" data-id="${order.id}">Delete</button></td></tr>`;
  }).join('');
  return `${pageHeading('ORDER ECONOMICS', 'Orders ledger', 'Multi-line order accounting with shipment actuals replacing estimates when dispatches are linked.', button('＋ Create order','add-order'))}
    <div class="notice"><span class="notice-icon">i</span><div><strong>How fulfilment costs are allocated</strong><p>Before the first linked shipment, order estimates are used. Once shipments exist, their packaging and shipping actuals are used instead—never both. Profit remains marked provisional until the order and actual expenses are complete.</p></div></div>
    <section class="panel">${rows ? `<div class="table-wrap"><table><thead><tr><th>ORDER</th><th>LINE ITEMS</th><th>QTY</th><th>GROSS</th><th>FULFILMENT</th><th>OPERATING PROFIT</th><th>STATUS</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No orders yet','Create an order with one or more product line items.',button('＋ Create order','add-order'))}</section>`;
}

function renderShipments(): string {
  const rows = [...data.shipments].sort((a,b)=>b.dispatchDate.localeCompare(a.dispatchDate)).map(s => {
    const linkedOrder = data.orders.find(o => o.id === s.orderId);
    return `<tr><td><strong>${esc(s.trackingRef)}</strong>${isSample(s)}<small class="cell-sub">${linkedOrder ? esc(linkedOrder.orderNumber) : 'Standalone dispatch'}</small></td><td>${esc(s.courierName)}<small class="cell-sub">${esc(s.mode)} · D${s.divisor}</small></td><td>${esc(s.lines.map(l=>`${l.quantity}× ${l.productName}`).join(', ')) || '—'}</td><td>${esc(s.dispatchDate || '—')}</td><td>${outcomeBadge(s.outcome)}${s.damageCategory ? `<small class="cell-sub">${esc(s.damageCategory)}</small>` : ''}</td><td>${s.actualPackagingCost == null ? '—' : money(s.actualPackagingCost)}</td><td>${s.actualShippingCost == null ? '—' : money(s.actualShippingCost)}</td><td class="row-actions"><button class="mini-button" data-action="edit-shipment" data-id="${s.id}">Edit</button><button class="mini-button danger" data-action="delete-shipment" data-id="${s.id}">Delete</button></td></tr>`;
  }).join('');
  return `${pageHeading('FULFILMENT & DAMAGE', 'Shipment register', 'Track each parcel independently, including split dispatches, damage, refunds and claim recovery.', button('＋ Record shipment','add-shipment'))}
    <section class="metric-grid three-metrics">${metric('TOTAL PARCELS',String(data.shipments.length),'All linked and standalone dispatches','⇢')}${metric('DAMAGE INCIDENTS',String(data.shipments.filter(s=>s.outcome==='Damaged'||s.outcome==='Replaced').length),'Recorded damaged or replaced parcels','!','metric-warning')}${metric('CLAIMS REIMBURSED',money(data.shipments.reduce((s,x)=>s+x.claimReimbursement,0)),'Recorded courier recovery','₹','metric-profit')}</section>
    <section class="panel">${rows ? `<div class="table-wrap"><table><thead><tr><th>TRACKING</th><th>COURIER</th><th>CONTENTS</th><th>DISPATCH</th><th>OUTCOME</th><th>PACKAGING</th><th>SHIPPING</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No shipments recorded','Record a parcel, link it to an order, and enter actual expenses when known.',button('＋ Record shipment','add-shipment'))}</section>`;
}

function renderIntelligence(): string {
  const configs = data.packaging.map(config => {
    const allRecipeShipments = data.shipments.filter(s => s.packagingConfigId === config.id);
    const shipments = allRecipeShipments.filter(s => !s.isSample);
    const observed = shipments.filter(s => ['Delivered safely','Damaged','Replaced'].includes(s.outcome));
    const incidents = observed.filter(s => s.outcome === 'Damaged' || s.outcome === 'Replaced').length;
    const freight = shipments.reduce((sum,s)=>sum+(s.actualShippingCost??0),0);
    const pack = shipments.reduce((sum,s)=>sum+(s.actualPackagingCost??0),0);
    const loss = shipments.reduce((sum,s)=>sum+s.damageLoss+s.replacementCost+s.refundAmount,0);
    return { config, shipments, sampleCount: allRecipeShipments.length - shipments.length, observed, incidents, rate: observed.length ? incidents/observed.length*100 : 0, averageCost: shipments.length ? (freight+pack)/shipments.length : 0, loss };
  });
  return `${pageHeading('RULE-BASED ANALYSIS', 'Packaging intelligence', 'Evidence-led comparisons from your own shipment records. Small samples are never presented as reliable rankings.', '')}
    <div class="notice"><span class="notice-icon">⌁</span><div><strong>How recommendations work</strong><p>FragileFit does not call a paid AI API or invent test results. It compares recorded shipment outcomes, packaging costs and courier charges. Sample shipments are excluded. Comparisons with fewer than 10 real resolved observations are labelled insufficient data.</p></div></div>
    <section class="recipe-grid intelligence-grid">${configs.map(item => `<article class="panel insight-card"><div class="insight-head"><span class="recipe-icon">◇</span>${isSample(item.config)}</div><h3>${esc(item.config.name)}</h3><div class="insight-metrics"><div><small>OBSERVED PARCELS</small><strong>${item.observed.length}</strong></div><div><small>DAMAGE RATE</small><strong>${item.observed.length >= 10 ? `${number(item.rate,1)}%` : '—'}</strong></div><div><small>AVG. PACK + FREIGHT</small><strong>${item.shipments.length ? money(item.averageCost) : '—'}</strong></div></div><div class="insight-foot">${item.observed.length >= 10 ? badge(`${number(item.rate,1)}% observed damage rate`, item.rate > 0 ? 'warning' : 'good') : badge('Insufficient data · need 10 observations','neutral')}<span class="muted small">${item.incidents} incidents · ${money(item.loss)} recorded loss · ${item.sampleCount} demo records excluded</span></div></article>`).join('') || empty('No packaging recipes','Add packaging configurations and link them to shipments.')}</section>
    <section class="panel"><div class="panel-heading"><div><span class="eyebrow">CURRENT GUIDANCE</span><h2>What the records can support</h2></div></div><div class="guidance-list">${configs.map(item => `<div class="guidance-row"><span class="guidance-icon">${item.observed.length >= 10 ? '✓' : 'i'}</span><div><strong>${esc(item.config.name)}</strong><p>${item.observed.length >= 10 ? `Observed ${number(item.rate,1)}% damage across ${item.observed.length} delivered or damaged parcels. Treat this as historical evidence, not a guaranteed future outcome.` : `Only ${item.observed.length} resolved observations are available. Collect at least 10 resolved shipments before comparing damage rates.`}</p></div></div>`).join('') || '<p class="muted">No shipment evidence is available yet.</p>'}</div></section>`;
}

function renderReports(): string {
  return `${pageHeading('REPORTS & DATA CONTROL', 'Records you can take with you.', 'Export reports, protect a full local backup, or verify critical calculation routines.', button('↓ Export JSON','export-plain'))}
    <section class="report-grid">
      <article class="panel report-card"><span class="report-icon">⇩</span><h2>Business data export</h2><p>Export products, recipes, orders, shipments, courier rules and settings as CSV or plain JSON.</p><div class="report-actions"><button class="btn primary" data-action="export-plain">Export JSON backup</button><button class="btn secondary" data-action="export-csv">Export CSV files</button></div></article>
      <article class="panel report-card"><span class="report-icon">⌑</span><h2>Encrypted backup</h2><p>Create a password-protected AES-256-GCM backup using PBKDF2-SHA-256. Keep the password safe; it cannot be recovered for you.</p><div class="report-actions"><button class="btn primary" data-action="encrypted-backup">Create encrypted backup</button><button class="btn secondary" data-action="import-backup">Restore backup</button></div><small class="muted">Plain JSON and encrypted backups are clearly different file formats.</small></article>
      <article class="panel report-card"><span class="report-icon">✓</span><h2>Calculation test suite</h2><p>Run checks for outer-carton volumetric weight, dual-box tare weight, multi-line order economics, shipment rollups and rounding.</p><button class="btn secondary" data-action="run-tests">Run critical tests</button><div id="test-output" class="test-output"></div></article>
      <article class="panel report-card"><span class="report-icon">▤</span><h2>Printable summary</h2><p>Open a print-friendly view of current product, order and shipment metrics. Save it as a PDF through your browser.</p><button class="btn secondary" data-action="print-report">Print business summary</button></article>
    </section>
    <input type="file" id="backup-file" accept=".json,.enc,.fragilefit.enc,application/json" hidden>`;
}

function renderSettings(): string {
  const rows = data.couriers.map(c => `<div class="courier-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.mode)} · divisor ${c.divisor.toLocaleString('en-IN')} · rounding ${c.rounding}${c.isPreset ? ' · preset' : ''}</small></div><div class="courier-rates">${c.baseRate == null || c.perKgRate == null ? '<span class="muted">Rates not configured</span>' : `${money(c.baseRate)} base + ${money(c.perKgRate)}/kg`}</div><div class="row-actions"><button class="mini-button" data-action="edit-courier" data-id="${c.id}">Edit</button>${!c.isPreset ? `<button class="mini-button danger" data-action="delete-courier" data-id="${c.id}">Delete</button>` : ''}</div></div>`).join('');
  return `${pageHeading('PREFERENCES', 'Workspace settings', 'Manage your business profile, currency, and editable courier calculation rules.', '')}
    <section class="settings-grid"><article class="panel settings-panel"><div class="panel-heading"><div><span class="eyebrow">BUSINESS PROFILE</span><h2>Your workspace</h2></div></div>
      <form id="settings-form" class="form-grid"><label class="full-span">Business name<input name="businessName" value="${esc(data.settings.businessName)}" placeholder="e.g. Clay Studio"></label><label>Currency<select name="currency">${selectOptions([{value:'INR',label:'INR · Indian Rupee (₹)'},{value:'USD',label:'USD · US Dollar ($)'},{value:'EUR',label:'EUR · Euro (€)'},{value:'GBP',label:'GBP · Pound (£)'}],data.settings.currency)}</select></label><label>Measurement system<input value="Metric · cm / g / kg" disabled></label><div class="form-actions full-span"><button class="btn primary" type="submit">Save settings</button></div></form>
    </article><article class="panel settings-panel"><div class="panel-heading"><div><span class="eyebrow">LOCAL PRIVACY</span><h2>Data on this device</h2></div><span class="privacy-mark">●</span></div><p class="muted">Products, orders, packaging recipes, shipment details and settings are saved in this browser's IndexedDB database. FragileFit does not connect to a bank or send business records to a server.</p><div class="privacy-facts"><div><span>Storage</span><strong>Browser IndexedDB</strong></div><div><span>Network dependency</span><strong>Not required for core tools</strong></div><div><span>Cloud sync</span><strong>Not included in this release</strong></div></div></article><article class="panel settings-panel"><div class="panel-heading"><div><span class="eyebrow">LOCAL DATA PROTECTION</span><h2>Browser storage protection</h2></div><span class="privacy-mark">●</span></div><p class="muted">FragileFit can ask your browser to protect this site's saved data from automatic storage cleanup. This does not prevent you or someone using your device from clearing site data.</p><div class="privacy-facts"><div><span>Protection status</span><strong>${!storageProtection.supported ? 'Not supported here' : storageProtection.persistent === true ? 'Persistent storage granted' : storageProtection.persistent === false ? 'Standard browser storage' : 'Status unavailable'}</strong></div><div><span>Data location</span><strong>This browser and device</strong></div></div>${storageProtection.supported && storageProtection.persistent !== true ? button('Request persistent storage protection','request-storage-protection','secondary') : ''}<p class="muted small">${storageProtection.persistent === true ? 'The browser granted persistent storage. Manual site-data deletion and device loss can still remove local records.' : 'Until protection is granted, the browser may clear local data when it needs storage space. Keep independent backup copies.'}</p></article></section>
    <section class="panel courier-panel"><div class="panel-heading"><div><span class="eyebrow">COURIER RULE ENGINE</span><h2>Courier presets & rates</h2><p class="muted small">Divisors are editable reference presets, not universal courier rules. Enter rates from your own courier agreement.</p></div>${button('＋ Add courier','add-courier')}</div><div class="courier-list">${rows}</div></section>
    <section class="panel data-management"><div class="panel-heading"><div><span class="eyebrow">DEMO & WORKSPACE CONTROL</span><h2>Reset or clear data</h2><p class="muted small">These actions change the records stored on this device.</p></div></div><div class="danger-actions"><div><strong>Reset sample data</strong><p>Remove the current sample records and load the labelled demo dataset again. Your non-sample records are preserved.</p></div><button class="btn secondary" data-action="reset-samples">Reset samples</button></div><div class="danger-actions"><div><strong>Clear all business records</strong><p>Delete products, recipes, orders and shipments from this browser. Courier presets remain.</p></div><button class="btn danger-button" data-action="clear-workspace">Clear workspace</button></div></section>`;
}

function renderDataSafety(): string {
  const driveStatus = getGoogleDrivePreparationStatus();
  const protectionLabel = !storageProtection.supported
    ? 'Not supported by this browser'
    : storageProtection.persistent === true
      ? 'Persistent storage granted'
      : storageProtection.persistent === false
        ? 'Standard browser storage'
        : 'Status unavailable';
  const driveState = !driveStatus.configured
    ? 'OAuth client ID required'
    : driveStatus.connected
      ? 'Connected for this browser session'
      : driveStatus.libraryReady
        ? 'Ready to connect'
        : 'Authorization library loading';
  const driveControls = !driveStatus.configured
    ? '<div class="notice drive-notice"><span class="notice-icon">i</span><div><strong>One setup item remains.</strong><p>The public Google OAuth client ID must be configured in the FragileFit source before Google sign-in can be enabled. No access token or client secret belongs in the repository.</p></div></div>' + button('View setup requirements','drive-setup-details','secondary')
    : !driveStatus.libraryReady
      ? '<p class="muted small">Loading Google authorization. Check your internet connection, then reload this page if the status does not change.</p>'
      : driveStatus.connected
        ? '<div class="drive-status-controls">' + button('Back up now','drive-backup') + button('Refresh backup list','drive-refresh','secondary') + button('Disconnect Google Drive','drive-disconnect','secondary') + '</div>'
        : button('Connect Google Drive','drive-connect');
  const backupList = !driveStatus.connected
    ? '<p class="muted small">Connect Google Drive to view encrypted backup versions in your account.</p>'
    : googleDriveBackups.length
      ? '<div class="drive-backup-list">' + googleDriveBackups.map(file => {
          const when = file.createdTime ? new Date(file.createdTime).toLocaleString('en-IN') : 'Date unavailable';
          const size = file.size ? (Number(file.size) / 1024).toFixed(1) + ' KB' : 'Size unavailable';
          return '<div class="drive-backup-row"><div><strong>' + esc(when) + '</strong><small>' + esc(file.name) + ' · ' + esc(size) + '</small></div><button class="btn secondary" data-action="drive-restore" data-id="' + esc(file.id) + '">Restore</button></div>';
        }).join('') + '</div>'
      : '<p class="muted small">No FragileFit backups were found in your Drive folder yet. Choose Back up now to create the first version.</p>';

  return `${pageHeading('DATA SAFETY', 'Keep your business records safe.', 'Understand where your records live, what can remove them, and how to make a recoverable backup.', '')}
    <section class="safety-alert" role="note"><span class="safety-alert-icon" aria-hidden="true">!</span><div><strong>Your FragileFit workspace is local to this browser on this device.</strong><p>At present, opening FragileFit on another phone or computer does not bring these records with you. Each device and browser profile has its own separate workspace.</p></div></section>
    <section class="safety-grid">
      <article class="panel safety-card"><span class="safety-card-icon">▣</span><span class="eyebrow">WHERE YOUR DATA LIVES</span><h2>This browser and device</h2><p>Products, packaging recipes, orders, shipments, courier rules and settings are stored in this browser's IndexedDB database. Core workspace records are not currently synchronised to an online account.</p><div class="safety-fact"><span>Storage type</span><strong>Browser IndexedDB</strong></div><div class="safety-fact"><span>Protection status</span><strong>${esc(protectionLabel)}</strong></div>${storageProtection.supported && storageProtection.persistent !== true ? button('Request persistent storage protection','request-storage-protection','secondary') : ''}</article>
      <article class="panel safety-card safety-card-warning"><span class="safety-card-icon">⌁</span><span class="eyebrow">DEVICE &amp; BROWSER LIMITS</span><h2>What can make records unavailable?</h2><ul><li>Clearing this site's browser data or storage.</li><li>Resetting or losing the browser profile.</li><li>Uninstalling or resetting the browser, depending on its data settings.</li><li>Losing, damaging or replacing the device without a separate backup.</li></ul><p class="safety-small">Persistent storage can reduce automatic browser cleanup, but it cannot prevent manual deletion, device failure or loss. FragileFit cannot intercept the browser's own Clear browsing data controls, so keep an independent backup.</p></article>
      <article class="panel safety-card"><span class="safety-card-icon">⇧</span><span class="eyebrow">BACKUP &amp; RECOVERY</span><h2>Make an independent copy</h2><p>Encrypted backups protect your exported workspace with a password. Keep the backup file and its password somewhere safe and separate from this device.</p><div class="safety-actions">${button('Create encrypted backup','encrypted-backup')}${button('Restore a backup','import-backup','secondary')}${button('Export plain JSON','export-plain','secondary')}</div><p class="safety-small">Restoring replaces the current workspace on this device. It does not merge records.</p></article>
      <article class="panel safety-card"><span class="safety-card-icon">▧</span><span class="eyebrow">ANOTHER DEVICE</span><h2>Backup and restore, not live sync</h2><p>To move your records to another device, create a backup here or in Google Drive and restore it there. Changes made on one device will not appear automatically on another.</p><div class="safety-fact"><span>Automatic cross-device sync</span><strong>Not available</strong></div><div class="safety-fact"><span>Manual backup and restore</span><strong>Available</strong></div></article>
    </section>
    <section class="panel drive-preparation">
      <div class="drive-preparation-head"><div><span class="eyebrow">ENCRYPTED CLOUD BACKUP</span><h2>Google Drive backup</h2><p class="muted">Backup copies are stored in the seller's own Google Drive account.</p></div><span class="drive-status-pill">${driveStatus.connected ? 'Connected' : driveStatus.configured ? 'Not connected' : 'Setup required'}</span></div>
      <div class="drive-preparation-grid"><div><strong>Drive folder</strong><span>${esc(GOOGLE_DRIVE_BACKUP_FOLDER_NAME)}</span></div><div><strong>Backup encryption</strong><span>AES-256-GCM before upload</span></div><div><strong>Permission requested</strong><span>drive.file only</span></div><div><strong>Connection status</strong><span>${esc(driveState)}</span></div></div>
      <p>Each backup is a new, timestamped encrypted file. FragileFit uploads the encrypted container only; the password and readable workspace data are not sent to Drive. You can list saved versions and restore a selected one on another device.</p>
      <div class="drive-scope-note"><span>Google permission</span><code>${esc(GOOGLE_DRIVE_BACKUP_SCOPE)}</code></div>
      ${driveControls}
      <div class="drive-backups-heading"><strong>Saved backup versions</strong><span>${googleDriveBackups.length} listed</span></div>
      ${backupList}
      <p class="safety-small">The Google access token stays in memory and expires. Reconnect after reloading or when Google authorization expires. Drive backup is manual in this release; no automatic schedule or live sync is enabled.</p>
    </section>`;
}

function renderView(): string {
  switch (activeView) {
    case 'products': return renderProducts();
    case 'packaging': return renderPackaging();
    case 'roi': return renderRoiSimulator();
    case 'orders': return renderOrders();
    case 'shipments': return renderShipments();
    case 'intelligence': return renderIntelligence();
    case 'reports': return renderReports();
    case 'settings': return renderSettings();
    case 'data-safety': return renderDataSafety();
    default: return renderDashboard();
  }
}

function render(): void { root!.innerHTML = appShell(); }

function openDialog(title: string, body: string, onSave: (form: FormData, dialog: HTMLDialogElement) => Promise<void> | void, submitLabel = 'Save changes'): void {
  document.querySelector('dialog#editor-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'editor-dialog';
  dialog.className = 'editor-dialog';
  dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">FRAGILEFIT WORKSPACE</span><h2>${esc(title)}</h2></div><button type="button" class="dialog-close" aria-label="Close dialog" data-dialog-close>×</button></div><form id="editor-form"><div class="dialog-body">${body}</div><div class="dialog-actions"><button type="button" class="btn secondary" data-dialog-close>Cancel</button><button type="submit" class="btn primary">${submitLabel}</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-dialog-close]').forEach(el => el.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelector<HTMLFormElement>('#editor-form')!.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try { await onSave(form, dialog); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
  });
  dialog.showModal();
}

function field(label: string, name: string, val: unknown = '', type = 'text', opts = ''): string {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(val)}" ${opts}></label>`;
}
function textArea(label: string, name: string, val = ''): string { return `<label class="full-span">${label}<textarea name="${name}" rows="2">${esc(val)}</textarea></label>`; }
function selectField(label: string, name: string, options: Array<{value:string;label:string}>, selected = ''): string { return `<label>${label}<select name="${name}">${selectOptions(options, selected)}</select></label>`; }
function formSection(title: string, detail = ''): string { return `<div class="form-section full-span"><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ''}</div>`; }

async function saveAndRefresh(message: string): Promise<void> { data = await getAllData(); packagingOutput = ''; render(); notify(message); }

function productDialog(existing?: Product): void {
  const p = existing;
  const body = `<div class="form-grid">${formSection('Product identity','Name and SKU help you identify each item.')}${field('Product name','name',p?.name ?? '', 'text','required')}${field('SKU / reference','sku',p?.sku ?? '')}${selectField('Category','category',[...['Terracotta','Ceramic','Glassware','Candle','Handicraft','Home decor','Other'].map(x=>({value:x,label:x}))],p?.category ?? 'Terracotta')}${formSection('Physical dimensions','Use centimetres and grams throughout the first release.')}${field('Length (cm)','lengthCm',p?.lengthCm ?? 0,'number','min="0" step="0.1" required')}${field('Width (cm)','widthCm',p?.widthCm ?? 0,'number','min="0" step="0.1" required')}${field('Height (cm)','heightCm',p?.heightCm ?? 0,'number','min="0" step="0.1" required')}${field('Actual weight (g)','actualWeightG',p?.actualWeightG ?? 0,'number','min="0" step="1" required')}${formSection('Unit economics','Enter your own amounts; these are not courier or marketplace defaults.')}${field('Production cost / unit','productionCost',p?.productionCost ?? 0,'number','min="0" step="0.01" required')}${field('Selling price / unit','sellingPrice',p?.sellingPrice ?? 0,'number','min="0" step="0.01" required')}${selectField('Preferred packaging','preferredPackagingId',[{value:'',label:'No preference'},...data.packaging.map(x=>({value:x.id,label:x.name}))],p?.preferredPackagingId ?? '')}${textArea('Notes','notes',p?.notes ?? '')}</div>`;
  openDialog(p ? 'Edit product' : 'Add a product', body, async (form, dialog) => {
    const name = value(form,'name'); if (!name) throw new Error('Product name is required.');
    if(num(form,'lengthCm')<=0||num(form,'widthCm')<=0||num(form,'heightCm')<=0||num(form,'actualWeightG')<=0) throw new Error('Product dimensions and actual weight must all be greater than zero.');
    if(num(form,'productionCost')<0||num(form,'sellingPrice')<0) throw new Error('Product costs and selling price cannot be negative.');
    const product: Product = { id: p?.id ?? id(), name, sku: value(form,'sku'), category: value(form,'category') as Category,
      lengthCm:num(form,'lengthCm'), widthCm:num(form,'widthCm'), heightCm:num(form,'heightCm'), actualWeightG:num(form,'actualWeightG'),
      productionCost:num(form,'productionCost'), sellingPrice:num(form,'sellingPrice'), preferredPackagingId:value(form,'preferredPackagingId') || undefined,
      notes:value(form,'notes'), isSample: p?.isSample ?? false, createdAt:p?.createdAt ?? new Date().toISOString() };
    await saveEntity('products',product); dialog.close(); await saveAndRefresh(p?'Product updated.':'Product added.');
  });
}

function packagingDialog(existing?: PackagingConfig): void {
  const p = existing;
  const body = `<div class="form-grid">${formSection('Recipe details')}${field('Recipe name','name',p?.name ?? '', 'text','required')}${selectField('Packaging type','mode',[{value:'single',label:'Single outer carton'},{value:'dual',label:'Dual box · inner + outer'}],p?.mode ?? 'single')}${formSection('Inner product box','Required for dual-box recipes. Its volume is not added to outer carton volume.')}${field('Inner length (cm)','innerLengthCm',p?.innerLengthCm ?? 0,'number','min="0" step="0.1"')}${field('Inner width (cm)','innerWidthCm',p?.innerWidthCm ?? 0,'number','min="0" step="0.1"')}${field('Inner height (cm)','innerHeightCm',p?.innerHeightCm ?? 0,'number','min="0" step="0.1"')}${field('Inner box weight (g)','innerBoxWeightG',p?.innerBoxWeightG ?? 0,'number','min="0" step="1"')}${formSection('Final outer shipping carton','Courier volumetric weight uses only these external dimensions.')}${field('Outer length (cm)','outerLengthCm',p?.outerLengthCm ?? 0,'number','min="0.1" step="0.1" required')}${field('Outer width (cm)','outerWidthCm',p?.outerWidthCm ?? 0,'number','min="0.1" step="0.1" required')}${field('Outer height (cm)','outerHeightCm',p?.outerHeightCm ?? 0,'number','min="0.1" step="0.1" required')}${field('Outer carton tare weight (g)','outerBoxWeightG',p?.outerBoxWeightG ?? 0,'number','min="0" step="1"')}${formSection('Material weights & costs','Use actual supplier costs where available.')}${field('Inner wrap weight (g)','innerWrapWeightG',p?.innerWrapWeightG ?? 0,'number','min="0" step="1"')}${field('Cushioning weight (g)','cushioningWeightG',p?.cushioningWeightG ?? 0,'number','min="0" step="1"')}${field('Inner wrap cost','innerWrapCost',p?.innerWrapCost ?? 0,'number','min="0" step="0.01"')}${field('Cushioning cost','cushioningCost',p?.cushioningCost ?? 0,'number','min="0" step="0.01"')}${field('Protective wrap cost','protectiveWrapCost',p?.protectiveWrapCost ?? 0,'number','min="0" step="0.01"')}${field('Other packaging cost','otherCost',p?.otherCost ?? 0,'number','min="0" step="0.01"')}${textArea('Notes','notes',p?.notes ?? '')}</div>`;
  openDialog(p?'Edit packaging recipe':'Create packaging recipe',body,async(form,dialog)=>{
    const name=value(form,'name'); if(!name) throw new Error('Recipe name is required.');
    const recipe: PackagingConfig={id:p?.id??id(),name,mode:value(form,'mode') as 'single'|'dual',innerLengthCm:num(form,'innerLengthCm'),innerWidthCm:num(form,'innerWidthCm'),innerHeightCm:num(form,'innerHeightCm'),innerBoxWeightG:num(form,'innerBoxWeightG'),outerLengthCm:num(form,'outerLengthCm'),outerWidthCm:num(form,'outerWidthCm'),outerHeightCm:num(form,'outerHeightCm'),outerBoxWeightG:num(form,'outerBoxWeightG'),innerWrapWeightG:num(form,'innerWrapWeightG'),cushioningWeightG:num(form,'cushioningWeightG'),innerWrapCost:num(form,'innerWrapCost'),cushioningCost:num(form,'cushioningCost'),protectiveWrapCost:num(form,'protectiveWrapCost'),otherCost:num(form,'otherCost'),notes:value(form,'notes'),isSample:p?.isSample??false,createdAt:p?.createdAt??new Date().toISOString()};
    if(recipe.outerLengthCm<=0||recipe.outerWidthCm<=0||recipe.outerHeightCm<=0) throw new Error('Outer carton dimensions must be greater than zero.');
    if(recipe.mode==='dual'&&(recipe.innerLengthCm<=0||recipe.innerWidthCm<=0||recipe.innerHeightCm<=0)) throw new Error('Dual-box recipes need positive inner box dimensions.');
    if([recipe.innerBoxWeightG,recipe.outerBoxWeightG,recipe.innerWrapWeightG,recipe.cushioningWeightG,recipe.innerWrapCost,recipe.cushioningCost,recipe.protectiveWrapCost,recipe.otherCost].some(x=>x<0)) throw new Error('Packaging weights and expenses cannot be negative.');
    await saveEntity('packaging',recipe);dialog.close();await saveAndRefresh(p?'Packaging recipe updated.':'Packaging recipe created.');
  });
}

function lineItemRow(line?: OrderLine): string {
  const selected = line?.productId ?? data.products[0]?.id ?? '';
  return `<div class="line-item-row"><label class="line-product">Product<select name="lineProduct" required>${selectOptions(data.products.map(p=>({value:p.id,label:p.name})),selected)}</select></label><label>Qty<input name="lineQuantity" type="number" min="1" step="1" value="${line?.quantity ?? 1}" required></label><label>Sell / unit<input name="linePrice" type="number" min="0" step="0.01" value="${line?.unitSellingPrice ?? data.products.find(p=>p.id===selected)?.sellingPrice ?? 0}" required></label><button type="button" class="mini-button danger remove-line" title="Remove line">×</button></div>`;
}
function orderDialog(existing?: Order): void {
  if(!data.products.length){notify('Add at least one product before creating an order.','error');return;}
  const o=existing;
  const body=`<div class="form-grid">${formSection('Order details')}${field('Order number','orderNumber',o?.orderNumber??`ORD-${new Date().getFullYear()}-${String(data.orders.length+1).padStart(3,'0')}`,'text','required')}${field('Order date','date',o?.date??dateToday(),'date','required')}${selectField('Order status','status',[{value:'Pending',label:'Pending'},{value:'Partially fulfilled',label:'Partially fulfilled'},{value:'Completed',label:'Completed'},{value:'Cancelled',label:'Cancelled'}],o?.status??'Pending')}${formSection('Product line items','One order can contain multiple products and quantities.')}
    <div class="full-span"><div id="order-lines">${(o?.items ?? []).length ? o!.items.map(line=>lineItemRow(line)).join('') : lineItemRow()}</div><button type="button" class="mini-button" id="add-order-line">＋ Add another product</button></div>
    ${formSection('Marketplace & payment fees','Enter the fee rules from your sales platform and payment provider.')}${selectField('Marketplace fee type','marketplaceFeeType',[{value:'percent',label:'Percentage of gross revenue'},{value:'fixed',label:'Fixed amount per order'}],o?.marketplaceFeeType??'percent')}${field('Marketplace fee value','marketplaceFeeValue',o?.marketplaceFeeValue??0,'number','min="0" step="0.01"')}${field('Payment fee (%)','paymentFeePercent',o?.paymentFeePercent??0,'number','min="0" step="0.01"')}${field('Payment fixed fee','paymentFeeFixed',o?.paymentFeeFixed??0,'number','min="0" step="0.01"')}
    ${formSection('Fulfilment estimates','Used only until at least one linked shipment is recorded.')}${field('Estimated packaging total','estimatedPackagingCost',o?.estimatedPackagingCost??0,'number','min="0" step="0.01"')}${field('Estimated shipping total','estimatedShippingCost',o?.estimatedShippingCost??0,'number','min="0" step="0.01"')}${field('Other direct expenses','directExpenses',o?.directExpenses??0,'number','min="0" step="0.01"')}
    ${formSection('Returns, replacements & tax reserve','Actual refunds and costs are tracked separately from the planning reserve.')}${field('Estimated return reserve','returnReserve',o?.returnReserve??0,'number','min="0" step="0.01"')}${field('Actual refunds','actualRefunds',o?.actualRefunds??0,'number','min="0" step="0.01"')}${field('Actual return expenses','actualReturnCosts',o?.actualReturnCosts??0,'number','min="0" step="0.01"')}${field('Replacement costs','replacementCosts',o?.replacementCosts??0,'number','min="0" step="0.01"')}${field('Courier claim reimbursements','claimReimbursements',o?.claimReimbursements??0,'number','min="0" step="0.01"')}${field('Tax reserve (%) · separate','taxReservePercent',o?.taxReservePercent??0,'number','min="0" step="0.01"')}${textArea('Order notes','notes',o?.notes??'')}</div>`;
  openDialog(o?'Edit order':'Create order',body,async(form,dialog)=>{
    const productIds=form.getAll('lineProduct').map(String);const quantities=form.getAll('lineQuantity').map(Number);const prices=form.getAll('linePrice').map(Number);
    const items:OrderLine[]=productIds.map((productId,index)=>{const p=data.products.find(x=>x.id===productId);if(!p)throw new Error('A selected product no longer exists.');const quantity=quantities[index];if(!Number.isInteger(quantity)||quantity<1)throw new Error('Each line quantity must be a positive whole number.');return{id:id(),productId,productName:p.name,quantity,unitProductionCost:p.productionCost,unitSellingPrice:Number.isFinite(prices[index])?prices[index]:p.sellingPrice,unitWeightG:p.actualWeightG};});
    if(!items.length)throw new Error('Add at least one product line.');
    if([num(form,'marketplaceFeeValue'),num(form,'paymentFeePercent'),num(form,'paymentFeeFixed'),num(form,'estimatedPackagingCost'),num(form,'estimatedShippingCost'),num(form,'directExpenses'),num(form,'returnReserve'),num(form,'actualRefunds'),num(form,'actualReturnCosts'),num(form,'replacementCosts'),num(form,'claimReimbursements'),num(form,'taxReservePercent')].some(x=>x<0)) throw new Error('Fees, reserves and order expenses cannot be negative.');
    if(num(form,'paymentFeePercent')>100||num(form,'taxReservePercent')>100||(value(form,'marketplaceFeeType')==='percent'&&num(form,'marketplaceFeeValue')>100)) throw new Error('Percentage values must be between 0 and 100.');
    const order:Order={id:o?.id??id(),orderNumber:value(form,'orderNumber'),date:value(form,'date'),status:value(form,'status') as Order['status'],items,marketplaceFeeType:value(form,'marketplaceFeeType') as 'percent'|'fixed',marketplaceFeeValue:num(form,'marketplaceFeeValue'),paymentFeePercent:num(form,'paymentFeePercent'),paymentFeeFixed:num(form,'paymentFeeFixed'),estimatedPackagingCost:num(form,'estimatedPackagingCost'),estimatedShippingCost:num(form,'estimatedShippingCost'),directExpenses:num(form,'directExpenses'),returnReserve:num(form,'returnReserve'),actualRefunds:num(form,'actualRefunds'),actualReturnCosts:num(form,'actualReturnCosts'),replacementCosts:num(form,'replacementCosts'),claimReimbursements:num(form,'claimReimbursements'),taxReservePercent:num(form,'taxReservePercent'),notes:value(form,'notes'),isSample:o?.isSample??false,createdAt:o?.createdAt??new Date().toISOString()};
    if(data.orders.some(x=>x.id!==order.id&&x.orderNumber.toLowerCase()===order.orderNumber.toLowerCase()))throw new Error('That order number is already in use.');
    await saveEntity('orders',order);dialog.close();await saveAndRefresh(o?'Order updated.':'Order created.');
  });
  const dialog=document.querySelector<HTMLDialogElement>('#editor-dialog');
  dialog?.querySelector('#add-order-line')?.addEventListener('click',()=>{const container=dialog.querySelector<HTMLElement>('#order-lines');if(container)container.insertAdjacentHTML('beforeend',lineItemRow());});
  dialog?.querySelector('#order-lines')?.addEventListener('click',event=>{const target=event.target as HTMLElement;if(target.closest('.remove-line')){const rows=dialog.querySelectorAll('.line-item-row');if(rows.length<=1){notify('An order needs at least one product line.','error');return;}target.closest('.line-item-row')?.remove();}});
  dialog?.querySelector('#order-lines')?.addEventListener('change',event=>{const target=event.target as HTMLSelectElement;if(target.name==='lineProduct'){const row=target.closest('.line-item-row');const product=data.products.find(p=>p.id===target.value);const price=row?.querySelector<HTMLInputElement>('[name="linePrice"]');if(price&&product)price.value=String(product.sellingPrice);}});
}

function shipmentLineRow(line?: ShipmentLine): string {
  const selected=line?.productId??data.products[0]?.id??'';
  return `<div class="line-item-row shipment-line-row"><label class="line-product">Product<select name="shipProduct">${selectOptions(data.products.map(p=>({value:p.id,label:p.name})),selected)}</select></label><label>Qty<input name="shipQuantity" type="number" min="1" step="1" value="${line?.quantity??1}" required></label><button type="button" class="mini-button danger remove-line" title="Remove line">×</button></div>`;
}
function shipmentDialog(existing?: Shipment): void {
  if(!data.products.length){notify('Add a product before recording a shipment.','error');return;}
  const s=existing;
  const couriers=data.couriers.map(c=>({value:c.id,label:`${c.name} · D${c.divisor}`}));
  const orders=[{value:'',label:'Standalone dispatch'},...data.orders.map(o=>({value:o.id,label:o.orderNumber}))];
  const packages=[{value:'',label:'No saved recipe'},...data.packaging.map(p=>({value:p.id,label:p.name}))];
  const body=`<div class="form-grid">${formSection('Dispatch details')}${field('Tracking / parcel reference','trackingRef',s?.trackingRef??`PKG-${Date.now().toString().slice(-6)}`,'text','required')}${selectField('Linked customer order','orderId',orders,s?.orderId??'')}${field('Dispatch date','dispatchDate',s?.dispatchDate??dateToday(),'date','required')}${field('Delivery date','deliveryDate',s?.deliveryDate??'','date')}${selectField('Outcome','outcome',[{value:'Dispatched',label:'Dispatched'},{value:'Delivered safely',label:'Delivered safely'},{value:'Damaged',label:'Damaged'},{value:'Returned',label:'Returned'},{value:'Replaced',label:'Replaced'}],s?.outcome??'Dispatched')}
    ${formSection('Parcel contents','A partial shipment can contain part of an order. Add each product and quantity in this parcel.')}
    <div class="full-span"><div id="shipment-lines">${(s?.lines??[]).length?s!.lines.map(l=>shipmentLineRow(l)).join(''):shipmentLineRow()}</div><button type="button" id="add-shipment-line" class="mini-button">＋ Add product line</button></div>
    ${formSection('Packaging & courier','The selected courier divisor applies to the final outer carton dimensions.')}${selectField('Packaging recipe','packagingConfigId',packages,s?.packagingConfigId??'')}${selectField('Courier rule','courierId',couriers,s?.courierId??data.couriers[0]?.id??'')}
    ${formSection('Actual shipment expenses','Enter only measured actual costs. A recipe estimate is not silently recorded as an actual; linked orders remain provisional until parcel costs are entered.')}${field('Actual shipping cost','actualShippingCost',s?.actualShippingCost??'','number','min="0" step="0.01" placeholder="Enter actual courier charge"')}${field('Actual packaging cost','actualPackagingCost',s?.actualPackagingCost??'','number','min="0" step="0.01" placeholder="Enter actual packing cost"')}${field('Chargeable weight (kg)','chargeableWeightKg',s?.chargeableWeightKg??'','number','min="0" step="0.001"')}
    ${formSection('Damage, returns & recovery')}${field('Damage category','damageCategory',s?.damageCategory??'','text','placeholder="e.g. Chipped, cracked, crushed carton"')}${field('Recorded damage loss','damageLoss',s?.damageLoss??0,'number','min="0" step="0.01"')}${field('Replacement costs','replacementCost',s?.replacementCost??0,'number','min="0" step="0.01"')}${field('Actual refund amount','refundAmount',s?.refundAmount??0,'number','min="0" step="0.01"')}${selectField('Courier claim status','claimStatus',[{value:'None',label:'None'},{value:'Submitted',label:'Submitted'},{value:'Reimbursed',label:'Reimbursed'}],s?.claimStatus??'None')}${field('Claim reimbursement','claimReimbursement',s?.claimReimbursement??0,'number','min="0" step="0.01"')}${textArea('Dispatch notes','notes',s?.notes??'')}</div>`;
  openDialog(s?'Edit shipment':'Record shipment',body,async(form,dialog)=>{
    const lineProducts=form.getAll('shipProduct').map(String);const quantities=form.getAll('shipQuantity').map(Number);
    const lines:ShipmentLine[]=lineProducts.map((productId,index)=>{const p=data.products.find(x=>x.id===productId);if(!p)throw new Error('A selected product no longer exists.');const quantity=quantities[index];if(!Number.isInteger(quantity)||quantity<1)throw new Error('Shipment quantities must be positive whole numbers.');return{productId,productName:p.name,quantity,unitWeightG:p.actualWeightG};});
    if(!lines.length)throw new Error('Add at least one product to this parcel.');
    const courier=data.couriers.find(c=>c.id===value(form,'courierId'));
    const pack=data.packaging.find(p=>p.id===value(form,'packagingConfigId'));
    const ship:Shipment={id:s?.id??id(),trackingRef:value(form,'trackingRef'),orderId:value(form,'orderId')||undefined,lines,packagingConfigId:value(form,'packagingConfigId')||undefined,courierId:courier?.id,courierName:courier?.name??'Custom / not specified',mode:courier?.mode??'Standard',divisor:courier?.divisor??5000,dispatchDate:value(form,'dispatchDate'),deliveryDate:value(form,'deliveryDate')||undefined,outcome:value(form,'outcome') as Shipment['outcome'],actualShippingCost:optionalNum(form,'actualShippingCost'),actualPackagingCost:optionalNum(form,'actualPackagingCost'),chargeableWeightKg:optionalNum(form,'chargeableWeightKg'),damageCategory:value(form,'damageCategory'),damageLoss:num(form,'damageLoss'),replacementCost:num(form,'replacementCost'),refundAmount:num(form,'refundAmount'),claimStatus:value(form,'claimStatus') as Shipment['claimStatus'],claimReimbursement:num(form,'claimReimbursement'),notes:value(form,'notes'),isSample:s?.isSample??false,createdAt:s?.createdAt??new Date().toISOString()};
    if(data.shipments.some(x=>x.id!==ship.id&&x.trackingRef.toLowerCase()===ship.trackingRef.toLowerCase()))throw new Error('That tracking reference is already recorded.');
    if(ship.orderId){
      const linkedOrder=data.orders.find(o=>o.id===ship.orderId);
      if(!linkedOrder)throw new Error('The linked order could not be found.');
      const existingShipments=data.shipments.filter(x=>x.orderId===ship.orderId&&x.id!==ship.id);
      const orderedByProduct=new Map<string,{name:string;quantity:number}>();
      for(const orderLine of linkedOrder.items){const current=orderedByProduct.get(orderLine.productId);orderedByProduct.set(orderLine.productId,{name:orderLine.productName,quantity:(current?.quantity??0)+orderLine.quantity});}
      const shippedByProduct=new Map<string,number>();
      for(const parcel of [...existingShipments,ship])for(const line of parcel.lines)shippedByProduct.set(line.productId,(shippedByProduct.get(line.productId)??0)+line.quantity);
      for(const [productId,quantity] of shippedByProduct){const ordered=orderedByProduct.get(productId);if(!ordered)throw new Error('A shipment includes a product that is not part of the linked order.');if(quantity>ordered.quantity)throw new Error(`Shipment quantity for ${ordered.name} would exceed the ordered quantity.`);}
    }
    await saveEntity('shipments',ship);dialog.close();await saveAndRefresh(s?'Shipment updated.':'Shipment recorded.');
  });
  const dialog=document.querySelector<HTMLDialogElement>('#editor-dialog');
  dialog?.querySelector('#add-shipment-line')?.addEventListener('click',()=>dialog.querySelector('#shipment-lines')?.insertAdjacentHTML('beforeend',shipmentLineRow()));
  dialog?.querySelector('#shipment-lines')?.addEventListener('click',event=>{const target=event.target as HTMLElement;if(target.closest('.remove-line')){const rows=dialog.querySelectorAll('.shipment-line-row');if(rows.length<=1){notify('A parcel needs at least one product line.','error');return;}target.closest('.shipment-line-row')?.remove();}});
}

function courierDialog(existing?: CourierSetting): void {
  const c=existing;
  const body=`<div class="form-grid">${formSection('Courier service','Presets are generic calculation starting points, not published courier prices.')}${field('Courier / service name','name',c?.name??'','text','required')}${selectField('Service mode','mode',[{value:'Surface',label:'Surface'},{value:'Air Express',label:'Air Express'},{value:'Standard',label:'Standard'}],c?.mode??'Surface')}${field('Volumetric divisor','divisor',c?.divisor??4000,'number','min="1" step="1" required')}${formSection('Your freight rate agreement','Leave blank if you do not want FragileFit to estimate a courier amount.')}${field('Base rate','baseRate',c?.baseRate??'','number','min="0" step="0.01" placeholder="Optional"')}${field('Rate per chargeable kg','perKgRate',c?.perKgRate??'','number','min="0" step="0.01" placeholder="Optional"')}${selectField('Weight rounding rule','rounding',[{value:'exact',label:'Exact decimal'},{value:'half',label:'Round up to 0.5 kg'},{value:'one',label:'Round up to 1 kg'}],c?.rounding??'half')}</div>`;
  openDialog(c?'Edit courier rule':'Add courier rule',body,async(form,dialog)=>{
    const courier:CourierSetting={id:c?.id??id(),name:value(form,'name'),mode:value(form,'mode') as CourierSetting['mode'],divisor:num(form,'divisor'),baseRate:optionalNum(form,'baseRate'),perKgRate:optionalNum(form,'perKgRate'),rounding:value(form,'rounding') as CourierSetting['rounding'],isPreset:c?.isPreset??false};
    if(!courier.name||courier.divisor<=0)throw new Error('Enter a courier name and a divisor greater than zero.');
    if((courier.baseRate??0)<0||(courier.perKgRate??0)<0)throw new Error('Courier rates cannot be negative.');
    await saveEntity('couriers',courier);dialog.close();await saveAndRefresh(c?'Courier rule updated.':'Courier rule added.');
  });
}

function showOrderDetails(order: Order): void {
  const shipments=data.shipments.filter(s=>s.orderId===order.id);const f=calculateOrderFinancials(order,shipments);
  const row=(label:string,valueText:string)=>`<div class="finance-row"><span>${label}</span><strong>${valueText}</strong></div>`;
  const body=`<div class="order-detail"><div class="detail-topline">${badge(f.provisional?'Provisional':'Finalized',f.provisional?'warning':'good')}<span>${esc(order.orderNumber)} · ${esc(order.date)}</span></div><div class="detail-total"><small>NET OPERATING PROFIT</small><strong>${money(f.operatingProfit)}</strong><span>${number(f.marginPercent,1)}% operating margin · before tax reserve</span></div><div class="finance-list">${row('Gross product revenue',money(f.grossRevenue))}${row('Actual refunds',`− ${money(f.refunds)}`)}${row('Net revenue',money(f.netRevenue))}${row('Manufacturing COGS',`− ${money(f.cogs)}`)}${row(`Packaging (${f.expenseSource.toLowerCase()})`,`− ${money(f.packagingCost)}`)}${row(`Shipping (${f.expenseSource.toLowerCase()})`,`− ${money(f.shippingCost)}`)}${row('Marketplace fees',`− ${money(f.marketplaceFees)}`)}${row('Payment fees',`− ${money(f.paymentFees)}`)}${row('Other direct expenses',`− ${money(f.directExpenses)}`)}${row('Return reserve',`− ${money(f.returnReserve)}`)}${row('Actual return expenses',`− ${money(f.actualReturnCosts)}`)}${row('Replacement costs',`− ${money(f.replacementCosts)}`)}${row('Claim reimbursements',`+ ${money(f.claimReimbursements)}`)}${row('Tax reserve · separate',money(f.taxReserve))}${row('Profit after tax reserve',money(f.profitAfterTaxReserve))}</div><div class="shipment-links"><strong>Linked shipments (${shipments.length})</strong>${shipments.length?shipments.map(s=>`<div class="linked-shipment"><span>${esc(s.trackingRef)} · ${esc(s.outcome)}</span><span>${money((s.actualPackagingCost??0)+(s.actualShippingCost??0))}</span></div>`).join(''):'<p class="muted">No shipments linked. Order estimates are currently used.</p>'}<p class="muted small">Fulfilled quantity: ${f.shippedQuantity} / ${f.orderedQuantity}. Profit status: ${f.provisional?'provisional / review actual expenses':'finalized based on recorded expenses'}.</p></div></div>`;
  openDialog(`Order economics · ${order.orderNumber}`,body,async(_form,dialog)=>dialog.close(),'Close');
  const form=document.querySelector<HTMLFormElement>('#editor-form');form?.setAttribute('novalidate','true');
  const submit=form?.querySelector<HTMLButtonElement>('button[type="submit"]');if(submit)submit.textContent='Close';
}

function courierForCalculator(form: HTMLFormElement): CourierSetting | undefined { const idValue=new FormData(form).get('courierId');return data.couriers.find(c=>c.id===idValue); }

function downloadCsv(name: string, rows: string[][]): void {
  const csv=rows.map(row=>row.map(cell=>`"${String(cell??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCsvFiles(): void {
  const rows=[['Record type','ID','Date','Name / reference','Quantity / status','Amount / details']];
  data.products.forEach(p=>rows.push(['Product',p.id,p.createdAt,p.name,p.category,`Production ${p.productionCost}; retail ${p.sellingPrice}`]));
  data.orders.forEach(o=>{const f=calculateOrderFinancials(o,data.shipments.filter(s=>s.orderId===o.id));rows.push(['Order',o.id,o.date,o.orderNumber,o.status,`Revenue ${f.grossRevenue}; profit ${f.operatingProfit}; provisional ${f.provisional}`]);});
  data.shipments.forEach(s=>rows.push(['Shipment',s.id,s.dispatchDate,s.trackingRef,s.outcome,`Packaging ${s.actualPackagingCost??''}; shipping ${s.actualShippingCost??''}; damage loss ${s.damageLoss}`]));
  downloadCsv(`fragilefit-summary-${dateToday()}.csv`,rows);notify('CSV report exported.');
}

function showBackupDialog(): void {
  openDialog('Create encrypted backup',`<div class="form-grid">${formSection('Backup password','Use at least 10 characters. This password is not stored by FragileFit.')}${field('Password','backupPassword','','password','minlength="10" required autocomplete="new-password"')}${field('Confirm password','confirmPassword','','password','minlength="10" required autocomplete="new-password"')}<p class="muted small full-span">Encryption uses PBKDF2-SHA-256 with a random salt and AES-256-GCM with a random IV. If you lose this password, the encrypted backup cannot be restored.</p></div>`,async(form,dialog)=>{
    const password=value(form,'backupPassword');if(password.length<10)throw new Error('Use at least 10 characters.');if(password!==value(form,'confirmPassword'))throw new Error('The passwords do not match.');await exportEncryptedBackup(password);dialog.close();notify('Encrypted backup created.');
  });
}

function showImportDialog(): void {
  openDialog('Restore a FragileFit backup',`<div class="form-grid">${formSection('Choose a backup file','Restoring replaces the current local workspace; it does not merge with it. Export a fresh encrypted backup first if you want to keep the current records.')}
    <label class="full-span">Backup file<input type="file" name="backupFile" accept=".json,.enc,.fragilefit.enc,application/json" required></label>
    ${field('Encryption password (only for .enc files)','password','','password','autocomplete="off"')}
    <label class="check-row full-span"><input type="checkbox" name="confirmReplace" required> I understand that restore replaces the current workspace.</label></div>`,async(form,dialog)=>{
      const file=(form.get('backupFile') as File|null);if(!file)throw new Error('Select a backup file.');if(!form.get('confirmReplace'))throw new Error('Confirm that you want to replace the current workspace.');await importBackupFile(file,value(form,'password')||undefined);dialog.close();data=await getAllData();activeView='dashboard';render();notify('Backup restored.');
  },'Restore workspace');
}

function printReport(): void {
  const profit=data.orders.reduce((sum,o)=>sum+calculateOrderFinancials(o,data.shipments.filter(s=>s.orderId===o.id)).operatingProfit,0);
  const report=window.open('','_blank','width=900,height=700');if(!report){notify('Allow pop-ups to print the report.','error');return;}
  report.document.write(`<!doctype html><html><head><title>FragileFit business summary</title><style>body{font:14px Arial;padding:36px;color:#1b2430}h1{margin-bottom:4px}small{color:#64748b}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card{border:1px solid #cbd5e1;padding:16px;border-radius:8px}.value{font-size:22px;font-weight:bold;margin-top:8px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{text-align:left;padding:9px;border-bottom:1px solid #ddd}</style></head><body><h1>FragileFit · Business summary</h1><small>Generated ${new Date().toLocaleString()}</small><div class="grid"><div class="card">Products<div class="value">${data.products.length}</div></div><div class="card">Orders<div class="value">${data.orders.length}</div></div><div class="card">Shipments<div class="value">${data.shipments.length}</div></div><div class="card">Damage rate<div class="value">${number(damageRate(data.shipments),1)}%</div></div><div class="card">Operating profit<div class="value">${money(profit)}</div></div><div class="card">Currency<div class="value">${esc(data.settings.currency)}</div></div></div><h2>Order summary</h2><table><thead><tr><th>Order</th><th>Status</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>${data.orders.map(o=>{const f=calculateOrderFinancials(o,data.shipments.filter(s=>s.orderId===o.id));return `<tr><td>${esc(o.orderNumber)}</td><td>${esc(o.status)}${f.provisional?' · provisional':''}</td><td>${money(f.grossRevenue)}</td><td>${money(f.operatingProfit)}</td></tr>`}).join('')}</tbody></table><p><small>Local business records are estimates and user-entered data. This report is not tax advice.</small></p><script>window.print()<\/script></body></html>`);
  report.document.close();
}

function startGuidedTour(startIndex = 0): void {
  document.querySelector<HTMLDialogElement>('#tour-dialog')?.remove();
  let current = Math.max(0, Math.min(startIndex, TOUR_STEPS.length - 1));
  const dialog = document.createElement('dialog');
  dialog.id = 'tour-dialog';
  dialog.className = 'tour-dialog';
  document.body.append(dialog);
  const showStep = (): void => {
    const step = TOUR_STEPS[current];
    activeView = step.view;
    packagingOutput = '';
    render();
    const progress = (current + 1) / TOUR_STEPS.length * 100;
    dialog.innerHTML = `<div class="tour-topline"><span class="eyebrow">FRAGILEFIT · NEWCOMER GUIDE</span><button type="button" class="dialog-close" data-tour="close" aria-label="Close guided tour">×</button></div><div class="tour-progress"><span style="width:${progress}%"></span></div><div class="tour-count">${current + 1} OF ${TOUR_STEPS.length} · ${esc(step.label)}</div><h2>${esc(step.title)}</h2><p class="tour-body">${esc(step.body)}</p><ul class="tour-bullets">${step.bullets.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><div class="tour-context">The ${esc(step.view === 'roi' ? 'ROI simulator' : step.view)} section is open behind this guide. Close the tour at any time to explore it directly.</div><div class="tour-actions"><button type="button" class="btn secondary" data-tour="previous" ${current===0?'disabled':''}>Previous</button><button type="button" class="btn primary" data-tour="next">${current===TOUR_STEPS.length-1?'Finish tour':'Next step'}</button></div>`;
  };
  dialog.addEventListener('click', event => {
    const target=(event.target as HTMLElement).closest<HTMLElement>('[data-tour]');
    if(!target)return;
    const action=target.dataset.tour;
    if(action==='close'){dialog.close();return;}
    if(action==='previous'&&current>0){current--;showStep();return;}
    if(action==='next'){
      if(current<TOUR_STEPS.length-1){current++;showStep();}
      else{dialog.close();activeView='dashboard';render();notify('Guided tour completed. You can start it again from the top bar.');}
    }
  });
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.addEventListener('cancel',()=>dialog.remove());
  dialog.showModal();
  showStep();
}

function confirmDataChange(
  title: string,
  detail: string,
  options: { confirmLabel?: string; requirePhrase?: string } = {}
): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'safety-confirm-dialog';
    const requiredPhrase = options.requirePhrase ?? '';
    dialog.innerHTML = `<div class="safety-confirm-heading"><span class="eyebrow">FRAGILEFIT · DATA PROTECTION</span><h2>${esc(title)}</h2></div>
      <form id="safety-confirm-form">
        <p>${esc(detail)}</p>
        <div class="safety-confirm-warning"><strong>This change is made on this device.</strong><span>Deleted records cannot be recovered from this browser unless you have an independent backup. FragileFit does not currently synchronise them to another device.</span></div>
        <label class="safety-confirm-check"><input type="checkbox" name="understand" required> I understand that this change may remove or replace saved records.</label>
        ${requiredPhrase ? `<label class="safety-confirm-phrase">Type <strong>${esc(requiredPhrase)}</strong> to continue<input name="confirmationPhrase" autocomplete="off" spellcheck="false" required></label>` : ''}
        <div class="dialog-actions"><button type="button" class="btn secondary" data-confirm-cancel>Cancel</button><button type="submit" class="btn danger-button" disabled>${esc(options.confirmLabel ?? 'Continue')}</button></div>
      </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector<HTMLFormElement>('#safety-confirm-form')!;
    const checkbox = form.querySelector<HTMLInputElement>('input[name="understand"]')!;
    const phraseInput = form.querySelector<HTMLInputElement>('input[name="confirmationPhrase"]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const updateSubmit = (): void => {
      submit.disabled = !checkbox.checked || Boolean(requiredPhrase && phraseInput?.value.trim() !== requiredPhrase);
    };
    checkbox.addEventListener('change', updateSubmit);
    phraseInput?.addEventListener('input', updateSubmit);
    form.querySelector<HTMLButtonElement>('[data-confirm-cancel]')!.addEventListener('click', () => dialog.close());
    let accepted = false;
    form.addEventListener('submit', event => {
      event.preventDefault();
      updateSubmit();
      if (submit.disabled) return;
      accepted = true;
      dialog.close();
    });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(accepted); }, { once: true });
    dialog.showModal();
    checkbox.focus();
  });
}

function showDriveBackupDialog(): void {
  openDialog('Create encrypted Google Drive backup',
    `<div class="form-grid">
      ${formSection('Choose a backup password','Use the same password when restoring on another device. FragileFit does not save or recover it.')}
      ${field('Backup password','drivePassword','','password','minlength="10" required autocomplete="new-password"')}
      ${field('Confirm password','drivePasswordConfirm','','password','minlength="10" required autocomplete="new-password"')}
      <p class="muted small full-span">Your workspace is encrypted in this browser using PBKDF2-SHA-256 and AES-256-GCM before any file is uploaded.</p>
    </div>`,
    async (form, dialog) => {
      const password = value(form,'drivePassword');
      if (password.length < 10) throw new Error('Use at least 10 characters for the backup password.');
      if (password !== value(form,'drivePasswordConfirm')) throw new Error('The passwords do not match.');
      const uploaded = await uploadEncryptedDriveBackup(data, password);
      dialog.close();
      notify('Encrypted backup uploaded to your Google Drive.');
      try { googleDriveBackups = await listEncryptedDriveBackups(); }
      catch { googleDriveBackups = [uploaded, ...googleDriveBackups.filter(item => item.id !== uploaded.id)]; }
      activeView = 'data-safety';
      render();
    },
    'Encrypt and upload'
  );
}

function showDriveRestoreDialog(backup: DriveBackupMetadata): void {
  openDialog('Restore encrypted Drive backup',
    `<div class="form-grid">
      ${formSection('Selected backup',backup.name)}
      <p class="full-span">Restoring will replace the complete workspace currently stored in this browser. It will not merge the records. The current workspace will remain unchanged if the password is wrong or the downloaded backup is invalid.</p>
      ${field('Backup password','driveRestorePassword','','password','required autocomplete="off"')}
      <label class="check-row full-span"><input type="checkbox" name="confirmDriveReplace" required> I understand that restoring replaces the current local workspace.</label>
    </div>`,
    async (form, dialog) => {
      if (!form.get('confirmDriveReplace')) throw new Error('Confirm that you want to replace this local workspace.');
      const encryptedText = await downloadEncryptedDriveBackup(backup.id);
      const restoredData = await parseDriveEncryptedBackupText(encryptedText,value(form,'driveRestorePassword'));
      await replaceAllData(restoredData);
      dialog.close();
      data = await getAllData();
      activeView = 'dashboard';
      render();
      notify('Google Drive backup restored to this device.');
      try { googleDriveBackups = await listEncryptedDriveBackups(); } catch { /* The restore already succeeded; backup-list refresh can be retried later. */ }
    },
    'Restore this workspace'
  );
}

function showDriveSetupDetails(): void {
  openDialog('Google Drive connection requirements',
    `<div class="form-grid">
      ${formSection('What is planned','Google Drive backup will be added as an optional way to keep encrypted backup copies in each seller’s own Drive account.')}
      <p class="full-span">The app owner must configure a Google Cloud project, enable the Google Drive API, register the FragileFit website origin and configure the correct OAuth client. No client ID is configured in this release.</p>
      ${formSection('Privacy and access','The integration is designed to use the narrow drive.file permission for app-created backup files, not broad access to every Drive file.')}
      <p class="full-span">Backups will be encrypted in the browser before upload. The backup password will not be sent to Google or stored by FragileFit. A Drive access token must not be placed in a public source file or localStorage.</p>
      ${formSection('What it will not do initially','The first version will upload and restore versioned backup files. It will not merge or live-sync edits between devices.')}
      <p class="muted small full-span">No Google sign-in or permission request is started by opening this information screen.</p>
    </div>`,
    async (_form, dialog) => { dialog.close(); },
    'Close'
  );
}

async function handleAction(action: string, target?: HTMLElement): Promise<void> {
  const recordId=target?.dataset.id;
  switch(action){
    case 'start-tour': startGuidedTour(); break;
    case 'roi-demo': { const form=document.querySelector<HTMLFormElement>('#roi-form'); if(form){const damage=form.querySelector<HTMLInputElement>('[name="incidentCost"]');const shipping=form.querySelector<HTMLInputElement>('[name="manualShipping"]');if(damage)damage.value='260';if(shipping)shipping.value='90';form.querySelectorAll<HTMLInputElement>('.roi-risk-control input:not([readonly])').forEach((input,index)=>{input.value=String([8,4,6,5,7][index%5]);});notify('Illustrative assumptions loaded. These are not real damage statistics.','info');} break;}
    case 'add-product': productDialog(); break;
    case 'edit-product': {const p=data.products.find(x=>x.id===recordId);if(p)productDialog(p);break;}
    case 'delete-product': if(recordId&&await confirmDataChange('Delete this product?','Existing order line snapshots and shipment records will remain, but this product will be removed from your catalogue.',{confirmLabel:'Delete product'})){await deleteEntity('products',recordId);await saveAndRefresh('Product deleted.');}break;
    case 'add-packaging': packagingDialog();break;
    case 'edit-packaging': {const p=data.packaging.find(x=>x.id===recordId);if(p)packagingDialog(p);break;}
    case 'delete-packaging': if(recordId&&await confirmDataChange('Delete this packaging recipe?','Existing shipment snapshots remain, but this recipe will be removed from your packaging list.',{confirmLabel:'Delete recipe'})){await deleteEntity('packaging',recordId);await saveAndRefresh('Packaging recipe deleted.');}break;
    case 'add-order': orderDialog();break;
    case 'edit-order': {const o=data.orders.find(x=>x.id===recordId);if(o)orderDialog(o);break;}
    case 'view-order': {const o=data.orders.find(x=>x.id===recordId);if(o)showOrderDetails(o);break;}
    case 'delete-order': if(recordId&&await confirmDataChange('Delete this order?','Linked shipment records will remain as standalone records, but this order and its order details will be removed.',{confirmLabel:'Delete order'})){for(const shipment of data.shipments.filter(s=>s.orderId===recordId)){shipment.orderId=undefined;await saveEntity('shipments',shipment);}await deleteEntity('orders',recordId);await saveAndRefresh('Order deleted; linked parcels retained.');}break;
    case 'add-shipment': shipmentDialog();break;
    case 'edit-shipment': {const s=data.shipments.find(x=>x.id===recordId);if(s)shipmentDialog(s);break;}
    case 'delete-shipment': if(recordId&&await confirmDataChange('Delete this shipment record?','The order will fall back to its saved estimate if no other linked shipments remain.',{confirmLabel:'Delete shipment'})){await deleteEntity('shipments',recordId);await saveAndRefresh('Shipment deleted.');}break;
    case 'add-courier': courierDialog();break;
    case 'edit-courier': {const c=data.couriers.find(x=>x.id===recordId);if(c)courierDialog(c);break;}
    case 'delete-courier': if(recordId&&await confirmDataChange('Delete this courier rule?','Existing shipment snapshots remain, but this courier rule will be removed from your editable courier list.',{confirmLabel:'Delete courier'})){await deleteEntity('couriers',recordId);await saveAndRefresh('Courier rule deleted.');}break;
    case 'request-storage-protection': { storageProtection = await requestStorageProtection(); render(); notify(storageProtection.persistent === true ? 'Persistent browser storage was granted.' : 'The browser did not grant persistent storage. Keep independent backups.', storageProtection.persistent === true ? 'success' : 'error'); break; }
    case 'drive-setup-details': showDriveSetupDetails(); break;
    case 'drive-connect': {
      await connectGoogleDrive();
      googleDriveBackups = await listEncryptedDriveBackups();
      render();
      notify('Google Drive connected for this browser session.');
      break;
    }
    case 'drive-backup': showDriveBackupDialog(); break;
    case 'drive-refresh': {
      googleDriveBackups = await listEncryptedDriveBackups();
      render();
      notify('Google Drive backup list refreshed.');
      break;
    }
    case 'drive-disconnect': {
      await disconnectGoogleDrive();
      googleDriveBackups = [];
      render();
      notify('Google Drive disconnected from this browser session.');
      break;
    }
    case 'drive-restore': {
      const backup = googleDriveBackups.find(item => item.id === recordId);
      if (backup) showDriveRestoreDialog(backup);
      break;
    }
    case 'export-plain': await exportPlainBackup();notify('JSON backup exported.');break;
    case 'export-csv': exportCsvFiles();break;
    case 'encrypted-backup': showBackupDialog();break;
    case 'import-backup': showImportDialog();break;
    case 'reset-samples': if(await confirmDataChange('Reset sample data?','This replaces the labelled demo records with a fresh sample set. Your non-sample business records are preserved.',{confirmLabel:'Reset samples'})){await resetSampleData();await saveAndRefresh('Sample data reset.');}break;
    case 'clear-workspace': if(await confirmDataChange('Clear this workspace?','This removes all products, packaging recipes, orders and shipments currently stored in this browser. Courier presets remain. Export an independent backup first if you may need these records later.',{confirmLabel:'Clear workspace',requirePhrase:'CLEAR'})){await clearWorkspace();await saveAndRefresh('Workspace cleared.');}break;
    case 'run-tests': {const output=document.querySelector<HTMLElement>('#test-output');if(output)output.innerHTML='<p class="muted small">Running calculation and encryption checks…</p>';const results=[...runCriticalTests(),...await runCryptoTests()];if(output)output.innerHTML=`<div class="test-results">${results.map(r=>`<div class="test-result ${r.passed?'passed':'failed'}"><strong>${r.passed?'PASS':'FAIL'}</strong><span>${esc(r.name)}</span><small>${esc(r.detail)}</small></div>`).join('')}<strong class="test-summary">${results.filter(r=>r.passed).length}/${results.length} tests passed</strong></div>`;break;}
    case 'print-report': printReport();break;
    case 'mobile-more': {const existing=document.querySelector('.mobile-more-menu');if(existing){existing.remove();}else{root!.insertAdjacentHTML('beforeend',`<div class="mobile-more-menu"><button class="mobile-more-close" data-action="mobile-more">Close ×</button><button data-view="roi">Delivery cost simulator</button><button data-view="intelligence">Packaging intelligence</button><button data-view="reports">Reports & backups</button><button data-view="settings">Settings & couriers</button><button data-view="data-safety">Data safety & backups</button><a href="./index.html">Website home</a></div>`);}break;}
    case 'install-app': {if(deferredInstallPrompt){await deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;notify(choice.outcome==='accepted'?'FragileFit installation is ready.':'Installation was not completed.');}else{notify('Use your browser menu and choose Install app or Add to Home screen.');}break;}
  }
}

root.addEventListener('click', async event=>{
  const target=(event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-action]');if(!target)return;
  if(target.dataset.view){event.preventDefault();activeView=target.dataset.view;packagingOutput='';render();return;}
  const action=target.dataset.action;if(action){try{await handleAction(action,target);}catch(error){notify(error instanceof Error?error.message:String(error),'error');}}
});

root.addEventListener('submit',async event=>{
  const form=event.target as HTMLFormElement;
  if(form.id==='pack-calc-form'){
    event.preventDefault();const values=new FormData(form);const p=data.products.find(x=>x.id===values.get('productId'));const recipe=data.packaging.find(x=>x.id===values.get('packagingId'));const courier=data.couriers.find(x=>x.id===values.get('courierId'));const quantity=Number(values.get('quantity'));
    try{
      if(!p||!recipe||!courier)throw new Error('Choose a product, packaging recipe and courier rule.');
      if(!Number.isInteger(quantity)||quantity<1)throw new Error('Quantity must be a positive whole number.');
      const result=calculatePackaging([{product:p,quantity}],recipe,courier.divisor,courier.rounding);
      const courierEstimate=estimateCourierCharge(result.chargeableWeightKg,courier);
      const output=document.querySelector<HTMLElement>('#pack-calc-output');
      if(output){output.classList.add('show');output.innerHTML=`<div class="calc-result-head"><div><small>CALCULATED CHARGEABLE WEIGHT</small><strong>${number(result.chargeableWeightKg,3)} kg</strong></div><div><small>OUTER CARTON VOLUME</small><strong>${number(result.outerVolumeCm3,0)} cm³</strong></div></div><div class="calc-result-grid"><div><span>Product + packaging actual weight</span><strong>${number(result.actualWeightKg,3)} kg</strong></div><div><span>Volumetric weight · outer box only</span><strong>${number(result.volumetricWeightKg,3)} kg</strong></div><div><span>Packaging materials</span><strong>${money(result.packagingCost)}</strong></div><div><span>Courier rate estimate</span><strong>${courierEstimate==null?'Not configured':money(courierEstimate)}</strong></div></div><p class="calc-footnote">Formula: ${number(recipe.outerLengthCm)} × ${number(recipe.outerWidthCm)} × ${number(recipe.outerHeightCm)} ÷ ${courier.divisor.toLocaleString('en-IN')}. Inner box volume is not added. Freight rates are only estimated when you enter them in Settings.</p>`;}
    }catch(error){notify(error instanceof Error?error.message:String(error),'error');}
  }
  if(form.id==='roi-form'){
    event.preventDefault();
    const values=new FormData(form);
    try{
      const product=data.products.find(p=>p.id===values.get('productId'));
      const courier=data.couriers.find(c=>c.id===values.get('courierId'));
      const quantity=Number(values.get('quantity'));
      const incidentCost=Number(values.get('incidentCost'));
      const manualShipping=optionalNum(values,'manualShipping');
      if(!product||!courier)throw new Error('Choose a product and courier rule.');
      if(!Number.isInteger(quantity)||quantity<1)throw new Error('Units per parcel must be a positive whole number.');
      if(!Number.isFinite(incidentCost)||incidentCost<0)throw new Error('Enter a non-negative damage-incident cost.');
      const rows=data.packaging.map((recipe,index)=>{
        const evidenceStats=getPackagingEvidence(data.shipments,recipe.id);
        const evidence=evidenceStats.observedCount>=10;
        const risk=evidence?evidenceStats.damageRatePercent:Number(values.get(`risk${index}`));
        if(!Number.isFinite(risk)||risk<0||risk>=100)throw new Error(`Enter a damage-rate assumption from 0% to less than 100% for ${recipe.name}.`);
        const pack=calculatePackaging([{product,quantity}],recipe,courier.divisor,courier.rounding);
        const configuredFreight=estimateCourierCharge(pack.chargeableWeightKg,courier);
        const freight=configuredFreight??manualShipping;
        if(freight==null||!Number.isFinite(freight)||freight<0)throw new Error('The selected courier has no saved rates. Enter a manual shipping estimate.');
        const expected=calculateExpectedDeliveryCost(pack.packagingCost,freight,incidentCost,risk);
        return {recipe,risk,evidence,observations:evidenceStats.observedCount,packagingCost:pack.packagingCost,freight,volumetricWeightKg:pack.volumetricWeightKg,chargeableWeightKg:pack.chargeableWeightKg,expectedDamageCost:expected.expectedDamageCost,expectedCost:expected.expectedCostPerSuccessfulDelivery};
      }).sort((a,b)=>a.expectedCost-b.expectedCost);
      const best=rows[0];
      const output=document.querySelector<HTMLElement>('#roi-output');
      if(output&&best){
        output.classList.add('show');
        output.innerHTML=`<div class="roi-result-head"><div><span class="eyebrow">LOWEST MODELLED COST IN THIS SCENARIO</span><h3>${esc(best.recipe.name)}</h3><strong>${money(best.expectedCost)} <small>/ successful delivery</small></strong><p>${best.evidence?'Using observed damage data':'Using your entered scenario assumptions'} · ${best.observations} resolved observations</p></div><span class="roi-best-icon">◎</span></div><div class="table-wrap"><table><thead><tr><th>PACKAGING RECIPE</th><th>RISK</th><th>PACKAGING</th><th>FREIGHT</th><th>EXPECTED DAMAGE COST</th><th>MODELLED COST / SUCCESS</th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td><strong>${esc(row.recipe.name)}</strong>${index===0?badge('Lowest modelled cost','good'):''}<small class="cell-sub">${number(row.chargeableWeightKg,2)} kg chargeable · outer box ${number(row.volumetricWeightKg,2)} kg volumetric</small></td><td>${number(row.risk,1)}%<small class="cell-sub">${row.evidence?'Observed':'Assumed'}</small></td><td>${money(row.packagingCost)}</td><td>${money(row.freight)}</td><td>${money(row.expectedDamageCost)}</td><td><strong>${money(row.expectedCost)}</strong></td></tr>`).join('')}</tbody></table></div><div class="notice roi-warning"><span class="notice-icon">i</span><div><strong>Scenario result, not a guarantee.</strong><p>FragileFit ranked recipes using the current product, courier, freight rates, incident-cost input and damage-rate evidence/assumptions. Confirm the result with real packing tests and actual courier invoices before changing your process.</p></div></div>`;
      }
    }catch(error){notify(error instanceof Error?error.message:String(error),'error');}
  }
  if(form.id==='settings-form'){
    event.preventDefault();const fd=new FormData(form);await saveSettings({businessName:value(fd,'businessName'),currency:value(fd,'currency'),unitSystem:'metric',theme:'light'});await saveAndRefresh('Workspace settings saved.');
  }
});

root.addEventListener('input',event=>{
  const target=event.target as HTMLInputElement;if(target.id==='product-search'){searchTerm=target.value;const start=target.selectionStart;const end=target.selectionEnd;const content=document.querySelector<HTMLElement>('#view-content');if(content){content.innerHTML=renderProducts();const input=content.querySelector<HTMLInputElement>('#product-search');input?.focus();input?.setSelectionRange(start,end);}}
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event as typeof deferredInstallPrompt;
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; notify('FragileFit installed.'); });

async function start(): Promise<void> {
  try {
    await initializeDatabase();storageProtection=await getStorageProtectionStatus();data=await getAllData();
    const params = new URLSearchParams(location.search);
    const requestedView = params.get('view');
    const allowedViews = ['dashboard', 'products', 'packaging', 'roi', 'orders', 'shipments', 'intelligence', 'reports', 'settings', 'data-safety'];
    if (requestedView && allowedViews.includes(requestedView)) activeView = requestedView;
    render();
    void preloadGoogleIdentityServices().then(() => { if (activeView === 'data-safety') render(); }).catch(error => { console.warn('Google authorization is not ready:', error); if (activeView === 'data-safety') render(); });
    if(params.get('tour')==='1') window.setTimeout(()=>startGuidedTour(),250);
    if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('FragileFit offline worker was not registered:',error));
    }
  } catch(error) {
    root!.innerHTML=`<div class="startup-error"><h1>FragileFit could not open local storage.</h1><p>${esc(error instanceof Error?error.message:String(error))}</p><p>Try opening the app in a modern browser over HTTPS, then reload.</p></div>`;
  }
}

void start();
