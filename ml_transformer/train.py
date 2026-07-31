#!/usr/bin/env python3
"""
Train TinyVisitorTransformer from JSON examples exported by PHP.

Usage:
  python train.py --data /path/to/train.json --out /path/to/model.npz --epochs 25

train.json format:
  {"examples":[{"text":"/cert /login ...","label":"auth_probe"}, ...]}
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# allow import from same dir
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiny_transformer import train_from_examples  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Path to train.json")
    ap.add_argument("--out", required=True, help="Output model.npz path")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--lr", type=float, default=0.05)
    args = ap.parse_args()

    with open(args.data, encoding="utf-8") as f:
        payload = json.load(f)
    examples = payload.get("examples") or []
    if not examples:
        print(json.dumps({"ok": False, "error": "no examples"}))
        return 1

    params, info = train_from_examples(examples, epochs=args.epochs, lr=args.lr)
    out = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    params.save(out)
    result = {"ok": True, "out": out, **info}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
