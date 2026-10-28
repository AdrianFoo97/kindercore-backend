import { defineConfig } from 'vitest/config';

// Integration tests (src/tests/integration) run against a real MySQL test
// database — see src/tests/integration/testDb.ts. DATABASE_URL is pointed
// at it here, before any test imports db/client.ts, so app code under test
// connects to the test DB and never to the dev/production one.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3307/kindercore_test';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/tests/integration/globalSetup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, TEST_DATABASE_URL },
    // Test files share one database — run them one at a time so one
    // file's resetTables() can't wipe another's fixtures mid-test.
    fileParallelism: false,
  },
});
