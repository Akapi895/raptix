import assert from 'node:assert/strict';
import { createDbClient } from '../../src/db/client.js';
import { PrismaAppConfigStore } from '../../src/db/app-config-store.js';
import { SpecialistConfigurationService } from '../../src/services/specialist-configuration.js';
import { FakeRuntime } from '../support/fake-runtime.js';

// Explicit opt-in lane, targeting a disposable migrated database only.
async function verifyPersistence(): Promise<void> {
    assert.ok(process.env.SPECIALIST_TEST_DATABASE_URL, 'Set SPECIALIST_TEST_DATABASE_URL to a disposable migrated database');
    const connectionString = process.env.SPECIALIST_TEST_DATABASE_URL!;
    const runtime = new FakeRuntime();
    runtime.specialistCatalog = { tools: [{ id: 'tool:solidity_scan' }], skills: [], servers: [] };
    let db = createDbClient({ connectionString });
    await db.appConfig.deleteMany({ where: { key: 'specialist-capabilities-v1' } });
    const service = new SpecialistConfigurationService(new PrismaAppConfigStore(db), runtime);
    const additions = { skills: [], tools: ['tool:solidity_scan'], mcp: [] };
    await service.update('recon', null, additions, 0);
    const contenders = await Promise.allSettled([service.update('recon', 'project-a', additions, 1), service.update('recon', 'project-b', additions, 1)]);
    assert.equal(contenders.filter(c => c.status === 'fulfilled').length, 1);
    await db.$disconnect();
    db = createDbClient({ connectionString });
    try {
      const restored = await new SpecialistConfigurationService(new PrismaAppConfigStore(db), runtime).snapshot(null);
      assert.equal(restored.revision, 2); assert.deepEqual(restored.specialists.recon.tools, additions.tools);
    } finally { await db.$disconnect(); }
}
await verifyPersistence();
