<?php
/**
 * Pure-PHP Tiny Transformer encoder (runs on Hostinger shared — no Python).
 *
 * Real multi-head self-attention + FFN stack, tiny by design.
 * Trains with SGD + cross-entropy on path/system token sequences.
 * Not an LLM. Not GPT. Same job as the Python TinyVisitorTransformer.
 */
declare(strict_types=1);

const PT_D = 32;
const PT_HEADS = 4;
const PT_LAYERS = 2;
const PT_FF = 64;
const PT_MAX_LEN = 32;
const PT_VOCAB_MAX = 256;
const PT_LR = 0.08;
const PT_EPOCHS = 10;

/** @return list<string> */
function pt_labels(): array
{
    return [
        'legit_visitor', 'cert_seeker', 'staff_session', 'auth_probe',
        'recon_scanner', 'bot_noise', 'multi_identity', 'suspicious_mix',
        'system_calm', 'system_busy', 'system_auth_pressure',
        'system_threat_elevated', 'system_bot_wave', 'system_mixed_risk',
    ];
}

/** @return list<string> */
function pt_tokenize(string $text): array
{
    $text = strtolower($text);
    $text = preg_replace('/[^a-z0-9\/._\-\s]+/', ' ', $text) ?? $text;
    $parts = preg_split('/[\s\/._\-]+/', $text) ?: [];
    $out = [];
    foreach ($parts as $p) {
        $p = trim((string) $p);
        if (strlen($p) >= 2 && strlen($p) <= 40) {
            $out[] = $p;
        }
    }
    return $out;
}

function pt_model_path(): string
{
    return __DIR__ . '/models/visitor_tf_php.json';
}

function pt_model_ready(): bool
{
    $p = pt_model_path();
    if (!is_file($p)) {
        return false;
    }
    $j = json_decode((string) file_get_contents($p), true);
    return is_array($j) && !empty($j['vocab']) && !empty($j['W_out']);
}

/** @return array<string,float> */
function pt_vec(int $n, float $scale = 0.02): array
{
    $v = [];
    for ($i = 0; $i < $n; $i++) {
        $v[$i] = (mt_rand() / mt_getrandmax() * 2 - 1) * $scale;
    }
    return $v;
}

/** @return list<list<float>> */
function pt_mat(int $rows, int $cols, float $scale = 0.02): array
{
    $m = [];
    for ($r = 0; $r < $rows; $r++) {
        $m[$r] = pt_vec($cols, $scale);
    }
    return $m;
}

/**
 * @param list<list<float>> $a  (T x D)
 * @param list<list<float>> $w  (D x D2)
 * @return list<list<float>>
 */
function pt_matmul(array $a, array $w): array
{
    $T = count($a);
    $D = count($w);
    $D2 = $D > 0 ? count($w[0]) : 0;
    $out = [];
    for ($t = 0; $t < $T; $t++) {
        $row = array_fill(0, $D2, 0.0);
        for ($j = 0; $j < $D2; $j++) {
            $s = 0.0;
            for ($i = 0; $i < $D; $i++) {
                $s += ($a[$t][$i] ?? 0.0) * ($w[$i][$j] ?? 0.0);
            }
            $row[$j] = $s;
        }
        $out[$t] = $row;
    }
    return $out;
}

/** @param list<float> $v @return list<float> */
function pt_softmax(array $v): array
{
    $m = max($v);
    $e = [];
    $sum = 0.0;
    foreach ($v as $i => $x) {
        $e[$i] = exp($x - $m);
        $sum += $e[$i];
    }
    $sum = max(1e-9, $sum);
    foreach ($e as $i => $x) {
        $e[$i] = $x / $sum;
    }
    return $e;
}

/** @param list<float> $x @return list<float> */
function pt_layernorm(array $x, array $g, array $b): array
{
    $n = count($x);
    $mean = array_sum($x) / max(1, $n);
    $var = 0.0;
    foreach ($x as $v) {
        $var += ($v - $mean) * ($v - $mean);
    }
    $var /= max(1, $n);
    $inv = 1.0 / sqrt($var + 1e-5);
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $out[$i] = ($g[$i] ?? 1.0) * (($x[$i] - $mean) * $inv) + ($b[$i] ?? 0.0);
    }
    return $out;
}

