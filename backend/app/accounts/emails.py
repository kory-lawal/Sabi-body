"""Transactional and reminder emails.

Providers:
- "resend": sends through the Resend HTTP API (RESEND_API_KEY, EMAIL_FROM).
- "console": no email leaves the server; the message is logged. Used when no
  provider is configured, so flows remain testable locally.
"""
import html
import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger("sabibody.email")

RESEND_URL = "https://api.resend.com/emails"


@dataclass
class EmailMessage:
    to: str
    subject: str
    text: str
    html: str


class EmailDeliveryError(Exception):
    pass


# Messages "sent" by the console provider, kept for automated tests.
console_outbox: list[EmailMessage] = []


def _layout(title: str, paragraphs: list[str], action_label: str | None = None, action_url: str | None = None) -> str:
    body = "".join(f"<p style=\"margin:0 0 14px;line-height:1.5\">{p}</p>" for p in paragraphs)
    button = ""
    if action_label and action_url:
        button = (
            f"<p style=\"margin:22px 0\"><a href=\"{html.escape(action_url, quote=True)}\" "
            "style=\"background:#1f5a4c;color:#ffffff;padding:12px 20px;border-radius:999px;"
            f"text-decoration:none;font-weight:700\">{html.escape(action_label)}</a></p>"
            f"<p style=\"font-size:13px;color:#5b716b\">Or open this link: {html.escape(action_url)}</p>"
        )
    return (
        "<div style=\"font-family:Arial,sans-serif;color:#173c36;max-width:520px;margin:0 auto;padding:24px\">"
        "<p style=\"font-weight:800;font-size:20px;color:#1f5a4c;margin:0 0 18px\">SabiBody</p>"
        f"<h1 style=\"font-size:22px;margin:0 0 16px\">{html.escape(title)}</h1>{body}{button}"
        "<p style=\"font-size:12px;color:#5b716b;margin-top:28px\">SabiBody is a movement coach, not medical advice.</p>"
        "</div>"
    )


def send_email(message: EmailMessage) -> None:
    provider = settings.email_provider
    if provider == "resend":
        if not settings.RESEND_API_KEY or not settings.EMAIL_FROM:
            raise EmailDeliveryError("RESEND_API_KEY and EMAIL_FROM must both be set.")
        try:
            response = httpx.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={
                    "from": settings.EMAIL_FROM,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                    "html": message.html,
                },
                timeout=15,
            )
        except httpx.HTTPError as exc:
            raise EmailDeliveryError(f"Email provider request failed: {exc.__class__.__name__}") from exc
        if response.status_code >= 300:
            raise EmailDeliveryError(f"Email provider returned HTTP {response.status_code}")
        return
    if provider == "console":
        console_outbox.append(message)
        if len(console_outbox) > 200:
            del console_outbox[:100]
        if settings.IS_PRODUCTION:
            logger.warning("Email provider not configured; email to a user was NOT delivered: %s", message.subject)
        else:
            logger.info("[console email] to=%s subject=%s\n%s", message.to, message.subject, message.text)
        return
    raise EmailDeliveryError(f"Unknown EMAIL_PROVIDER '{provider}'.")


def frontend_link(route: str, token: str) -> str:
    return f"{settings.FRONTEND_URL}/#/{route}?token={token}"


def verification_email(to: str, name: str, token: str) -> EmailMessage:
    url = frontend_link("verify-email", token)
    hours = settings.EMAIL_VERIFICATION_HOURS
    return EmailMessage(
        to=to,
        subject="Confirm your SabiBody email",
        text=f"Hi {name},\n\nConfirm your email to finish setting up SabiBody:\n{url}\n\nThis link expires in {hours} hours. If you did not create an account, ignore this email.",
        html=_layout(
            "Confirm your email",
            [f"Hi {html.escape(name)},", "Confirm your email address to finish setting up your SabiBody account.",
             f"This link expires in {hours} hours. If you did not create an account, you can ignore this email."],
            "Confirm email",
            url,
        ),
    )


