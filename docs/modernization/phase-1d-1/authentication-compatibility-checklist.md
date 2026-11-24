# Phase 1D-1 — Authentication Compatibility Checklist

## Endpoint Contract Preservation

| Endpoint | Method | Request | Response Shape | Preserved? |
|----------|--------|---------|---------------|------------|
| `/auth/register` | POST | `{name, email, password}` | `{user, accessToken, refreshToken, expiresIn, tokenType, tokens}` | ✅ |
| `/auth/login` | POST | `{email, password}` | `{user, accessToken, refreshToken, expiresIn, tokenType, tokens}` | ✅ |
| `/auth/refresh` | POST | `{refreshToken}` | `{accessToken, refreshToken, expiresIn, tokenType, tokens}` | ✅ |
| `/auth/logout` | POST | (Bearer token) | `{success: true}` | ✅ |
| `/auth/me` | GET | (Bearer token) | `{id, email, role, tokenVersion}` | ✅ |

All response shapes preserved through `issueSession()` (unchanged) and `profilePayload()` (unchanged in `legacy-style.ts`).

## Password Hash Compatibility

### Supported Hash Types

| Hash Type | Detection Pattern | Verification Method | Upgrade Path |
|-----------|------------------|---------------------|--------------|
| bcrypt | Starts with `$2a$`, `$2b$`, or `$2y$` | `bcrypt.compare(password, hash)` | N/A (already bcrypt) |
| SHA-256 legacy | `/^[a-f0-9]{64}$/i` | `sha256(password) === hash.toLowerCase()` | Re-hash with bcrypt on first successful login |

### Login Flow with Hash Handling

1. `userRepo.findOne({ where: { email } }).addSelect('user.passwordHash')` — retrieve user WITH password hash
2. If no user → 401 "Incorrect email or password"
3. If `user.passwordHash` is null → 401
4. If hash matches SHA-256 pattern → verify with `sha256(password) === hash`
   - If match → upgrade: `user.passwordHash = await bcrypt.hash(password, rounds)`; `userRepo.save(user)`
   - If no match → 401
5. If hash is bcrypt → verify with `bcrypt.compare(password, hash)`
   - If match → proceed
   - If no match → 401
6. Invalidate user cache: `cache.invalidateUser(user.id)`
7. Return `issueSession(user)`

### Password Hash in Responses

- `passwordHash` has `select: false` on User entity — never included in `findOne()` results unless explicitly added with `.addSelect()`
- `profilePayload()` calls `publicUser()` which destructures out `passwordHash` and `tokenVersion`
- **Password hash never appears in API responses** ✅
- **Password hash never logged** ✅ (no console.log of passwordHash anywhere in AuthService)

## SHA-256 Legacy Upgrade

Existing users in `data/db.json` may have SHA-256 hashes:
- Demo user: `passwordHash: sha256('wardrobe2024')` = `d82a1e9c7cd3f7aaeb971fe070d2b7d3c4bb2b377bc9b3e9d11756d21ebb055a`

On first successful login with SHA-256 hash:
1. Verify with `sha256(password) === hash.toLowerCase()`
2. Re-hash: `await bcrypt.hash(password, rounds)`
3. Save via `userRepo.save(user)`
4. Subsequent logins use bcrypt comparison

## Session/Token Compatibility

### JWT Token Structure (unchanged)

```typescript
{
  sub: user.id,           // User ID (preserved from existing records)
  email: user.email,
  role: user.role,
  ver: user.tokenVersion, // Token version for refresh invalidation
  type: 'access' | 'refresh'
}
```

### Refresh Token Invalidation (unchanged)

- `logout()` increments `user.tokenVersion`
- `JwtStrategy.validate()` compares `payload.ver !== user.tokenVersion`
- Mismatch → 401 "Session expired, please sign in again"

### Existing JWT Tokens

- Tokens issued before migration remain valid until `tokenVersion` changes or TTL expires
- JwtStrategy must look up user by `payload.sub` (user ID) — must work with existing user IDs

## User ID Compatibility

### User Entity PK

```typescript
@PrimaryGeneratedColumn('uuid')
id: string;
```

### Existing IDs

| Source | ID Format | Example |
|--------|-----------|---------|
| `legacy.uid('u')` | `u_` + 6 hex bytes | `u_a1b2c3d4` |
| `data/db.json` seed | `u_demo` | `u_demo` |
| TypeORM `@PrimaryGeneratedColumn('uuid')` | UUID | `550e8400-e29b-...` |

