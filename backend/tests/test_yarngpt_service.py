import json
import unittest
from unittest.mock import patch

from app.routes.speech import router as speech_router
from app.services.naijalingo_service import NaijaLingoService


class YarnGPTServiceTests(unittest.TestCase):
    def test_audio_compatibility_route_and_generate_route_are_registered(self):
        routes = {
            (route.path, method)
            for route in speech_router.routes
            for method in getattr(route, "methods", set())
        }

        self.assertIn(("/audio", "POST"), routes)
        self.assertIn(("/generate", "POST"), routes)

    def test_voice_language_names_are_normalized_to_application_codes(self):
        service = NaijaLingoService(api_key="test-key")

        voices = service._parse_voice_catalog({
            "voices": [
                {
                    "id": "idera",
                    "name": "idera",
                    "description": "Melodic, gentle.",
                    "languages": ["english", "pidgin", "hausa", "yoruba", "igbo"],
                    "default": True,
                }
            ]
        })

        self.assertEqual(voices[0]["languages"], ["en", "pcm", "ha", "yo", "ig"])
        self.assertTrue(service._voice_supports_language(voices[0], "yo"))
        self.assertTrue(service._voice_supports_language(voices[0], "pcm"))

    def test_synthesis_uses_bearer_auth_and_current_conversation_contract(self):
        service = NaijaLingoService(api_key="test-key")
        response_headers = {"Content-Type": "audio/mpeg"}
        response = unittest.mock.MagicMock()
        response.status = 200
        response.headers = response_headers
        response.read.return_value = b"mp3 bytes"
        response.__enter__.return_value = response
        captured = {}

        def capture_request(req, timeout):
            captured["url"] = req.full_url
            captured["authorization"] = req.get_header("Authorization")
            captured["body"] = json.loads(req.data.decode("utf-8"))
            captured["timeout"] = timeout
            return response

        with patch("app.services.naijalingo_service.request.urlopen", capture_request):
            audio, content_type, voice = service.synthesize("yo", "O ṣe dáadáa!", "umar")

        self.assertEqual(captured["url"], "https://api.yarngpt.ai/api/v1/streaming/conversation")
        self.assertEqual(captured["authorization"], "Bearer test-key")
        self.assertEqual(
            captured["body"],
            {"text": "O ṣe dáadáa!", "voice": "umar", "output_format": "mp3"},
        )
        self.assertEqual(audio, b"mp3 bytes")
        self.assertEqual(content_type, "audio/mpeg")
        self.assertEqual(voice, "umar")


if __name__ == "__main__":
    unittest.main()
