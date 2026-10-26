import json
import subprocess
import sys
from pathlib import Path

import pytest

import r2_ls
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


# Second upload run (26 Oct 2026): R2 + AWS CLI pagination listed some keys twice
# (1053 entries for 801 files), so a plain count failed a complete upload.
def test_key_count_ignores_duplicate_pages():
    body = json.dumps({"Contents": [{"Key": "v1/a"}, {"Key": "v1/b"}, {"Key": "v1/a"}]})
    assert r2_ls.key_count(body) == 2


def test_missing_lists_local_files_not_in_bucket():
    body = json.dumps({"Contents": [{"Key": "v1/fonts/Noto Sans Regular/0-255.pbf"}, {"Key": "v1/style-en.json"}]})
    local = ["v1/style-en.json", "v1/fonts/Noto Sans Regular/0-255.pbf", "v1/syros.pmtiles"]
    assert r2_ls.missing(local, body) == ["v1/syros.pmtiles"]


def test_missing_decodes_url_encoded_keys():
    body = json.dumps({"Contents": [{"Key": "v1/fonts/Noto%20Sans%20Regular/0-255.pbf"}]})
    assert r2_ls.missing(["v1/fonts/Noto Sans Regular/0-255.pbf"], body) == []


def test_missing_cli_exits_nonzero_when_something_is_missing(tmp_path):
    local = tmp_path / "local.txt"
    local.write_text("v1/a\nv1/b\n")
    body = json.dumps({"Contents": [{"Key": "v1/a"}]})
    r = subprocess.run([sys.executable, str(HERE / "r2_ls.py"), "missing", str(local)],
                       input=body, capture_output=True, text=True)
    assert r.returncode != 0 and "v1/b" in r.stdout
