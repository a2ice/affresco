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
$data=null;
if($method==='POST'){
 $raw=file_get_contents('php://input');
 $data=is_string($raw)&&strlen($raw)<2048?json_decode($raw,true):null;
 if(!is_array($data))af_response(422,['error'=>'invalid_request']);
}
$context=(string)($data['context']??$_GET['context']??'');
if(!af_ai_context($context))af_response(422,['error'=>'invalid_request']);
if(!class_exists('ZipArchive'))af_response(503,['error'=>'zip_unavailable']);
$jobs=af_ai_jobs($owner,$context);
$complete=array_values(array_filter($jobs,static fn($j)=>($j['status']??'')==='completed'));
if($complete===[])af_response(404,['error'=>'ai_no_results']);
if(count($complete)>6)af_response(422,['error'=>'invalid_request']);
$file=tempnam(af_ai_user_dir($owner),'export-');
if(!is_string($file))af_response(503,['error'=>'zip_unavailable']);
$zip=new ZipArchive();
if($zip->open($file,ZipArchive::CREATE|ZipArchive::OVERWRITE)!==true){@unlink($file);af_response(503,['error'=>'zip_unavailable']);}
$size=0;$count=0;
foreach($complete as $index=>$job){
 $source=af_ai_user_dir($owner).'/'.$job['id'].'-result.png';
 if(!is_file($source)){ $zip->close();@unlink($file);af_response(503,['error'=>'ai_storage_unavailable']); }
 $bytes=filesize($source);
 if(!is_int($bytes)||$bytes<100||$bytes>12*1048576){$zip->close();@unlink($file);af_response(422,['error'=>'invalid_image']);}
 $size+=$bytes;
 if($size>36*1048576){$zip->close();@unlink($file);af_response(413,['error'=>'zip_too_large']);}
 $zip->addFile($source,sprintf('affresco-ai-%02d.png',$index+1));$count++;
}
$zip->close();
if(!is_file($file)||filesize($file)<100){@unlink($file);af_response(503,['error'=>'zip_unavailable']);}
if($method==='GET'){
 header('Content-Type: application/zip');header('Cache-Control: private, no-store');
 header('Content-Disposition: attachment; filename="affresco-ai-results.zip"');
 header('Content-Length: '.filesize($file));header('X-Content-Type-Options: nosniff');
 readfile($file);@unlink($file);exit;
}
$email=trim((string)($data['email']??''));
if(strlen($email)>254||!filter_var($email,FILTER_VALIDATE_EMAIL)){@unlink($file);af_response(422,['error'=>'invalid_email']);}
$now=time();$times=is_array($_SESSION['affresco_ai_mail_times']??null)?$_SESSION['affresco_ai_mail_times']:[];
$times=array_values(array_filter($times,static fn($t)=>is_int($t)&&$t>$now-60));
if(count($times)>=5){@unlink($file);af_response(429,['error'=>'send_rate_limit']);}
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
 $mailer->Subject='AFFRESCO — AI-примерки фрески';
 $mailer->isHTML(false);
 $mailer->Body="Ваши AI-примерки фрески AFFRESCO находятся во вложенном ZIP-архиве.\n".
     "Количество: ".$count."\nРазмеры и фактура фрески ориентировочные: AI-визуализация не заменяет техническую проекцию.\nhttps://affresco.a2ice.ru/\n";
 $mailer->addAttachment($file,'affresco-ai-results.zip',PHPMailer\PHPMailer\PHPMailer::ENCODING_BASE64,'application/zip');
 $mailer->send();
}catch(Throwable $e){
 @unlink($file);
 $message=$e instanceof RuntimeException&&in_array($e->getMessage(),['smtp_not_configured','smtp_invalid_config'],true)?$e->getMessage():'smtp_unavailable';
 af_response(503,['error'=>$message]);
}
@unlink($file);
$times[]=$now;$_SESSION['affresco_ai_mail_times']=$times;
require_once __DIR__.'/_usage.php';
af_track_usage($owner,'email');
af_response(200,['accepted'=>true,'count'=>$count]);
