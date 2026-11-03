import type { AppData, AppSettings, CourierSetting, Order, PackagingConfig, Product, Shipment } from './types.js';

const DB_NAME = 'FragileFitDB';
const DB_VERSION = 1;
const STORES = ['products', 'packaging', 'orders', 'shipments', 'couriers', 'meta'] as const;
type StoreName = typeof STORES[number];

const defaultSettings: AppSettings = { businessName: '', currency: 'INR', unitSystem: 'metric', theme: 'light' };

export const defaultCouriers: CourierSetting[] = [
  { id: 'preset-surface-4000', name: 'Generic Surface · D4000', mode: 'Surface', divisor: 4000, rounding: 'half', isPreset: true },
  { id: 'preset-surface-4500', name: 'Generic Surface · D4500', mode: 'Surface', divisor: 4500, rounding: 'half', isPreset: true },
  { id: 'preset-air-5000', name: 'Generic Air Express · D5000', mode: 'Air Express', divisor: 5000, rounding: 'half', isPreset: true }
];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export interface StorageProtectionStatus {
  supported: boolean;
  persistent: boolean | null;
}

export async function getStorageProtectionStatus(): Promise<StorageProtectionStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persisted !== 'function') {
    return { supported: false, persistent: null };
  }
  try {
    return { supported: typeof navigator.storage.persist === 'function', persistent: await navigator.storage.persisted() };
  } catch {
    return { supported: true, persistent: null };
  }
}

export async function requestStorageProtection(): Promise<StorageProtectionStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return { supported: false, persistent: null };
  }
  try {
    const granted = await navigator.storage.persist();
    return { supported: true, persistent: granted };
  } catch {
    return { supported: true, persistent: false };
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
export function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support IndexedDB.'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open local database.'));
      request.onblocked = () => reject(new Error('Database upgrade is blocked by another open tab. Close other FragileFit tabs and retry.'));
    });
  }
  return dbPromise;
}

async function all<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const result = await requestResult(tx.objectStore(storeName).getAll()) as T[];
  await transactionDone(tx);
  return result;
}

async function put<T extends { id: string }>(storeName: StoreName, value: T): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
}

async function remove(storeName: StoreName, id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await transactionDone(tx);
}

const sampleProducts: Product[] = [
  { id: 'sample-product-pot', name: 'Handcrafted terracotta planter', sku: 'SAMPLE-POT-01', category: 'Terracotta', lengthCm: 18, widthCm: 18, heightCm: 16, actualWeightG: 900, productionCost: 120, sellingPrice: 349, preferredPackagingId: 'sample-pack-pot', notes: 'Illustrative sample record. Replace with measured business data.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' },
  { id: 'sample-product-mug', name: 'Glazed ceramic coffee mug', sku: 'SAMPLE-MUG-01', category: 'Ceramic', lengthCm: 11, widthCm: 11, heightCm: 10, actualWeightG: 320, productionCost: 80, sellingPrice: 249, preferredPackagingId: 'sample-pack-mug', notes: 'Illustrative sample record. Replace with measured business data.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' },
  { id: 'sample-product-glass', name: 'Ribbed glass vase', sku: 'SAMPLE-GLASS-01', category: 'Glassware', lengthCm: 14, widthCm: 14, heightCm: 28, actualWeightG: 700, productionCost: 220, sellingPrice: 599, preferredPackagingId: 'sample-pack-glass', notes: 'Illustrative sample record. Replace with measured business data.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' }
];

const samplePackaging: PackagingConfig[] = [
  { id: 'sample-pack-pot', name: 'Planter · inner + outer carton', mode: 'dual', innerLengthCm: 22, innerWidthCm: 22, innerHeightCm: 20, innerBoxWeightG: 180, outerLengthCm: 30, outerWidthCm: 30, outerHeightCm: 28, outerBoxWeightG: 420, innerWrapWeightG: 35, cushioningWeightG: 160, innerWrapCost: 14, cushioningCost: 24, protectiveWrapCost: 9, otherCost: 4, notes: 'Sample recipe only. Verify with real packing trials.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' },
  { id: 'sample-pack-mug', name: 'Mug · padded single carton', mode: 'single', innerLengthCm: 0, innerWidthCm: 0, innerHeightCm: 0, innerBoxWeightG: 0, outerLengthCm: 18, outerWidthCm: 18, outerHeightCm: 16, outerBoxWeightG: 220, innerWrapWeightG: 25, cushioningWeightG: 90, innerWrapCost: 8, cushioningCost: 16, protectiveWrapCost: 6, otherCost: 2, notes: 'Sample recipe only. Verify with real packing trials.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' },
  { id: 'sample-pack-glass', name: 'Glass vase · double protection', mode: 'dual', innerLengthCm: 18, innerWidthCm: 18, innerHeightCm: 32, innerBoxWeightG: 160, outerLengthCm: 26, outerWidthCm: 26, outerHeightCm: 40, outerBoxWeightG: 390, innerWrapWeightG: 40, cushioningWeightG: 210, innerWrapCost: 12, cushioningCost: 32, protectiveWrapCost: 12, otherCost: 5, notes: 'Sample recipe only. Verify with real packing trials.', isSample: true, createdAt: '2026-01-10T10:00:00.000Z' }
];

