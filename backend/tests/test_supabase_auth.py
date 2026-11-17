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


class FailingJwksClient:
    def get_signing_key_from_jwt(self, token):
        raise PyJWKClientConnectionError("JWKS unavailable")


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
        with patch(
            "app.auth.settings.SUPABASE_URL",
            "https://yxrsrfjkabmsfztnpmkb.supabase.co",
        ), patch(
            "app.auth.settings.SUPABASE_JWKS_URL",
            "https://yxrsrfjkabmsfztnpmkb.supabase.co/auth/v1/.well-known/jwks.json",
        ), patch(
            "app.auth.get_jwks_client",
            return_value=jwks or self.jwks,
        ):
            return get_current_user(credentials)

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
        with patch("app.auth.settings.SUPABASE_URL", ""), patch(
            "app.auth.settings.SUPABASE_JWKS_URL", ""
        ):
            with self.assertRaises(HTTPException) as raised:
                get_current_user(credentials)
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
