<?php
declare(strict_types=1);
require __DIR__.'/_account.php';
require __DIR__.'/_usage.php';
require __DIR__.'/_manual_tryon.php';
af_session();
if (($_SERVER['REQUEST_METHOD']??'')!=='POST') {header('Allow: POST');af_response(405,['error'=>'method_not_allowed']);}
af_guard_post();
$raw=file_get_contents('php://input');
$data=is_string($raw)&&strlen($raw)<2048?json_decode($raw,true):null;
if (!is_array($data) || !is_string($data['id']??null) ||
    preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iD',$data['id'])!==1 ||
    !is_string($data['sku']??null) || preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$data['sku'])!==1) af_response(422,['error'=>'invalid_request']);
foreach (['width_cm','height_cm'] as $field) {
    $value=$data[$field]??null;
    if (!is_numeric($value) || !is_finite((float)$value) || (float)$value<0.1 || (float)$value>1000) af_response(422,['error'=>'invalid_request']);
}
$account=af_current_account();
$owner=$account?'account:'.(string)$account['id']:'guest';
if (($data['owner']??null)!==$owner) af_response(409,['error'=>'identity_changed']);
if (!af_record_manual_tryon($account,strtolower($data['id']))) af_response(503,['error'=>'tracking_unavailable']);
af_response(200,['accepted'=>true]);