const sampleOrders: Order[] = [
  { id: 'sample-order-1', orderNumber: 'DEMO-1001', date: '2026-10-28', status: 'Completed', items: [{ id: 'ol-1', productId: 'sample-product-mug', productName: 'Glazed ceramic coffee mug', quantity: 2, unitProductionCost: 80, unitSellingPrice: 249, unitWeightG: 320 }], marketplaceFeeType: 'percent', marketplaceFeeValue: 8, paymentFeePercent: 2, paymentFeeFixed: 4, estimatedPackagingCost: 30, estimatedShippingCost: 65, directExpenses: 0, returnReserve: 0, actualRefunds: 0, actualReturnCosts: 0, replacementCosts: 0, claimReimbursements: 0, taxReservePercent: 0, notes: 'Sample only. All values are illustrative.', isSample: true, createdAt: '2026-10-28T10:00:00.000Z' },
  { id: 'sample-order-2', orderNumber: 'DEMO-1002', date: '2026-10-29', status: 'Completed', items: [{ id: 'ol-2', productId: 'sample-product-pot', productName: 'Handcrafted terracotta planter', quantity: 1, unitProductionCost: 120, unitSellingPrice: 349, unitWeightG: 900 }, { id: 'ol-3', productId: 'sample-product-mug', productName: 'Glazed ceramic coffee mug', quantity: 1, unitProductionCost: 80, unitSellingPrice: 249, unitWeightG: 320 }], marketplaceFeeType: 'percent', marketplaceFeeValue: 8, paymentFeePercent: 2, paymentFeeFixed: 4, estimatedPackagingCost: 40, estimatedShippingCost: 90, directExpenses: 0, returnReserve: 0, actualRefunds: 0, actualReturnCosts: 0, replacementCosts: 0, claimReimbursements: 0, taxReservePercent: 0, notes: 'Sample only. One order fulfilled across linked parcels.', isSample: true, createdAt: '2026-10-29T10:00:00.000Z' },
  { id: 'sample-order-3', orderNumber: 'DEMO-1003', date: '2026-10-30', status: 'Pending', items: [{ id: 'ol-4', productId: 'sample-product-glass', productName: 'Ribbed glass vase', quantity: 1, unitProductionCost: 220, unitSellingPrice: 599, unitWeightG: 700 }], marketplaceFeeType: 'fixed', marketplaceFeeValue: 25, paymentFeePercent: 2, paymentFeeFixed: 4, estimatedPackagingCost: 61, estimatedShippingCost: 120, directExpenses: 0, returnReserve: 10, actualRefunds: 0, actualReturnCosts: 0, replacementCosts: 0, claimReimbursements: 0, taxReservePercent: 0, notes: 'Sample pending order; expenses are estimates.', isSample: true, createdAt: '2026-10-30T10:00:00.000Z' }
];