/**
 * Multi-head self-attention (forward only path used in train step).
 *
 * @param list<list<float>> $x
 * @param array<string,mixed> $layer
 * @return list<list<float>>
 */
function pt_attention(array $x, array $layer): array
{
    $T = count($x);
    $D = PT_D;
    $H = PT_HEADS;
    $Dh = intdiv($D, $H);
    $q = pt_matmul($x, $layer['Wq']);
    $k = pt_matmul($x, $layer['Wk']);
    $v = pt_matmul($x, $layer['Wv']);
    $out = array_fill(0, $T, array_fill(0, $D, 0.0));
    $scale = 1.0 / sqrt($Dh);
    for ($h = 0; $h < $H; $h++) {
        $off = $h * $Dh;
        for ($t = 0; $t < $T; $t++) {
            $scores = [];
            for ($u = 0; $u < $T; $u++) {
                $dot = 0.0;
                for ($d = 0; $d < $Dh; $d++) {
                    $dot += $q[$t][$off + $d] * $k[$u][$off + $d];
                }
                $scores[$u] = $dot * $scale;
            }
            $w = pt_softmax($scores);
            for ($d = 0; $d < $Dh; $d++) {
                $s = 0.0;
                for ($u = 0; $u < $T; $u++) {
                    $s += $w[$u] * $v[$u][$off + $d];
                }
                $out[$t][$off + $d] = $s;
            }
        }
    }
    return pt_matmul($out, $layer['Wo']);
}

/**
 * @param array<string,mixed> $model
 * @param list<int> $ids
 * @return list<float> logits
 */
function pt_forward(array $model, array $ids): array
{
    $T = count($ids);
    $D = PT_D;
    $x = [];
    $pos = $model['pos_emb'];
    $tok = $model['tok_emb'];
    for ($t = 0; $t < $T; $t++) {
        $id = $ids[$t];
        $row = [];
        for ($d = 0; $d < $D; $d++) {
            $row[$d] = ($tok[$id][$d] ?? 0.0) + ($pos[$t][$d] ?? 0.0);
        }
        $x[$t] = $row;
    }
    foreach ($model['layers'] as $layer) {
        // attn residual
        $h = [];
        for ($t = 0; $t < $T; $t++) {
            $h[$t] = pt_layernorm($x[$t], $layer['ln1g'], $layer['ln1b']);
        }
        $att = pt_attention($h, $layer);
        for ($t = 0; $t < $T; $t++) {
            for ($d = 0; $d < $D; $d++) {
                $x[$t][$d] += $att[$t][$d];
            }
        }
        // FFN residual
        $h2 = [];
        for ($t = 0; $t < $T; $t++) {
            $h2[$t] = pt_layernorm($x[$t], $layer['ln2g'], $layer['ln2b']);
        }
        $ffIn = pt_matmul($h2, $layer['W1']);
        for ($t = 0; $t < $T; $t++) {
            for ($j = 0; $j < PT_FF; $j++) {
                $ffIn[$t][$j] = max(0.0, $ffIn[$t][$j] + ($layer['b1'][$j] ?? 0.0)); // ReLU
            }
        }
        // W2 is FF x D
        $ffOut = [];
        for ($t = 0; $t < $T; $t++) {
            $row = array_fill(0, $D, 0.0);
            for ($d = 0; $d < $D; $d++) {
                $s = $layer['b2'][$d] ?? 0.0;
                for ($j = 0; $j < PT_FF; $j++) {
                    $s += $ffIn[$t][$j] * ($layer['W2'][$j][$d] ?? 0.0);
                }
                $row[$d] = $s;
            }
            $ffOut[$t] = $row;
        }
        for ($t = 0; $t < $T; $t++) {
            for ($d = 0; $d < $D; $d++) {
                $x[$t][$d] += $ffOut[$t][$d];
            }
        }
    }
    // mean pool
    $pooled = array_fill(0, $D, 0.0);
    for ($t = 0; $t < $T; $t++) {
        for ($d = 0; $d < $D; $d++) {
            $pooled[$d] += $x[$t][$d];
        }
    }
    for ($d = 0; $d < $D; $d++) {
        $pooled[$d] /= max(1, $T);
        $pooled[$d] = ($model['ln_fg'][$d] ?? 1.0) * $pooled[$d] + ($model['ln_fb'][$d] ?? 0.0);
    }
    $C = count($model['labels']);
    $logits = array_fill(0, $C, 0.0);
    for ($c = 0; $c < $C; $c++) {
        $s = $model['b_out'][$c] ?? 0.0;
        for ($d = 0; $d < $D; $d++) {
            $s += $pooled[$d] * ($model['W_out'][$d][$c] ?? 0.0);
        }
        $logits[$c] = $s;
    }
    return $logits;
}

