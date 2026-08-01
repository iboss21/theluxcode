"""Round-trip coverage for scripts/rebrand_regescore_gguf.py.

The tool rewrites a model's embedded identity. The properties that matter are
that it changes the branding, removes the upstream lineage, and touches nothing
structural: a rebrand that alters the architecture string or a hyperparameter
key produces a file no runtime will load, and one that alters tensor data
silently damages the model.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

gguf = pytest.importorskip("gguf")

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/rebrand_regescore_gguf.py"
ARCH = "qwen3_5_moe"


@pytest.fixture(scope="module")
def source_gguf(tmp_path_factory):
    """A miniature GGUF carrying the same upstream names as the real model."""
    path = tmp_path_factory.mktemp("gguf") / "source.gguf"
    writer = gguf.GGUFWriter(path, arch=ARCH)
    writer.add_name("Ornith 1.0 35B")
    writer.add_basename("Ornith")
    writer.add_description("Qwen3.5 MoE derived model from deepreinforce-ai")
    writer.add_key_value("general.organization", "deepreinforce-ai", gguf.GGUFValueType.STRING)
    writer.add_key_value("general.base_model.count", 1, gguf.GGUFValueType.UINT32)
    writer.add_key_value("general.base_model.0.name", "Ornith 1.0 35B", gguf.GGUFValueType.STRING)
    writer.add_key_value(
        "general.base_model.0.repo_url",
        "https://huggingface.co/deepreinforce-ai/Ornith-1.0-35B",
        gguf.GGUFValueType.STRING,
    )
    writer.add_key_value(
        "general.tags", ["qwen", "moe", "unsloth"],
        gguf.GGUFValueType.ARRAY, sub_type=gguf.GGUFValueType.STRING,
    )
    writer.add_block_count(48)
    writer.add_context_length(262144)
    writer.add_key_value("tokenizer.ggml.model", "gpt2", gguf.GGUFValueType.STRING)
    writer.add_tensor("token_embd.weight", np.arange(32, dtype=np.float32).reshape(8, 4))
    writer.add_tensor("blk.0.attn_q.weight", np.ones((4, 4), dtype=np.float32))
    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    return path


def run(*args):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *[str(a) for a in args]],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


@pytest.fixture(scope="module")
def rebranded(source_gguf):
    out = source_gguf.parent / "rebranded.gguf"
    run(source_gguf, "--out", out)
    return gguf.GGUFReader(out, "r")


def test_report_mode_writes_nothing(source_gguf, tmp_path):
    before = source_gguf.read_bytes()
    output = run(source_gguf)
    assert "Report only" in output
    assert source_gguf.read_bytes() == before


def test_report_separates_rebrandable_from_structural(source_gguf):
    output = run(source_gguf)
    rebrandable, structural = output.split("structural fields", 1)
    assert "general.base_model.0.name" in rebrandable
    assert "general.organization" in rebrandable
    assert f"{ARCH}.block_count" in structural
    assert "general.architecture" in structural


def test_branding_is_replaced(rebranded):
    assert str(rebranded.get_field("general.name").contents()) == "RegesCore v1.0"
    assert str(rebranded.get_field("general.basename").contents()) == "RegesCore"
    assert str(rebranded.get_field("general.version").contents()) == "1.0"
    assert "RegesCore" in str(rebranded.get_field("general.description").contents())
    assert "davidio.dev" in str(rebranded.get_field("general.url").contents())


def test_upstream_lineage_is_removed(rebranded):
    for key in rebranded.fields:
        assert not key.startswith("general.base_model")
    tags = rebranded.get_field("general.tags").contents()
    assert "qwen" not in tags
    assert "regescore" in tags


def test_architecture_and_hyperparameters_survive(rebranded):
    """Renaming either yields a file llama.cpp cannot dispatch or configure."""
    assert str(rebranded.get_field("general.architecture").contents()) == ARCH
    assert int(rebranded.get_field(f"{ARCH}.block_count").contents()) == 48
    assert int(rebranded.get_field(f"{ARCH}.context_length").contents()) == 262144


def test_tokenizer_is_untouched(rebranded):
    assert str(rebranded.get_field("tokenizer.ggml.model").contents()) == "gpt2"


def test_tensor_data_is_byte_identical(source_gguf, rebranded):
    original = gguf.GGUFReader(source_gguf, "r")
    assert [t.name for t in rebranded.tensors] == [t.name for t in original.tensors]
    for new, old in zip(rebranded.tensors, original.tensors):
        assert np.array_equal(np.asarray(new.data), np.asarray(old.data)), new.name


def test_refuses_to_overwrite_its_own_input(source_gguf):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(source_gguf), "--out", str(source_gguf), "--force"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "never edits in place" in result.stderr


def test_keep_flags_preserve_upstream_fields(source_gguf, tmp_path):
    out = tmp_path / "kept.gguf"
    run(source_gguf, "--out", out, "--keep-base-model", "--keep-tags")
    reader = gguf.GGUFReader(out, "r")
    assert reader.get_field("general.base_model.0.name") is not None
    assert "qwen" in reader.get_field("general.tags").contents()
