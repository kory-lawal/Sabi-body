# SabiBody Supabase and FastAPI Authentication Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward existing Supabase browser sessions to FastAPI and verify access tokens securely without changing guest workout behavior.

**Architecture:** Keep the existing Vite browser client and FastAPI application. Add a reusable FastAPI bearer dependency that verifies Supabase JWTs from the cached public JWKS, expose only a protected `/api/auth/me` identity endpoint, and provide a browser helper that attaches the current access token to API calls. Existing workout, speech, health, pose, and Supabase database behavior is unchanged.

**Tech Stack:** Vite, vanilla JavaScript, `@supabase/supabase-js`, FastAPI, `PyJWT[crypto]`, Python `unittest`, Node.js built-in test runner.

**Spec:** [docs/superpowers/specs/2026-11-17-sabibody-supabase-fastapi-auth-design.md](../specs/2026-11-17-sabibody-supabase-fastapi-auth-design.md)

## Global Constraints

- Preserve the current Vite single-page application and FastAPI backend; do not migrate frameworks.
- Existing health, speech/coaching, and pose routes remain public for guest use.
- Do not add or apply database tables, policies, or migrations.
- Verify JWT signatures, issuer, `authenticated` audience, expiry, non-empty subject, and `authenticated` role; do not trust unverified claims or request-body IDs.
- Use only the public JWKS for token verification; do not read or deploy a Supabase secret key for this feature.
- Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser; backend verification uses `SUPABASE_URL` and `SUPABASE_JWKS_URL`.
- Do not add the Supabase Python SDK, Next.js packages, dashboards, reminders, or workout-history behavior.
- Missing Supabase verification configuration must not prevent the existing guest-facing backend from starting.

---

## File Map

| File | Responsibility |
|---|---|
| `backend/app/auth.py` | Cached JWKS access, strict Supabase token verification, and the reusable authenticated-user dependency. |
| `backend/app/routes/auth.py` | Protected `/auth/me` endpoint returning only verified user identity. |
| `backend/app/config.py` | Optional backend Supabase URL and JWKS URL settings, loaded without requiring them at startup. |
| `backend/app/main.py` | Register the auth router under `/api` without changing existing routers. |
| `backend/requirements.txt` | Add the pinned JWT verifier with cryptographic support. |
| `backend/.env.example` | Document backend Supabase settings and explicitly unused secret-key placeholder. |
| `backend/tests/test_supabase_auth.py` | Test JWT verification, errors, and the protected route's identity shape. |
| `src/services/supabase-auth.js` | Add a Supabase-verified current-user method to the existing auth service. |
| `src/services/authenticated-fetch.js` | Attach the current session's access token to FastAPI requests. |
| `vite.config.js` | Proxy local `/api/auth` requests to the existing FastAPI development server. |
| `test/supabase-auth.test.js` | Cover the new current-user method using the existing Node test conventions. |
| `test/authenticated-fetch.test.js` | Cover bearer header handling, missing-session errors, and response propagation. |
| `test/app.test.js` | Update the existing Vite proxy assertion to allow both auth and coaching API routes. |
| `README.md` | Document local, Vercel, and Render environment configuration and verification limits. |

### Task 1: Creating the FastAPI Supabase token verifier

**Files:**
- Create: `backend/app/auth.py`
- Modify: `backend/app/config.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_supabase_auth.py`

**Interfaces:**
- Produces `AuthenticatedUser(id: str, email: str | None)`.
- Produces `get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> AuthenticatedUser`, usable as a FastAPI dependency and directly testable.
- Uses the optional `settings.SUPABASE_URL` and `settings.SUPABASE_JWKS_URL` values added in this task.

- [ ] **Step 1: Write tests for valid and invalid tokens**

Create `backend/tests/test_supabase_auth.py` with a generated ES256 key pair, a fake JWKS client, and token helpers. Build the fixture around this structure:

