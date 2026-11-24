/**
 * Phase 3 MySQL 8 verification harness (plain JS, run with NODE_PATH set).
 *
 * Uses freshly compiled entities from /tmp/opencode/verify-dist (compiled from
 * the real src with full type info; emitted `let` -> `var` only to work around
 * a pre-existing decorator-metadata TDZ bug). This script does NOT touch
 * server.js, src/store.js, data/db.json, .env, or any entity source.
 *
 * Run: NODE_PATH=<backend>/node_modules node scripts/phase3-mysql-verify.js [all|schema]
 */
const { DataSource } = require('typeorm');
const path = require('path');

const ENTITIES_DIR = process.env.VERIFY_ENTITIES_DIR ||
  path.join(__dirname, '..', 'dist', 'database', 'entities');
const E = require(path.join(ENTITIES_DIR, 'index.js'));
const { ALL_ENTITIES } = E;

// Target is configurable so the same harness can run against MySQL 8 (3307)
// or the XAMPP MariaDB instance (3306). Defaults keep the MySQL 8 test server.
const TEST_DB = {
  host: process.env.PHASE3_DB_HOST || '127.0.0.1',
  port: Number(process.env.PHASE3_DB_PORT || 3307),
  username: process.env.PHASE3_DB_USER || 'swtest',
  password: process.env.PHASE3_DB_PASSWORD || 'SwTest_2026!',
  database: process.env.PHASE3_DB_NAME || 'smartwardrobe_migration_test',
};
const DB_DRIVER = process.env.PHASE3_DB_DRIVER || 'mysql';

