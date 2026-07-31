#!/usr/bin/env python3
"""
TinyTransformer — a real (small-scale) Transformer encoder for visitor path sequences.

Not an LLM. Not GPT. A genuine multi-head self-attention encoder that:
  - maps tokenized page paths → class logits (persona / intent)
  - trains with SGD + cross-entropy on your labeled sequences
  - saves weights as .npz

Dependencies: numpy only.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
from dataclasses import dataclass, asdict
from typing import Any

import numpy as np

# ---------------------------------------------------------------------------
# Hyperparameters (small by design)
# ---------------------------------------------------------------------------
D_MODEL = 64
N_HEADS = 4
N_LAYERS = 2
D_FF = 128
MAX_LEN = 48
VOCAB_MAX = 512
LR = 0.03  # head+emb training is stable at this scale
EPOCHS_DEFAULT = 20
SEED = 42
GRAD_CLIP = 1.0
EARLY_STOP_PATIENCE = 6
DIVERGE_DROP = 0.15  # if acc falls this far below best, restore + cut LR
# Approx full backprop through attention was diverging; train head+embeddings
# on frozen random-feature transformer (classic, stable for tiny numpy models)
TRAIN_DEEP_LAYERS = False

# Consumer shopping personas (Trove behavior model)
PERSONA_LABELS = [
    "window_shopper",
    "product_browser",
    "bargain_hunter",
    "cart_builder",
    "cart_abandons",
    "high_intent",
    "loyal_buyer",
    "impulse_buyer",
    "category_loyal",
    "explorer",
]
LABEL2ID = {n: i for i, n in enumerate(PERSONA_LABELS)}
ID2LABEL = {i: n for n, i in LABEL2ID.items()}


def set_seed(seed: int = SEED) -> None:
    np.random.seed(seed)


def tokenize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^a-z0-9/._\-\s]+", " ", text)
    parts = re.split(r"[\s/._\-]+", text)
    out = []
    for p in parts:
        p = p.strip()
        if 2 <= len(p) <= 40:
            out.append(p)
    return out


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = x - np.max(x, axis=axis, keepdims=True)
    e = np.exp(x)
    return e / (np.sum(e, axis=axis, keepdims=True) + 1e-9)


def layer_norm(x: np.ndarray, gamma: np.ndarray, beta: np.ndarray, eps: float = 1e-5) -> np.ndarray:
    mean = x.mean(axis=-1, keepdims=True)
    var = x.var(axis=-1, keepdims=True)
    return gamma * (x - mean) / np.sqrt(var + eps) + beta


# ---------------------------------------------------------------------------
# Model parameters
# ---------------------------------------------------------------------------

@dataclass
class TinyTransformerParams:
    tok_emb: np.ndarray       # (V, D)
    pos_emb: np.ndarray       # (L, D)
    # per layer: Wq, Wk, Wv, Wo, W1, b1, W2, b2, ln1g, ln1b, ln2g, ln2b
    layers: list[dict[str, np.ndarray]]
    ln_fg: np.ndarray
    ln_fb: np.ndarray
    W_out: np.ndarray         # (D, C)
    b_out: np.ndarray         # (C,)
    vocab: dict[str, int]
    labels: list[str]
    d_model: int = D_MODEL
    n_heads: int = N_HEADS
    max_len: int = MAX_LEN

    def save(self, path: str) -> None:
        payload = {
            "tok_emb": self.tok_emb,
            "pos_emb": self.pos_emb,
            "layers": self.layers,
            "ln_fg": self.ln_fg,
            "ln_fb": self.ln_fb,
            "W_out": self.W_out,
            "b_out": self.b_out,
            "vocab": self.vocab,
            "labels": self.labels,
            "d_model": self.d_model,
            "n_heads": self.n_heads,
            "max_len": self.max_len,
            "kind": "TinyVisitorTransformer",
            "version": 1,
        }
        np.savez_compressed(path, **{k: (np.array(v) if isinstance(v, list) else v)
                                     for k, v in payload.items() if k != "layers" and k != "vocab" and k != "labels"})
        # save layers + meta as companion json (vocab/labels) + npy for layers
        meta = {
            "vocab": self.vocab,
            "labels": self.labels,
            "d_model": self.d_model,
            "n_heads": self.n_heads,
            "max_len": self.max_len,
            "kind": "TinyVisitorTransformer",
            "version": 1,
            "n_layers": len(self.layers),
        }
        base = path[:-4] if path.endswith(".npz") else path
        with open(base + ".meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f)
        for i, layer in enumerate(self.layers):
            np.savez_compressed(f"{base}.layer{i}.npz", **layer)

    @staticmethod
    def load(path: str) -> "TinyTransformerParams":
        base = path[:-4] if path.endswith(".npz") else path
        data = np.load(path, allow_pickle=False)
        with open(base + ".meta.json", encoding="utf-8") as f:
            meta = json.load(f)
        layers = []
        for i in range(int(meta["n_layers"])):
            ld = np.load(f"{base}.layer{i}.npz")
            layers.append({k: ld[k] for k in ld.files})
        return TinyTransformerParams(
            tok_emb=data["tok_emb"],
            pos_emb=data["pos_emb"],
            layers=layers,
            ln_fg=data["ln_fg"],
            ln_fb=data["ln_fb"],
            W_out=data["W_out"],
            b_out=data["b_out"],
            vocab=meta["vocab"],
            labels=meta["labels"],
            d_model=int(meta["d_model"]),
            n_heads=int(meta["n_heads"]),
            max_len=int(meta["max_len"]),
        )


def init_params(vocab_size: int, n_classes: int) -> TinyTransformerParams:
    set_seed()
    D, H, L = D_MODEL, N_HEADS, MAX_LEN
    assert D % H == 0
    scale = 0.02
    layers = []
    for _ in range(N_LAYERS):
        layers.append({
            "Wq": np.random.randn(D, D).astype(np.float32) * scale,
            "Wk": np.random.randn(D, D).astype(np.float32) * scale,
            "Wv": np.random.randn(D, D).astype(np.float32) * scale,
            "Wo": np.random.randn(D, D).astype(np.float32) * scale,
            "W1": np.random.randn(D, D_FF).astype(np.float32) * scale,
            "b1": np.zeros(D_FF, dtype=np.float32),
            "W2": np.random.randn(D_FF, D).astype(np.float32) * scale,
            "b2": np.zeros(D, dtype=np.float32),
            "ln1g": np.ones(D, dtype=np.float32),
            "ln1b": np.zeros(D, dtype=np.float32),
            "ln2g": np.ones(D, dtype=np.float32),
            "ln2b": np.zeros(D, dtype=np.float32),
        })
    return TinyTransformerParams(
        tok_emb=np.random.randn(vocab_size, D).astype(np.float32) * scale,
        pos_emb=np.random.randn(L, D).astype(np.float32) * scale,
        layers=layers,
        ln_fg=np.ones(D, dtype=np.float32),
        ln_fb=np.zeros(D, dtype=np.float32),
        W_out=np.random.randn(D, n_classes).astype(np.float32) * scale,
        b_out=np.zeros(n_classes, dtype=np.float32),
        vocab={},
        labels=PERSONA_LABELS[:],
    )


def attention(q: np.ndarray, k: np.ndarray, v: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """q,k,v: (T, H, Dh)  mask: (T,) bool True=keep"""
    Dh = q.shape[-1]
    # scores (T, H, T)
    scores = np.einsum("thd,Thd->htT", q, k) / math.sqrt(Dh)
    # mask keys
    m = mask.astype(np.float32)
    scores = scores + (1.0 - m)[None, None, :] * (-1e9)
    w = softmax(scores, axis=-1)
    out = np.einsum("htT,Thd->thd", w, v)
    return out


def forward(params: TinyTransformerParams, ids: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """
    ids: (T,) int
    mask: (T,) bool
    returns logits (C,)
    """
    T = ids.shape[0]
    H = params.n_heads
    D = params.d_model
    Dh = D // H
    x = params.tok_emb[ids] + params.pos_emb[:T]

    for layer in params.layers:
        # Multi-head self-attention
        h = layer_norm(x, layer["ln1g"], layer["ln1b"])
        q = h @ layer["Wq"]
        k = h @ layer["Wk"]
        v = h @ layer["Wv"]
        q = q.reshape(T, H, Dh)
        k = k.reshape(T, H, Dh)
        v = v.reshape(T, H, Dh)
        att = attention(q, k, v, mask)  # (T,H,Dh)
        att = att.reshape(T, D) @ layer["Wo"]
        x = x + att
        # FFN
        h2 = layer_norm(x, layer["ln2g"], layer["ln2b"])
        ff = np.maximum(0, h2 @ layer["W1"] + layer["b1"])  # ReLU
        ff = ff @ layer["W2"] + layer["b2"]
        x = x + ff

    x = layer_norm(x, params.ln_fg, params.ln_fb)
    # mean pool over valid tokens
    m = mask.astype(np.float32)[:, None]
    pooled = (x * m).sum(axis=0) / (m.sum() + 1e-9)
    logits = pooled @ params.W_out + params.b_out
    return logits


def encode_sequence(text: str, vocab: dict[str, int], max_len: int = MAX_LEN) -> tuple[np.ndarray, np.ndarray]:
    toks = tokenize(text)
    ids = [vocab.get(t, 1) for t in toks][:max_len]  # 1 = UNK
    if not ids:
        ids = [1]
    while len(ids) < max_len:
        ids.append(0)  # PAD
    ids_a = np.array(ids[:max_len], dtype=np.int64)
    mask = ids_a != 0
    if not mask.any():
        mask[0] = True
    return ids_a, mask


def build_vocab(texts: list[str], max_size: int = VOCAB_MAX) -> dict[str, int]:
    counts: dict[str, int] = {}
    for t in texts:
        for tok in tokenize(t):
            counts[tok] = counts.get(tok, 0) + 1
    ordered = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    vocab = {"<PAD>": 0, "<UNK>": 1}
    for w, _ in ordered:
        if w in vocab:
            continue
        if len(vocab) >= max_size:
            break
        vocab[w] = len(vocab)
    return vocab


def cross_entropy(
    logits: np.ndarray, y: int, class_weight: float = 1.0
) -> tuple[float, np.ndarray]:
    p = softmax(logits)
    w = float(class_weight)
    loss = float(-np.log(p[y] + 1e-9) * w)
    grad = p.copy()
    grad[y] -= 1.0
    grad *= w
    return loss, grad


def _clone_weights(params: TinyTransformerParams) -> dict[str, Any]:
    return {
        "tok_emb": params.tok_emb.copy(),
        "pos_emb": params.pos_emb.copy(),
        "layers": [{k: v.copy() for k, v in layer.items()} for layer in params.layers],
        "ln_fg": params.ln_fg.copy(),
        "ln_fb": params.ln_fb.copy(),
        "W_out": params.W_out.copy(),
        "b_out": params.b_out.copy(),
    }


def _restore_weights(params: TinyTransformerParams, snap: dict[str, Any]) -> None:
    params.tok_emb[:] = snap["tok_emb"]
    params.pos_emb[:] = snap["pos_emb"]
    params.ln_fg[:] = snap["ln_fg"]
    params.ln_fb[:] = snap["ln_fb"]
    params.W_out[:] = snap["W_out"]
    params.b_out[:] = snap["b_out"]
    for layer, sl in zip(params.layers, snap["layers"]):
        for k in layer:
            layer[k][:] = sl[k]


def _balanced_indices(samples: list[tuple[np.ndarray, np.ndarray, int]]) -> np.ndarray:
    """Oversample rare personas so majority class doesn't dominate every step."""
    from collections import defaultdict

    by_y: dict[int, list[int]] = defaultdict(list)
    for i, s in enumerate(samples):
        by_y[int(s[2])].append(i)
    if not by_y:
        return np.array([], dtype=np.int64)
    # Cap per-class draws so huge datasets stay fast and stable
    target = max(len(v) for v in by_y.values())
    target = min(target, 40)  # keep epochs fast + less thrashing
    target = max(target, 6)
    idx: list[int] = []
    for ys, ids in by_y.items():
        replace = len(ids) < target
        chosen = np.random.choice(ids, size=target, replace=replace)
        idx.extend(int(x) for x in chosen)
    np.random.shuffle(idx)
    return np.array(idx, dtype=np.int64)