```python
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.auth import get_current_user


class FakeJwksClient:
    def __init__(self, public_key):
        self.public_key = public_key

    def get_signing_key_from_jwt(self, token):
        if jwt.get_unverified_header(token).get("kid") != "test-key":
            raise PyJWKClientError("No matching test key")
        return SimpleNamespace(key=self.public_key)


class SupabaseAuthTests(unittest.TestCase):
    def setUp(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.jwks = FakeJwksClient(self.private_key.public_key())

    def token(self, signing_key=None, kid="test-key", algorithm="ES256", **overrides):
        claims = {
            "sub": "user-123",
            "email": "person@example.com",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://yxrsrfjkabmsfztnpmkb.supabase.co/auth/v1",
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
        }
        claims.update(overrides)
        return jwt.encode(
            claims,
            signing_key or self.private_key,
            algorithm=algorithm,
            headers={"kid": kid},
        )

    def verify(self, token, jwks=None):
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=token,
        )
        with patch("app.auth.settings.SUPABASE_URL",
                   "https://yxrsrfjkabmsfztnpmkb.supabase.co"), \
             patch("app.auth.settings.SUPABASE_JWKS_URL",
                   "https://yxrsrfjkabmsfztnpmkb.supabase.co/auth/v1/.well-known/jwks.json"), \
             patch("app.auth.get_jwks_client", return_value=jwks or self.jwks):
            return get_current_user(credentials)


class FailingJwksClient:
    def get_signing_key_from_jwt(self, token):
        raise PyJWKClientConnectionError("JWKS unavailable")
```

Add these methods to `SupabaseAuthTests`:

```python
    def test_valid_token_returns_verified_identity(self):
        user = self.verify(self.token())
        self.assertEqual(user.id, "user-123")
        self.assertEqual(user.email, "person@example.com")

    def test_missing_bearer_credentials_are_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            get_current_user(None)
        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(raised.exception.headers["WWW-Authenticate"], "Bearer")

    def test_wrong_issuer_audience_role_subject_and_expiry_are_rejected(self):
        for claims in (
            {"iss": "https://wrong.example/auth/v1"},
            {"aud": "other"},
            {"role": "service_role"},
            {"sub": ""},
            {"exp": 1},
        ):
            with self.subTest(claims=claims):
                with self.assertRaises(HTTPException) as raised:
                    self.verify(self.token(**claims))
                self.assertEqual(raised.exception.status_code, 401)

    def test_invalid_signature_and_unknown_key_are_rejected(self):
        invalid_signature = self.token(
            signing_key=ec.generate_private_key(ec.SECP256R1()),
        )
        for token in (invalid_signature, self.token(kid="unknown")):
            with self.subTest(token=token):
                with self.assertRaises(HTTPException) as raised:
                    self.verify(token)
                self.assertEqual(raised.exception.status_code, 401)

    def test_symmetric_jwt_algorithm_is_rejected(self):
        token = self.token(
            signing_key="not-a-public-key",
            algorithm="HS256",
        )
        with self.assertRaises(HTTPException) as raised:
            self.verify(token)
        self.assertEqual(raised.exception.status_code, 401)

    def test_jwks_connection_failure_is_service_unavailable(self):
        with self.assertRaises(HTTPException) as raised:
            self.verify(self.token(), FailingJwksClient())
        self.assertEqual(raised.exception.status_code, 503)

    def test_missing_supabase_configuration_is_service_unavailable(self):
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=self.token(),
        )
        with patch("app.auth.settings.SUPABASE_URL", ""), \
             patch("app.auth.settings.SUPABASE_JWKS_URL", ""):
            with self.assertRaises(HTTPException) as raised:
                get_current_user(credentials)
        self.assertEqual(raised.exception.status_code, 503)
```

Mock the JWKS client and settings; tests must not make network calls.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run from the repository root:

```powershell
Set-Location backend
py -3.10 -m unittest discover -s tests -p "test_supabase_auth.py" -v
```

Expected: import or missing-symbol failures because `app.auth` and its verifier do not exist yet.

- [ ] **Step 3: Add the JWT dependency, optional settings, and verifier**

Add `PyJWT[crypto]==2.10.1` to `backend/requirements.txt`. In `backend/app/config.py`, load `SUPABASE_URL` and `SUPABASE_JWKS_URL` as optional, trimmed settings. Derive the JWKS endpoint from a configured URL only when the explicit JWKS URL is absent. In `backend/app/auth.py`, define an `HTTPBearer(auto_error=False)` scheme, the immutable identity type, a cached `PyJWKClient` factory, and `get_current_user`. Reject absent credentials with 401 and missing verification configuration with 503. Obtain the signing key by token `kid`, then decode only with `algorithms=["ES256", "RS256"]`, configured issuer, `audience="authenticated"`, and required claims `exp`, `sub`, `aud`, `iss`, and `role`. Reject any role other than `authenticated`, empty subject, or invalid claim with 401. Include `WWW-Authenticate: Bearer` in 401 responses. Map `PyJWKClientConnectionError` to 503 and malformed JWT/signature/unknown-key errors to 401; do not catch arbitrary exceptions.