### Compatibility Strategy

TypeORM `@PrimaryGeneratedColumn('uuid')` generates UUIDs only when no ID is provided. If we explicitly set `id` on create, TypeORM uses the provided value:

```typescript
userRepo.create({ id: 'u_demo', email: 'karim@...', ... })
```

**Migration plan must preserve existing IDs** — no UUID conversion or ID regeneration.

### Foreign Key References

All user-related entities reference `userId` (string), not `id`:
- `UserProfile.userId`, `StyleProfile.userId`, `StyleMemory.userId`, `Subscription.userId`
- `Wardrobe.userId`, `WardrobeItem.userId` (via wardrobe), `Outfit.userId`
- `CalendarEvent.userId`, `WishlistItem.userId`, `ShoppingItem` (no userId), `AIUsage.userId`
- `Session.userId`

Existing user IDs (`u_demo`, etc.) are preserved as-is — no FK updates needed.

## Query Strategy for `passwordHash: select: false`

### Login Query (WITH password hash)

```typescript
const user = await this.userRepo
  .createQueryBuilder('user')
  .addSelect('user.passwordHash')
  .where('user.email = :email', { email })
  .getOne();
```

### Profile Query (WITHOUT password hash)

```typescript
const user = await this.userRepo.findOne({
  where: { id: userId },
  relations: ['styleProfile'],
});
```

### Registration Query

```typescript
// Check existing
const existing = await this.userRepo.findOne({ where: { email } });
if (existing) throw new ConflictException('...');

// Create
const user = this.userRepo.create({
  id: legacyUid,
  email,
  passwordHash: await bcrypt.hash(password, rounds),
  name,
  avatarUrl: null,
  tokenVersion: 0,
  role: UserRole.USER,
});
await this.userRepo.save(user);
```

## Concurrency Handling

### Concurrent Registration (Same Email)

1. `userRepo.findOne({ where: { email } })` — both requests find no existing user
2. Both call `userRepo.save()` → database unique constraint on `email` rejects second insert
3. TypeORM throws `QueryFailedError` → catch and return 409 "Email already registered"

### Concurrent Logout (TokenVersion Increment)

1. Read user: `tokenVersion = 5`
2. Increment: `tokenVersion = 6`
3. Save: `userRepo.save(user)` — lost update if another request also incremented to 6

**Mitigation:** Use `userRepo.increment({ id }, 'tokenVersion', 1)` for atomic increment. Or accept the race (tokenVersion is a best-effort invalidation mechanism; a missed increment just means an old token works slightly longer).

### Concurrent Social Login (Same Email)

Same as concurrent registration — unique constraint on email prevents duplicates.

## Testing Requirements

### Tests to Add

| Test | Description |
|------|-------------|
| Register new user | Verify user created in MySQL, JWT returned, profile accessible |
| Login with bcrypt hash | Verify successful authentication |
| Login with SHA-256 legacy hash | Verify authentication + hash upgrade to bcrypt |
| Invalid credentials | Verify 401 |
| Duplicate email registration | Verify 409 |
| User profile retrieval | Verify `/users/me` returns correct data |
| User profile update | Verify `/users/me` PATCH updates name/avatar |
| User isolation | Verify User A cannot access User B's data |
| Refresh token | Verify new access token issued |
| Refresh token invalidation | Verify logout invalidates refresh token |
| JWT validation via JwtStrategy | Verify authenticated request succeeds with valid token |
| JWT validation after logout | Verify 401 after tokenVersion increment |
| Repository failure rollback | Verify transaction rollback on error |

### Tests NOT Added (Out of Scope)

- Express `server.js` auth route tests (unchanged)
- Flutter client tests (SDK not available)
- Controller-level tests (no existing pattern)

## Environment Limitations

- **MySQL/PostgreSQL not available** — Cannot run database integration tests
- **SQLite fallback available** — TypeORM falls back to `better-sqlite3` if PostgreSQL/MySQL unreachable
- **SQLite testing does NOT prove PostgreSQL/MySQL compatibility** — Different JSON column handling, decimal transformers, FK enforcement

## Rollback Procedure

1. `git revert` or `git stash` the three modified files
2. Restore `AuthModule` providers: `[AuthService, JwtStrategy, LegacyDbService]`
3. Restore `AuthService` constructor: inject `LegacyDbService`
4. Restore `JwtStrategy` constructor: inject `LegacyDbService`
5. `npm run build` + `npm test` to confirm pre-migration state

No database schema changes → no schema rollback needed.
