<?php
declare(strict_types=1);
require __DIR__ . '/_account.php';
require __DIR__ . '/_account_email.php';
af_session();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    af_response(405, ['error'=>'method_not_allowed']);
}
af_guard_post();
$raw=file_get_contents('php://input');
$data=is_string($raw) && strlen($raw) < 3500000 ? json_decode($raw,true):null;
if (!is_array($data))af_response(413,['error'=>'request_too_large']);
$email=$data['email']??null;
$sku=$data['sku']??null;
$image=$data['image']??null;
$width=$data['width_cm']??null;
$height=$data['height_cm']??null;
if (!is_string($email) || strlen($email)>254 || filter_var(trim($email),FILTER_VALIDATE_EMAIL)===false ||
    !is_string($sku) || preg_match('/^[A-Za-z0-9_.-]{1,100}$/D',$sku)!==1 ||
    !is_string($image) || strlen($image)>3300000 ||
    !is_numeric($width) || !is_numeric($height) ||
    !is_finite((float)$width) || !is_finite((float)$height) ||
    (float)$width<30 || (float)$height<30 || (float)$width>1000 || (float)$height>1000) {
    af_response(422,['error'=>'invalid_request']);
}
$email=trim($email);
if (!str_starts_with($image,'data:image/jpeg;base64,'))af_response(422,['error'=>'invalid_image']);
$binary=base64_decode(substr($image,23),true);
if (!is_string($binary) || strlen($binary)<100 || strlen($binary)>2200000 ||
    substr($binary,0,3)!=="\xFF\xD8\xFF" ||
    !function_exists('getimagesizefromstring') ||
    ($info=@getimagesizefromstring($binary))===false ||
    ($info[2]??0)!==IMAGETYPE_JPEG || $info[0]>3200 || $info[1]>3200 ||
    $info[0]<20 || $info[1]<20) {
    af_response(422,['error'=>'invalid_image']);
}
// Keep the public demo from becoming an unrestricted mail relay.
// The limit is applied per IP (independent of the browser cookie).
function af_mail_rate_limited(): bool {
    $dir=rtrim(sys_get_temp_dir(),DIRECTORY_SEPARATOR).'/affresco-mail-rate';
    if (!is_dir($dir) && !@mkdir($dir,0700,true) && !is_dir($dir)) return true;
    $key=hash('sha256',($_SERVER['REMOTE_ADDR']??'unknown').'|affresco-send-v1');
    $handle=@fopen($dir.'/'.$key.'.json','c+');
    if (!$handle) return true;
    if (!flock($handle,LOCK_EX)) {fclose($handle);return true;}
    $raw=stream_get_contents($handle);
    $times=json_decode(is_string($raw)?$raw:'[]',true);
    if (!is_array($times))$times=[];
    $now=time();
    $times=array_values(array_filter($times,static fn($t)=>is_int($t)&&$t>$now-3600));
    $blocked=count($times)>=4;
    if (!$blocked){
        $times[]=$now;
        $out=json_encode($times);
        if (!is_string($out) || !rewind($handle) || !ftruncate($handle,0) ||
            fwrite($handle,$out)!==strlen($out) || !fflush($handle)) $blocked=true;
    }
    flock($handle,LOCK_UN);fclose($handle);
    return $blocked;
}
if (af_mail_rate_limited())af_response(429,['error'=>'send_rate_limit']);
// Only persist the recipient to the account owned by the current session.
// Guests can send a limited number of messages but have no saved profile.
$account=af_current_account();
if ($account!==null && !af_save_account_email((string)$account['id'],$email)) {
    af_response(503,['error'=>'email_storage_unavailable']);
}
$from=getenv('AFFRESCO_MAIL_FROM');
if (!is_string($from) || !filter_var($from,FILTER_VALIDATE_EMAIL)) {
    $from='no-reply@affresco.a2ice.ru';
}
$boundary='affresco_'.bin2hex(random_bytes(12));
$subject='=?UTF-8?B?'.base64_encode('AFFRESCO — ваш кадр фрески '.$sku).'?=';
$text="Ваш кадр фрески AFFRESCO\n".
    "Артикул: ".$sku."\n".
    "Размер кадра: ".(float)$width." × ".(float)$height." см\n\n".
    "Изображение выбранного фрагмента во вложении.\n".
    "Размеры демонстрационные, уточняются перед изготовлением.\n\n".
    "https://affresco.a2ice.ru/\n";
$headers=[
    'From: AFFRESCO <'.$from.'>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="'.$boundary.'"',
    'X-Auto-Response-Suppress: All'
];
$body="--".$boundary."\r\n".
    "Content-Type: text/plain; charset=UTF-8\r\n".
    "Content-Transfer-Encoding: 8bit\r\n\r\n".$text."\r\n".
    "--".$boundary."\r\n".
    "Content-Type: image/jpeg; name=\"affresco-".$sku.".jpg\"\r\n".
    "Content-Transfer-Encoding: base64\r\n".
    "Content-Disposition: attachment; filename=\"affresco-".$sku.".jpg\"\r\n\r\n".
    chunk_split(base64_encode($binary),76,"\r\n").
    "--".$boundary."--\r\n";
if (!function_exists('mail') || !@mail($email,$subject,$body,implode("\r\n",$headers))) {
    af_response(503,['error'=>'mail_unavailable']);
}
// mail() confirms only acceptance by the server's local mail transport.
// Final delivery to inbox is not guaranteed.
af_response(200,['accepted'=>true,'email'=>$email,'sku'=>$sku]);