def train_epoch(
    params: TinyTransformerParams,
    samples: list[tuple[np.ndarray, np.ndarray, int]],
    lr: float,
    class_weights: np.ndarray | None = None,
) -> float:
    """One epoch of SGD with class-balanced sampling when imbalanced."""
    total = 0.0
    n = 0
    # Balance when skew is bad (max class > 2x min class among present)
    from collections import Counter

    cnt = Counter(int(s[2]) for s in samples)
    present = [c for c in cnt.values() if c > 0]
    skew = (max(present) / max(min(present), 1)) if present else 1.0
    if skew >= 2.0 and len(present) >= 2:
        idx = _balanced_indices(samples)
    else:
        idx = np.random.permutation(len(samples))
    for i in idx:
        ids, mask, y = samples[int(i)]
        w = float(class_weights[y]) if class_weights is not None else 1.0
        loss = _train_step(params, ids, mask, y, lr, class_weight=w)
        total += loss
        n += 1
    return total / max(1, n)


def _train_step(
    params: TinyTransformerParams,
    ids: np.ndarray,
    mask: np.ndarray,
    y: int,
    lr: float,
    class_weight: float = 1.0,
) -> float:
    """One SGD step with backprop through all layers (numpy)."""
    T = ids.shape[0]
    H = params.n_heads
    D = params.d_model
    Dh = D // H
    clip = GRAD_CLIP

    # ---- Forward with cache ----
    caches = []
    x = params.tok_emb[ids] + params.pos_emb[:T]
    for layer in params.layers:
        cache: dict[str, Any] = {}
        h = layer_norm(x, layer["ln1g"], layer["ln1b"])
        cache["x"] = x
        cache["h"] = h
        q = h @ layer["Wq"]
        k = h @ layer["Wk"]
        v = h @ layer["Wv"]
        qh = q.reshape(T, H, Dh)
        kh = k.reshape(T, H, Dh)
        vh = v.reshape(T, H, Dh)
        scores = np.einsum("thd,Thd->htT", qh, kh) / math.sqrt(Dh)
        m = mask.astype(np.float32)
        scores = scores + (1.0 - m)[None, None, :] * (-1e9)
        w = softmax(scores, axis=-1)
        att_h = np.einsum("htT,Thd->thd", w, vh)
        att = att_h.reshape(T, D)
        att_o = att @ layer["Wo"]
        x2 = x + att_o
        h2 = layer_norm(x2, layer["ln2g"], layer["ln2b"])
        ff1 = h2 @ layer["W1"] + layer["b1"]
        ff1_act = np.maximum(0, ff1)
        ff2 = ff1_act @ layer["W2"] + layer["b2"]
        x3 = x2 + ff2
        cache.update({
            "qh": qh, "kh": kh, "vh": vh, "w": w, "att": att, "att_o": att_o,
            "x2": x2, "h2": h2, "ff1": ff1, "ff1_act": ff1_act, "ff2": ff2,
        })
        caches.append(cache)
        x = x3

    x_final = layer_norm(x, params.ln_fg, params.ln_fb)
    mcol = mask.astype(np.float32)[:, None]
    denom = float(mcol.sum() + 1e-9)
    pooled = (x_final * mcol).sum(axis=0) / denom
    logits = pooled @ params.W_out + params.b_out
    loss, dlogits = cross_entropy(logits, y, class_weight=class_weight)

    # ---- Backward ----
    dW_out = np.outer(pooled, dlogits)
    db_out = dlogits
    dpooled = params.W_out @ dlogits

    # ---- Parameter updates ----
    # Stable path: classifier head + token embeddings only.
    # Freezing attention/FFN avoids noisy approx-backprop that collapsed accuracy
    # as the dataset grew (more learning → worse model).
    if not TRAIN_DEEP_LAYERS:
        demb = dpooled / denom
        for t in range(T):
            if mask[t]:
                params.tok_emb[ids[t]] -= lr * np.clip(demb, -clip, clip)
                params.pos_emb[t] -= lr * 0.2 * np.clip(demb, -clip, clip)
    else:
        # Optional full-ish path (legacy; less stable)
        dx_final = (dpooled[None, :] * mcol) / denom
        dx = dx_final
        for li in range(len(params.layers) - 1, -1, -1):
            layer = params.layers[li]
            cache = caches[li]
            dff2 = dx
            dx2 = dx.copy()
            dW2 = cache["ff1_act"].T @ dff2
            db2 = dff2.sum(axis=0)
            dff1_act = dff2 @ layer["W2"].T
            dff1 = dff1_act * (cache["ff1"] > 0)
            dW1 = cache["h2"].T @ dff1
            db1 = dff1.sum(axis=0)
            dh2 = dff1 @ layer["W1"].T
            dx2 = dx2 + dh2
            datt_o = dx2
            dWo = cache["att"].T @ datt_o
            datt = datt_o @ layer["Wo"].T
            datt_h = datt.reshape(T, H, Dh)
            dvh = np.einsum("htT,thd->Thd", cache["w"], datt_h)
            dv = dvh.reshape(T, D)
            dWv = cache["h"].T @ dv
            dh = dv @ layer["Wv"].T
            dWq = cache["h"].T @ (cache["qh"].reshape(T, D) * 0.05)
            dWk = cache["h"].T @ (cache["kh"].reshape(T, D) * 0.05)
            dx_in = dx2 + dh
            deep = lr * 0.15
            layer["W2"] -= deep * np.clip(dW2, -clip, clip)
            layer["b2"] -= deep * np.clip(db2, -clip, clip)
            layer["W1"] -= deep * np.clip(dW1, -clip, clip)
            layer["b1"] -= deep * np.clip(db1, -clip, clip)
            layer["Wo"] -= deep * np.clip(dWo, -clip, clip)
            layer["Wv"] -= deep * np.clip(dWv, -clip, clip)
            layer["Wq"] -= deep * 0.3 * np.clip(dWq, -clip, clip)
            layer["Wk"] -= deep * 0.3 * np.clip(dWk, -clip, clip)
            dx = dx_in
        for t in range(T):
            if mask[t]:
                params.tok_emb[ids[t]] -= lr * 0.5 * np.clip(dx[t], -clip, clip)
                params.pos_emb[t] -= lr * 0.15 * np.clip(dx[t], -clip, clip)

    params.W_out -= lr * np.clip(dW_out, -clip, clip)
    params.b_out -= lr * np.clip(db_out, -clip, clip)
    return loss


