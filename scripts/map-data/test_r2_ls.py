import json
import subprocess
import sys
from pathlib import Path

import pytest

from r2_ls import key_count, next_version

HERE = Path(__file__).parent


def prefixes(*names):
    return json.dumps({"CommonPrefixes": [{"Prefix": n} for n in names]})


def run_cli(cmd, body):
    return subprocess.run(
        [sys.executable, str(HERE / "r2_ls.py"), cmd], input=body, text=True, capture_output=True
    )


def test_next_version_empty_bucket_is_1():
    assert next_version(json.dumps({"KeyCount": 0})) == 1


def test_next_version_blank_output_is_1():
    # the AWS CLI can print nothing at all for an empty listing
    assert next_version("") == 1
    assert next_version("null") == 1


def test_next_version_takes_highest_number_not_string_order():
    assert next_version(prefixes("v1/", "v12/", "v2/")) == 13


def test_next_version_ignores_other_prefixes():
    assert next_version(prefixes("v3/", "vfoo/", "v/", "other/", "v4x/")) == 4


def test_next_version_rejects_garbage():
    with pytest.raises(ValueError):
        next_version("<html>not json</html>")


def test_key_count_empty_is_zero():
    assert key_count(json.dumps({"KeyCount": 0})) == 0
    assert key_count("") == 0


def test_key_count_counts_contents():
    body = json.dumps({"Contents": [{"Key": "v1/a"}, {"Key": "v1/b"}], "KeyCount": 1})
    assert key_count(body) == 2  # Contents is merged across pages; KeyCount is per page


def test_cli_count_reports_existing_objects():
    r = run_cli("count", json.dumps({"Contents": [{"Key": "v1/manifest.json"}]}))
    assert r.returncode == 0 and r.stdout.strip() == "1"


def test_cli_next_version_prints_number():
    r = run_cli("next-version", prefixes("v1/", "v12/", "v2/"))
    assert r.stdout.strip() == "13"


def test_cli_bad_input_exits_nonzero():
    assert run_cli("next-version", "oops").returncode != 0
