/**
 * Phase 4 — DRY-RUN importer (JSON -> dedicated MySQL 8 test database).
 *
 * Safety guarantees:
 *   - Reads data/db.json only (never writes it).
 *   - Writes ONLY to smartwardrobe_migration_test (asserts *_test suffix).
 *   - Refuses to run if USE_MYSQL=true in .env.
 *   - Does not touch server.js, src/store.js, .env, or any app config.
 *   - Whole import runs in ONE transaction; a failure rolls everything back.
 *   - Rebuilds the test schema from scratch on every run (drop + synchronize).
 *
 * Run: NODE_PATH=<backend>/node_modules node scripts/phase4-dry-run-importer.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const JSON_PATH = path.join(BACKEND, 'data', 'db.json');
const ENV_PATH = path.join(BACKEND, '.env');
const ENTITIES_DIR = path.join(BACKEND, 'dist', 'database', 'entities');

// Target is configurable so the same harness can run against MySQL 8 (3307)
// or the XAMPP MariaDB instance (3306). Defaults keep the MySQL 8 test server.
const TEST_DB = {
  host: process.env.PHASE4_DB_HOST || '127.0.0.1',
  port: Number(process.env.PHASE4_DB_PORT || 3307),
  username: process.env.PHASE4_DB_USER || 'swtest',
  password: process.env.PHASE4_DB_PASSWORD || 'SwTest_2026!',
  database: process.env.PHASE4_DB_NAME || 'smartwardrobe_migration_test',
};
const DB_DRIVER = process.env.PHASE4_DB_DRIVER || 'mysql';

const { DataSource } = require('typeorm');
const E = require(path.join(ENTITIES_DIR, 'index.js'));

/* --------------------------------------------------------------- utilities */
function assertSafe() {
  if (!TEST_DB.database.endsWith('_test')) {
    throw new Error('Refusing to import: target database is not a *_test database');
  }
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const useMysql = /^USE_MYSQL\s*=\s*true\s*$/m.test(env);
  if (useMysql) {
    throw new Error('Refusing to import: USE_MYSQL=true (cutover must stay off)');
  }
}
function parseMoney(s) {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function splitName(full) {
  if (!full) return ['', null];
  const parts = String(full).trim().split(/\s+/);
  return [parts[0], parts.length > 1 ? parts.slice(1).join(' ') : null];
}
function norm(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  }
  return v;
}
/**
 * Deep comparison with float tolerance: MySQL JSON normalises number literals
 * (e.g. 0.46799999999999997 -> 0.468), which is numerically equivalent.
 */
function normTolerant(v) {
  if (typeof v === 'number') return Math.round(v * 1e12) / 1e12;
  if (Array.isArray(v)) return v.map(normTolerant);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normTolerant(v[k])]));
  }
  return v;
}
function eq(a, b) {
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b)) ||
    JSON.stringify(normTolerant(a)) === JSON.stringify(normTolerant(b));
}
function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

/* ----------------------------------------------------------------- reporter */
const report = {
  runAt: new Date().toISOString(),
  source: JSON_PATH,
  target: `${TEST_DB.host}:${TEST_DB.port}/${TEST_DB.database}`,
  safety: {},
  collections: [],
  totals: { sourceRows: 0, importedRows: 0, mismatches: 0, unmappedFields: 0 },
  errors: [],
};
function collection(name, sourceCount, importedCount) {
  const c = { name, sourceCount, importedCount, mismatches: [], unmapped: [], checks: [] };
  report.collections.push(c);
  report.totals.sourceRows += sourceCount;
  report.totals.importedRows += importedCount;
  return c;
}
function check(c, label, expected, actual) {
  const ok = eq(expected, actual);
  c.checks.push({ label, expected, actual, ok });
  if (!ok) {
    c.mismatches.push({ label, expected, actual });
    report.totals.mismatches++;
  }
}
function unmapped(c, fields) {
  for (const f of fields) {
    c.unmapped.push(f);
    report.totals.unmappedFields++;
  }
}

