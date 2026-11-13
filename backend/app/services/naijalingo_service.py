import json
import os
from typing import Any, Dict, Iterable, List, Tuple
from urllib import error, request


class NaijaLingoService:
    SUPPORTED_LANGUAGES = {"en": "en", "yo": "yo", "ig": "ig", "ha": "ha", "pcm": "pcm"}
    LANGUAGE_ALIASES = {
        "english": "en",
        "yoruba": "yo",
        "igbo": "ig",
        "hausa": "ha",
        "pidgin": "pcm",
        "nigerian pidgin": "pcm",
    }
    VOICE_LANGUAGE_ALIASES = {
        "english": "en",
        "yoruba": "yo",
        "igbo": "ig",
        "hausa": "ha",
        "pidgin": "pcm",
        "nigerian pidgin": "pcm",
    }
    PREFERRED_SPEAKERS = {
        "yo": ["umar", "abimbola", "babatunde"],
        "ig": ["uma", "adaeze", "chibueze"],
        "ha": ["umar", "aisha", "aliyu"],
        "pcm": ["umar", "bola", "bose"],
        "en": ["umar"],
    }

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = (api_key or os.getenv("YARNGPT_API_KEY", "") or os.getenv("NAIJALINGO_API_KEY", "")).strip()
        self.base_url = (base_url or os.getenv("YARNGPT_BASE_URL", "https://api.yarngpt.ai")).rstrip("/")
        self._voice_cache: list[dict[str, Any]] | None = None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    @staticmethod
    def _normalize_language(language: str) -> str:
        normalized = (language or "").strip().lower()
        normalized = NaijaLingoService.LANGUAGE_ALIASES.get(normalized, normalized)
        if normalized not in NaijaLingoService.SUPPORTED_LANGUAGES:
            raise ValueError(
                f"Unsupported language '{language}'. Supported: {sorted(NaijaLingoService.SUPPORTED_LANGUAGES)}"
            )
        return NaijaLingoService.SUPPORTED_LANGUAGES[normalized]

    @staticmethod
    def _normalize_voice_languages(raw: Any) -> List[str]:
        if isinstance(raw, str):
            values = [part.strip().lower() for part in raw.split(",") if part.strip()]
            return [
                NaijaLingoService.VOICE_LANGUAGE_ALIASES.get(value, value)
                for value in values
            ]
        if isinstance(raw, list):
            values: List[str] = []
            for item in raw:
                values.extend(NaijaLingoService._normalize_voice_languages(item))
            return values
        if isinstance(raw, dict):
            values = []
            for key in ("languages", "supported_languages", "language", "language_code", "locale"):
                if key in raw:
                    values.extend(NaijaLingoService._normalize_voice_languages(raw[key]))
            return values
        return []

    @staticmethod
    def _voice_supports_language(voice: Dict[str, Any], language: str) -> bool:
        languages = [str(value).lower() for value in voice.get("languages", [])]
        if not languages:
            return language in {"en", "yo", "ig", "ha", "pcm"} or voice.get("default") is True
        return any(code == language or code.startswith(f"{language}-") for code in languages)

    def _request(self, method: str, path: str, payload: Dict[str, Any] | None = None):
        if not self.api_key:
            raise RuntimeError("YARNGPT_API_KEY is not configured in the backend environment.")
        url = f"{self.base_url}{path}"
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(url, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=30) as response:
                response_headers = {
                    name.lower(): value for name, value in response.headers.items()
                }
                return response.status, response_headers, response.read()
        except error.HTTPError as exc:  # pragma: no cover - runtime integration
            body = exc.read()
            detail = body.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(detail)
                message = parsed.get("detail") or parsed.get("message") or parsed.get("error")
                if isinstance(message, dict):
                    message = message.get("message") or message.get("detail")
            except Exception:
                message = detail or str(exc)
            raise RuntimeError(f"YarnGPT request failed ({exc.code}): {message}") from exc
        except Exception as exc:  # pragma: no cover - runtime integration
            raise RuntimeError(f"Unable to reach the YarnGPT API: {exc}") from exc

    def _parse_voice_catalog(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            rows = payload.get("voices") or payload.get("data") or payload.get("items") or payload.get("results") or []
            if not isinstance(rows, list):
                rows = [payload]
        else:
            rows = []

        voices: List[Dict[str, Any]] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            voice_id = str(
                item.get("id")
                or item.get("voice_id")
                or item.get("voiceId")
                or item.get("voice")
                or item.get("name")
                or ""
            ).strip()
            if not voice_id:
                continue
            description = item.get("description") or item.get("title") or item.get("label") or ""
            languages = self._normalize_voice_languages(
                item.get("languages")
                or item.get("language")
                or item.get("supported_languages")
                or item.get("supportedLanguages")
                or item.get("locale")
            )
            default = bool(item.get("default") or item.get("is_default") or item.get("isDefault"))
            voices.append(
                {
                    "id": voice_id,
                    "name": str(item.get("name") or item.get("display_name") or item.get("label") or voice_id),
                    "description": str(description),
                    "languages": [value.lower() for value in languages],
                    "default": default,
                }
            )
        return sorted(voices, key=lambda item: (0 if item.get("default") else 1, item.get("name", "").lower()))

    def list_voices(self) -> List[Dict[str, Any]]:
        if self._voice_cache is not None:
            return self._voice_cache
        status, _, body = self._request("GET", "/api/v1/voices")
        if status < 200 or status >= 300:
            raise RuntimeError(f"YarnGPT voice catalogue request failed with HTTP {status}.")
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {}
        self._voice_cache = self._parse_voice_catalog(payload)
        return self._voice_cache

    def list_speakers_by_language(self, language: str) -> List[Dict[str, Any]]:
        normalized = self._normalize_language(language)
        voices = self.list_voices()
        compatible = [
            voice for voice in voices if self._voice_supports_language(voice, normalized)
        ]
        if not compatible and normalized in {"yo", "ig", "ha", "pcm"} and not any(
            len(voice.get("languages", [])) for voice in voices
        ):
            return voices
        return compatible

    def select_voice(self, language: str, preferred: Iterable[str] | None = None) -> str:
        normalized = self._normalize_language(language)
        catalog = self.list_speakers_by_language(normalized)
        if not catalog:
            raise ValueError(f"No compatible YarnGPT voice was found for language '{normalized}'.")
        candidates = list(preferred or self.PREFERRED_SPEAKERS.get(normalized, []))
        available_ids = {voice["id"]: voice for voice in catalog}
        for candidate in candidates:
            if candidate in available_ids:
                return candidate
        for voice in catalog:
            if voice.get("default"):
                return voice["id"]
        return catalog[0]["id"]

    def synthesize(self, language: str, text: str, voice: str | None = None) -> Tuple[bytes, str, str]:
        normalized = self._normalize_language(language)
        clean_text = (text or "").strip()
        if not clean_text:
            raise ValueError("Text is required for speech synthesis.")
        if not self.is_configured:
            raise RuntimeError("YARNGPT_API_KEY is not configured in the backend environment.")

        selected_voice = voice or self.select_voice(normalized)
        request_payload: Dict[str, Any] = {
            "text": clean_text,
            "voice": selected_voice,
            "output_format": "mp3",
        }
        _, headers, body = self._request("POST", "/api/v1/streaming/conversation", request_payload)
        if not body:
            raise ValueError("YarnGPT generated an empty audio payload.")
        content_type = headers.get("content-type", "").lower()
        if "audio" not in content_type and "mpeg" not in content_type and "wav" not in content_type and "octet-stream" not in content_type:
            raise RuntimeError(
                f"YarnGPT returned an unexpected response type: {content_type or 'unknown'}"
            )
        mime_type = "audio/mpeg" if "mpeg" in content_type or "mp3" in content_type else "audio/wav" if "wav" in content_type else "audio/mpeg"
        return body, mime_type, selected_voice


naijalingo_service = NaijaLingoService()