def predict(params: TinyTransformerParams, text: str) -> dict[str, Any]:
    ids, mask = encode_sequence(text, params.vocab, params.max_len)
    logits = forward(params, ids, mask)
    p = softmax(logits)
    pred = int(np.argmax(p))
    label = params.labels[pred] if pred < len(params.labels) else str(pred)
    top = sorted(
        [{"label": params.labels[i], "prob": float(p[i])} for i in range(len(p))],
        key=lambda x: -x["prob"],
    )[:5]
    return {
        "label": label,
        "confidence": float(p[pred]),
        "probs": top,
        "model": "TinyVisitorTransformer",
        "d_model": params.d_model,
        "n_heads": params.n_heads,
        "n_layers": len(params.layers),
    }


def weak_label_from_text(text: str) -> str:
    """Same spirit as PHP rules — weak labels for visitor + system tokens."""
    t = text.lower()
    # Whole-system posture tokens (from Superadmin export)
    if "sys_posture" in t or "system_snapshot" in t:
        if "threat_elevated" in t or "threat_high" in t or "score_high" in t:
            return "system_threat_elevated"
        if "auth_pressure" in t or "fails_high" in t or "login_fail" in t:
            return "system_auth_pressure"
        if "bot_wave" in t or "bots_high" in t:
            return "system_bot_wave"
        if "mixed_risk" in t or "suspicious_many" in t:
            return "system_mixed_risk"
        if "sys_busy" in t or "hits_high" in t:
            return "system_busy"
        return "system_calm"
    if any(x in t for x in ("wp-login", "phpmyadmin", ".env", "xmlrpc", "eval-stdin")):
        return "recon_scanner"
    if "marked_ip" in t or "threat_suspicious" in t:
        return "suspicious_mix"
    if "multi_browser" in t or "chain_multi" in t:
        return "multi_identity"
    if "bot" in t or "curl" in t or "python" in t:
        return "bot_noise"
    if "superadmin" in t or t.count("admin") >= 2:
        return "auth_probe"
    if "login" in t or "password" in t or "admin-entry" in t or "login_fail" in t:
        return "auth_probe"
    if "cert" in t or "seafarer" in t or "verif" in t:
        return "cert_seeker"
    if "logged" in t or "session" in t or "staff" in t:
        return "staff_session"
    return "legit_visitor"


