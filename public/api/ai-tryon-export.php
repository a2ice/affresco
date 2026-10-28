<?php
declare(strict_types=1);
require __DIR__.'/_ai_tryon.php';
require __DIR__.'/_smtp_mail.php';
af_session();
$account=af_current_account();
if($account===null)af_response(401,['error'=>'login_required']);
$owner=(string)$account['id'];
$method=$_SERVER['REQUEST_METHOD']??'GET';
if(!in_array($method,['GET','POST'],true))af_response(405,['error'=>'method_not_allowed']);
if($method==='POST')af_guard_post();
$raw=$method==='POST'?file_get_contents('php://input'):'';
if($method==='POST'&&(!is_string($raw)||strlen($raw)>3600000))af_response(413,['error'=>'request_too_large']);
$data=$method==='POST'?json_decode($raw,true):null;
if($method==='POST'&&!is_array($data))af_response(422,['error'=>'invalid_request']);
$context=(string)($data['context']??$_GET['context']??'');
if(!af_ai_context($context))af_response(422,['error'=>'invalid_request']);

if($method==='POST'&&isset($_GET['manual'])){
    $id=(string)($data['id']??'');
    if(!preg_match('/^[a-f0-9-]{36}$/iD',$id))af_response(422,['error'=>'invalid_request']);
    $image=$data['image']??null;
    if(!is_string($image)||strlen($image)>3400000||!str_starts_with($image,'data:image/jpeg;base64,'))
        af_response(422,['error'=>'invalid_image']);
    $binary=base64_decode(substr($image,23),true);
    if(!is_string($binary)||strlen($binary)<100||strlen($binary)>2400000)af_response(422,['error'=>'invalid_image']);
    $info=@getimagesizefromstring($binary);
    if(!is_array($info)||($info['mime']??'')!=='image/jpeg'||$info[0]<50||$info[1]<50||
       $info[0]>2500||$info[1]>2500)af_response(422,['error'=>'invalid_image']);
    $created=(int)($data['created']??time()*1000);
    if($created<1577836800000||$created>(time()+300)*1000)af_response(422,['error'=>'invalid_request']);
    af_ai_lock($owner,static function()use($owner,$context,$id,$binary,$created){
        $base=af_ai_user_dir($owner);
        $metaFile=$base.'/manual-'.$id.'.json';
        if(is_file($metaFile)){
            $existing=json_decode((string)@file_get_contents($metaFile),true);
            if(!is_array($existing)||($existing['context']??null)!==$context)af_response(409,['error'=>'manual_conflict']);
            return;
        }
        // Per-owner limit, not just per-context: prevent unbounded private uploads.
        $existing=glob($base.'/manual-*.json')?:[];
        if(count($existing)>=48)af_response(429,['error'=>'manual_storage_limit']);
        $file=$base.'/manual-'.$id.'.jpg';
        $tmp=$file.'.'.bin2hex(random_bytes(4)).'.tmp';
        if(@file_put_contents($tmp,$binary,LOCK_EX)!==strlen($binary)){
            @unlink($tmp);af_response(503,['error'=>'ai_storage_unavailable']);
        }
        @chmod($tmp,0600);
        if(!@rename($tmp,$file)){
            @unlink($tmp);af_response(503,['error'=>'ai_storage_unavailable']);
        }
        $json=json_encode(['id'=>$id,'context'=>$context,'created'=>$created],JSON_UNESCAPED_SLASHES);
        if(!is_string($json)||@file_put_contents($metaFile,$json,LOCK_EX)!==strlen($json)){
            @unlink($file);af_response(503,['error'=>'ai_storage_unavailable']);
        }
        @chmod($metaFile,0600);
    });
    af_response(200,['accepted'=>true]);
}

