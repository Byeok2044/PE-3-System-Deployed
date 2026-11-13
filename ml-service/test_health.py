"""Public health checks support a direct, credential-free browser wake-up."""
import json
import unittest
from unittest.mock import patch

import app as api


class HealthTests(unittest.TestCase):
    def test_health_can_be_read_cross_origin_without_caching(self):
        with patch.object(api, "model_load_error", None):
            response = api.health()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["status"], "ok")
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("access-control-allow-credentials", response.headers)

    def test_missing_models_remain_observable_as_degraded(self):
        with patch.object(api, "model_load_error", "Missing model"):
            response = api.health()
        self.assertEqual(json.loads(response.body)["status"], "degraded")


if __name__ == "__main__":
    unittest.main()
