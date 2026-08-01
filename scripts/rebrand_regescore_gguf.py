#!/usr/bin/env python3
"""Rebrand a GGUF's metadata to RegesCore v1.0.

A GGUF carries its own identity, separate from the Hugging Face model card.
Tools read that embedded metadata, which is why LM Studio, Ollama and
llama.cpp can still show an upstream name long after the card says otherwise.
This rewrites the branding fields and leaves everything else alone.

    # report what is in the file and what would change
    python3 scripts/rebrand_regescore_gguf.py RegesCore-1.0-35B-MXFP4_MOE.gguf

    # write a rebranded copy
    python3 scripts/rebrand_regescore_gguf.py in.gguf --out RegesCore-v1.0.gguf

What it changes, all under general.*:
    name, basename, version, organization, description, url, repo_url,
    finetune, tags, languages, and every general.base_model.* entry, which is
    where an upstream lineage name lives.

What it refuses to change, and why:
    general.architecture and every key prefixed with the architecture name.
    llama.cpp dispatches on the architecture string and reads its
    hyperparameters from keys built from it, such as qwen3_5_moe.block_count.
    Renaming either produces a file no runtime can load. The architecture
    describes the tensor layout, not the brand, and a rebranded model is still
    that layout.

    tokenizer.* is also left alone. Those fields are the vocabulary contract.

Requires: pip install gguf

RegesCore // Fable 5 - brand and engineering by davidio.dev
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

try:
    import gguf
    from gguf.scripts.gguf_new_metadata import MetadataDetails, copy_with_new_metadata
except ImportError:  # pragma: no cover - environment guard
    sys.exit("gguf is required: pip install gguf")

DEFAULTS = {
    "name": "RegesCore v1.0",
    "basename": "RegesCore",
    "version": "1.0",
    "organization": "Like A King Inc.",
    "finetune": "regescore-v1.0",
    "url": "https://davidio.dev",
    "repo_url": "https://huggingface.co/iBossonline/RegesCore-1.0-35",
    "description": (
        "RegesCore v1.0 - elite engineering intelligence for software "
        "architecture, cybersecurity, AI systems and game server runtimes. "
        "Built by davidio.dev for the Like A King Inc. ecosystem."
    ),
}

TAGS = [
    "regescore",
    "fable5",
    "agentic",
    "reasoning",
    "cybersecurity",
    "reverse-engineering",
    "devops",
    "redm",
    "fivem",
]

# Structural keys. Changing these makes the file unloadable.
PROTECTED_EXACT = {"general.architecture", "general.file_type", "general.quantization_version"}
PROTECTED_PREFIXES = ("tokenizer.", "split.", "quantize.")

BRAND_NEEDLES = ("qwen", "ornith", "deepreinforce", "unsloth")


def architecture_of(reader: gguf.GGUFReader) -> str:
    field = reader.get_field("general.architecture")
    return str(field.contents()) if field is not None else ""


def is_protected(key: str, arch: str) -> bool:
    if key in PROTECTED_EXACT or key.startswith(PROTECTED_PREFIXES):
        return True
    # Hyperparameters are namespaced by the architecture string.
    return bool(arch) and key.startswith(f"{arch}.")


def survey(reader: gguf.GGUFReader, arch: str):
    """Return (rebrandable, protected) lists of (key, value) carrying a needle."""
    rebrandable, protected = [], []
    for name, field in reader.fields.items():
        try:
            value = field.contents()
        except Exception:  # pragma: no cover - malformed field
            continue
        text = str(value)
        if len(text) > 400:
            text = text[:400] + " ..."
        if not any(needle in text.lower() or needle in name.lower() for needle in BRAND_NEEDLES):
            continue
        (protected if is_protected(name, arch) else rebrandable).append((name, text))
    return rebrandable, protected


def build_metadata(args) -> tuple[dict, list[str]]:
    def detail(value, type_):
        return MetadataDetails(type_, value)

    string = gguf.GGUFValueType.STRING
    new = {
        "general.name": detail(args.name, string),
        "general.basename": detail(args.basename, string),
        "general.version": detail(args.version, string),
        "general.organization": detail(args.organization, string),
        "general.finetune": detail(args.finetune, string),
        "general.description": detail(args.description, string),
        "general.url": detail(args.url, string),
        "general.repo_url": detail(args.repo_url, string),
    }
    if not args.keep_tags:
        new["general.tags"] = MetadataDetails(
            gguf.GGUFValueType.ARRAY, TAGS, sub_type=gguf.GGUFValueType.STRING
        )
    return new, []


def base_model_keys(reader: gguf.GGUFReader) -> list[str]:
    """Every general.base_model.* key: the upstream lineage lives there."""
    return [name for name in reader.fields if name.startswith("general.base_model")]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebrand GGUF metadata to RegesCore v1.0",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="source .gguf")
    parser.add_argument("--out", type=Path, help="write a rebranded copy here")
    parser.add_argument("--name", default=DEFAULTS["name"])
    parser.add_argument("--basename", default=DEFAULTS["basename"])
    parser.add_argument("--version", default=DEFAULTS["version"])
    parser.add_argument("--organization", default=DEFAULTS["organization"])
    parser.add_argument("--finetune", default=DEFAULTS["finetune"])
    parser.add_argument("--description", default=DEFAULTS["description"])
    parser.add_argument("--url", default=DEFAULTS["url"])
    parser.add_argument("--repo-url", dest="repo_url", default=DEFAULTS["repo_url"])
    parser.add_argument("--keep-tags", action="store_true", help="leave general.tags as-is")
    parser.add_argument(
        "--keep-base-model",
        action="store_true",
        help="keep the general.base_model.* lineage fields instead of removing them",
    )
    parser.add_argument("--chat-template-file", type=Path, help="embed this Jinja template")
    parser.add_argument("--force", action="store_true", help="overwrite an existing --out")
    args = parser.parse_args()

    if not args.input.is_file():
        return fail(f"not a file: {args.input}")

    reader = gguf.GGUFReader(args.input, "r")
    arch = architecture_of(reader)

    print(f"\nRegesCore GGUF rebrand - davidio.dev")
    print(f"  input        : {args.input}")
    print(f"  architecture : {arch}  (structural, never changed)")

    rebrandable, protected = survey(reader, arch)

    print("\nUpstream names found in rebrandable fields:")
    if rebrandable:
        for key, value in rebrandable:
            print(f"  {key} = {value}")
    else:
        print("  (none)")

    print("\nUpstream names found in structural fields, left untouched:")
    if protected:
        for key, _ in protected:
            print(f"  {key}")
        print(
            "\n  These stay. llama.cpp dispatches on general.architecture and reads\n"
            f"  hyperparameters from keys prefixed '{arch}.'. Renaming them produces a\n"
            "  file no runtime can load. Architecture is the tensor layout, not the brand."
        )
    else:
        print("  (none)")

    new_metadata, remove = build_metadata(args)
    if not args.keep_base_model:
        remove.extend(base_model_keys(reader))

    if args.chat_template_file:
        if not args.chat_template_file.is_file():
            return fail(f"not a file: {args.chat_template_file}")
        new_metadata[gguf.Keys.Tokenizer.CHAT_TEMPLATE] = MetadataDetails(
            gguf.GGUFValueType.STRING,
            args.chat_template_file.read_text(encoding="utf-8"),
        )

    print("\nPlanned metadata:")
    for key, detail in new_metadata.items():
        value = str(detail.value)
        print(f"  set    {key} = {value[:100]}{' ...' if len(value) > 100 else ''}")
    for key in remove:
        print(f"  remove {key}")

    if args.out is None:
        print(
            "\nReport only. Re-run with --out NEW.gguf to write the rebranded copy."
            "\nThe copy is a full rewrite, so keep room for a second file of the same size."
        )
        return 0

    if args.out.exists() and not args.force:
        return fail(f"{args.out} exists; pass --force to overwrite")
    if args.out.resolve() == args.input.resolve():
        return fail("--out must differ from the input; this tool never edits in place")

    free = shutil.disk_usage(args.out.parent if args.out.parent.as_posix() else ".").free
    needed = args.input.stat().st_size
    if free < needed:
        return fail(
            f"need {needed / 1e9:.1f} GB free next to the output, {free / 1e9:.1f} GB available"
        )

    writer = gguf.GGUFWriter(args.out, arch=arch, endianess=reader.endianess)
    # Tensors are streamed from the source mapping, so peak memory stays small
    # even for a 20 GB model.
    copy_with_new_metadata(reader, writer, new_metadata, remove)

    print(f"\nWrote {args.out}")
    print("Load it once in LM Studio to confirm it still loads before deleting the original.")
    return 0


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
