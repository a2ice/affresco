<?php
declare(strict_types=1);

// Guest favorites: private JSON per unpredictable token held only in PHP session.
// Account favorites will live in a separate store; never merge identities.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.gc_maxlifetime', '2592000');
session_set_cookie_params([
    'lifetime' => 2592000, 'path' => '/', 'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
]);
session_start();

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    header('Allow: GET, POST');
    respond(405, ['error' => 'method_not_allowed']);
}
// Account mode remains unavailable until the private account storage is
// implemented. Never display or write a guest file under an account identity.
if (isset($_SESSION['afreska_user_id']) &&
    is_string($_SESSION['afreska_user_id']) && $_SESSION['afreska_user_id'] !== '') {
    respond(501, ['error' => 'account_favorites_not_ready']);
}
if ($method === 'POST') {
    if (($_SERVER['HTTP_X_AFFRESCO_REQUEST'] ?? '') !== '1') {
        respond(403, ['error' => 'request_header_required']);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        $requestedHost = explode(':', strtolower($_SERVER['HTTP_HOST'] ?? ''))[0];
        if (!is_string($host) || strtolower($host) !== $requestedHost) {
            respond(403, ['error' => 'origin_mismatch']);
        }
    }
    $fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($fetchSite !== '' && $fetchSite !== 'same-origin' && $fetchSite !== 'none') {
        respond(403, ['error' => 'cross_site_request']);
    }
}
if (!isset($_SESSION['affresco_guest_favorites_token']) ||
    !is_string($_SESSION['affresco_guest_favorites_token']) ||
    !preg_match('/^[a-f0-9]{48}$/D', $_SESSION['affresco_guest_favorites_token'])) {
    try {
        $_SESSION['affresco_guest_favorites_token'] = bin2hex(random_bytes(24));
    } catch (Throwable $error) {
        respond(503, ['error' => 'session_unavailable']);
    }
}
$token = $_SESSION['affresco_guest_favorites_token'];
// The primary directory is above the published public/ root. An isolated
// operating-system temp directory is an alternative on restrictive FTP hosts.
$directories = [
    dirname(__DIR__, 2) . '/.affresco-favorites-private',
    rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . '/affresco-favorites-' .
        substr(hash('sha256', __DIR__), 0, 16),
];
$folder = null;
foreach ($directories as $candidate) {
    if (!is_dir($candidate)) {
        @mkdir($candidate, 0700, true);
    }
    if (is_dir($candidate) && is_writable($candidate)) {
        $folder = $candidate;
        break;
    }
}
if ($folder === null) {
    respond(503, ['error' => 'private_storage_unavailable']);
}
$file = $folder . DIRECTORY_SEPARATOR . $token . '.json';
// Reading an empty guest list must not create a disk file for every visitor.
// A private JSON is created only after the first explicit favorite change.
if ($method === 'GET' && !is_file($file)) {
    respond(200, ['items' => [], 'count' => 0, 'scope' => 'guest']);
}
$handle = @fopen($file, 'c+');
if ($handle === false || !flock($handle, LOCK_EX)) {
    if (is_resource($handle)) fclose($handle);
    respond(503, ['error' => 'storage_locked']);
}
@chmod($file, 0600);
rewind($handle);
$raw = stream_get_contents($handle);
$parsed = ($raw !== false && $raw !== '') ? json_decode($raw, true) : [];
$stored = is_array($parsed) && isset($parsed['items']) ? $parsed['items'] : [];
$stored = is_array($stored) ? $stored : [];
$items = [];
foreach ($stored as $sku) {
    // PHP casts numeric SKU array keys to int, and previous releases
    // persisted those ints; accept them but always return strings.
    if (is_int($sku) && $sku >= 0) $sku=(string)$sku;
    if (is_string($sku) && preg_match('/^[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{0,99}$/uD', $sku)) {
        $items[$sku] = true;
    }
}
if ($method === 'POST') {
    $body = file_get_contents('php://input');
    $data = $body !== false && strlen($body) <= 4096 ? json_decode($body, true) : null;
    $sku = is_array($data) ? ($data['sku'] ?? null) : null;
    $action = is_array($data) ? ($data['action'] ?? null) : null;
    if (!is_string($sku) || !preg_match('/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/uD', $sku) ||
        !in_array($action, ['add', 'remove'], true)) {
        flock($handle, LOCK_UN);
        fclose($handle);
        respond(422, ['error' => 'invalid_request']);
    }
    if ($action === 'add') {
        if (count($items) >= 200 && !isset($items[$sku])) {
            flock($handle, LOCK_UN);
            fclose($handle);
            respond(422, ['error' => 'favorites_limit']);
        }
        $items[$sku] = true;
    } else {
        unset($items[$sku]);
    }
    $json = json_encode(['version' => 1, 'items' => array_map('strval', array_keys($items))],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || !rewind($handle) || !ftruncate($handle, 0) ||
        fwrite($handle, $json) !== strlen($json) || !fflush($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
        respond(503, ['error' => 'storage_write_failed']);
    }
}
flock($handle, LOCK_UN);
fclose($handle);
respond(200, ['items' => array_map('strval', array_keys($items)), 'count' => count($items), 'scope' => 'guest']);
