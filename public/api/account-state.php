<?php
declare(strict_types=1);
require __DIR__ . '/_account.php';
require __DIR__ . '/_usage.php';
af_session();
$account=af_current_account();
if ($account===null) af_response(401,['error'=>'login_required']);
$method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method!=='GET' && $method!=='POST') af_response(405,['error'=>'method_not_allowed']);
$input=null;
if ($method==='POST') {
    af_guard_post();
    $raw=file_get_contents('php://input');
    $input=is_string($raw) && strlen($raw)<=8192 ? json_decode($raw,true) : null;
    if (!is_array($input)) af_response(422,['error'=>'invalid_request']);
}
$action=$input['action']??'';
$sku=$input['sku']??'';
if ($method==='POST' && (!in_array($action,['add','remove','save_draft'],true) ||
    !is_string($sku) || !preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$sku))) {
    af_response(422,['error'=>'invalid_action']);
}
$draft=$input['draft']??null;
if ($action==='save_draft') {
    if (!is_array($draft)) af_response(422,['error'=>'invalid_draft']);
    foreach (['width','height','ratio','zoom','dx','dy'] as $key) {
        if (!isset($draft[$key]) || !is_numeric($draft[$key])) af_response(422,['error'=>'invalid_draft']);
    }
    $draft=array_intersect_key($draft,array_flip(['width','height','ratio','zoom','dx','dy','selection','lockRatio','dimensionsSource']));
}
$mutation=$method==='GET'?null:static function(array $state) use($action,$sku,$draft):array {
    $unique=[];
    foreach ($state['favorites'] as $id) {
        // Support numeric items produced by older versions of PHP's array_keys.
        if (is_int($id) && $id>=0) $id=(string)$id;
        if (is_string($id) && preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$id)) $unique[$id]=true;
    }
    if ($action==='remove') unset($unique[$sku]);
    if ($action==='add' && count($unique)<200) $unique[$sku]=true;
    $state['favorites']=array_map('strval', array_keys($unique));
    if ($action==='save_draft') {
        if (count($state['drafts'])<200 || isset($state['drafts'][$sku])) $state['drafts'][$sku]=$draft;
    }
    return $state;
};
$data=af_state((string)$account['id'],$mutation);
if ($data===null) af_response(503,['error'=>'storage_unavailable']);
if ($action==='save_draft') af_track_usage((string)$account['id'], 'edit', $sku);
$items=array_values(array_filter(array_map(
    static fn($v)=>is_int($v) && $v>=0 ? (string)$v : $v,
    $data['favorites']
),static fn($v)=>is_string($v) && preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$v)===1));
$drafts=$data['drafts'];
af_response(200,['scope'=>'account','items'=>$items,'count'=>count($items),
    'drafts'=>$drafts,'draft_count'=>count($drafts),
    'account'=>af_public_account(af_current_account()??$account)]);