Install the declared dependency in the active Python 3.10 environment:

```powershell
py -3.10 -m pip install "PyJWT[crypto]==2.10.1"
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run the same `unittest discover` command from Step 2. Expected: all token-verification cases pass without contacting Supabase.

- [ ] **Step 5: Commit the verifier and tests**

```powershell
git add -- backend/app/auth.py backend/requirements.txt backend/tests/test_supabase_auth.py
git commit -m "feat: verify Supabase access tokens" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Exposing the protected identity endpoint

**Files:**
- Create: `backend/app/routes/auth.py`
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example`
- Test: `backend/tests/test_supabase_auth.py`

**Interfaces:**
- Consumes `AuthenticatedUser` and `get_current_user` from `app.auth`.
- Produces `GET /api/auth/me`, returning exactly `{"id": <verified sub>, "email": <verified email or null>}`.

- [ ] **Step 1: Add endpoint path and identity tests**

Add these imports and methods to the backend test case. They mount the new router on a minimal `FastAPI` instance to confirm it registers `GET /api/auth/me`, and test that its handler returns only the verified `id` and `email`. Do not import the full app (which initializes the MediaPipe pose service) or add `httpx` solely for tests.

```python
from fastapi import FastAPI

from app.auth import AuthenticatedUser
from app.routes.auth import me, router as auth_router


    def test_router_mounts_at_expected_api_path(self):
        test_app = FastAPI()
        test_app.include_router(auth_router, prefix="/api")
        route_methods = {
            (route.path, method)
            for route in test_app.routes
            for method in getattr(route, "methods", set())
        }
        self.assertIn(("/api/auth/me", "GET"), route_methods)

    def test_me_returns_only_verified_identity_fields(self):
        result = me(AuthenticatedUser(id="user-123", email="person@example.com"))
        self.assertEqual(result, {"id": "user-123", "email": "person@example.com"})
```

- [ ] **Step 2: Run the focused tests and confirm the route tests fail**

Run from the repository root:

```powershell
Set-Location backend
py -3.10 -m unittest discover -s tests -p "test_supabase_auth.py" -v
```

Expected: the auth router and endpoint are missing; existing tests should continue to pass.

- [ ] **Step 3: Register the route and document backend configuration**

Create `backend/app/routes/auth.py`:

```python
from fastapi import APIRouter, Depends

from app.auth import AuthenticatedUser, get_current_user

router = APIRouter()


@router.get("/auth/me")
def me(user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, str | None]:
    return {"id": user.id, "email": user.email}
```

In `backend/app/main.py`, include this router with `prefix="/api"`. Add these non-secret template values to `backend/.env.example`; leave the actual local `.env` files untouched:

```dotenv
SUPABASE_URL=https://yxrsrfjkabmsfztnpmkb.supabase.co
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=https://yxrsrfjkabmsfztnpmkb.supabase.co/auth/v1/.well-known/jwks.json
```

Add a short adjacent comment in the example that `SUPABASE_SECRET_KEY` is unused by this integration and must not be exposed in frontend variables.

- [ ] **Step 4: Run all backend tests**

Run from the repository root:

```powershell
Set-Location backend
py -3.10 -m unittest discover -s tests -v
```

Expected: all original YarnGPT tests and new Supabase auth tests pass. Existing route registrations in `backend/app/main.py` remain unchanged apart from adding the new router.

- [ ] **Step 5: Commit the endpoint and configuration**

```powershell
git add -- backend/app/routes/auth.py backend/app/main.py backend/.env.example backend/tests/test_supabase_auth.py
git commit -m "feat: expose verified Supabase identity endpoint" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Forwarding browser sessions and documenting deployment

**Files:**
- Modify: `src/services/supabase-auth.js`
- Create: `src/services/authenticated-fetch.js`
- Modify: `vite.config.js`
- Modify: `test/supabase-auth.test.js`
- Modify: `test/app.test.js`
- Create: `test/authenticated-fetch.test.js`
- Modify: `README.md`

**Interfaces:**
- Produces `authService.getUser()`, which calls Supabase `client.auth.getUser()` and returns the verified user or throws the Supabase error.
- Produces `createAuthenticatedFetch({ authService, fetchImpl })`, an async function that gets the persisted session, sets `Authorization: Bearer <access_token>`, and returns the underlying `fetch` response.

- [ ] **Step 1: Add frontend tests**