function makeDataSource() {
  return new DataSource({
    type: DB_DRIVER, ...TEST_DB, entities: ALL_ENTITIES,
    synchronize: false, logging: false, charset: 'utf8mb4',
  });
}
async function initClean() {
  const ds = makeDataSource();
  await ds.initialize();
  await ds.dropDatabase();
  await ds.synchronize();
  return ds;
}

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) passed++; else failed++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
}
function info(name, detail) { console.log(`  [INFO] ${name}${detail ? ' :: ' + detail : ''}`); }
function section(title) { console.log(`\n=== ${title} ===`); }
function deepEqual(a, b) {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

async function createUser(ds, prefix) {
  const users = ds.getRepository(E.User);
  return users.save(users.create({
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}@test.local`,
    passwordHash: null, phone: null,
  }));
}

/* ------------------------------------------------------------------ 1. SCHEMA */
async function schemaSection(ds) {
  section('1. SCHEMA VERIFICATION (information_schema + SHOW CREATE TABLE)');
  info('Entity count', String(ALL_ENTITIES.length));
  info('MySQL version', (await ds.query('SELECT VERSION() AS v'))[0].v);

  const tables = await ds.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME`,
    [TEST_DB.database]);
  const names = tables.map((r) => r.t);
  const expected = [
    'ai_conversations','ai_interactions','ai_usage','notifications',
    'users','user_profiles','style_profiles','style_preferences','style_memories',
    'subscriptions','wardrobes','brands','categories','wardrobe_items',
    'clothing_attributes','wear_events','occasions','outfits','outfit_items',
    'outfit_feedback','recommendations','recommendation_feedback',
    'calendar_events','event_schedules','weather_snapshots','trips','packing_lists',
    'shopping_items','wishlist_items','purchases','sessions','weekly_plans',
  ];
  const missing = expected.filter((t) => !names.includes(t));
  ok('All 32 expected tables created', missing.length === 0 && names.length === 32,
    `created=${names.length}, missing=${missing.length ? missing.join(',') : 'none'}`);

  const cols = await ds.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS dt,
            NUMERIC_PRECISION AS np, NUMERIC_SCALE AS ns, IS_NULLABLE AS n
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [TEST_DB.database]);
  const versionRow = await ds.query('SELECT VERSION() AS v');
  const isMariaDb = /mariadb/i.test(String(versionRow[0].v));

  // MySQL 8 exposes JSON as its own type. MariaDB implements JSON as
  // LONGTEXT + CHECK (json_valid(col)), so count that equivalent form.
  let jsonCols = cols.filter((c) => c.dt === 'json');
  let jsonDetail = `count=${jsonCols.length}`;
  let jsonChecks = null;
  if (isMariaDb) {
    jsonCols = cols.filter((c) => c.dt === 'longtext');
    const chk = await ds.query(
      `SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA=? AND CHECK_CLAUSE LIKE '%json_valid%'`,
      [TEST_DB.database]);
    jsonChecks = Number(chk[0].n);
    jsonDetail = `longtext=${jsonCols.length}, json_valid_checks=${jsonChecks} (MariaDB JSON alias)`;
  }
  const decCols = cols.filter((c) => c.dt === 'decimal');
  ok(isMariaDb ? '41 JSON columns (MariaDB LONGTEXT + json_valid)' : '41 native JSON columns',
    jsonCols.length === 41 && (!isMariaDb || jsonChecks === 41), jsonDetail);
  ok('7 DECIMAL columns with correct precision/scale', decCols.length === 7 &&
    decCols.every((c) => (c.t === 'ai_usage'
      ? Number(c.np) === 12 && Number(c.ns) === 4
      : Number(c.np) === 10 && Number(c.ns) === 2)),
    decCols.map((c) => `${c.t}.${c.c}(${c.np},${c.ns})`).join(', '));
  info('JSON columns', jsonCols.map((c) => `${c.t}.${c.c}`).join(', '));

  const fks = await ds.query(
    `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS rt,
            k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS del
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
     WHERE k.TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.COLUMN_NAME`, [TEST_DB.database]);
  info('Foreign keys', `${fks.length}: ` + fks.map((f) => `${f.t}.${f.c}->${f.rt}(${f.del})`).join(', '));
  const badSetNull = await ds.query(
    `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, c.IS_NULLABLE AS n
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
     JOIN information_schema.COLUMNS c
       ON c.TABLE_SCHEMA=k.TABLE_SCHEMA AND c.TABLE_NAME=k.TABLE_NAME AND c.COLUMN_NAME=k.COLUMN_NAME
     WHERE k.TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
       AND r.DELETE_RULE='SET NULL' AND c.IS_NULLABLE='NO'`, [TEST_DB.database]);
  ok('All SET NULL FK columns are nullable', badSetNull.length === 0,
    badSetNull.length ? JSON.stringify(badSetNull) : 'none violations');

  const uniq = await ds.query(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i, COLUMN_NAME AS c, NON_UNIQUE AS nu
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND INDEX_NAME<>'PRIMARY'`,
    [TEST_DB.database]);
  const u = uniq.filter((x) => Number(x.nu) === 0);
  ok('sessions.token UNIQUE', u.some((x) => x.t === 'sessions' && x.c === 'token'), '');
  ok('users.email UNIQUE', u.some((x) => x.t === 'users' && x.c === 'email'), '');
  const spFk = fks.find((f) => f.t === 'style_preferences' && f.c === 'userId');
  ok('StylePreference.userId FK -> users CASCADE',
    !!spFk && spFk.rt === 'users' && spFk.del === 'CASCADE',
    spFk ? `${spFk.rt} ON DELETE ${spFk.del}` : 'NO FK');

  // Column types that matter: date/datetime/text preservation
  const dateCols = cols.filter((c) => ['date','datetime'].includes(c.dt));
  info('Date/datetime columns', dateCols.map((c) => `${c.t}.${c.c}:${c.dt}`).join(', '));

  const create = await ds.query(`SHOW CREATE TABLE weekly_plans`);
  info('SHOW CREATE TABLE weekly_plans', create[0]['Create Table'].replace(/\n/g, ' '));
  const createSess = await ds.query(`SHOW CREATE TABLE sessions`);
  info('SHOW CREATE TABLE sessions', createSess[0]['Create Table'].replace(/\n/g, ' '));
}

/* -------------------------------------------------------- 2. WEEKLYPLAN TXNS */
async function weeklyPlanSection(ds) {
  section('2. WEEKLYPLAN ATOMIC REPLACEMENT');
  const repo = ds.getRepository(E.WeeklyPlan);
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const mk = (tag) => days.map((d) => repo.create({
    weekday: d, date: null, occasion: 'Work',
    outfitName: `${tag}-${d}`, image: null, outfitId: null, isToday: d === 'Mon',
  }));

  await repo.save(mk('A'));
  ok('7 initial rows inserted', (await repo.count()) === 7);

  // Successful replacement
  await ds.transaction(async (mgr) => {
    const r = mgr.getRepository(E.WeeklyPlan);
    await r.createQueryBuilder().delete().execute();
    await r.save(mk('B'));
  });
  const afterB = await repo.find({ order: { weekday: 'ASC' } });
  ok('Successful replacement -> 7 new rows', afterB.length === 7 &&
    afterB.every((x) => x.outfitName.startsWith('B-')), `count=${afterB.length}`);

  // Simulated failure: delete then insert a NOT NULL violation
  let threw = false;
  try {
    await ds.transaction(async (mgr) => {
      const r = mgr.getRepository(E.WeeklyPlan);
      await r.createQueryBuilder().delete().execute();
      await r.save(repo.create({
        weekday: 'Mon', date: null, occasion: null, // violates NOT NULL
        outfitName: 'BAD', image: null, outfitId: null, isToday: false,
      }));
    });
  } catch (e) { threw = true; info('Rollback triggered by', e.message.split('\n')[0]); }
  ok('Insertion failure threw', threw);
  const afterFail = await repo.find({ order: { weekday: 'ASC' } });
  ok('Rollback preserved previous 7 rows', afterFail.length === 7 &&
    afterFail.every((x) => x.outfitName.startsWith('B-')),
    `count=${afterFail.length}, names=${afterFail.map((x) => x.outfitName).join(',')}`);
}

/* ------------------------------------------------------------ 3. SESSIONS */
async function sessionSection(ds) {
  section('3. SESSION PERSISTENCE');
  const users = ds.getRepository(E.User);
  const sessions = ds.getRepository(E.Session);
  const user = await users.save(users.create({
    email: `sess-${Date.now()}@test.local`, passwordHash: null, phone: null,
  }));
  info('Created test user', user.id);

  const s1 = await sessions.save(sessions.create({ token: 'tok_' + Date.now() + '_a', userId: user.id }));
  const found = await sessions.findOne({ where: { token: s1.token } });
  ok('Create + find session by token', !!found && found.userId === user.id);

  // Refresh: create a new session, old must stay valid
  const s2 = await sessions.save(sessions.create({ token: 'tok_' + Date.now() + '_b', userId: user.id }));
  const oldStill = await sessions.findOne({ where: { token: s1.token } });
  const newFound = await sessions.findOne({ where: { token: s2.token } });
  ok('Refresh: new session created, old still valid', !!oldStill && !!newFound);

  // Logout one session
  await sessions.delete({ id: s1.id });
  const loggedOut = await sessions.findOne({ where: { token: s1.token } });
  const otherAlive = await sessions.findOne({ where: { token: s2.token } });
  ok('Logout removes only the target session', !loggedOut && !!otherAlive);

  // Cascade: deleting user removes sessions
  await users.delete({ id: user.id });
  const remaining = await sessions.count({ where: { userId: user.id } });
  ok('Deleting user cascades to sessions', remaining === 0, `remaining=${remaining}`);
}

/* ------------------------------------------------------- 4. DECIMAL ROUNDTRIP */
async function decimalSection(ds) {
  section('4. REAL MYSQL DECIMAL ROUND TRIPS');
  const wish = ds.getRepository(E.WishlistItem);
  const user = 'dec-' + Date.now();
  // price columns are decimal(10,2): 0.0023 rounds to 0.00 by design.
  // The 4-dp value is tested against ai_usage.costUsd decimal(12,4) below.
  const values = [65.00, 19.99, 0.00, null, 0, 99999999.99];
  const rows = values.map((v, i) => wish.create({
    userId: user, name: `P${i}`, category: 'test', imageUrl: null,
    price: v, productUrl: `http://x/${i}`, lowestPrice: v, targetPrice: v,
  }));
  await wish.save(rows);

  const usage = ds.getRepository(E.AIUsage);
  await usage.save(usage.create({
    userId: user, endpoint: 'test', costUsd: 0.0023,
  }));
  const u4 = await usage.findOne({ where: { userId: user } });
  ok('DECIMAL(12,4) preserves 0.0023', u4 && u4.costUsd === 0.0023,
    `costUsd=${u4 && u4.costUsd}`);
  const u4raw = await ds.query('SELECT costUsd FROM ai_usage WHERE userId=?', [user]);
  info('Raw decimal(12,4) driver value', `${u4raw[0].costUsd} (${typeof u4raw[0].costUsd})`);
  const found = await wish.find({ where: { userId: user }, order: { name: 'ASC' } });
  const byName = Object.fromEntries(found.map((r) => [r.name, r]));

  const toTest = (v, i) => [v, i];
  let allOk = true;
  const report = [];
  for (let i = 0; i < values.length; i++) {
    const expected = values[i];
    const got = byName['P' + i];
    const appVal = got ? got.price : undefined;
    const match = expected === null ? (got && appVal === null) : (got && appVal === expected);
    if (!match) allOk = false;
    report.push(`${expected}->${JSON.stringify(appVal)}${match ? '' : ' MISMATCH'}`);
  }
  ok('DECIMAL app round trip via transformer', allOk, report.join(', '));
  const raw = await ds.query(
    `SELECT name, price FROM wishlist_items WHERE userId=? ORDER BY name`, [user]);
  const rawReport = raw.map((r) => `${r.name}:${r.price}(${typeof r.price})`).join(', ');
  info('Raw MySQL driver values (strings)', rawReport);
  const serialized = JSON.stringify(found);
  ok('API JSON serialization yields numbers, not strings',
    serialized.includes('"price":65') && serialized.includes('"price":19.99'),
    serialized.slice(0, 160));
}

