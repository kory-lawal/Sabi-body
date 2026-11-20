"""Request and response bodies for account endpoints.

Responses never include password hashes, token hashes or session secrets.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _clean_name(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("Enter your full name.")
    if len(cleaned) > 120:
        raise ValueError("Use 120 characters or fewer.")
    if any(ord(ch) < 32 for ch in cleaned):
        raise ValueError("Remove unsupported characters from your name.")
    return cleaned


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(StrictModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)

    _name = field_validator("full_name")(_clean_name)


class LoginRequest(StrictModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    remember: bool = True


class EmailOnlyRequest(StrictModel):
    email: EmailStr


class TokenRequest(StrictModel):
    token: str = Field(min_length=20, max_length=200)


class ResetPasswordRequest(StrictModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(StrictModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class ChangeEmailRequest(StrictModel):
    new_email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class DeleteAccountRequest(StrictModel):
    password: str = Field(min_length=1, max_length=256)


class UpdateProfileRequest(StrictModel):
    full_name: str = Field(min_length=1, max_length=200)

    _name = field_validator("full_name")(_clean_name)


class UserOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    email_verified: bool
    created_at: datetime
    is_admin: bool = False


class SessionOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class MessageOut(BaseModel):
    message: str
