"""履歴タグと時刻列の設定違いを、保存ミスではなく入力エラーとして返す。"""

import pytest
from fastapi.testclient import TestClient
from studio import create_app


@pytest.mark.parametrize(
    "options, field",
    [
        ({"tags": ["vlaue"]}, "vlaue"),
        ({"tags": ["status"]}, "status"),
        ({"source_time_field": "time_typo"}, "time_typo"),
        ({"source_time_field": "value"}, "value"),
    ],
)
def test_invalid_history_reference_is_rejected_before_execution(options, field):
    app = create_app("historian")
    with TestClient(app) as client:
        for path in ("/api/preview", "/api/presets/bad-history", "/api/start"):
            reply = client.post(path, json={"history": options})
            assert reply.status_code == 422 and field in reply.text
        assert app.state.store.meta("desired") is None


def test_optional_datetime_and_boolean_history_tag_are_supported():
    spec = {
        "history": {"source_time_field": "event_at", "tags": ["active"]},
        "generator": {
            "fields": [
                {
                    "name": "event_at",
                    "data_type": "datetime",
                    "generator": "constant",
                    "value": "2026-01-01T00:00:00Z",
                    "null_probability": 1,
                },
                {
                    "name": "active",
                    "data_type": "boolean",
                    "generator": "constant",
                    "value": True,
                },
            ]
        },
    }
    with TestClient(create_app("historian")) as client:
        response = client.post("/api/preview", json=spec)
        assert response.status_code == 200, response.text


def test_missing_datetime_uses_own_calculated_timestamp(tmp_path, monkeypatch):
    """2台目の欠測時刻を1台目の時刻で埋めない。"""
    from datetime import UTC, datetime

    from controller import Controller
    from drivers import HistorianDriver
    from models import Spec
    from store import Store

    controller = Controller("historian", Store(tmp_path))
    controller.spec = Spec.model_validate(
        {"history": {"devices": 2, "source_time_field": "event_at"}}
    )
    controller.ds = "time-fallback"
    source_time = datetime(2026, 1, 1, tzinfo=UTC)
    fallback_time = datetime(2026, 1, 2, tzinfo=UTC)
    rows = [
        {"event_at": source_time.isoformat(), "value": 28},
        {"event_at": None, "value": 30},
    ]
    monkeypatch.setattr(controller, "record", rows.__getitem__)
    driver = HistorianDriver(controller)
    driver.options = controller.spec.history
    driver.anchor = fallback_time.timestamp()
    driver.write(0)
    with controller.store.db() as db:
        samples = db.execute("SELECT tag,ts FROM samples ORDER BY tag").fetchall()
    assert [tuple(row) for row in samples] == [
        ("device-001.value", source_time.timestamp()),
        ("device-002.value", fallback_time.timestamp()),
    ]
