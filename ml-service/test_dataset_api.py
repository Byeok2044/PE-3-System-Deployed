"""Validate registered dataset routes and FastAPI query fields without sockets."""

import unittest
from unittest.mock import patch

import pandas as pd

import app as api
from dataset_report import DatasetReport
from test_dataset_report import row


class DatasetApiTests(unittest.TestCase):
    def setUp(self):
        self.report = DatasetReport(pd.DataFrame([row()]))
        self.report_patch = patch.object(api, "historical_dataset_report", return_value=self.report)
        self.report_patch.start()
        self.addCleanup(self.report_patch.stop)

    def test_summary_and_rows_are_read_only_public_get_routes(self):
        paths = api.app.openapi()["paths"]
        for path in ("/dataset/summary", "/dataset/rows", "/dataset/download"):
            self.assertIn("get", paths[path])
            self.assertNotIn("security", paths[path]["get"])
            self.assertNotIn("post", paths[path])
        self.assertEqual(api.dataset_summary()["counts"]["original"], 1)
        result = api.dataset_rows(view="cleaned", page=1, pageSize=25, outcome="all", search="")
        self.assertEqual(result["rows"][0]["Source row"], "SRC-000001")

    def test_fastapi_query_fields_reject_unsupported_values(self):
        route = next(route for route in api.app.routes if route.path == "/dataset/rows")
        fields = {field.alias: field for field in route.dependant.query_params}
        for name, value in (("view", "../../students"), ("page", 0), ("pageSize", 101),
                            ("outcome", "high"), ("search", "x" * 81)):
            _, errors = fields[name].validate(value, {}, loc=("query", name))
            self.assertTrue(errors, (name, value))
        for name, value in (("view", "cleaned"), ("page", 1), ("pageSize", 100),
                            ("outcome", "Dropout"), ("search", "SRC-000001")):
            _, errors = fields[name].validate(value, {}, loc=("query", name))
            self.assertFalse(errors, (name, value))

    def test_download_and_missing_model_error(self):
        response = api.dataset_download(view="cleaned", outcome="all", search="")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertIn(b"SRC-000001", response.body)
        with self.assertRaises(api.HTTPException) as context:
            api.dataset_rows(view="risk", page=1, pageSize=25, outcome="all", search="")
        self.assertEqual(context.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