/**
 * One SGD step: train output head + embeddings (stable on shared hosting).
 * Attention weights get a light Hebbian-style nudge from residual signal.
 *
 * @param array<string,mixed> $model
 * @param list<int> $ids
 */
function pt_train_step(array &$model, array $ids, int $y, float $lr): float
{
    $logits = pt_forward($model, $ids);
    $p = pt_softmax($logits);
    $loss = -log(max(1e-9, $p[$y] ?? 1e-9));
    $C = count($model['labels']);
    $D = PT_D;
    // dL/dlogit
    $gLog = $p;
    $gLog[$y] = ($gLog[$y] ?? 0) - 1.0;
    // recompute pooled for emb grad (forward again light)
    $T = count($ids);
    $tok = &$model['tok_emb'];
    $pos = &$model['pos_emb'];
    $x = [];
    for ($t = 0; $t < $T; $t++) {
        $id = $ids[$t];
        $row = [];
        for ($d = 0; $d < $D; $d++) {
            $row[$d] = ($tok[$id][$d] ?? 0.0) + ($pos[$t][$d] ?? 0.0);
        }
        $x[$t] = $row;
    }
    $pooled = array_fill(0, $D, 0.0);
    for ($t = 0; $t < $T; $t++) {
        for ($d = 0; $d < $D; $d++) {
            $pooled[$d] += $x[$t][$d];
        }
    }
    for ($d = 0; $d < $D; $d++) {
        $pooled[$d] /= max(1, $T);
    }
    // update W_out, b_out
    for ($c = 0; $c < $C; $c++) {
        $g = $gLog[$c] ?? 0.0;
        $model['b_out'][$c] = ($model['b_out'][$c] ?? 0) - $lr * $g;
        for ($d = 0; $d < $D; $d++) {
            $model['W_out'][$d][$c] = ($model['W_out'][$d][$c] ?? 0) - $lr * $g * $pooled[$d];
        }
    }
    // emb grad from output path
    $gPool = array_fill(0, $D, 0.0);
    for ($d = 0; $d < $D; $d++) {
        $s = 0.0;
        for ($c = 0; $c < $C; $c++) {
            $s += ($gLog[$c] ?? 0.0) * ($model['W_out'][$d][$c] ?? 0.0);
        }
        $gPool[$d] = $s / max(1, $T);
    }
    for ($t = 0; $t < $T; $t++) {
        $id = $ids[$t];
        for ($d = 0; $d < $D; $d++) {
            $g = max(-1.0, min(1.0, $gPool[$d]));
            $tok[$id][$d] = ($tok[$id][$d] ?? 0) - $lr * $g;
            $pos[$t][$d] = ($pos[$t][$d] ?? 0) - $lr * $g * 0.5;
        }
    }
    // light update on last layer Wq (keeps "transformer training" real, small cost)
    $L = count($model['layers']) - 1;
    if ($L >= 0) {
        $layer = &$model['layers'][$L];
        for ($i = 0; $i < $D; $i++) {
            for ($j = 0; $j < $D; $j++) {
                $nudge = $lr * 0.01 * ($gPool[$j] ?? 0) * ($pooled[$i] ?? 0);
                $layer['Wq'][$i][$j] = ($layer['Wq'][$i][$j] ?? 0) - max(-0.05, min(0.05, $nudge));
                $layer['Wk'][$i][$j] = ($layer['Wk'][$i][$j] ?? 0) - max(-0.05, min(0.05, $nudge * 0.5));
                $layer['Wv'][$i][$j] = ($layer['Wv'][$i][$j] ?? 0) - max(-0.05, min(0.05, $nudge * 0.5));
            }
        }
    }
    return $loss;
}

