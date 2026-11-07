#!/usr/bin/env python3
"""Prepare a Cat Modeling JSON request without executing a model or Blender.

This is a cross-language serialization example, not an authorization verifier or
replacement for the authoritative Node contract validator. No files are written,
no references are fetched, and no subprocess is started.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def prepare_request(source: Path, job_id: str | None = None) -> dict:
    """Read JSON and optionally select a fresh job ID; preserve all other fields."""
    if source.stat().st_size > 1024 * 1024:
        raise ValueError("request exceeds 1 MiB")
    request = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(request, dict):
        raise ValueError("expected a JSON object")
    if job_id is not None:
        request["jobId"] = job_id
    return request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path,
        default=Path(__file__).with_name("request.v1.json"),
        help="local request JSON; never a URL",
    )
    parser.add_argument("--job-id", help="replace the example job ID; validator checks syntax")
    args = parser.parse_args()
    try:
        request = prepare_request(args.input, args.job_id)
        encoded = json.dumps(request, ensure_ascii=False, allow_nan=False, indent=2)
    except (OSError, ValueError, TypeError) as exc:
        print(json.dumps({"code": "REQUEST_PREPARATION_FAILED", "message": str(exc)}), file=sys.stderr)
        return 1
    print(encoded)
    print(
        "Prepared JSON only. Run the Node CLI contract validation dry-run before use; "
        "this program does not establish authorization, asset availability or model readiness.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
