/**
 * D1 test database verification — ensures E2E tests connect to
 * an isolated test instance, NOT production.
 *
 * Checks for a _test_marker table with env=test in the database
 * identified by CF_D1_DATABASE_ID_TEST.
 *
 * Hard-fails if:
 *  - CF_D1_DATABASE_ID_TEST is not set
 *  - The _test_marker table does not exist
 *  - The marker value is not 'test'
 *  - The database ID matches the production CF_D1_DATABASE_ID
 */

import { query } from "../src/lib/d1";

async function main() {
  const testDbId = process.env.CF_D1_DATABASE_ID_TEST;
  const prodDbId = process.env.CF_D1_DATABASE_ID;

  console.log("--- D1 Test Database Verification ---\n");

  // 1. CF_D1_DATABASE_ID_TEST must be set
  if (!testDbId) {
    console.error(
      "CF_D1_DATABASE_ID_TEST is not set. E2E tests require an isolated test database.",
    );
    console.error("Set it in .env.e2e or via the dev:e2e script.\n");
    process.exit(1);
  }

  console.log(`Test database ID: ${testDbId}`);

  // 2. Test DB must differ from production DB
  if (prodDbId && testDbId === prodDbId) {
    console.error(
      `\nFATAL: CF_D1_DATABASE_ID_TEST (${testDbId}) matches CF_D1_DATABASE_ID!`,
    );
    console.error("E2E tests must NOT run against the production database.\n");
    process.exit(1);
  }

  // 3. Verify _test_marker table exists with env=test
  try {
    const rows = await query<{ key: string; value: string }>(
      "SELECT key, value FROM _test_marker WHERE key = ?",
      ["env"],
    );

    if (rows.length === 0) {
      console.error(
        `\nD1 test marker missing: database ${testDbId} has no _test_marker row with key='env'.`,
      );
      console.error(
        "Create it with: INSERT INTO _test_marker (key, value) VALUES ('env', 'test');\n",
      );
      process.exit(1);
    }

    const marker = rows[0];
    if (!marker || marker.value !== "test") {
      console.error(
        `\nD1 test marker invalid: expected env='test', got env='${marker?.value ?? "null"}'.`,
      );
      console.error("This database is not configured for E2E testing.\n");
      process.exit(1);
    }

    console.log("_test_marker.env = 'test' ✓");
  } catch (err) {
    console.error(`\nD1 test marker verification failed: ${err}`);
    console.error(
      `The _test_marker table may not exist in database ${testDbId}.`,
    );
    console.error(
      "Create it with: CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT); INSERT INTO _test_marker VALUES ('env', 'test');\n",
    );
    process.exit(1);
  }

  console.log("\nTest database verification passed.\n");
}

void main();
