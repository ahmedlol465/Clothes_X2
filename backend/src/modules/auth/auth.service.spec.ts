import { UnauthorizedException } from '@nestjs/common';
import { verifyGoogleIdToken } from './google-auth';

/** Google ID-token verification: config gate lives in AuthService (needs Nest). */
describe('verifyGoogleIdToken', () => {
  const fetchReturning = (body: unknown, ok = true) =>
    jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) });

  it('rejects a token issued for a different app (aud mismatch)', async () => {
    const f = fetchReturning({ aud: 'someone-else', email: 'p@gmail.com', sub: 'g1' });
    await expect(verifyGoogleIdToken('t', 'our-id', f)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when Google cannot verify the token', async () => {
    const f = fetchReturning({}, false);
    await expect(verifyGoogleIdToken('bad', 'our-id', f)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unverified email', async () => {
    const f = fetchReturning({ aud: 'our-id', email: 'p@gmail.com', email_verified: 'false', sub: 'g1' });
    await expect(verifyGoogleIdToken('t', 'our-id', f)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the verified profile when Google confirms the token', async () => {
    const f = fetchReturning({ aud: 'our-id', sub: 'g1', email: 'Person@Gmail.com', email_verified: 'true', given_name: 'Person' });
    const profile = await verifyGoogleIdToken('good', 'our-id', f);
    expect(profile.email).toBe('person@gmail.com');
    expect(profile.sub).toBe('g1');
    expect(profile.givenName).toBe('Person');
  });
});
