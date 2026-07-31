<?php
// Allow from any origin (or specify your React app URL)
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
if ($data) {
    // Add server-side metadata
    $data['ip'] = $_SERVER['REMOTE_ADDR'];
    $data['server_time'] = date('Y-m-d H:i:s');
    
    // Log path
    $logDir = __DIR__ . '/logs';
    $logFile = $logDir . '/behavior.log';
    
    if (!file_exists($logDir)) {
        mkdir($logDir, 0755, true);
    }
    
    // Sanitize and append
    $entry = json_encode($data) . PHP_EOL;
    file_put_contents($logFile, $entry, FILE_APPEND);
}
?>