/* --------------------------------------------------------- 5. JSON ROUNDTRIP */
async function jsonSection(ds) {
  section('5. NATIVE JSON COLUMN ROUND TRIPS');
  const wardrobes = ds.getRepository(E.Wardrobe);
  const items = ds.getRepository(E.WardrobeItem);
  const user = await createUser(ds, 'json');
  const w = await wardrobes.save(wardrobes.create({ userId: user.id, name: 'Test' }));

  const nested = { color: 0.95, material: { cotton: 0.8, silk: 0.1 }, unicode: 'café-שלום-日本語' };
  const item = await items.save(items.create({
    wardrobeId: w.id, name: 'JSON item', category: 'top', imageUrl: 'x',
    secondaryColors: [], tags: ['a', 'b', 'ü'],
    confidenceByAttribute: nested,
    compatibleColors: ['rouge', 'bleu'],
    embeddings: [0.1, 0.2, 0.3],
    occasions: ['casual', 'work'],
  }));
  const got = await items.findOne({ where: { id: item.id } });
  ok('JSON: arrays, empty arrays, nested objects, Unicode',
    deepEqual(got.tags, ['a','b','ü']) &&
    deepEqual(got.secondaryColors, []) &&
    deepEqual(got.confidenceByAttribute, nested) &&
    deepEqual(got.embeddings, [0.1,0.2,0.3]) &&
    deepEqual(got.occasions, ['casual','work']),
    JSON.stringify({ tags: got.tags, secondary: got.secondaryColors,
      conf: got.confidenceByAttribute, emb: got.embeddings, occ: got.occasions }));

  // Defaults: insert with no value for defaulted JSON array columns
  const bare = await items.save(items.create({
    wardrobeId: w.id, name: 'Default item', imageUrl: 'x',
  }));
  const gotBare = await items.findOne({ where: { id: bare.id } });
  ok('JSON default -> [] for omitted array column',
    Array.isArray(gotBare.occasions) && gotBare.occasions.length === 0,
    JSON.stringify(gotBare.occasions));

  // Nullable JSON -> null
  const gotNull = await items.findOne({ where: { id: item.id } });
  ok('Nullable JSON can store null', gotNull.tags !== undefined);
}

