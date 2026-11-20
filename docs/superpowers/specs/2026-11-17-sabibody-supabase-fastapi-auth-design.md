# SabiBody Supabase and FastAPI Authentication Boundary

**Status:** Approved.

## Goal

Connect the existing Vite browser authentication session to the existing
FastAPI service through verified Supabase access tokens, while preserving guest
workouts and all existing camera, exercise, voice, and API behavior.

## Verified repository architecture

- The frontend is a Vite single-page application using vanilla JavaScript
  modules. It has no React dependency or React entry point.
- `@supabase/supabase-js` is already installed. The browser client enables
  persistent sessions, automatic token refresh, and URL-session detection.
  The existing auth service supports sign-up, password login, logout, session
  retrieval, and auth-state subscriptions.
- FastAPI is in `backend/app`. Its environment loader reads `backend/.env`.
  Existing routes provide health, YarnGPT speech, and a pose WebSocket; none
  currently verifies Supabase tokens.
- Vercel rewrites `/api/*` to the Render-hosted FastAPI service. Vite's
  development proxy currently forwards `/api/coach` to local FastAPI.
- A separate Azure Functions source tree also contains coaching endpoints;
  it is not the destination of the current Vercel rewrite.
- The project JWKS endpoint is reachable and currently publishes an ES256
  P-256 key. The previously supplied publishable key is rejected by Supabase
  with HTTP 401 `Invalid API key`; live Auth actions require a corrected
  project-matched key.
- A local account-data migration exists but has not been applied. This stage
  does not inspect, create, or modify live database tables or apply migrations.

## Scope and compatibility

- Preserve the current vanilla-JavaScript/Vite application and FastAPI
  structure. Do not migrate to React, Next.js, or server-rendered Supabase
  helpers.
- Reuse the existing browser Supabase client and auth service. Add a verified
  current-user method and a small authenticated-fetch helper for protected
  FastAPI requests.
- Add one reusable FastAPI bearer-token dependency and a protected
  `GET /api/auth/me` identity endpoint.
- Leave existing health, speech/coaching, and pose routes unauthenticated so
  guest workouts and existing services continue working.
- Do not add profiles, history, reminder, dashboard, or other database
  behavior.

## Authentication and request flow

1. The browser Supabase client restores or refreshes its persistent session.
2. Authenticated browser requests obtain the current access token from the
   session and send it as `Authorization: Bearer <access-token>`.
3. FastAPI extracts the bearer token and obtains its public signing key from
   the configured Supabase JWKS URL using a cached JWKS client.
4. JWT validation enforces an allowed asymmetric algorithm (`ES256` or
   `RS256`), signature, Supabase issuer (`<SUPABASE_URL>/auth/v1`),
   `authenticated` audience, expiry, non-empty subject, and the
   `authenticated` role.
5. The dependency exposes the verified subject and optional email to protected
   route handlers. It never uses a request-body user ID as identity.
6. `/api/auth/me` returns only the verified identity fields; it does not
   return the access token or arbitrary JWT claims.

Missing, invalid, expired, wrong-issuer, wrong-audience, and unknown-key
credentials receive HTTP 401 with `WWW-Authenticate: Bearer`. A JWKS network
or service failure returns HTTP 503 rather than being presented as an invalid
credential. JWKS keys are cached and refreshed by key ID to support key
rotation.

The current project's JWKS is asymmetric, so JWT verification does not require
the Supabase Python SDK, publishable key, or secret key. The server secret key
must not be read, used, logged, or deployed for this authentication boundary.

## Configuration and deployment

- Vercel build environment: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`. The key must be copied from the same
  Supabase project as the URL; it is public and is not an administrative
  credential.
- Render environment: `SUPABASE_URL` and `SUPABASE_JWKS_URL`. Configure
  `SABI_ALLOWED_ORIGINS` for the deployed Vercel origin and allowed preview
  origins where required by the existing CORS middleware.
- These backend settings remain optional at process startup so existing guest
  services are not taken down by missing Supabase configuration. The protected
  identity endpoint returns HTTP 503 until its verification settings are
  present.
- `backend/.env.example` documents the requested publishable-key variable and
  an empty, explicitly unused `SUPABASE_SECRET_KEY` setting for future
  server-only operations. Neither key is needed by current token verification.
- Vite development proxies `/api/auth` to local FastAPI. The existing Vercel
  `/api/*` rewrite continues to route production calls to Render.
- Do not read or modify existing `.env` or `backend/.env` files. Keep them
  ignored by Git.
- Do not apply or change the existing account-data migration.

## Dependencies

Add `PyJWT[crypto]` to the existing Python requirements for asymmetric JWT and
JWKS verification. Do not add `supabase` to Python requirements unless a
future server feature actually needs Supabase database/Auth SDK operations.
Do not install `@supabase/ssr` or Next.js middleware.

## Error behavior and security

- Authenticated routes fail closed when no bearer token is supplied.
- Invalid or expired credentials are not decoded and trusted without
  signature verification.
- JWKS retrieval failures are observable as service errors; they do not
  silently grant access or become empty identities.
- The publishable key is never treated as proof of user identity. The verified
  token subject is the only user identity supplied to protected handlers.
- No admin privileges, service-role operations, database policies, or secret
  keys are added.

## Validation

Backend tests use locally generated ES256 tokens and a mocked JWKS source. They
verify that:

- Requests without credentials are rejected.
- Valid tokens yield the expected subject at `/api/auth/me`.
- Expired tokens, invalid signatures, wrong issuer/audience, and unknown key
  IDs are rejected.
- JWKS retrieval failures return service-unavailable responses.
- Existing public health, coaching, and pose routes remain unchanged.

Frontend tests verify that the authenticated-fetch helper sends the current
access token, propagates HTTP responses, and fails clearly when there is no
session. Run existing backend tests, frontend tests, and the Vite production
build.

Live sign-up, login, and session restoration cannot be claimed until the
correct publishable key is supplied and the Supabase project's email/password
Auth settings and redirect URLs are configured. RLS isolation cannot be
verified in this stage because there are no new data routes or live schema
changes.