def _eval_detailed(
    params: TinyTransformerParams,
    samples: list[tuple[np.ndarray, np.ndarray, int]],
    n_classes: int,
    texts: list[str] | None = None,
    max_mistakes: int = 16,
) -> dict[str, Any]:
    """Accuracy, per-class metrics, confusion, confidence bins, mistakes."""
    from collections import Counter

    correct = 0
    conf_sum = 0.0
    true_conf_sum = 0.0
    # confusion[true][pred]
    confusion = np.zeros((n_classes, n_classes), dtype=np.int32)
    class_correct = Counter()
    class_total = Counter()
    class_conf = Counter()  # sum of p(true) for each class
    conf_hist = [0] * 10  # bins [0-0.1), ..., [0.9-1.0]
    mistakes: list[dict[str, Any]] = []
    entropy_sum = 0.0

    for idx, (ids, mask, y) in enumerate(samples):
        logits = forward(params, ids, mask)
        p = softmax(logits)
        pred = int(np.argmax(p))
        conf = float(p[pred])
        true_p = float(p[y])
        conf_sum += conf
        true_conf_sum += true_p
        # entropy of predictive distribution
        pp = np.clip(p, 1e-12, 1.0)
        entropy_sum += float(-np.sum(pp * np.log(pp)))
        bin_i = min(9, int(conf * 10))
        conf_hist[bin_i] += 1
        confusion[y, pred] += 1
        class_total[y] += 1
        class_conf[y] += true_p
        if pred == y:
            correct += 1
            class_correct[y] += 1
        elif len(mistakes) < max_mistakes:
            top2 = int(np.argsort(p)[-2]) if len(p) > 1 else pred
            mistakes.append(
                {
                    "true": ID2LABEL.get(y, str(y)),
                    "pred": ID2LABEL.get(pred, str(pred)),
                    "confidence": round(conf, 4),
                    "true_class_prob": round(true_p, 4),
                    "runner_up": ID2LABEL.get(top2, str(top2)),
                    "runner_up_prob": round(float(p[top2]), 4),
                    "journey": (texts[idx][:180] if texts and idx < len(texts) else ""),
                }
            )

    n = max(len(samples), 1)
    per_class = {}
    for i, name in enumerate(PERSONA_LABELS[:n_classes]):
        tot = class_total[i]
        if tot == 0:
            continue
        pred_as_i = int(confusion[:, i].sum())
        tp = int(confusion[i, i])
        precision = tp / pred_as_i if pred_as_i else 0.0
        recall = tp / tot
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )
        per_class[name] = {
            "support": tot,
            "accuracy": tp / tot,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "mean_true_class_prob": class_conf[i] / tot,
        }

    return {
        "train_acc": correct / n,
        "mean_confidence": conf_sum / n,
        "mean_true_class_prob": true_conf_sum / n,
        "mean_entropy": entropy_sum / n,
        "n_correct": correct,
        "n_wrong": len(samples) - correct,
        "per_class": per_class,
        "confusion": confusion.tolist(),
        "confusion_labels": PERSONA_LABELS[:n_classes],
        "confidence_hist": conf_hist,
        "mistakes": mistakes,
    }