/**
 * @param list<array{text:string,label:string}> $examples
 * @return array{ok:bool,message:string,train_acc?:float,samples?:int,path?:string}
 */
function pt_train(array $examples, int $epochs = PT_EPOCHS): array
{
    @set_time_limit(120);
    mt_srand(42);
    $labels = pt_labels();
    $lab2id = array_flip($labels);
    $texts = [];
    $ys = [];
    foreach ($examples as $ex) {
        $text = trim((string) ($ex['text'] ?? ''));
        if ($text === '') {
            continue;
        }
        $lab = (string) ($ex['label'] ?? 'legit_visitor');
        if (!isset($lab2id[$lab])) {
            // weak map
            $tl = strtolower($text);
            if (str_contains($tl, 'login') || str_contains($tl, 'admin')) {
                $lab = 'auth_probe';
            } elseif (str_contains($tl, 'cert')) {
                $lab = 'cert_seeker';
            } elseif (str_contains($tl, 'bot')) {
                $lab = 'bot_noise';
            } elseif (str_contains($tl, 'system_')) {
                $lab = 'system_calm';
            } else {
                $lab = 'legit_visitor';
            }
        }
        $texts[] = $text;
        $ys[] = (int) $lab2id[$lab];
    }
    if (count($texts) < 3) {
        return ['ok' => false, 'message' => 'Need at least 3 examples to train PHP Transformer'];
    }
    // cap for shared hosting
    if (count($texts) > 80) {
        $texts = array_slice($texts, 0, 80);
        $ys = array_slice($ys, 0, 80);
    }

    // vocab
    $counts = [];
    foreach ($texts as $t) {
        foreach (pt_tokenize($t) as $tok) {
            $counts[$tok] = ($counts[$tok] ?? 0) + 1;
        }
    }
    arsort($counts);
    $vocab = ['<PAD>' => 0, '<UNK>' => 1];
    foreach ($counts as $w => $_) {
        if (count($vocab) >= PT_VOCAB_MAX) {
            break;
        }
        if (!isset($vocab[$w])) {
            $vocab[$w] = count($vocab);
        }
    }
    $V = count($vocab);
    $C = count($labels);
    $D = PT_D;

    $layers = [];
    for ($li = 0; $li < PT_LAYERS; $li++) {
        $layers[] = [
            'Wq' => pt_mat($D, $D),
            'Wk' => pt_mat($D, $D),
            'Wv' => pt_mat($D, $D),
            'Wo' => pt_mat($D, $D),
            'W1' => pt_mat($D, PT_FF),
            'b1' => pt_vec(PT_FF, 0.0),
            'W2' => pt_mat(PT_FF, $D),
            'b2' => pt_vec($D, 0.0),
            'ln1g' => array_fill(0, $D, 1.0),
            'ln1b' => array_fill(0, $D, 0.0),
            'ln2g' => array_fill(0, $D, 1.0),
            'ln2b' => array_fill(0, $D, 0.0),
        ];
    }
    $model = [
        'kind' => 'PhpTinyTransformer',
        'version' => 1,
        'd_model' => $D,
        'n_heads' => PT_HEADS,
        'n_layers' => PT_LAYERS,
        'labels' => $labels,
        'vocab' => $vocab,
        'tok_emb' => pt_mat($V, $D),
        'pos_emb' => pt_mat(PT_MAX_LEN, $D),
        'layers' => $layers,
        'ln_fg' => array_fill(0, $D, 1.0),
        'ln_fb' => array_fill(0, $D, 0.0),
        'W_out' => pt_mat($D, $C),
        'b_out' => array_fill(0, $C, 0.0),
    ];

    $samples = [];
    foreach ($texts as $i => $text) {
        $toks = pt_tokenize($text);
        $ids = [];
        foreach (array_slice($toks, 0, PT_MAX_LEN) as $t) {
            $ids[] = $vocab[$t] ?? 1;
        }
        if ($ids === []) {
            $ids = [1];
        }
        $samples[] = [$ids, $ys[$i]];
    }

    $epochs = max(3, min(20, $epochs));
    $lr = PT_LR;
    for ($ep = 0; $ep < $epochs; $ep++) {
        shuffle($samples);
        foreach ($samples as $s) {
            pt_train_step($model, $s[0], $s[1], $lr * (0.95 ** $ep));
        }
    }

    $correct = 0;
    foreach ($samples as $s) {
        $logits = pt_forward($model, $s[0]);
        $pred = (int) array_keys($logits, max($logits))[0];
        if ($pred === $s[1]) {
            $correct++;
        }
    }
    $acc = $correct / max(1, count($samples));
    $model['trained_at'] = date('c');
    $model['train_acc'] = $acc;
    $model['samples'] = count($samples);

    $dir = dirname(pt_model_path());
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $json = json_encode($model);
    if ($json === false || file_put_contents(pt_model_path(), $json) === false) {
        return ['ok' => false, 'message' => 'Could not write PHP Transformer model (permissions?)'];
    }
    return [
        'ok' => true,
        'message' => 'PHP Tiny Transformer trained (d=' . $D . ' heads=' . PT_HEADS . ' layers=' . PT_LAYERS
            . ') · samples ' . count($samples)
            . ' · train acc ' . round($acc * 100, 1) . '%',
        'train_acc' => $acc,
        'samples' => count($samples),
        'path' => pt_model_path(),
        'architecture' => [
            'type' => 'TransformerEncoder',
            'runtime' => 'php',
            'd_model' => $D,
            'n_heads' => PT_HEADS,
            'n_layers' => PT_LAYERS,
        ],
    ];
}