const sampleShipments: Shipment[] = [
  { id: 'sample-shipment-1', trackingRef: 'DEMO-TRACK-001', orderId: 'sample-order-1', lines: [{ productId: 'sample-product-mug', productName: 'Glazed ceramic coffee mug', quantity: 2, unitWeightG: 320 }], packagingConfigId: 'sample-pack-mug', courierId: 'preset-surface-4000', courierName: 'Generic Surface · D4000', mode: 'Surface', divisor: 4000, dispatchDate: '2026-10-28', deliveryDate: '2026-10-30', outcome: 'Delivered safely', actualShippingCost: 65, actualPackagingCost: 30, chargeableWeightKg: 1.2, damageCategory: '', damageLoss: 0, replacementCost: 0, refundAmount: 0, claimStatus: 'None', claimReimbursement: 0, notes: 'Sample shipment only.', isSample: true, createdAt: '2026-10-28T10:00:00.000Z' },
  { id: 'sample-shipment-2a', trackingRef: 'DEMO-TRACK-002-A', orderId: 'sample-order-2', lines: [{ productId: 'sample-product-pot', productName: 'Handcrafted terracotta planter', quantity: 1, unitWeightG: 900 }], packagingConfigId: 'sample-pack-pot', courierId: 'preset-surface-4500', courierName: 'Generic Surface · D4500', mode: 'Surface', divisor: 4500, dispatchDate: '2026-10-29', deliveryDate: '2026-10-31', outcome: 'Delivered safely', actualShippingCost: 82, actualPackagingCost: 51, chargeableWeightKg: 5.6, damageCategory: '', damageLoss: 0, replacementCost: 0, refundAmount: 0, claimStatus: 'None', claimReimbursement: 0, notes: 'First parcel in a split order. Sample only.', isSample: true, createdAt: '2026-10-29T10:00:00.000Z' },
  { id: 'sample-shipment-2b', trackingRef: 'DEMO-TRACK-002-B', orderId: 'sample-order-2', lines: [{ productId: 'sample-product-mug', productName: 'Glazed ceramic coffee mug', quantity: 1, unitWeightG: 320 }], packagingConfigId: 'sample-pack-mug', courierId: 'preset-air-5000', courierName: 'Generic Air Express · D5000', mode: 'Air Express', divisor: 5000, dispatchDate: '2026-10-29', deliveryDate: '2026-10-31', outcome: 'Damaged', actualShippingCost: 68, actualPackagingCost: 30, chargeableWeightKg: 1.1, damageCategory: 'Chipped', damageLoss: 40, replacementCost: 80, refundAmount: 0, claimStatus: 'Submitted', claimReimbursement: 0, notes: 'Second parcel in a split order. Sample only.', isSample: true, createdAt: '2026-10-29T10:05:00.000Z' },
  { id: 'sample-shipment-3', trackingRef: 'DEMO-TRACK-003', orderId: 'sample-order-3', lines: [{ productId: 'sample-product-glass', productName: 'Ribbed glass vase', quantity: 1, unitWeightG: 700 }], packagingConfigId: 'sample-pack-glass', courierId: 'preset-air-5000', courierName: 'Generic Air Express · D5000', mode: 'Air Express', divisor: 5000, dispatchDate: '2026-10-30', outcome: 'Dispatched', damageCategory: '', damageLoss: 0, replacementCost: 0, refundAmount: 0, claimStatus: 'None', claimReimbursement: 0, notes: 'Sample pending shipment. Actual costs will be entered after dispatch.', isSample: true, createdAt: '2026-10-30T10:00:00.000Z' }
];

export async function getAllData(): Promise<AppData> {
  const [products, packaging, orders, shipments, couriers, settingsRows] = await Promise.all([
    all<Product>('products'), all<PackagingConfig>('packaging'), all<Order>('orders'),
    all<Shipment>('shipments'), all<CourierSetting>('couriers'), all<AppSettings & { id: string }>('meta')
  ]);
  const settingsRow = settingsRows.find(row => row.id === 'settings');
  const settings = settingsRow ? { businessName: settingsRow.businessName, currency: settingsRow.currency, unitSystem: 'metric' as const, theme: 'light' as const } : defaultSettings;
  return { products, packaging, orders, shipments, couriers, settings };
}

export async function saveEntity(store: Exclude<StoreName, 'meta'>, entity: { id: string }): Promise<void> {
  await put(store, entity as { id: string });
}
export async function deleteEntity(store: Exclude<StoreName, 'meta'>, id: string): Promise<void> {
  await remove(store, id);
}
export async function saveSettings(settings: AppSettings): Promise<void> {
  await put('meta', { id: 'settings', ...settings });
}

