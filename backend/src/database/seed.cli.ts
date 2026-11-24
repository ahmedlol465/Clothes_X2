import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './data-source';
import { seedDemoDatabase } from './seed.service';
import { DEMO_EMAIL, DEMO_PASSWORD } from './demo-data';

const booleanKeys = new Set([
  'database.synchronize',
  'database.logging',
]);

const configMap: Record<string, string | undefined> = {
  'database.type': 'mysql',
  'database.host': process.env.DB_HOST,
  'database.port': process.env.DB_PORT,
  'database.username': process.env.DB_USERNAME,
  'database.password': process.env.DB_PASSWORD,
  'database.database': process.env.DB_NAME,
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

async function main(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(config));

  try {
    await ds.initialize();
    console.log('Connected to MySQL. Seeding demo data...');

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