def email_change_email(to: str, name: str, token: str) -> EmailMessage:
    url = frontend_link("verify-email", token)
    return EmailMessage(
        to=to,
        subject="Confirm your new SabiBody email",
        text=f"Hi {name},\n\nConfirm this new email address for your SabiBody account:\n{url}\n\nIf you did not request this change, ignore this email.",
        html=_layout(
            "Confirm your new email",
            [f"Hi {html.escape(name)},", "Confirm this address to make it the email for your SabiBody account.",
             "If you did not request this change, you can ignore this email; your account is unchanged."],
            "Confirm new email",
            url,
        ),
    )


def password_reset_email(to: str, name: str, token: str) -> EmailMessage:
    url = frontend_link("reset-password", token)
    minutes = settings.PASSWORD_RESET_MINUTES
    return EmailMessage(
        to=to,
        subject="Reset your SabiBody password",
        text=f"Hi {name},\n\nReset your password here:\n{url}\n\nThis link expires in {minutes} minutes and can be used once. If you did not ask for this, ignore this email.",
        html=_layout(
            "Reset your password",
            [f"Hi {html.escape(name)},", "Use the button below to choose a new password.",
             f"This link expires in {minutes} minutes and works once. If you did not ask for a reset, ignore this email."],
            "Choose a new password",
            url,
        ),
    )


def password_changed_email(to: str, name: str) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject="Your SabiBody password was changed",
        text=f"Hi {name},\n\nYour SabiBody password was just changed and other devices were signed out. If this was not you, reset your password immediately.",
        html=_layout(
            "Your password was changed",
            [f"Hi {html.escape(name)},", "Your SabiBody password was just changed and your other devices were signed out.",
             "If this was not you, reset your password immediately from the login page."],
        ),
    )


def reminder_email(to: str, name: str, reminder_type: str) -> EmailMessage:
    url = f"{settings.FRONTEND_URL}/#/exercises"
    when = "this morning" if reminder_type == "morning" else "this evening"
    return EmailMessage(
        to=to,
        subject="Time for a quick SabiBody workout",
        text=f"Hi {name},\n\nYou haven't worked out yet today. A few minutes {when} is enough to keep your streak going:\n{url}\n\nYou can change reminder times in Settings.",
        html=_layout(
            "Ready to move?",
            [f"Hi {html.escape(name)},", f"You haven't worked out yet today. A few minutes {when} is enough to keep going.",
             "You can change or turn off reminders any time in Settings."],
            "Start a workout",
            url,
        ),
    )


def buddy_reminder_email(to: str, name: str, partner: str, exercise: str, local_time: str, kind: str,
                         session_id: str) -> EmailMessage:
    """Shared-workout reminders: 24 hours before (optional), one hour before, and at start time."""
    url = f"{settings.FRONTEND_URL}/#/calendar?session={session_id}"
    first = name.split(" ")[0] or "there"
    if kind == "start":
        subject = f"It's time to work out with {partner}!"
        lines = [f"Hey {first},", f"It's time for your workout with {partner}.",
                 f"You both planned to complete {exercise} today.",
                 "Your workout partner is counting on you. Open SabiBody and join your session."]
        title, action = f"Time to work out with {partner}", "Join your session"
    elif kind == "24h":
        subject = f"Your SabiBody workout with {partner} is tomorrow"
        lines = [f"Hey {first},", f"Your workout with {partner} is tomorrow.",
                 f"You both have a {exercise} session scheduled for {local_time}.",
                 "Plan your workout space now and show up for each other."]
        title, action = "Your workout is tomorrow", "View workout"
    else:
        subject = "Your SabiBody workout is in one hour!"
        lines = [f"Hey {first},", f"Your workout with {partner} starts in one hour.",
                 f"You both have a {exercise} session scheduled for {local_time}.",
                 "Get ready, prepare your workout space and show up for each other.", "See you soon!"]
        title, action = "Your workout is in one hour", "View workout"
    text = "\n\n".join(lines) + f"\n\n{url}\n\n— SabiBody\n\nYou can change workout reminder emails in SabiBody → Notifications."
    return EmailMessage(
        to=to, subject=subject, text=text,
        html=_layout(title, [html.escape(line) for line in lines] + ["— SabiBody"], action, url),
    )