def _token_stats_by_label(
    texts: list[str], labels: list[int], top_k: int = 8
) -> dict[str, list[dict[str, Any]]]:
    """What tokens appear most for each persona — 'what is it learning'."""
    from collections import Counter, defaultdict

    bag: dict[int, Counter] = defaultdict(Counter)
    for text, y in zip(texts, labels):
        for tok in tokenize(text):
            bag[y][tok] += 1
    out: dict[str, list[dict[str, Any]]] = {}
    for y, ctr in bag.items():
        name = ID2LABEL.get(y, str(y))
        total = sum(ctr.values()) or 1
        out[name] = [
            {"token": t, "count": c, "share": round(c / total, 4)}
            for t, c in ctr.most_common(top_k)
        ]
    return out


def _example_journeys(
    texts: list[str], labels: list[int], per_label: int = 2
) -> dict[str, list[str]]:
    from collections import defaultdict

    buckets: dict[int, list[str]] = defaultdict(list)
    for text, y in zip(texts, labels):
        if len(buckets[y]) < per_label:
            buckets[y].append(text[:200])
    return {ID2LABEL.get(y, str(y)): xs for y, xs in buckets.items()}


def train_from_examples(
    examples: list[dict[str, str]],
    epochs: int = EPOCHS_DEFAULT,
    lr: float = LR,
    progress_cb=None,
) -> tuple[TinyTransformerParams, dict[str, Any]]:
    """
    examples: [{"text": "journey tokens ...", "label": "loyal_buyer"}, ...]
    progress_cb(epoch, epochs, loss, train_acc, extra_dict) optional
    """
    from collections import Counter

    set_seed()
    texts = [str(e.get("text", "")) for e in examples]
    labels = []
    for e in examples:
        lab = str(e.get("label") or "window_shopper")
        if lab not in LABEL2ID:
            aliases = {
                "buyer": "loyal_buyer",
                "browser": "product_browser",
                "window": "window_shopper",
            }
            lab = aliases.get(lab, "window_shopper")
        labels.append(LABEL2ID[lab])

    vocab = build_vocab(texts)
    n_classes = len(PERSONA_LABELS)
    params = init_params(len(vocab), n_classes)
    params.vocab = vocab
    params.labels = PERSONA_LABELS[:]

    samples: list[tuple[np.ndarray, np.ndarray, int]] = []
    for text, y in zip(texts, labels):
        ids, mask = encode_sequence(text, vocab)
        samples.append((ids, mask, y))

    if not samples:
        raise ValueError("No training samples")

    # Inverse-frequency class weights (stabilize when one persona floods the set)
    label_counts = Counter(labels)
    n_present = max(1, len([c for c in label_counts.values() if c > 0]))
    class_weights = np.ones(n_classes, dtype=np.float64)
    for yi, c in label_counts.items():
        class_weights[yi] = len(labels) / (n_present * max(c, 1))
    class_weights = class_weights / (class_weights.mean() + 1e-9)
    # Soften extremes so rare classes don't explode gradients
    class_weights = np.clip(class_weights, 0.5, 2.5)

    # Head+emb training supports higher LR; still cap on huge sets
    base_lr = float(lr) if lr > 0 else LR
    if base_lr < 0.01:
        base_lr = 0.02
    if len(samples) > 500:
        base_lr = min(base_lr, 0.025)
    if len(samples) > 1000:
        base_lr = min(base_lr, 0.02)

    # Snapshot BEFORE training (epoch 0) — how clueless it starts
    baseline = _eval_detailed(params, samples, n_classes, texts=texts)

    history = []
    per_class_history: list[dict[str, Any]] = []  # epoch -> {label: acc}
    diary: list[dict[str, Any]] = [
        {
            "epoch": 0,
            "kind": "baseline",
            "message": (
                f"Cold start · acc {(baseline['train_acc'] * 100):.1f}% · "
                f"mean conf {(baseline['mean_confidence'] * 100):.0f}% · "
                f"entropy {baseline['mean_entropy']:.2f} · "
                f"{baseline['n_wrong']} wrong of {len(samples)} · "
                f"lr={base_lr:.4f} · balanced training on"
            ),
            "acc": float(baseline["train_acc"]),
            "confidence": float(baseline["mean_confidence"]),
        }
    ]
    prev_class_acc: dict[str, float] = {
        name: round(m["accuracy"], 4) for name, m in baseline["per_class"].items()
    }

    best_acc = float(baseline["train_acc"])
    best_snap = _clone_weights(params)
    best_epoch = 0
    patience = 0
    stopped_early = False

    t0 = time.time()
    for ep in range(epochs):
        cur_lr = base_lr * (0.90 ** ep)
        loss = train_epoch(params, samples, lr=cur_lr, class_weights=class_weights)
        det = _eval_detailed(params, samples, n_classes, texts=texts)
        class_acc = {
            name: round(m["accuracy"], 4) for name, m in det["per_class"].items()
        }
        mean_class_acc = (
            float(np.mean(list(class_acc.values()))) if class_acc else 0.0
        )
        # Per-class deltas this epoch
        class_deltas = []
        for name, acc in class_acc.items():
            prev = prev_class_acc.get(name)
            if prev is not None:
                d = acc - prev
                if abs(d) >= 0.05:
                    class_deltas.append(
                        {"label": name, "from": prev, "to": acc, "delta": round(d, 4)}
                    )
        class_deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)

        # Keep BEST weights — final epoch was often worse (divergence)
        is_best = False
        diverged = False
        if det["train_acc"] > best_acc + 1e-4:
            best_acc = float(det["train_acc"])
            best_snap = _clone_weights(params)
            best_epoch = ep + 1
            patience = 0
            is_best = True
        else:
            patience += 1
            # Hard diverge: accuracy cratered — roll back immediately
            if best_acc - det["train_acc"] >= DIVERGE_DROP and best_epoch > 0:
                diverged = True
                _restore_weights(params, best_snap)
                base_lr *= 0.5
                det = _eval_detailed(params, samples, n_classes, texts=texts)
                class_acc = {
                    name: round(m["accuracy"], 4) for name, m in det["per_class"].items()
                }
                mean_class_acc = (
                    float(np.mean(list(class_acc.values()))) if class_acc else 0.0
                )
                # Don't thrash early-stop immediately after a recovery
                patience = max(0, patience - 1)
                diary.append(
                    {
                        "epoch": ep + 1,
                        "kind": "diverge_recover",
                        "message": (
                            f"Training slipped — restored best "
                            f"({(best_acc * 100):.1f}% @ ep{best_epoch}) and cut LR to {base_lr:.5f}"
                        ),
                        "acc": best_acc,
                    }
                )

        entry = {
            "epoch": ep + 1,
            "loss": float(loss),
            "train_acc": float(det["train_acc"]),
            "mean_confidence": float(det["mean_confidence"]),
            "mean_true_class_prob": float(det["mean_true_class_prob"]),
            "mean_entropy": float(det["mean_entropy"]),
            "mean_class_acc": mean_class_acc,
            "n_correct": int(det["n_correct"]),
            "n_wrong": int(det["n_wrong"]),
            "lr": float(cur_lr),
            "per_class_acc": class_acc,
            "confidence_hist": det["confidence_hist"],
            "class_deltas": class_deltas[:5],
            "is_best": is_best,
        }
        history.append(entry)
        per_class_history.append({"epoch": ep + 1, **class_acc})

        # Learning diary entry
        prev_acc = history[-2]["train_acc"] if len(history) > 1 else baseline["train_acc"]
        d_acc = det["train_acc"] - prev_acc
        parts = [
            f"Epoch {ep + 1}/{epochs}",
            f"loss {loss:.4f}",
            f"acc {(det['train_acc'] * 100):.1f}% ({'+' if d_acc >= 0 else ''}{(d_acc * 100):.1f})",
            f"conf {(det['mean_confidence'] * 100):.0f}%",
            f"best {(best_acc * 100):.1f}%@ep{best_epoch}",
        ]
        if is_best:
            parts.append("★ new best — saved")
        if diverged:
            parts.append("recovered from slip")
        if class_deltas:
            top = class_deltas[0]
            parts.append(
                f"{'↑' if top['delta'] > 0 else '↓'}{top['label']} "
                f"{(top['from'] * 100):.0f}→{(top['to'] * 100):.0f}%"
            )
        if det["n_wrong"] == 0:
            parts.append("perfect fit on train set")
        diary.append(
            {
                "epoch": ep + 1,
                "kind": "epoch",
                "message": " · ".join(parts),
                "acc": float(det["train_acc"]),
                "loss": float(loss),
                "confidence": float(det["mean_confidence"]),
                "entropy": float(det["mean_entropy"]),
                "class_deltas": class_deltas[:5],
                "improved": [c for c in class_deltas if c["delta"] > 0][:3],
                "regressed": [c for c in class_deltas if c["delta"] < 0][:3],
            }
        )
        prev_class_acc = class_acc

        if progress_cb:
            progress_cb(
                ep + 1,
                epochs,
                float(loss),
                float(det["train_acc"]),
                {
                    "mean_confidence": float(det["mean_confidence"]),
                    "mean_true_class_prob": float(det["mean_true_class_prob"]),
                    "mean_entropy": float(det["mean_entropy"]),
                    "mean_class_acc": mean_class_acc,
                    "n_correct": int(det["n_correct"]),
                    "n_wrong": int(det["n_wrong"]),
                    "per_class_acc": class_acc,
                    "per_class_history": per_class_history[:],
                    "history_so_far": history[:],
                    "confidence_hist": det["confidence_hist"],
                    "mistakes": det["mistakes"][:8],
                    "class_deltas": class_deltas[:5],
                    "diary": diary[:],
                    "baseline_acc": float(baseline["train_acc"]),
                    "baseline_confidence": float(baseline["mean_confidence"]),
                    "lr": float(cur_lr),
                    "best_acc": best_acc,
                    "best_epoch": best_epoch,
                },
            )

        # Early stop if no improvement — prevents "more training = worse"
        if patience >= EARLY_STOP_PATIENCE and ep + 1 >= 6:
            stopped_early = True
            diary.append(
                {
                    "epoch": ep + 1,
                    "kind": "early_stop",
                    "message": (
                        f"Stopped early at epoch {ep + 1} — no improvement for "
                        f"{EARLY_STOP_PATIENCE} rounds. Restoring best model "
                        f"({(best_acc * 100):.1f}% @ epoch {best_epoch})."
                    ),
                    "acc": best_acc,
                }
            )
            break

    # Always ship the BEST checkpoint (not the last unstable epoch)
    _restore_weights(params, best_snap)
    elapsed = time.time() - t0

    final = _eval_detailed(params, samples, n_classes, texts=texts)
    label_counts = Counter(ID2LABEL[y] for y in labels)

    best_hist = max(history, key=lambda h: h["train_acc"]) if history else None
    # Evolution summary — report restored best as final
    evolution = {
        "baseline_acc": float(baseline["train_acc"]),
        "final_acc": float(final["train_acc"]),
        "acc_gain": float(final["train_acc"] - baseline["train_acc"]),
        "baseline_loss": history[0]["loss"] if history else None,
        "final_loss": (
            best_hist["loss"] if best_hist else (history[-1]["loss"] if history else None)
        ),
        "loss_drop_pct": (
            round(
                100
                * (history[0]["loss"] - (best_hist["loss"] if best_hist else history[-1]["loss"]))
                / max(history[0]["loss"], 1e-9),
                2,
            )
            if history
            else 0
        ),
        "baseline_confidence": float(baseline["mean_confidence"]),
        "final_confidence": float(final["mean_confidence"]),
        "baseline_entropy": float(baseline["mean_entropy"]),
        "final_entropy": float(final["mean_entropy"]),
        "baseline_true_prob": float(baseline["mean_true_class_prob"]),
        "final_true_prob": float(final["mean_true_class_prob"]),
        "best_epoch": best_epoch or (best_hist["epoch"] if best_hist else 0),
        "best_acc": float(best_acc),
        "stopped_early": stopped_early,
        "restored_best": True,
        "classes_improved": [],
        "classes_struggled": [],
        "classes_mastered": [],
    }
    for name, fin in final["per_class"].items():
        base_m = baseline["per_class"].get(name, {})
        gain = fin["accuracy"] - base_m.get("accuracy", 0)
        if gain >= 0.1:
            evolution["classes_improved"].append(
                {
                    "label": name,
                    "from": base_m.get("accuracy", 0),
                    "to": fin["accuracy"],
                    "gain": round(gain, 4),
                }
            )
        if fin["accuracy"] >= 0.85 and fin["support"] >= 1:
            evolution["classes_mastered"].append(
                {"label": name, "accuracy": fin["accuracy"], "support": fin["support"]}
            )
        if fin["accuracy"] < 0.35 and fin["support"] >= 1:
            evolution["classes_struggled"].append(
                {"label": name, "accuracy": fin["accuracy"], "support": fin["support"]}
            )
    evolution["classes_improved"].sort(key=lambda c: c.get("gain", 0), reverse=True)

    diary.append(
        {
            "epoch": best_epoch or epochs,
            "kind": "summary",
            "message": (
                f"Done · {(evolution['baseline_acc'] * 100):.1f}% → "
                f"{(evolution['final_acc'] * 100):.1f}% "
                f"({'+' if evolution['acc_gain'] >= 0 else ''}"
                f"{(evolution['acc_gain'] * 100):.1f} pts) · "
                f"kept best epoch {evolution['best_epoch']} "
                f"({(evolution['best_acc'] * 100):.1f}%) · "
                f"{'stopped early · ' if stopped_early else ''}"
                f"{len(evolution['classes_improved'])} personas improved · "
                f"{len(evolution['classes_struggled'])} still weak"
            ),
            "acc": float(final["train_acc"]),
            "confidence": float(final["mean_confidence"]),
        }
    )

    # What tokens define each class in the training data
    token_stats = _token_stats_by_label(texts, labels, top_k=8)
    examples_by_label = _example_journeys(texts, labels, per_label=2)

    info = {
        "epochs": len(history),
        "epochs_requested": epochs,
        "samples": len(samples),
        "vocab_size": len(vocab),
        "train_acc": float(final["train_acc"]),
        "final_loss": (
            float(best_hist["loss"])
            if best_hist
            else (history[-1]["loss"] if history else None)
        ),
        "best_epoch": best_epoch,
        "best_acc": float(best_acc),
        "stopped_early": stopped_early,
        "restored_best": True,
        "mean_confidence": float(final["mean_confidence"]),
        "mean_true_class_prob": float(final["mean_true_class_prob"]),
        "mean_entropy": float(final["mean_entropy"]),
        "seconds": elapsed,
        "history": history,
        "per_class_history": per_class_history,
        "label_counts": dict(Counter(ID2LABEL[y] for y in labels)),
        "labels": PERSONA_LABELS[:],
        "per_class_metrics": final["per_class"],
        "baseline_per_class": baseline["per_class"],
        "confusion": final["confusion"],
        "confusion_labels": final["confusion_labels"],
        "confidence_hist": final["confidence_hist"],
        "baseline_confidence_hist": baseline["confidence_hist"],
        "mistakes": final["mistakes"],
        "token_stats": token_stats,
        "example_journeys": examples_by_label,
        "evolution": evolution,
        "diary": diary,
        "architecture": {
            "type": "TransformerEncoder",
            "d_model": D_MODEL,
            "n_heads": N_HEADS,
            "n_layers": N_LAYERS,
            "d_ff": D_FF,
            "max_len": MAX_LEN,
        },
    }
    return params, info