$items=af_ai_export_items($owner,$context);
if(!$items)af_response(404,['error'=>'no_results']);
if(count($items)>54)af_response(422,['error'=>'invalid_request']);
$size=0;
foreach($items as $item){
    $n=@filesize($item['file']);
    if(!is_int($n)||$n<100||$n>12*1048576)af_response(503,['error'=>'ai_storage_unavailable']);
    $size+=$n;
}
if($size>48*1048576)af_response(413,['error'=>'zip_too_large']);
$count=count($items);
$bundle=$count>1;
$filename=$bundle?'affresco-tryon-results.zip':$items[0]['name'];
$mime=$bundle?'application/zip':$items[0]['mime'];
if($bundle){
    if(!class_exists('ZipArchive'))af_response(503,['error'=>'zip_unavailable']);
    $attachment=tempnam(af_ai_user_dir($owner),'export-');
    if(!is_string($attachment))af_response(503,['error'=>'zip_unavailable']);
    $zip=new ZipArchive();
    if($zip->open($attachment,ZipArchive::CREATE|ZipArchive::OVERWRITE)!==true){
        @unlink($attachment);af_response(503,['error'=>'zip_unavailable']);
    }
    foreach($items as $item){
        if(!$zip->addFile($item['file'],$item['name'])){
            $zip->close();@unlink($attachment);af_response(503,['error'=>'zip_unavailable']);
        }
    }
    if(!$zip->close()||!is_file($attachment)||filesize($attachment)<100){
        @unlink($attachment);af_response(503,['error'=>'zip_unavailable']);
    }
}else $attachment=$items[0]['file'];
if($method==='GET'){
    header('Content-Type: '.$mime);
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: attachment; filename="'.$filename.'"');
    header('Content-Length: '.filesize($attachment));
    readfile($attachment);
    if($bundle)@unlink($attachment);
    exit;
}
$email=trim((string)($data['email']??''));
if(strlen($email)>254||!filter_var($email,FILTER_VALIDATE_EMAIL)){
    if($bundle)@unlink($attachment);
    af_response(422,['error'=>'invalid_email']);
}
$now=time();
$times=is_array($_SESSION['affresco_ai_mail_times']??null)?$_SESSION['affresco_ai_mail_times']:[];
$times=array_values(array_filter($times,static fn($t)=>is_int($t)&&$t>$now-60));
if(count($times)>=5){
    if($bundle)@unlink($attachment);
    af_response(429,['error'=>'send_rate_limit']);
}
try{
    $cfg=af_smtp_config();
    $mailer=new PHPMailer\PHPMailer\PHPMailer(true);
    $mailer->isSMTP();$mailer->Host=$cfg['host'];$mailer->Port=$cfg['port'];
    $mailer->SMTPAuth=true;$mailer->Username=$cfg['username'];$mailer->Password=$cfg['password'];
    $mailer->SMTPSecure=$cfg['security']==='ssl'
      ?PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
      :($cfg['security']==='starttls'?PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS:'');
    $mailer->SMTPAutoTLS=$cfg['security']!=='none';$mailer->SMTPDebug=0;$mailer->Timeout=15;
    $mailer->SMTPOptions=['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'allow_self_signed'=>false]];
    $mailer->CharSet='UTF-8';$mailer->setFrom($cfg['from'],$cfg['from_name']);$mailer->addAddress($email);
    $mailer->Subject='AFFRESCO — сохранённые примерки фрески';
    $mailer->isHTML(false);
    $mailer->Body="Ваши изображения AFFRESCO — во вложении ".($bundle?'ZIP-архив.':'одним файлом.').
      "\nКоличество изображений: ".$count."\nРучная примерка показывает проектное размещение; AI-визуализация ориентировочная.\nhttps://affresco.a2ice.ru/\n";
    $mailer->addAttachment($attachment,$filename,PHPMailer\PHPMailer\PHPMailer::ENCODING_BASE64,$mime);
    $mailer->send();
}catch(Throwable $e){
    if($bundle)@unlink($attachment);
    $message=$e instanceof RuntimeException&&in_array($e->getMessage(),['smtp_not_configured','smtp_invalid_config'],true)
      ?$e->getMessage():'smtp_unavailable';
    af_response(503,['error'=>$message]);
}
if($bundle)@unlink($attachment);
$times[]=$now;$_SESSION['affresco_ai_mail_times']=$times;
require_once __DIR__.'/_usage.php';
af_track_usage($owner,'email');
af_response(200,['accepted'=>true,'count'=>$count,'archive'=>$bundle]);
