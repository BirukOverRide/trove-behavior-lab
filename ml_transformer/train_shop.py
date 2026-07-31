#!/usr/bin/env python3
"""
Train Tiny Transformer on Trove shopper journeys.
Writes rich live progress JSON for the admin learning console.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiny_transformer import train_from_examples  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--progress", required=True)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--lr", type=float, default=0.05)
    args = ap.parse_args()

    def write_progress(payload: dict) -> None:
        tmp = args.progress + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp, args.progress)

    write_progress(
        {
            "status": "starting",
            "epoch": 0,
            "epochs": args.epochs,
            "loss": None,
            "startedAt": time.time(),
        }
    )

    try:
        with open(args.data, encoding="utf-8") as f:
            payload = json.load(f)
        examples = payload.get("examples") or []
        if not examples:
            write_progress({"status": "failed", "error": "no examples"})
            print(json.dumps({"ok": False, "error": "no examples"}))
            return 1

        # What we're about to learn (dataset snapshot)
        from collections import Counter

        label_pre = Counter(str(e.get("label") or "window_shopper") for e in examples)
        write_progress(
            {
                "status": "training",
                "epoch": 0,
                "epochs": args.epochs,
                "samples": len(examples),
                "loss": None,
                "startedAt": time.time(),
                "learning_target": {
                    "n_examples": len(examples),
                    "label_counts": dict(label_pre),
                    "description": "Classify shopper journey token sequences into consumer personas",
                },
            }
        )

        t0 = time.time()

        def on_progress(
            epoch: int,
            epochs: int,
            loss: float,
            train_acc: float = 0.0,
            extra: dict | None = None,
        ) -> None:
            extra = extra or {}
            write_progress(
                {
                    "status": "training",
                    "epoch": epoch,
                    "epochs": epochs,
                    "loss": loss,
                    "train_acc": train_acc,
                    "mean_confidence": extra.get("mean_confidence"),
                    "mean_true_class_prob": extra.get("mean_true_class_prob"),
                    "mean_entropy": extra.get("mean_entropy"),
                    "mean_class_acc": extra.get("mean_class_acc"),
                    "n_correct": extra.get("n_correct"),
                    "n_wrong": extra.get("n_wrong"),
                    "per_class_acc": extra.get("per_class_acc"),
                    "per_class_history": extra.get("per_class_history"),
                    "history": extra.get("history_so_far"),
                    "confidence_hist": extra.get("confidence_hist"),
                    "mistakes": extra.get("mistakes"),
                    "class_deltas": extra.get("class_deltas"),
                    "diary": extra.get("diary"),
                    "baseline_acc": extra.get("baseline_acc"),
                    "baseline_confidence": extra.get("baseline_confidence"),
                    "lr": extra.get("lr"),
                    "samples": len(examples),
                    "pct": round(100 * epoch / epochs, 1),
                    "startedAt": t0,
                    "elapsed": time.time() - t0,
                    "eta_sec": (
                        ((time.time() - t0) / epoch) * (epochs - epoch)
                        if epoch
                        else None
                    ),
                    "learning_target": {
                        "n_examples": len(examples),
                        "label_counts": dict(label_pre),
                        "description": "Classify shopper journey token sequences into consumer personas",
                    },
                }
            )

        params, info = train_from_examples(
            examples, epochs=args.epochs, lr=args.lr, progress_cb=on_progress
        )
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
        params.save(args.out)

        # Drop huge fields from stdout if needed — full info to progress file
        result = {"ok": True, "out": args.out, **info}
        write_progress(
            {
                "status": "completed",
                "epoch": args.epochs,
                "epochs": args.epochs,
                "pct": 100,
                "loss": info.get("final_loss"),
                "train_acc": info.get("train_acc"),
                "mean_confidence": info.get("mean_confidence"),
                "mean_true_class_prob": info.get("mean_true_class_prob"),
                "mean_entropy": info.get("mean_entropy"),
                "samples": info.get("samples"),
                "vocab_size": info.get("vocab_size"),
                "seconds": info.get("seconds"),
                "history": info.get("history"),
                "per_class_history": info.get("per_class_history"),
                "label_counts": info.get("label_counts"),
                "per_class_metrics": info.get("per_class_metrics"),
                "baseline_per_class": info.get("baseline_per_class"),
                "confusion": info.get("confusion"),
                "confusion_labels": info.get("confusion_labels"),
                "confidence_hist": info.get("confidence_hist"),
                "baseline_confidence_hist": info.get("baseline_confidence_hist"),
                "mistakes": info.get("mistakes"),
                "token_stats": info.get("token_stats"),
                "example_journeys": info.get("example_journeys"),
                "evolution": info.get("evolution"),
                "diary": info.get("diary"),
                "modelPath": args.out,
                "completedAt": time.time(),
                "improvement": {
                    "start_loss": (info.get("history") or [{}])[0].get("loss"),
                    "end_loss": info.get("final_loss"),
                    "start_acc": (info.get("history") or [{}])[0].get("train_acc"),
                    "end_acc": info.get("train_acc"),
                    "baseline_acc": (info.get("evolution") or {}).get("baseline_acc"),
                    "acc_gain": (info.get("evolution") or {}).get("acc_gain"),
                    "loss_drop_pct": (info.get("evolution") or {}).get("loss_drop_pct"),
                },
            }
        )
        print(json.dumps(result))
        return 0
    except Exception as e:
        write_progress({"status": "failed", "error": str(e)})
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
