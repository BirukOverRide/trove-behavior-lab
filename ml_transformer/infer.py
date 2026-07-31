#!/usr/bin/env python3
"""
Run TinyVisitorTransformer inference.

  python infer.py --model model.npz --text "/cert_ver.php /admin-entry2.php"
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiny_transformer import TinyTransformerParams, predict  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--text", required=True)
    args = ap.parse_args()

    if not os.path.isfile(args.model):
        print(json.dumps({"ok": False, "error": "model file missing"}))
        return 1
    try:
        params = TinyTransformerParams.load(args.model)
        out = predict(params, args.text)
        out["ok"] = True
        print(json.dumps(out))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
