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
// Validate recipient BEFORE JPEG processing, quotas, profile changes and mail().
$email=is_string($email)?trim($email):'';
$domain=strrpos($email,'@')!==false ? substr($email,strrpos($email,'@')+1) : '';
if ($email==='' || strlen($email)>254 ||
    filter_var($email,FILTER_VALIDATE_EMAIL)===false ||
    !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/iD',$domain)) {
    af_response(422,['error'=>'invalid_email']);
}
if (!is_string($sku) || preg_match('/^[A-Za-z0-9_.-]{1,100}$/D',$sku)!==1 ||
    !is_string($image) || strlen($image)>3300000 ||
    !is_numeric($width) || !is_numeric($height) ||
    !is_finite((float)$width) || !is_finite((float)$height) ||
    (float)$width<30 || (float)$height<30 || (float)$width>1000 || (float)$height>1000) {
    af_response(422,['error'=>'invalid_request']);
}
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
// Accepted messages only. Prefer a per-IP locked file; when the shared
// hosting disables writes to private directories and system tmp, fall back
// to a per-session quota rather than blocking ALL mail with HTTP 503.
// This is a portfolio demo, not a high-volume mail service.
function af_mail_quota_open(): array {
    $now=time();
    $sessionTimes=$_SESSION['affresco_mail_accepted_v3']??[];
    if (!is_array($sessionTimes)) $sessionTimes=[];
    $sessionTimes=array_values(array_filter($sessionTimes,
        static fn($t)=>is_int($t)&&$t>$now-3600));
    if (count($sessionTimes)>=4)af_response(429,['error'=>'send_rate_limit']);
    $directories=[
        dirname(__DIR__,2).'/.affresco-mail-rate',
        rtrim(sys_get_temp_dir(),DIRECTORY_SEPARATOR).'/affresco-mail-rate'
    ];
    foreach ($directories as $dir) {
        if (!is_dir($dir))@mkdir($dir,0700,true);
        if (!is_dir($dir) || !is_writable($dir))continue;
        $key=hash('sha256',($_SERVER['REMOTE_ADDR']??'unknown').'|affresco-accepted-v2');
        $handle=@fopen($dir.'/'.$key.'.json','c+');
        if ($handle===false)continue;
        if (!flock($handle,LOCK_EX)){fclose($handle);continue;}
        rewind($handle);
        $raw=stream_get_contents($handle);
        $times=json_decode(is_string($raw)?$raw:'[]',true);
        if (!is_array($times))$times=[];
        $times=array_values(array_filter($times,
            static fn($t)=>is_int($t)&&$t>$now-3600));
        if (count($times)>=4) {
            flock($handle,LOCK_UN);fclose($handle);
            af_response(429,['error'=>'send_rate_limit']);
        }
        return ['handle'=>$handle,'times'=>$times,'sessionTimes'=>$sessionTimes];
    }
    // PHP sessions already work on this host for guest favorites/auth.
    return ['handle'=>null,'times'=>[],'sessionTimes'=>$sessionTimes];
}
function af_mail_quota_close(array $quota,bool $accepted): void {
    if ($accepted) {
        $sessionTimes=$quota['sessionTimes'];
        $sessionTimes[]=time();
        $_SESSION['affresco_mail_accepted_v3']=$sessionTimes;
    }
    $handle=$quota['handle'];
    if (!is_resource($handle))return;
    if ($accepted) {
        $times=$quota['times'];
        $times[]=time();
        $json=json_encode($times);
        if (is_string($json)){
            rewind($handle);
            if (ftruncate($handle,0)) {
                fwrite($handle,$json);
                fflush($handle);
            }
        }
    }
    flock($handle,LOCK_UN);
    fclose($handle);
}
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
// Hold the per-IP lock across the short mail transport call, so concurrent
// successful submissions cannot exceed the limit.
$quota=af_mail_quota_open();
$accepted=function_exists('mail') && @mail($email,$subject,$body,implode("\r\n",$headers));
af_mail_quota_close($quota,$accepted);
if (!$accepted) {
    af_response(503,['error'=>'mail_unavailable']);
}
// mail() confirms only acceptance by the server's local mail transport.
// Final delivery to inbox is not guaranteed.
af_response(200,['accepted'=>true,'email'=>$email,'sku'=>$sku]);
