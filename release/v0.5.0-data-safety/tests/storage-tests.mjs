import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const database = await import('../assets/db.js');

const originalData = () => ({
  products: [{ id: 'keep-product', name: 'Original product' }],
  packaging: [{ id: 'keep-pack', name: 'Original packaging' }],
  orders: [{ id: 'keep-order', orderNumber: 'KEEP-001' }],
  shipments: [{ id: 'keep-shipment', trackingRef: 'KEEP-SHIP-001' }],
  couriers: [{ id: 'keep-courier', name: 'Original courier', mode: 'Surface', divisor: 4000, rounding: 'half' }],
  settings: { businessName: 'Original workspace', currency: 'INR', unitSystem: 'metric', theme: 'light' }
});

const testResults = [];
async function test(name, fn) {
  try {
    await fn();
    testResults.push({ name, passed: true, detail: 'Passed' });
  } catch (error) {
    testResults.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function withNavigator(value, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value });
  try { await fn(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
}

export async function runStorageTests() {
  await test('Workspace replacement saves all record groups', async () => {
    await database.replaceAllData(originalData());
    const saved = await database.getAllData();
    assert.equal(saved.products[0]?.id, 'keep-product');
    assert.equal(saved.packaging[0]?.id, 'keep-pack');
    assert.equal(saved.orders[0]?.id, 'keep-order');
    assert.equal(saved.shipments[0]?.id, 'keep-shipment');
    assert.equal(saved.couriers[0]?.id, 'keep-courier');
    assert.equal(saved.settings.businessName, 'Original workspace');
  });

  await test('Failed restore rolls back queued clears and writes', async () => {
    await database.replaceAllData(originalData());
    const invalidReplacement = {
      ...originalData(),
      products: [{ id: 'new-product', name: 'Should not be committed' }],
      packaging: [{ id: 'new-pack', name: 'Should also roll back', invalidValue: () => 'not cloneable' }]
    };
    await assert.rejects(database.replaceAllData(invalidReplacement));
    const afterFailure = await database.getAllData();
    assert.equal(afterFailure.products.length, 1);
    assert.equal(afterFailure.products[0]?.id, 'keep-product');
    assert.equal(afterFailure.packaging.length, 1);
    assert.equal(afterFailure.packaging[0]?.id, 'keep-pack');
    assert.equal(afterFailure.orders[0]?.id, 'keep-order');
    assert.equal(afterFailure.shipments[0]?.id, 'keep-shipment');
    assert.equal(afterFailure.settings.businessName, 'Original workspace');
  });

  await test('Successful restore replaces the complete workspace', async () => {
    const replacement = {
      products: [{ id: 'new-product', name: 'Replacement product' }],
      packaging: [],
      orders: [{ id: 'new-order', orderNumber: 'NEW-001' }],
      shipments: [],
      couriers: [],
      settings: { businessName: 'New workspace', currency: 'INR', unitSystem: 'metric', theme: 'light' }
    };
    await database.replaceAllData(replacement);
    const restored = await database.getAllData();
    assert.deepEqual(restored.products.map(x => x.id), ['new-product']);
    assert.deepEqual(restored.orders.map(x => x.id), ['new-order']);
    assert.equal(restored.packaging.length, 0);
    assert.equal(restored.shipments.length, 0);
    assert.equal(restored.settings.businessName, 'New workspace');
  });

  await test('Restore rejects missing and duplicate record IDs before changing data', async () => {
    const current = {
      products: [{ id: 'safe-product', name: 'Safe product' }],
      packaging: [], orders: [], shipments: [], couriers: [],
      settings: { businessName: 'Safe', currency: 'INR', unitSystem: 'metric', theme: 'light' }
    };
    await database.replaceAllData(current);
    await assert.rejects(database.replaceAllData({ ...current, products: [{ name: 'Missing ID' }] }), /missing its ID/i);
    await assert.rejects(database.replaceAllData({ ...current, products: [{ id: 'duplicate' }, { id: 'duplicate' }] }), /duplicate ID/i);
    const after = await database.getAllData();
    assert.equal(after.products[0]?.id, 'safe-product');
  });

  await test('Persistent storage status reports a browser grant', async () => {
    await withNavigator({ storage: { persisted: async () => true, persist: async () => true } }, async () => {
      assert.deepEqual(await database.getStorageProtectionStatus(), { supported: true, persistent: true });
    });
  });

  await test('Persistent storage request reports when the browser declines', async () => {
    await withNavigator({ storage: { persisted: async () => false, persist: async () => false } }, async () => {
      assert.deepEqual(await database.requestStorageProtection(), { supported: true, persistent: false });
    });
  });

  await test('Storage protection reports unsupported browsers honestly', async () => {
    await withNavigator({ storage: {} }, async () => {
      assert.deepEqual(await database.getStorageProtectionStatus(), { supported: false, persistent: null });
      assert.deepEqual(await database.requestStorageProtection(), { supported: false, persistent: null });
    });
  });

  return testResults;
}
