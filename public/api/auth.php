<?php
declare(strict_types=1);
require __DIR__ . '/_account.php';
require __DIR__ . '/_usage.php';
af_session();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    $row = af_current_account();
    af_response(200, $row ? ['authenticated'=>true,'account'=>af_public_account($row)] : ['authenticated'=>false,'activity'=>af_guest_activity()]);
}
if ($method !== 'POST') af_response(405, ['error'=>'method_not_allowed']);
af_guard_post();
$raw = file_get_contents('php://input');
$data = is_string($raw) && strlen($raw) < 4096 ? json_decode($raw, true) : null;
if (!is_array($data)) af_response(422, ['error'=>'invalid_request']);
if (($data['action'] ?? '') === 'logout') {
    unset($_SESSION['afreska_user_id']);
    session_regenerate_id(true);
    af_response(200, ['authenticated'=>false,'activity'=>af_guest_activity()]);
}
if (($data['action'] ?? '') !== 'login') af_response(422, ['error'=>'invalid_action']);
$login = $data['login'] ?? null;
$password = $data['password'] ?? null;
if (!is_string($login) || !is_string($password) ||
    $login === '' || $password === '' || strlen($login) > 100 || strlen($password) > 512) {
    af_response(422, ['error'=>'invalid_credentials']);
}
$accounts = af_accounts();
if ($accounts === null) af_response(503, ['error'=>'accounts_not_configured']);
$now = time();
$attempts = $_SESSION['affresco_login_attempts'] ?? [];
if (!is_array($attempts)) $attempts=[];
$attempts = array_values(array_filter($attempts, static function($t) use($now) {
    return is_int($t) && $t > $now - 900;
}));
if (count($attempts) >= 5) af_response(429, ['error'=>'too_many_attempts']);
$row = af_find_account($accounts, $login, true);
$hash = $row !== null && is_string($row['pass'] ?? null) ? $row['pass'] : '';
$hashInfo = password_get_info($hash);
$verified = ($hashInfo['algo'] ?? null) !== null &&
    ($hashInfo['algo'] ?? null) !== 0 && password_verify($password, $hash);
if (!$verified) {
    $attempts[] = $now;
    $_SESSION['affresco_login_attempts'] = $attempts;
    af_response(401, ['error'=>'invalid_credentials']);
}
session_regenerate_id(true);
$_SESSION['affresco_login_attempts'] = [];
$_SESSION['afreska_user_id'] = (string)$row['id'];
af_track_usage((string)$row['id'], 'login');
$row=af_current_account()??$row;
af_response(200, ['authenticated'=>true,'account'=>af_public_account($row)]);