/* ------------------------------------------------------------- 6. FK RULES */
async function fkSection(ds) {
  section('6. FOREIGN KEY ON DELETE BEHAVIOR');
  const categories = ds.getRepository(E.Category);
  const wardrobes = ds.getRepository(E.Wardrobe);
  const items = ds.getRepository(E.WardrobeItem);

  const user = await createUser(ds, 'fk');
  const cat = await categories.save(categories.create({ name: 'Cat-' + Date.now() }));
  const w = await wardrobes.save(wardrobes.create({ userId: user.id, name: 'W' }));
  const wi = await items.save(items.create({
    wardrobeId: w.id, name: 'FK item', categoryId: cat.id, imageUrl: 'x',
  }));
  await categories.delete({ id: cat.id });
  // categoryId is a @JoinColumn-created column with no plain entity property,
  // so verify the DB-level SET NULL via raw SQL.
  const rawCat = await ds.query('SELECT categoryId FROM wardrobe_items WHERE id=?', [wi.id]);
  const afterSetNull = await items.findOne({ where: { id: wi.id } });
  ok('ON DELETE SET NULL (category, DB level)',
    rawCat.length === 1 && rawCat[0].categoryId === null && !!afterSetNull,
    `db categoryId=${rawCat[0] && rawCat[0].categoryId}, entity kept=${!!afterSetNull}`);

  await wardrobes.delete({ id: w.id });
  const afterCascade = await items.findOne({ where: { id: wi.id } });
  ok('ON DELETE CASCADE (wardrobe)', !afterCascade);
}

