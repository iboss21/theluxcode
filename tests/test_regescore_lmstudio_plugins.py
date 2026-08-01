"""Structural checks for the RegesCore LM Studio plugins.

Field names and constraints below come from the LM Studio SDK source
(``@lmstudio/sdk`` v1.5.0, ``lms-shared-types/src/PluginManifest.ts`` and
``ArtifactManifestBase.ts``). A manifest LM Studio cannot parse means the
plugin never loads, with no error surfaced in the app.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "lmstudio-plugins"
PLUGIN_NAMES = ["regescore", "regescore-gateway"]

# owner: kebabCaseSchema. name: kebabCaseWithDotsSchema.
KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
KEBAB_WITH_DOTS = re.compile(r"^[a-z0-9]+(?:[-.][a-z0-9]+)*$")
VALID_RUNNERS = {"ecmascript", "node", "deno", "mcpBridge"}
MANIFEST_FIELDS = {"type", "runner", "sandbox", "owner", "name", "revision", "dependencies", "tags"}


def manifest(name: str) -> dict:
    return json.loads((PLUGINS_DIR / name / "manifest.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", PLUGIN_NAMES)
def test_manifest_matches_the_plugin_schema(name):
    data = manifest(name)
    assert data["type"] == "plugin"
    assert data["runner"] in VALID_RUNNERS
    assert KEBAB.match(data["owner"]), data["owner"]
    assert KEBAB_WITH_DOTS.match(data["name"]), data["name"]
    assert 1 <= len(data["name"]) <= 100
    assert data["name"] == name, "folder name must match the manifest name"
    unknown = set(data) - MANIFEST_FIELDS
    assert not unknown, f"fields LM Studio's schema will strip: {sorted(unknown)}"


@pytest.mark.parametrize("name", PLUGIN_NAMES)
def test_manifest_does_not_declare_a_sandbox_on_a_node_runner(name):
    """The schema rejects sandboxing unless the runner is deno."""
    data = manifest(name)
    if data["runner"] != "deno":
        assert "sandbox" not in data


@pytest.mark.parametrize("name", PLUGIN_NAMES)
def test_plugin_has_the_files_the_runner_expects(name):
    """LM Studio npm-installs the folder, then builds .lmstudio/entry.ts,
    which imports ./../src/index.ts and calls its exported main()."""
    plugin = PLUGINS_DIR / name
    assert (plugin / "package.json").is_file()
    index = plugin / "src" / "index.ts"
    assert index.is_file()
    source = index.read_text(encoding="utf-8")
    assert "export async function main(" in source
    assert "PluginContext" in source


@pytest.mark.parametrize("name", PLUGIN_NAMES)
def test_sdk_is_a_declared_dependency(name):
    package = json.loads((PLUGINS_DIR / name / "package.json").read_text(encoding="utf-8"))
    assert "@lmstudio/sdk" in package.get("dependencies", {})


@pytest.mark.parametrize("name", PLUGIN_NAMES)
def test_davidio_credit_is_present(name):
    package = json.loads((PLUGINS_DIR / name / "package.json").read_text(encoding="utf-8"))
    assert "davidio.dev" in package["author"]
    assert package["homepage"] == "https://davidio.dev"
    assert "davidio-dev" in manifest(name)["tags"]


def test_only_the_gateway_registers_a_generator():
    """A plugin with a generator leaves the plugin list and becomes a model
    entry, taking any bundled preprocessor with it. Keeping them in separate
    plugins is what lets the preprocessor run for local models."""
    preprocessor = (PLUGINS_DIR / "regescore/src/index.ts").read_text(encoding="utf-8")
    gateway = (PLUGINS_DIR / "regescore-gateway/src/index.ts").read_text(encoding="utf-8")
    assert "withPromptPreprocessor" in preprocessor
    assert "withGenerator" not in preprocessor
    assert "withGenerator" in gateway
    assert "withPromptPreprocessor" not in gateway


def test_doctrine_files_are_in_sync_with_the_chat_template():
    import subprocess

    result = subprocess.run(
        ["python3", str(ROOT / "scripts/sync_regescore_doctrine.py"), "--check"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_installers_are_shipped_for_both_platforms():
    assert (PLUGINS_DIR / "install.sh").is_file()
    assert (PLUGINS_DIR / "install.ps1").is_file()


@pytest.mark.parametrize("installer", ["install.sh", "install.ps1"])
def test_installers_register_through_lms_rather_than_copying_files(installer):
    """LM Studio does not scan a folder for plugins.

    A plugin is only visible once the app is told about it over its local API,
    which `lms dev --install` does via installLocalPlugin. An installer that
    copies into extensions/plugins produces a plugin that never appears, with
    no error anywhere.
    """
    text = (PLUGINS_DIR / installer).read_text(encoding="utf-8")
    assert "dev --install" in text
    # The old copy-into-the-plugins-folder approach built a destination path.
    # Its absence is what proves the installer no longer relies on a scan.
    assert "PluginRoot" not in text
    assert "PLUGIN_ROOT" not in text


def test_bundled_chat_template_matches_the_canonical_one():
    bundled = PLUGINS_DIR / "regescore/templates/regescore_fable5.jinja"
    canonical = ROOT / "config/chat_templates/regescore_fable5.jinja"
    assert bundled.read_text(encoding="utf-8") == canonical.read_text(encoding="utf-8")