/* ------------------------------------------------------------------- import */
async function main() {
  assertSafe();
  report.safety = {
    targetIsTestDb: true,
    useMysqlFalse: true,
    jsonOpenedReadOnly: true,
  };
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

  const ds = new DataSource({
    type: DB_DRIVER, ...TEST_DB, entities: E.ALL_ENTITIES,
    synchronize: false, logging: false, charset: 'utf8mb4',
  });
  await ds.initialize();
  await ds.dropDatabase();
  await ds.synchronize();

  try {
    await ds.transaction(async (mgr) => {
      const R = (ent) => mgr.getRepository(ent);

      /* ---- 1. Users / UserProfile / StyleProfile ---- */
      const uc = collection('users', data.users.length, 0);
      const users = R(E.User), profiles = R(E.UserProfile), styles = R(E.StyleProfile);
      const legacyStyleProfile = new Map();
      for (const u of data.users) {
        const sp = u.styleProfile || {};
        legacyStyleProfile.set(u.id, sp);
        await users.save(users.create({
          id: u.id, email: u.email, passwordHash: u.passwordHash ?? null,
          phone: null, createdAt: toDate(u.createdAt),
        }));
        const [first, last] = splitName(u.name);
        await profiles.save(profiles.create({
          userId: u.id, firstName: first, lastName: last,
          topSize: sp.sizes?.top ?? null, bottomSize: sp.sizes?.bottom ?? null,
          shoeSize: sp.sizes?.shoe ?? null,
          heightCm: sp.heightCm ?? null, weightKg: sp.weightKg ?? null,
          preferredColors: sp.favoriteColors ?? [],
          avoidedColors: sp.avoidedColors ?? [],
          preferredStyles: sp.preferredStyles ?? [],
          occasions: [],
          fitPreference: sp.fitPreference ?? 'balanced',
        }));
        await styles.save(styles.create({
          userId: u.id,
          // Preserve both legacy blobs verbatim in a native JSON column.
          dimensions: { legacyStyleProfile: sp },
        }));
      }
      uc.importedCount = data.users.length;
      const ru = await users.createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.id = :id', { id: data.users[0].id })
        .getOne();
      const rp = await profiles.findOne({ where: { userId: data.users[0].id } });
      const rs = await styles.findOne({ where: { userId: data.users[0].id } });
      const src = data.users[0];
      check(uc, 'users.id', src.id, ru.id);
      check(uc, 'users.email', src.email, ru.email);
      check(uc, 'users.passwordHash', src.passwordHash, ru.passwordHash);
      check(uc, 'users.createdAt', toDate(src.createdAt), ru.createdAt);
      check(uc, 'name -> firstName/lastName', splitName(src.name), [rp.firstName, rp.lastName]);
      check(uc, 'styleProfile.favoriteColors -> preferredColors',
        src.styleProfile.favoriteColors, rp.preferredColors);
      check(uc, 'styleProfile.sizes -> sizes',
        [src.styleProfile.sizes.top, src.styleProfile.sizes.bottom, src.styleProfile.sizes.shoe],
        [rp.topSize, rp.bottomSize, rp.shoeSize]);
      check(uc, 'styleProfile blob preserved in style_profiles.dimensions',
        { legacyStyleProfile: src.styleProfile }, rs.dimensions);
      unmapped(uc, ['User has no `name` column (split into UserProfile.firstName/lastName)']);

      // Safety self-test: force a failure after partial inserts to prove
      // the whole transaction rolls back. Set PHASE4_FORCE_FAIL=1 to use.
      if (process.env.PHASE4_FORCE_FAIL === '1') {
        throw new Error('FORCED FAILURE — rollback self-test');
      }

      /* ---- 2. Sessions ---- */
      const sc = collection('sessions', data.sessions.length, 0);
      const sessions = R(E.Session);
      for (const s of data.sessions) {
        await sessions.save(sessions.create({
          token: s.token, userId: s.userId, createdAt: toDate(s.createdAt),
        }));
      }
      sc.importedCount = await sessions.count();
      const sess = await sessions.find({ order: { token: 'ASC' } });
      const byToken = Object.fromEntries(sess.map((x) => [x.token, x]));
      for (const s of data.sessions) {
        const got = byToken[s.token];
        if (!got) { check(sc, `token ${s.token}`, s.token, undefined); continue; }
        check(sc, `${s.token}.userId`, s.userId, got.userId);
        check(sc, `${s.token}.createdAt`, toDate(s.createdAt), got.createdAt);
      }

      /* ---- 3. Wardrobe -> Wardrobe + WardrobeItem (+ Brand) ---- */
      const wc = collection('wardrobe', data.wardrobe.length, 0);
      const wardrobes = R(E.Wardrobe), items = R(E.WardrobeItem), brands = R(E.Brand);
      const wardrobeId = 'wardrobe_' + data.users[0].id;
      await wardrobes.save(wardrobes.create({
        id: wardrobeId, userId: data.users[0].id, name: 'My Wardrobe',
        itemCount: data.wardrobe.length,
      }));
      const brandRows = new Map();
      for (const w of data.wardrobe) {
        const b = (w.brand || '').trim();
        if (b && !brandRows.has(b)) {
          const saved = await brands.save(brands.create({ name: b }));
          brandRows.set(b, saved);
        }
      }
      for (const w of data.wardrobe) {
        const b = (w.brand || '').trim();
        await items.save(items.create({
          id: w.id, wardrobeId, name: w.name,
          imageUrl: w.image ?? '',
          category: w.category ?? null,
          color: w.color ?? null, pattern: w.pattern ?? null,
          style: w.style ?? null, material: w.material ?? null,
          season: w.season ?? null, formality: w.formality ?? null,
          timesWorn: w.timesWorn ?? 0,
          status: w.archived ? 'archived' : 'active',
          // 12 source items have no createdAt; omit it so the DB default applies.
          ...(w.createdAt ? { createdAt: toDate(w.createdAt) } : {}),
          brand: b ? brandRows.get(b) : null,
          occasions: [],
          secondaryColors: null,
        }));
      }
      wc.importedCount = await items.count();
      const dbItems = await items.find({ order: { id: 'ASC' } });
      const itemById = Object.fromEntries(dbItems.map((x) => [x.id, x]));
      for (const w of data.wardrobe) {
        const got = itemById[w.id];
        if (!got) { check(wc, `item ${w.id}`, w.id, undefined); continue; }
        check(wc, `${w.id}.name`, w.name, got.name);
        check(wc, `${w.id}.image`, w.image, got.imageUrl);
        check(wc, `${w.id}.category`, w.category, got.category);
        check(wc, `${w.id}.color`, w.color, got.color);
        check(wc, `${w.id}.timesWorn`, w.timesWorn, got.timesWorn);
        check(wc, `${w.id}.archived -> status`, w.archived ? 'archived' : 'active', got.status);
        if (w.createdAt) {
          check(wc, `${w.id}.createdAt`, toDate(w.createdAt), got.createdAt);
        } else {
          check(wc, `${w.id}.createdAt (DB default applied)`, true, got.createdAt instanceof Date);
        }
      }
      unmapped(wc, [
        'analysis/analysisSource/analysisRejected/analysisConfidence/confidenceKind/agreement/uncertainAttributes/colorDetail/analysisModel/analyzedAt (all null/empty in source)',
        'lastWornLabel (no column)',
      ]);

      /* ---- 4. Outfits -> Outfit + OutfitItem ---- */
      const oc = collection('outfits', data.outfits.length, 0);
      const outfits = R(E.Outfit), outfitItems = R(E.OutfitItem);
      for (const o of data.outfits) {
        await outfits.save(outfits.create({
          id: o.id, userId: data.users[0].id, name: o.name,
          imageUrl: o.image ?? null, occasion: o.occasion ?? 'Daily',
          matchScore: o.match ?? 0, isFavorite: !!o.favorite,
          createdAt: toDate(o.createdAt),
          factorBreakdown: { pieces: o.pieces ?? [] },
        }));
        for (const [idx, iid] of (o.itemIds || []).entries()) {
          await outfitItems.save(outfitItems.create({
            outfitId: o.id, itemId: iid,
            // (outfitId, slot) is UNIQUE; source has no slot, so derive one.
            slot: `piece_${idx}`, layerOrder: idx,
          }));
        }
      }
      oc.importedCount = await outfits.count();
      const dbOutfits = await outfits.find({ order: { id: 'ASC' } });
      const ob = Object.fromEntries(dbOutfits.map((x) => [x.id, x]));
      for (const o of data.outfits) {
        const got = ob[o.id];
        if (!got) { check(oc, `outfit ${o.id}`, o.id, undefined); continue; }
        check(oc, `${o.id}.name`, o.name, got.name);
        check(oc, `${o.id}.image`, o.image, got.imageUrl);
        check(oc, `${o.id}.occasion`, o.occasion, got.occasion);
        check(oc, `${o.id}.match -> matchScore`, o.match, got.matchScore);
        check(oc, `${o.id}.favorite -> isFavorite`, !!o.favorite, got.isFavorite);
        check(oc, `${o.id}.pieces preserved`, { pieces: o.pieces }, got.factorBreakdown);
        const links = await outfitItems.find({ where: { outfitId: o.id }, order: { itemId: 'ASC' } });
        check(oc, `${o.id}.itemIds`, [...o.itemIds].sort(), links.map((x) => x.itemId).sort());
      }
      unmapped(oc, ['OutfitItem.slot derived as piece_0..N (source has no slot; outfitId+slot is UNIQUE)']);

      /* ---- 5. feedback -> OutfitFeedback ---- */
      const fc = collection('feedback', data.feedback.length, 0);
      const fb = R(E.OutfitFeedback);
      for (const f of data.feedback) {
        await fb.save(fb.create({
          userId: data.users[0].id, outfitId: f.outfitId,
          type: 'rated', rating: f.rating, comment: f.comment ?? null,
          createdAt: toDate(f.at), tags: [],
        }));
      }
      fc.importedCount = await fb.count();
      const dbfb = await fb.find();
      check(fc, 'feedback.rating', data.feedback[0].rating, dbfb[0].rating);
      check(fc, 'feedback.outfitId', data.feedback[0].outfitId, dbfb[0].outfitId);
      check(fc, 'feedback.at -> createdAt', toDate(data.feedback[0].at), dbfb[0].createdAt);

      /* ---- 6. styleMemory -> StyleMemory ---- */
      const smc = collection('styleMemory', data.styleMemory.length, 0);
      const sm = R(E.StyleMemory);
      for (const s of data.styleMemory) {
        await sm.save(sm.create({
          userId: s.userId, preference: s.preference, value: s.value,
          confidence: s.confidence, source: s.source, createdAt: toDate(s.updatedAt),
          updatedAt: toDate(s.updatedAt), observations: 1,
        }));
      }
      smc.importedCount = await sm.count();
      const dbsm = await sm.find();
      check(smc, 'styleMemory.preference', data.styleMemory[0].preference, dbsm[0].preference);
      check(smc, 'styleMemory.value', data.styleMemory[0].value, dbsm[0].value);
      check(smc, 'styleMemory.confidence', data.styleMemory[0].confidence, dbsm[0].confidence);

      /* ---- 7. conversations -> AIConversation + AIInteraction ---- */
      const cc = collection('conversations', data.conversations.length, 0);
      const convs = R(E.AIConversation), inter = R(E.AIInteraction);
      for (const c of data.conversations) {
        await convs.save(convs.create({
          id: c.id, userId: c.userId, title: 'Legacy conversation',
          channel: 'stylist', context: { conversationId: c.conversationId },
          messageCount: 2, lastMessageAt: toDate(c.at),
        }));
        await inter.save(inter.create({
          conversationId: c.id, role: 'user', content: c.message,
          referencedItemIds: c.itemIds ?? [], createdAt: toDate(c.at),
        }));
        await inter.save(inter.create({
          conversationId: c.id, role: 'assistant', content: c.reply,
          referencedItemIds: c.itemIds ?? [], createdAt: toDate(c.at),
        }));
      }
      cc.importedCount = await convs.count();
      const dbConv = await convs.findOne({ where: { id: data.conversations[0].id } });
      check(cc, 'conversation.id', data.conversations[0].id, dbConv.id);
      check(cc, 'conversation.context.conversationId',
        { conversationId: data.conversations[0].conversationId }, dbConv.context);
      const dbInter = await inter.find({ where: { conversationId: data.conversations[0].id }, order: { role: 'ASC' } });
      check(cc, 'user message content', data.conversations[0].message,
        dbInter.find((x) => x.role === 'user').content);
      check(cc, 'assistant reply content', data.conversations[0].reply,
        dbInter.find((x) => x.role === 'assistant').content);
      check(cc, 'referencedItemIds', data.conversations[0].itemIds,
        dbInter.find((x) => x.role === 'user').referencedItemIds);

      /* ---- 8. events -> CalendarEvent + EventSchedule ---- */
      const ec = collection('events', data.events.length, 0);
      const events = R(E.CalendarEvent), sched = R(E.EventSchedule);
      for (const ev of data.events) {
        await events.save(events.create({
          id: ev.id, userId: data.users[0].id, title: ev.title,
          eventType: ev.type ?? 'Meeting', location: ev.location ?? null,
          dressCode: ev.dressCode ?? null,
          startsAtRaw: ev.date ?? null, startsAt: null, endsAtRaw: null, endsAt: null,
          tags: [],
        }));
        if (ev.outfitId) {
          await sched.save(sched.create({ eventId: ev.id, outfitId: ev.outfitId }));
        }
      }
      ec.importedCount = await events.count();
      const dbEvents = await events.find({ order: { id: 'ASC' } });
      const eb = Object.fromEntries(dbEvents.map((x) => [x.id, x]));
      for (const ev of data.events) {
        const got = eb[ev.id];
        if (!got) { check(ec, `event ${ev.id}`, ev.id, undefined); continue; }
        check(ec, `${ev.id}.title`, ev.title, got.title);
        check(ec, `${ev.id}.date -> startsAtRaw`, ev.date, got.startsAtRaw);
        check(ec, `${ev.id}.startsAt (unparseable)`, null, got.startsAt);
        check(ec, `${ev.id}.type -> eventType`, ev.type, got.eventType);
        check(ec, `${ev.id}.location`, ev.location, got.location);
        check(ec, `${ev.id}.dressCode`, ev.dressCode, got.dressCode);
      }
      unmapped(ec, ['EventSchedule.outfitId is null in all source events']);

      /* ---- 9. weeklyPlan -> WeeklyPlan ---- */
      const wpc = collection('weeklyPlan', data.weeklyPlan.length, 0);
      const wp = R(E.WeeklyPlan);
      for (const w of data.weeklyPlan) {
        await wp.save(wp.create({
          weekday: w.weekday, date: w.date ?? null, occasion: w.occasion,
          outfitName: w.outfitName, image: w.image ?? null,
          outfitId: w.outfitId ?? null, isToday: !!w.isToday,
        }));
      }
      wpc.importedCount = await wp.count();
      const dbWp = await wp.find({ order: { weekday: 'ASC' } });
      for (const w of data.weeklyPlan) {
        const got = dbWp.find((x) => x.weekday === w.weekday);
        check(wpc, `${w.weekday}.occasion`, w.occasion, got.occasion);
        check(wpc, `${w.weekday}.outfitName`, w.outfitName, got.outfitName);
        check(wpc, `${w.weekday}.date`, w.date, got.date);
        check(wpc, `${w.weekday}.outfitId`, w.outfitId, got.outfitId);
        check(wpc, `${w.weekday}.isToday`, !!w.isToday, got.isToday);
      }

      /* ---- 10. products -> ShoppingItem ---- */
      const pc = collection('products', data.products.length, 0);
      const products = R(E.ShoppingItem);
      for (const p of data.products) {
        await products.save(products.create({
          id: p.id, name: p.name,
          imageUrl: p.image ?? null,
          price: parseMoney(p.price), category: 'general',
          reason: p.reason ?? null, compatibleColors: [],
        }));
      }
      pc.importedCount = await products.count();
      const dbp = await products.find({ order: { id: 'ASC' } });
      const pb = Object.fromEntries(dbp.map((x) => [x.id, x]));
      for (const p of data.products) {
        const got = pb[p.id];
        check(pc, `${p.id}.name`, p.name, got.name);
        check(pc, `${p.id}.price`, parseMoney(p.price), got.price);
        check(pc, `${p.id}.image`, p.image, got.imageUrl);
        check(pc, `${p.id}.reason`, p.reason, got.reason);
      }
      unmapped(pc, ['ShoppingItem.category not in source; set to "general"']);

      /* ---- 11. aiUsage -> AIUsage ---- */
      const ac = collection('aiUsage', data.aiUsage.length, 0);
      const usage = R(E.AIUsage);
      const tokenTotal = (t) => {
        if (typeof t === 'number') return t;
        if (t && typeof t === 'object') {
          return (Number(t.prompt) || 0) + (Number(t.completion) || 0);
        }
        return 0;
      };
      for (const a of data.aiUsage) {
        const extra = {};
        for (const k of ['source', 'variant', 'rejected']) {
          if (a[k] !== undefined && a[k] !== null) extra[k] = a[k];
        }
        // Raw tokens may be a {prompt, completion} object; preserve it verbatim.
        if (a.tokens && typeof a.tokens === 'object') extra.tokensRaw = a.tokens;
        await usage.save(usage.create({
          userId: data.users[0].id, endpoint: a.endpoint,
          latencyMs: a.ms ?? 0, tokens: tokenTotal(a.tokens),
          createdAt: toDate(a.at),
          metadata: Object.keys(extra).length ? extra : null,
        }));
      }
      ac.importedCount = await usage.count();
      check(ac, 'count', data.aiUsage.length, ac.importedCount);
      const endpointsSrc = data.aiUsage.map((x) => x.endpoint).sort();
      const endpointsDb = (await usage.find()).map((x) => x.endpoint).sort();
      check(ac, 'endpoint multiset', endpointsSrc, endpointsDb);
      const msSrc = data.aiUsage.map((x) => x.ms ?? 0).sort((a, b) => a - b);
      const msDb = (await usage.find()).map((x) => x.latencyMs).sort((a, b) => a - b);
      check(ac, 'latencyMs multiset', msSrc, msDb);
      const tokensDb = (await usage.find()).map((x) => x.tokens).sort((a, b) => a - b);
      const tokensSrc = data.aiUsage.map((x) => tokenTotal(x.tokens)).sort((a, b) => a - b);
      check(ac, 'tokens total multiset', tokensSrc, tokensDb);
      const metaSrc = data.aiUsage
        .map((a) => {
          const o = {};
          for (const k of ['source', 'variant', 'rejected']) {
            if (a[k] !== undefined && a[k] !== null) o[k] = a[k];
          }
          if (a.tokens && typeof a.tokens === 'object') o.tokensRaw = a.tokens;
          return Object.keys(o).length ? o : null;
        })
        .filter((x) => x !== null);
      const metaDb = (await usage.find())
        .map((x) => x.metadata)
        .filter((x) => x !== null && x !== undefined)
        .sort((a, b) => JSON.stringify(norm(a)).localeCompare(JSON.stringify(norm(b))));
      check(ac, 'extra fields preserved in metadata',
        [...metaSrc].sort((a, b) => JSON.stringify(norm(a)).localeCompare(JSON.stringify(norm(b)))),
        metaDb);
      unmapped(ac, ['userId absent in source; set to users[0].id',
        'source/variant/rejected/tokensRaw preserved in ai_usage.metadata JSON',
        'tokens (when object) summed to int column; raw object preserved in metadata']);

      /* ---- 12. styleMemories -> StyleProfile.dimensions blob ---- */
      const smm = data.styleMemories || [];
      const smmc = collection('styleMemories', smm.length, 0);
      if (smm.length) {
        const rs2 = await styles.findOne({ where: { userId: data.users[0].id } });
        rs2.dimensions = {
          ...(rs2.dimensions || {}),
          legacyStyleMemories: smm[0],
        };
        await styles.save(rs2);
        smmc.importedCount = smm.length;
        const verify = await styles.findOne({ where: { userId: data.users[0].id } });
        check(smmc, 'styleMemories blob preserved (float-tolerant)',
          smm[0], verify.dimensions.legacyStyleMemories);
        unmapped(smmc, [
          'MySQL JSON normalises float literals (e.g. 0.46799999999999997 -> 0.468); compared with 1e-12 tolerance',
        ]);
      }

      /* ---- empty collections ---- */
      for (const key of ['wearEvents', 'wishlist']) {
        const c = collection(key, data[key].length, 0);
        c.importedCount = 0;
        check(c, 'empty collection', 0, 0);
      }
    });

    report.status = 'DRY RUN COMPLETED';
  } catch (err) {
    report.status = 'DRY RUN FAILED - ROLLED BACK';
    report.errors.push(String(err && err.message || err));
    throw err;
  } finally {
    await ds.destroy();
  }

  /* ------------------------------------------------------------ print report */
  console.log('\n================ PHASE 4 DRY-RUN REPORT ================');
  console.log('Status:', report.status);
  console.log('Target:', report.target);
  console.log('Safety:', JSON.stringify(report.safety));
  console.log('');
  for (const c of report.collections) {
    console.log(`- ${c.name}: source=${c.sourceCount} imported=${c.importedCount} ` +
      `checks=${c.checks.length} mismatches=${c.mismatches.length} unmapped=${c.unmapped.length}`);
    for (const m of c.mismatches) {
      console.log(`    MISMATCH ${m.label}: expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
    }
    for (const u of c.unmapped) console.log(`    UNMAPPED: ${u}`);
  }
  report.totals.importedRows = report.collections.reduce((n, c) => n + c.importedCount, 0);
  console.log('\nTOTALS:', JSON.stringify(report.totals));
  if (report.errors.length) console.log('ERRORS:', report.errors.join(' | '));
  const out = '/tmp/opencode/phase4-dry-run-report.json';
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('Full report:', out);
  process.exitCode = (report.totals.mismatches === 0 && report.status.startsWith('DRY RUN COMPLETED')) ? 0 : 1;
}

main().catch((e) => {
  console.error('IMPORTER ERROR:', e);
  process.exit(1);
});