export async function replaceAllData(data: AppData): Promise<void> {
  const collections: Array<[StoreName, Array<{ id: string }>]> = [
    ['products', data.products],
    ['packaging', data.packaging],
    ['orders', data.orders],
    ['shipments', data.shipments],
    ['couriers', data.couriers]
  ];
  for (const [storeName, records] of collections) {
    if (!Array.isArray(records)) throw new Error(`Cannot restore: ${storeName} is not a valid record list.`);
    const seen = new Set<string>();
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id.trim()) {
        throw new Error(`Cannot restore: a ${storeName} record is missing its ID.`);
      }
      if (seen.has(record.id)) throw new Error(`Cannot restore: duplicate ID "${record.id}" in ${storeName}.`);
      seen.add(record.id);
    }
  }
  if (!data.settings || typeof data.settings !== 'object') {
    throw new Error('Cannot restore: workspace settings are missing.');
  }

  const db = await openDatabase();
  const tx = db.transaction([...STORES], 'readwrite');
  const completed = transactionDone(tx);
  try {
    for (const name of STORES) tx.objectStore(name).clear();
    for (const product of data.products) tx.objectStore('products').put(product);
    for (const config of data.packaging) tx.objectStore('packaging').put(config);
    for (const order of data.orders) tx.objectStore('orders').put(order);
    for (const shipment of data.shipments) tx.objectStore('shipments').put(shipment);
    for (const courier of data.couriers) tx.objectStore('couriers').put(courier);
    tx.objectStore('meta').put({ id: 'settings', ...data.settings });
    tx.objectStore('meta').put({ id: 'sample-initialized', value: true });
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
    await completed.catch(() => undefined);
    throw error;
  }
  await completed;
}

export async function seedDemoData(force = false): Promise<void> {
  const current = await getAllData();
  const markers = await all<{ id: string; value?: boolean }>('meta');
  if (!force && markers.some(row => row.id === 'sample-initialized' && row.value)) return;
  if (!force && (current.products.length || current.orders.length || current.shipments.length)) {
    await put('meta', { id: 'sample-initialized', value: true });
    return;
  }
  const keepCustomCouriers = current.couriers.filter(c => !c.isPreset);
  const data: AppData = {
    products: sampleProducts, packaging: samplePackaging, orders: sampleOrders,
    shipments: sampleShipments, couriers: [...defaultCouriers, ...keepCustomCouriers], settings: current.settings ?? defaultSettings
  };
  await replaceAllData(data);
}

export async function resetSampleData(): Promise<void> {
  const current = await getAllData();
  const customOrders = current.orders.filter(x => !x.isSample);
  const customShipments = current.shipments.filter(x => !x.isSample);
  const referencedProducts = new Set<string>([
    ...customOrders.flatMap(order => order.items.map(line => line.productId)),
    ...customShipments.flatMap(shipment => shipment.lines.map(line => line.productId))
  ]);
  const referencedPackaging = new Set(customShipments.map(shipment => shipment.packagingConfigId).filter((x): x is string => Boolean(x)));
  const retainedProducts = current.products.filter(x => !x.isSample || referencedProducts.has(x.id)).map(x => ({ ...x, isSample: false }));
  const retainedPackaging = current.packaging.filter(x => !x.isSample || referencedPackaging.has(x.id)).map(x => ({ ...x, isSample: false }));
  const productMap = new Map<string, Product>(sampleProducts.map(x => [x.id, x]));
  retainedProducts.forEach(x => productMap.set(x.id, x));
  const packageMap = new Map<string, PackagingConfig>(samplePackaging.map(x => [x.id, x]));
  retainedPackaging.forEach(x => packageMap.set(x.id, x));
  await replaceAllData({
    products: [...productMap.values()], packaging: [...packageMap.values()],
    orders: [...sampleOrders, ...customOrders], shipments: [...sampleShipments, ...customShipments],
    couriers: [...defaultCouriers, ...current.couriers.filter(c => !c.isPreset)], settings: current.settings
  });
}

export async function clearWorkspace(): Promise<void> {
  const current = await getAllData();
  await replaceAllData({ products: [], packaging: [], orders: [], shipments: [], couriers: defaultCouriers, settings: current.settings });
}

export async function initializeDatabase(): Promise<void> {
  const db = await openDatabase();
  if (!db.objectStoreNames.contains('products')) throw new Error('FragileFit database did not initialize correctly.');
  const couriers = await all<CourierSetting>('couriers');
  if (!couriers.length) for (const courier of defaultCouriers) await saveEntity('couriers', courier);
  const rows = await all<AppSettings & { id: string }>('meta');
  if (!rows.length) await saveSettings(defaultSettings);
  await seedDemoData(false);
}
