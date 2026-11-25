import { UnauthorizedException } from '@nestjs/common';

export interface GoogleProfile {
  sub: string;
  email: string;
  givenName?: string;
  familyName?: string;
}

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Verifies a Google ID token with Google's tokeninfo endpoint and pins it to
 * this app's Client ID. Kept free of Nest/module imports so it stays cheap to
 * unit-test.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<GoogleProfile> {
  let payload: Record<string, unknown>;
  try {
    const res = await fetchImpl(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException('Google token could not be verified.');
  }
  if (payload.aud !== clientId) {
    throw new UnauthorizedException('Google token was issued for a different app.');
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!email || payload.email_verified === 'false' || payload.email_verified === false) {
    throw new UnauthorizedException('Google account has no verified email.');
  }
  return {
    sub: String(payload.sub ?? ''),
    email,
    givenName: payload.given_name ? String(payload.given_name) : undefined,
    familyName: payload.family_name ? String(payload.family_name) : undefined,
  };
}