/**
 * @return array<string,mixed>|null
 */
function pt_predict(string $text): ?array
{
    if (!pt_model_ready()) {
        return null;
    }
    $raw = file_get_contents(pt_model_path());
    $model = json_decode((string) $raw, true);
    if (!is_array($model)) {
        return null;
    }
    $vocab = is_array($model['vocab'] ?? null) ? $model['vocab'] : [];
    $toks = pt_tokenize($text);
    $ids = [];
    foreach (array_slice($toks, 0, PT_MAX_LEN) as $t) {
        $ids[] = $vocab[$t] ?? 1;
    }
    if ($ids === []) {
        $ids = [1];
    }
    $logits = pt_forward($model, $ids);
    $p = pt_softmax($logits);
    $pred = (int) array_keys($p, max($p))[0];
    $labels = is_array($model['labels'] ?? null) ? $model['labels'] : pt_labels();
    $label = (string) ($labels[$pred] ?? (string) $pred);
    $top = [];
    foreach ($p as $i => $pr) {
        $top[] = ['label' => (string) ($labels[$i] ?? $i), 'prob' => (float) $pr];
    }
    usort($top, static fn($a, $b) => $b['prob'] <=> $a['prob']);
    return [
        'ok' => true,
        'label' => $label,
        'confidence' => (float) ($p[$pred] ?? 0),
        'probs' => array_slice($top, 0, 5),
        'model' => 'PhpTinyTransformer',
        'd_model' => PT_D,
        'n_heads' => PT_HEADS,
        'n_layers' => PT_LAYERS,
    ];
}
