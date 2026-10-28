<?php
declare(strict_types=1);
// Exercise the production quota functions with isolated filesystem/session state.
$root=sys_get_temp_dir().'/affresco-quota-test-'.bin2hex(random_bytes(8));
mkdir($root.'/public/api',0700,true);
mkdir($root.'/tmp',0700,true);
$source=file_get_contents(__DIR__.'/../public/api/send-crop.php');
$start=strpos($source,'function af_mail_quota_open(): array {');
$end=strpos($source,'// Mail recipients are accepted independently',$start);
if ($start===false || $end===false) throw new RuntimeException('Quota functions not found');
$functions=substr($source,$start,$end-$start);
// Redirect only the system temp dependency, retaining the actual quota implementation.
$functions=str_replace('sys_get_temp_dir()','af_quota_test_tmp()',$functions);
file_put_contents($root.'/public/api/quota.php',"<?php\n".$functions);
function af_quota_test_tmp(): string {return $GLOBALS['root'].'/tmp';}
function af_response(int $status,array $body): void {throw new RuntimeException((string)$status);}
function quota_check(bool $value,string $label): void {if (!$value) throw new RuntimeException($label);}
function expect_limited(): void {
    try {$quota=af_mail_quota_open();af_mail_quota_close($quota,false);}
    catch (RuntimeException $e) {if ($e->getMessage()==='429') return;throw $e;}
    throw new RuntimeException('Sixth acceptance should be limited');
}
function quota_cleanup(string $path): void {
    foreach (scandir($path) as $name) {
        if ($name==='.' || $name==='..') continue;
        $child=$path.'/'.$name;
        if (is_dir($child)) quota_cleanup($child);else unlink($child);
    }
    rmdir($path);
}
require $root.'/public/api/quota.php';
try {
    $_SERVER['REMOTE_ADDR']='192.0.2.1';$_SESSION=[];
    for ($i=0;$i<8;$i++) af_mail_quota_close(af_mail_quota_open(),false);
    quota_check(empty($_SESSION['affresco_mail_accepted_v3']),'Failures consumed session quota');
    for ($i=0;$i<5;$i++) af_mail_quota_close(af_mail_quota_open(),true);
    expect_limited();
    $_SESSION=[];
    expect_limited(); // Same IP cannot evade the file quota via a fresh session.
    // Accepted messages older than 60 seconds no longer count in either store.
    foreach (glob($root.'/.affresco-mail-rate/*.json') as $file) file_put_contents($file,json_encode(array_fill(0,5,time()-61)));
    $_SESSION['affresco_mail_accepted_v3']=array_fill(0,5,time()-61);
    af_mail_quota_close(af_mail_quota_open(),true);
    quota_check(count($_SESSION['affresco_mail_accepted_v3'])===1,'Minute window did not expire');
    // Force the session fallback by making both candidate directories ordinary files.
    quota_cleanup($root.'/.affresco-mail-rate');
    touch($root.'/.affresco-mail-rate');
    touch($root.'/tmp/affresco-mail-rate');
    $_SESSION=[];
    for ($i=0;$i<5;$i++) af_mail_quota_close(af_mail_quota_open(),true);
    expect_limited();
    echo "PASS: five accepted per rolling minute; sixth rejected; failures free; IP/session stores; expiry\n";
} finally {quota_cleanup($root);}