In `test/supabase-auth.test.js`, extend `createAuthDouble()` with a `getUser()` method that records calls and returns `results.getUser` or a successful default. Cover `getUser()` returning the client user and propagating a Supabase error. Create `test/authenticated-fetch.test.js` with Node's built-in `node:test` and `node:assert/strict`; test token forwarding, preservation of existing request options and headers, response identity, and a clear rejection when there is no session:

```javascript
test('authenticated fetch adds the current bearer token', async () => {
  const response = { status: 200 };
  const fetchImpl = async (_input, init) => {
    assert.equal(init.headers.get('Authorization'), 'Bearer access-token');
    return response;
  };
  const authenticatedFetch = createAuthenticatedFetch({
    authService: { getSession: async () => ({ access_token: 'access-token' }) },
    fetchImpl,
  });

  assert.equal(await authenticatedFetch('/api/auth/me'), response);
});
```

Also assert that missing `access_token` rejects before calling `fetchImpl`, and that a Supabase session lookup error propagates.

Update the existing Vite proxy assertion in `test/app.test.js` to expect exactly `['/api/auth', '/api/coach']` and verify both entries target `http://127.0.0.1:8000`.

- [ ] **Step 2: Run the focused Node tests and confirm they fail**

Run from the repository root:

```powershell
node --test test/supabase-auth.test.js test/authenticated-fetch.test.js
```

Expected: failures for the missing `getUser` method and `authenticated-fetch.js` module.

- [ ] **Step 3: Implement current-user lookup, token forwarding, and local proxy**

Add `getUser()` to `createSupabaseAuthService(client)` using `client.auth.getUser()`, the existing `throwOnError` helper, and `data.user`.

Create `src/services/authenticated-fetch.js`. Validate `authService.getSession` and `fetchImpl` at construction. For each request, await `getSession()`, throw a clear signed-in-required error if `session.access_token` is absent, create a `Headers` object from `init.headers`, set the bearer header, then call and return `fetchImpl(input, { ...init, headers })`. Do not swallow lookup errors or transform HTTP responses.

Add `/api/auth` to the existing Vite proxy in `vite.config.js` with the same `http://127.0.0.1:8000` target and `changeOrigin: true` used for `/api/coach`. Do not modify the existing Vercel rewrite.

- [ ] **Step 4: Document environment and deployment configuration**

Add a subsection to `README.md` explaining:

- Vercel frontend variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Render backend variables: `SUPABASE_URL` and `SUPABASE_JWKS_URL`.
- The Supabase secret key is not required for JWT verification and must remain unset for this feature.
- Configure Supabase Auth email/password and allowed redirect/site URLs as described in the existing Accounts section.
- The supplied publishable key currently receives Supabase `401 Invalid API key`; replace it with a valid publishable key from the same project before attempting live sign-up/login verification.
- Backend unit tests validate JWT behavior locally; they do not prove live Supabase Auth works.

- [ ] **Step 5: Run focused frontend tests**

Run:

```powershell
node --test test/supabase-auth.test.js test/authenticated-fetch.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Run complete regression checks**

Run from the repository root:

```powershell
npm test
npm run build
Set-Location backend
py -3.10 -m unittest discover -s tests -v
```

Expected: all Node tests, the Vite production build, and all backend tests pass. Report the existing large-bundle warning if it remains; do not alter unrelated bundle configuration.

- [ ] **Step 7: Commit the browser integration and documentation**

`README.md` already contains unrelated uncommitted account, workout-history, and reminder documentation from earlier work. Keep it out of this commit rather than staging those changes; the new FastAPI section remains in the worktree.

```powershell
git add -- src/services/supabase-auth.js src/services/authenticated-fetch.js vite.config.js test/supabase-auth.test.js test/authenticated-fetch.test.js test/app.test.js
git commit -m "feat: forward Supabase sessions to FastAPI" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Do not stage unrelated worktree changes.

## Coverage and Limits

- Backend tests cover missing credentials, valid signature and identity, invalid signature, expiry, issuer, audience, role, unknown key ID, and JWKS connectivity failure.
- Frontend tests cover verified user retrieval, bearer-token forwarding, missing session handling, and HTTP response passthrough.
- Regression commands cover the existing Node test suite, Vite build, and Python backend test suite.
- Live registration, login, refresh, and browser persistence still require a valid publishable key and configured Supabase Auth URLs/settings. The current supplied key is invalid, so tests must not claim those live flows passed.
- This stage does not create or inspect Supabase tables, apply migrations, add workout-history routes, or verify RLS isolation.
