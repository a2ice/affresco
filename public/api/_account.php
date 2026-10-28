<?php
declare(strict_types=1);

/* AFFRESCO-only account support. Never serve or commit credentials.
 * Expected private path (outside the site document root):
 * dirname(__DIR__, 2) . '/data/accounts.json'
 * Supported file: [{id, login, pass: password_hash(...),
 *   generations_limit, generations_used, generations_failed}, ...]
 */
function af_response(int $status, array $payload): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function af_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', '2592000');
    session_set_cookie_params([
        'lifetime'=>2592000, 'path'=>'/', 'httponly'=>true,
        'secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite'=>'Lax'
    ]);
    session_start();
}
function af_guard_post(): void {
    if (($_SERVER['HTTP_X_AFFRESCO_REQUEST'] ?? '') !== '1') {
        af_response(403, ['error'=>'request_header_required']);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        $requestHost = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
        $requestHost = explode(':', $requestHost)[0];
        if (!is_string($host) || strtolower($host) !== $requestHost) {
            af_response(403, ['error'=>'origin_mismatch']);
        }
    }
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '' && !in_array($site, ['same-origin','none'], true)) {
        af_response(403, ['error'=>'cross_site_request']);
    }
}
function af_private_root(): string {
    return dirname(__DIR__, 2);
}
function af_accounts_path(): string {
    $private = af_private_root() . '/data/accounts.json';
    return is_file($private) ? $private : dirname(__DIR__) . '/data/accounts.json';
}
function af_accounts(): ?array {
    $file = af_accounts_path();
    if (!is_file($file) || !is_readable($file)) return null;
    $raw = @file_get_contents($file);
    if (!is_string($raw) || strlen($raw) > 1048576) return null;
    $parsed = json_decode($raw, true);
    if (!is_array($parsed)) return null;
    $list = isset($parsed['accounts']) ? $parsed['accounts'] : $parsed;
    if (!is_array($list)) return null;
    return $list===[] || array_keys($list)===range(0,count($list)-1) ? $list : null;
}
function af_valid_account($entry): bool {
    return is_array($entry) && isset($entry['id'], $entry['login']) &&
        (is_string($entry['id']) || is_int($entry['id'])) &&
        is_string($entry['login']) &&
        preg_match('/^[\\p{L}\\p{N}_.-]{1,100}$/uD', $entry['login']) === 1;
}
function af_find_account(?array $accounts, string $value, bool $byLogin=false): ?array {
    if ($accounts === null) return null;
    foreach ($accounts as $row) {
        if (af_valid_account($row) && ($byLogin
            ? hash_equals($row['login'], $value)
            : hash_equals((string)$row['id'], $value))) return $row;
    }
    return null;
}
function af_current_account(): ?array {
    $id = $_SESSION['afreska_user_id'] ?? null;
    if (!is_string($id) || $id === '') return null;
    $row = af_find_account(af_accounts(), $id);
    if ($row === null) unset($_SESSION['afreska_user_id']);
    return $row;
}
function af_public_account(array $row): array {
    return [
        'id'=>(string)$row['id'],
        'login'=>$row['login'],
        'email'=>is_string($row['email']??null) && filter_var($row['email'],FILTER_VALIDATE_EMAIL)
            ?$row['email']:'',
        'generations_limit'=>max(0,(int)($row['generations_limit'] ?? 0)),
        'generations_used'=>max(0,(int)($row['generations_used'] ?? 0)),
        'generations_failed'=>max(0,(int)($row['generations_failed'] ?? 0)),
        'last_login'=>is_string($row['last_login']??null)?$row['last_login']:null,
        'login_count'=>max(0,(int)($row['login_count']??0)),
        'last_update'=>is_string($row['last_update']??null)?$row['last_update']:null,
        'updates_count'=>max(0,(int)($row['updates_count']??0)),
        'emails_count'=>max(0,(int)($row['emails_count']??0)),
        'last_email'=>is_string($row['last_email']??null)?$row['last_email']:null
    ];
}
function af_account_state_file(string $id): string {
    $primary = af_private_root() . '/.affresco-account-state';
    if (!is_dir($primary)) @mkdir($primary,0700,true);
    $directory = $primary;
    if (!is_dir($primary) || !is_writable($primary)) {
        $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) .
            '/affresco-account-state-' . substr(hash('sha256', __DIR__), 0, 16);
        if (!is_dir($directory)) @mkdir($directory,0700,true);
    }
    return $directory . '/' . hash('sha256', $id) . '.json';
}
function af_state(string $id, ?callable $edit=null): ?array {
    $file=af_account_state_file($id);
    $dir=dirname($file);
    if (!is_dir($dir) && $edit !== null && !@mkdir($dir,0700,true) && !is_dir($dir)) return null;
    if ($edit === null && !is_file($file)) return ['favorites'=>[], 'drafts'=>[]];
    $handle=@fopen($file,'c+');
    if ($handle===false || !flock($handle,LOCK_EX)){
        if (is_resource($handle)) fclose($handle);
        return null;
    }
    @chmod($file,0600);
    rewind($handle);
    $raw=stream_get_contents($handle);
    $data= $raw ? json_decode($raw,true) : null;
    $state=is_array($data)?$data:['favorites'=>[], 'drafts'=>[]];
    $state['favorites']=is_array($state['favorites']??null)?$state['favorites']:[];
    $state['drafts']=is_array($state['drafts']??null)?$state['drafts']:[];
    if ($edit!==null) {
        $state=$edit($state);
        if (!is_array($state)) {
            flock($handle,LOCK_UN);fclose($handle);return null;
        }
        $json=json_encode($state,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        if (!is_string($json) || strlen($json)>262144 || !rewind($handle) ||
            !ftruncate($handle,0) || fwrite($handle,$json)!==strlen($json) || !fflush($handle)) {
            flock($handle,LOCK_UN);fclose($handle);return null;
        }
    }
    flock($handle,LOCK_UN);
    fclose($handle);
    return $state;
}

