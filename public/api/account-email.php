<?php
declare(strict_types=1);
require __DIR__ . '/_account.php';
require __DIR__ . '/_account_email.php';
af_session();
if (($_SERVER['REQUEST_METHOD']??'')!=='POST') {
    header('Allow: POST');
    af_response(405,['error'=>'method_not_allowed']);
}
af_guard_post();
$account=af_current_account();
if ($account===null)af_response(401,['error'=>'login_required']);
$raw=file_get_contents('php://input');
$data=is_string($raw) && strlen($raw)<2048 ? json_decode($raw,true):null;
$email=is_array($data)?($data['email']??null):null;
if (!is_string($email) || strlen($email)>254 ||
    filter_var(trim($email),FILTER_VALIDATE_EMAIL)===false) {
    af_response(422,['error'=>'invalid_email']);
}
$email=trim($email);
if (!af_save_account_email((string)$account['id'],$email)) {
    af_response(503,['error'=>'email_storage_unavailable']);
}
af_response(200,['email'=>$email,'saved'=>true]);