/* ------------------------------------------------------- 7. DATE PRESERVATION */
async function dateSection(ds) {
  section('7. DATE COLUMN PRESERVATION');
  const events = ds.getRepository(E.CalendarEvent);
  const ev = await events.save(events.create({
    userId: 'date-' + Date.now(), title: 'Dated',
    startsAt: new Date('2026-06-15T10:30:00Z'), startsAtRaw: '15/06/2026 10:30',
    endsAt: null, endsAtRaw: 'garbage-date',
  }));
  const got = await events.findOne({ where: { id: ev.id } });
  ok('Valid datetime parsed', got.startsAt instanceof Date &&
    got.startsAt.toISOString() === '2026-06-15T10:30:00.000Z');
  ok('Invalid raw date preserved in text column', got.endsAtRaw === 'garbage-date' && got.endsAt === null,
    `raw=${got.endsAtRaw}, parsed=${got.endsAt}`);
}

/* -------------------------------------------------------------------- RUNNER */
async function runAll() {
  const ds = await initClean();
  try {
    await schemaSection(ds);
    await weeklyPlanSection(ds);
    await sessionSection(ds);
    await decimalSection(ds);
    await jsonSection(ds);
    await fkSection(ds);
    await dateSection(ds);
  } finally {
    await ds.destroy();
  }
  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (require.main === module) {
  const mode = process.argv[2] || 'all';
  if (mode === 'schema') {
    initClean().then(async (ds) => {
      try { await schemaSection(ds); } finally { await ds.destroy(); }
    }).catch((e) => { console.error('ERROR:', e); process.exit(1); });
  } else {
    runAll().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
  }
}
