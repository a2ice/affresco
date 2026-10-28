<?php
declare(strict_types=1);

/* SMTP transport for CISHOST shared hosting.
 * PHP mail() is disabled on this service. Configure credentials on FTP in
 * /data/mail.json (or private ../data/mail.json), never in the repository.
 *
 * See docs/tasks/006-email/README.md for the minimal mail.json format.
 */
require_once __DIR__ . '/vendor/phpmailer/Exception.php';
require_once __DIR__ . '/vendor/phpmailer/PHPMailer.php';
require_once __DIR__ . '/vendor/phpmailer/SMTP.php';

function af_smtp_config(): array {
    $private=dirname(__DIR__,2).'/data/mail.json';
    $ftp=dirname(__DIR__).'/data/mail.json';
    $file=is_file($private)?$private:$ftp;
    if (!is_file($file) || !is_readable($file)) {
        throw new RuntimeException('smtp_not_configured');
    }
    $raw=@file_get_contents($file);
    $config=is_string($raw) && strlen($raw)<8192 ? json_decode($raw,true) : null;
    if (!is_array($config))throw new RuntimeException('smtp_invalid_config');
    foreach (['host','username','password'] as $key) {
        if (!is_string($config[$key]??null) || trim($config[$key])==='') {
            throw new RuntimeException('smtp_invalid_config');
        }
    }
    $host=trim($config['host']);
    $user=trim($config['username']);
    $from=is_string($config['from']??null)?trim($config['from']):$user;
    $port=$config['port']??587;
    $security=$config['security']??'starttls';
    if (!filter_var($host,FILTER_VALIDATE_DOMAIN,FILTER_FLAG_HOSTNAME) ||
        strlen($host)>253 || !filter_var($user,FILTER_VALIDATE_EMAIL) ||
        !filter_var($from,FILTER_VALIDATE_EMAIL) ||
        !is_int($port) || !in_array($port,[25,465,587],true) ||
        !in_array($security,['starttls','ssl'],true) ||
        ($port===465 && $security!=='ssl') ||
        ($port===587 && $security!=='starttls') ||
        strlen($config['password'])>512) {
        throw new RuntimeException('smtp_invalid_config');
    }
    return [
        'host'=>$host,
        'port'=>$port,
        'security'=>$security,
        'username'=>$user,
        'password'=>$config['password'],
        'from'=>$from,
        'from_name'=>is_string($config['from_name']??null) &&
            trim($config['from_name'])!=='' ? substr(trim($config['from_name']),0,80) : 'AFFRESCO'
    ];
}
/** Returns null if accepted by SMTP, or a public error code on failure. */
function af_send_crop_smtp(string $to,string $sku,float $width,float $height,string $binary): ?string {
    try {
        $cfg=af_smtp_config();
    } catch (RuntimeException $e) {
        return $e->getMessage();
    }
    try {
        $mailer=new PHPMailer\PHPMailer\PHPMailer(true);
        $mailer->isSMTP();
        $mailer->Host=$cfg['host'];
        $mailer->Port=$cfg['port'];
        $mailer->SMTPAuth=true;
        $mailer->Username=$cfg['username'];
        $mailer->Password=$cfg['password'];
        $mailer->SMTPSecure=$cfg['security']==='ssl'
            ?PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
            :PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mailer->SMTPAutoTLS=true;
        $mailer->SMTPDebug=0;
        $mailer->Timeout=15;
        $mailer->SMTPOptions=['ssl'=>[
            'verify_peer'=>true,
            'verify_peer_name'=>true,
            'allow_self_signed'=>false
        ]];
        $mailer->CharSet='UTF-8';
        $mailer->setFrom($cfg['from'],$cfg['from_name']);
        $mailer->addAddress($to);
        $mailer->Subject='AFFRESCO — ваш кадр фрески '.$sku;
        $mailer->isHTML(false);
        $mailer->Body="Ваш кадр фрески AFFRESCO\n".
            "Артикул: ".$sku."\n".
            "Размер кадра: ".$width." × ".$height." см\n\n".
            "Выбранный фрагмент приложен в формате JPEG.\n".
            "Размеры ориентировочные, уточняются перед изготовлением.\n".
            "https://affresco.a2ice.ru/\n";
        $mailer->addStringAttachment($binary,'affresco-'.$sku.'.jpg',
            PHPMailer\PHPMailer\PHPMailer::ENCODING_BASE64,'image/jpeg');
        $mailer->send();
        return null;
    } catch (PHPMailer\PHPMailer\Exception $e) {
        // Never expose SMTP banners, credentials or server debug to visitors.
        $msg=strtolower($e->getMessage());
        return str_contains($msg,'authenticate')?'smtp_auth_failed':'smtp_unavailable';
    } catch (Throwable $e) {
        return 'smtp_unavailable';
    }
}
