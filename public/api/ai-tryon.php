<?php
declare(strict_types=1);
require __DIR__.'/_ai_tryon.php';
af_session();
$method=$_SERVER['REQUEST_METHOD']??'GET';
$cfg=af_ai_config();
function ai_ticket(string $id): ?array {
    if(!af_ai_id($id))return null;
    $path=af_ai_root().'/ticket-'.$id.'.json';
    $obj=is_file($path)?json_decode((string)@file_get_contents($path),true):null;
    return is_array($obj)&&is_string($obj['owner']??null)?$obj:null;
}
function ai_terminal_error(int $code,string $error): void {af_response($code,['error'=>$error]);}
if($method==='GET'&&isset($_GET['manifest'])){
    $id=(string)$_GET['manifest'];$ticket=ai_ticket($id);
    $exp=filter_var($_GET['exp']??null,FILTER_VALIDATE_INT);
    $sig=(string)($_GET['sig']??'');
    if(!$cfg||!$ticket||!$exp||$exp<time()||$exp>time()+1800||
        !hash_equals(hash_hmac('sha256',"$id\n$exp",$cfg['callback_secret']),$sig))ai_terminal_error(403,'invalid_signature');
    $job=af_ai_read($ticket['owner'],$id);
    if(!$job||!in_array($job['status'],['pending','processing'],true))ai_terminal_error(410,'expired');
    $expiry=time()+900;
    af_response(200,[
      'generation_id'=>$id,
      'prompt'=>af_ai_prompt($job['metadata']),
      'references'=>[
        af_ai_signed_url($cfg,$id,'room',$expiry),
        af_ai_signed_url($cfg,$id,'fresco',$expiry),
        af_ai_signed_url($cfg,$id,'guide',$expiry)
      ],
      'callback_url'=>$cfg['public_url'].'/api/ai-tryon.php?callback='.$id,
      'openai'=>['model'=>'gpt-image-2','size'=>$job['metadata']['orientation']==='portrait'?'1024x1536':'1536x1024','quality'=>'medium','output_format'=>'png']
    ]);
}
if($method==='GET'&&isset($_GET['asset'])){
    $id=(string)$_GET['asset'];$slot=(string)($_GET['slot']??'');$ticket=ai_ticket($id);
    $exp=filter_var($_GET['exp']??null,FILTER_VALIDATE_INT);$sig=(string)($_GET['sig']??'');
    if(!$cfg||!$ticket||!in_array($slot,['room','fresco','guide'],true)||!$exp||$exp<time()||$exp>time()+1200||
       !hash_equals(hash_hmac('sha256',"$id\n$slot\n$exp",$cfg['callback_secret']),$sig))ai_terminal_error(403,'invalid_signature');
    $job=af_ai_read($ticket['owner'],$id);
    if(!$job||!in_array($job['status'],['pending','processing'],true))ai_terminal_error(410,'expired');
    $path=af_ai_user_dir($ticket['owner']).'/'.$id.'-'.$slot.'.jpg';
    if(!is_file($path))ai_terminal_error(404,'not_found');
    header('Content-Type: image/jpeg');header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');readfile($path);exit;
}
if($method==='POST'&&isset($_GET['callback'])){
    $id=(string)$_GET['callback'];$ticket=ai_ticket($id);
    if(!$cfg||!$ticket)ai_terminal_error(404,'not_found');
    $status=(string)($_POST['status']??'');
    if(!in_array($status,['processing','completed','failed'],true))ai_terminal_error(422,'invalid_request');
    $timestamp=(string)($_SERVER['HTTP_X_AFFRESCO_TIMESTAMP']??'');
    $signature=(string)($_SERVER['HTTP_X_AFFRESCO_SIGNATURE']??'');
    $image=$_FILES['image']??null;
    $bytes=$status==='completed'&&is_array($image)&&($image['error']??1)===UPLOAD_ERR_OK&&($image['size']??0)<=12*1048576
       ?@file_get_contents($image['tmp_name']):'';
    if(!is_string($bytes))$bytes='';
    $digest=hash('sha256',$bytes);
    $expected=hash_hmac('sha256',"$timestamp\n$id\n$status\n$digest",$cfg['callback_secret']);
    if(!ctype_digit($timestamp)||abs(time()-(int)$timestamp)>300||!hash_equals($expected,$signature))ai_terminal_error(401,'invalid_signature');
    if($status==='completed'){
        $info=@getimagesizefromstring($bytes);
        if(strlen($bytes)<100||strlen($bytes)>12*1048576||!is_array($info)||($info['mime']??'')!=='image/png'||$info[0]>2048||$info[1]>2048)ai_terminal_error(422,'invalid_image');
    }
    af_ai_lock($ticket['owner'],static function()use($id,$ticket,$status,$bytes){
       $owner=$ticket['owner'];$job=af_ai_read($owner,$id);
       if(!$job||in_array($job['status'],['completed','failed'],true))return;
       if($status==='completed'){
           $file=af_ai_user_dir($owner).'/'.$id.'-result.png';
           if(@file_put_contents($file,$bytes,LOCK_EX)!==strlen($bytes))ai_terminal_error(503,'ai_storage_unavailable');
           @chmod($file,0600);$job['status']='completed';$job['completed']=time();
       }elseif($status==='failed'){
           $job['status']='failed';$job['error']='generation_failed';
       }else{$job['status']='processing';}
       if(!af_ai_write($owner,$job))ai_terminal_error(503,'ai_storage_unavailable');
       // Refund only after the terminal state is durably persisted: no double refund on retry.
       if($status==='failed')af_ai_quota($owner,-1);
    });
    af_response(200,['accepted'=>true]);
}
$account=af_current_account();
if($account===null)ai_terminal_error(401,'login_required');
$owner=(string)$account['id'];
if($method==='GET'&&isset($_GET['image'])){
    $id=(string)$_GET['image'];$job=af_ai_read($owner,$id);
    if(!$job||$job['status']!=='completed')ai_terminal_error(404,'not_found');
    $path=af_ai_user_dir($owner).'/'.$id.'-result.png';
    if(!is_file($path))ai_terminal_error(404,'not_found');
    header('Content-Type: image/png');header('Cache-Control: private, no-store');
    header('Content-Disposition: inline; filename="affresco-ai-'.$id.'.png"');
    header('X-Content-Type-Options: nosniff');readfile($path);exit;
}
if($method==='GET'&&isset($_GET['context'])){
    $context=(string)$_GET['context'];
    if(!af_ai_context($context))ai_terminal_error(422,'invalid_request');
    $jobs=af_ai_lock($owner,static function()use($owner,$context){
        return array_map(static fn($job)=>af_ai_expire($owner,$job),af_ai_jobs($owner,$context));
    });
    af_response(200,['jobs'=>array_map('af_ai_public',$jobs),'generations_limit'=>(int)($account['generations_limit']??0),'generations_used'=>(int)((af_current_account()??$account)['generations_used']??0)]);
}
if($method!=='POST'){header('Allow: GET, POST');ai_terminal_error(405,'method_not_allowed');}
af_guard_post();
if(!$cfg||!function_exists('curl_init'))ai_terminal_error(503,'ai_not_configured');
$meta=isset($_POST['metadata'])&&is_string($_POST['metadata'])&&strlen($_POST['metadata'])<4096?json_decode($_POST['metadata'],true):null;
$context=is_array($meta)?(string)($meta['context']??''):'';
if(!af_ai_context($context))ai_terminal_error(422,'invalid_request');
foreach(['wall_cm','fresco_cm'] as $key) {
    if(!is_array($meta[$key]??null)||count($meta[$key])!==2||!isset($meta[$key][0],$meta[$key][1]))ai_terminal_error(422,'invalid_request');
    foreach($meta[$key] as $v)if(!is_numeric($v)||(float)$v<.1||(float)$v>5000)ai_terminal_error(422,'invalid_request');
}
foreach(['wall_quad','fresco_quad'] as $key) {
    if(!is_array($meta[$key]??null)||count($meta[$key])!==4)ai_terminal_error(422,'invalid_request');
    foreach($meta[$key] as $p) {
      if(!is_array($p)||count($p)!==2)ai_terminal_error(422,'invalid_request');
      foreach($p as $v)if(!is_numeric($v)||!is_finite((float)$v)||abs((float)$v)>20)ai_terminal_error(422,'invalid_request');
    }
}
$meta['orientation']=($meta['orientation']??'')==='portrait'?'portrait':'landscape';
$light=$meta['lighting']??null;
if($light!==null){
 if(!is_array($light)||!in_array($light['tone']??'', ['warm','cold'],true))ai_terminal_error(422,'invalid_request');
 foreach(['from','to'] as $key)if(!is_array($light[$key]??null)||count($light[$key])!==2||!is_numeric($light[$key][0]??null)||!is_numeric($light[$key][1]??null))ai_terminal_error(422,'invalid_request');
 $meta['lighting']=['tone'=>$light['tone'],'from'=>array_map('floatval',$light['from']),'to'=>array_map('floatval',$light['to'])];
}
$buffers=[];
foreach(['room','fresco','guide'] as $slot){
 $file=$_FILES[$slot]??null;
 if(!is_array($file)||($file['error']??1)!==UPLOAD_ERR_OK||($file['size']??0)<100||($file['size']??0)>2400000)ai_terminal_error(422,'invalid_image');
 $bytes=@file_get_contents($file['tmp_name']);$info=is_string($bytes)?@getimagesizefromstring($bytes):false;
 if(!is_array($info)||($info['mime']??'')!=='image/jpeg'||$info[0]<50||$info[1]<50||$info[0]>2500||$info[1]>2500)ai_terminal_error(422,'invalid_image');
 $buffers[$slot]=$bytes;
}
$created=af_ai_lock($owner,static function()use($owner,$context,$meta,$buffers,$cfg){
    $jobs=af_ai_jobs($owner,$context);
    if(count($jobs)>=6)ai_terminal_error(429,'ai_context_limit');
    foreach($jobs as $j)if(in_array(af_ai_expire($owner,$j)['status'],['pending','processing'],true))ai_terminal_error(409,'ai_in_progress');
    if(!af_ai_quota($owner,1))ai_terminal_error(429,'ai_quota_exceeded');
    $id=bin2hex(random_bytes(16));$job=['id'=>$id,'owner'=>$owner,'context'=>$context,'created'=>time(),'status'=>'pending','metadata'=>$meta];
    $dir=af_ai_user_dir($owner);
    foreach($buffers as $slot=>$bytes) {
       $path="$dir/$id-$slot.jpg";
       if(@file_put_contents($path,$bytes,LOCK_EX)!==strlen($bytes)){af_ai_quota($owner,-1);ai_terminal_error(503,'ai_storage_unavailable');}
       @chmod($path,0600);
    }
    if(!af_ai_write($owner,$job)){af_ai_quota($owner,-1);ai_terminal_error(503,'ai_storage_unavailable');}
    $ticket=['owner'=>$owner];$ticketJson=json_encode($ticket);
    if(@file_put_contents(af_ai_root().'/ticket-'.$id.'.json',$ticketJson,LOCK_EX)!==strlen($ticketJson)){af_ai_quota($owner,-1);ai_terminal_error(503,'ai_storage_unavailable');}
    return $job;
});
$id=$created['id'];
$repo=(string)($cfg['github_repo']??'a2ice/affresco');
if(!preg_match('~^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$~D',$repo))ai_terminal_error(503,'ai_not_configured');
$endpoint="https://api.github.com/repos/$repo/actions/workflows/openai-room-tryon.yml/dispatches";
$ch=curl_init($endpoint);
curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,
    CURLOPT_HTTPHEADER=>['Accept: application/vnd.github+json','Content-Type: application/json',
       'Authorization: Bearer '.$cfg['github_token'],'User-Agent: AFFRESCO-AI-Dispatcher','X-GitHub-Api-Version: 2022-11-28'],
    CURLOPT_POSTFIELDS=>json_encode(['ref'=>'main','inputs'=>['generation_id'=>$id]]),
    CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2
]);
curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
if($status!==204){
    af_ai_lock($owner,static function()use($owner,$created){
        $job=$created;$job['status']='failed';$job['error']='dispatch_failed';
        if(af_ai_write($owner,$job))af_ai_quota($owner,-1);
    });
    ai_terminal_error(503,'ai_dispatch_unavailable');
}
af_response(202,['accepted'=>true,'id'=>$id,'status'=>'pending']);
