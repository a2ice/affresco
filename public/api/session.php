<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
ini_set('session.use_strict_mode', '1');
// Keep the same long-lived, HTTP-only guest session cookie as favorites.php.
ini_set('session.gc_maxlifetime', '2592000');
session_set_cookie_params([
    'lifetime' => 2592000,
    'httponly' => true,
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    'samesite' => 'Lax',
    'path' => '/',
]);
session_start();

// This read-only endpoint is ready for the future Accounts backend. It does
// not create demo accounts or accept login credentials from the browser.
$authenticated = isset($_SESSION['afreska_user_id'])
    && is_string($_SESSION['afreska_user_id'])
    && $_SESSION['afreska_user_id'] !== '';

echo json_encode(['authenticated' => $authenticated], JSON_UNESCAPED_UNICODE);
