import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './data-source';
import { seedDemoDatabase } from './seed.service';
import { DEMO_EMAIL, DEMO_PASSWORD } from './demo-data';

type Mode = 'postgres' | 'better-sqlite3' | 'mysql';

const mode = resolveMode();

const booleanKeys = new Set([
  'database.ssl',
  'database.synchronize',
  'database.logging',
]);

const configMap: Record<string, string | undefined> = {
  'database.type': process.env.DB_TYPE,
  'database.host': process.env.DB_HOST,
  'database.port': process.env.DB_PORT,
  'database.username': process.env.DB_USERNAME,
  'database.password': process.env.DB_PASSWORD,
  'database.database': mode === 'better-sqlite3'
    ? (process.env.DB_SQLITE_PATH ?? 'data/smartwardrobe.sqlite')
    : process.env.DB_NAME,
  'database.ssl': process.env.DB_SSL,
  'database.synchronize': process.env.DB_SYNCHRONIZE,
  'database.logging': process.env.DB_LOGGING,
};

const config: any = {
  get: <T>(key: string, fallback?: T): T | undefined => {
    const value = configMap[key];
    if (value === undefined || value === '') return fallback;
    if (booleanKeys.has(key)) {
      return (['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) as unknown) as T;
    }
    return (value as unknown) as T;
  },
};

function resolveMode(): Mode {
  const requested = (process.env.DB_TYPE ?? 'sqlite').toLowerCase();
  if (requested === 'postgres') return 'postgres';
  if (requested === 'mysql') return 'mysql';
  return 'better-sqlite3';
}

async function main(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(config, mode));

  try {
    await ds.initialize();
    console.log(`Connected to ${mode}. Seeding demo data...`);

    // Explicit seed operation: it only inserts rows whose deterministic demo
    // id is missing. Existing user-generated records are never touched, and
    // nothing is truncated or reset.
    const report = await seedDemoDatabase(ds);

    const created = Object.values(report.created).reduce((a, b) => a + b, 0);
    const skipped = Object.values(report.skipped).reduce((a, b) => a + b, 0);
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nSeeded ${created} new row(s), skipped ${skipped} existing row(s).`);
    console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
