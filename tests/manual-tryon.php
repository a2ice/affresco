<?php
declare(strict_types=1);
$root=sys_get_temp_dir().'/affresco-manual-test-'.bin2hex(random_bytes(8));
mkdir($root.'/public/api',0700,true);mkdir($root.'/data',0700,true);
foreach (['_account.php','_usage.php','_manual_tryon.php'] as $name) copy(__DIR__.'/../public/api/'.$name,$root.'/public/api/'.$name);
require $root.'/public/api/_account.php';require $root.'/public/api/_usage.php';require $root.'/public/api/_manual_tryon.php';
function manual_check(bool $ok,string $message): void {if (!$ok) throw new RuntimeException($message);}
try {
    foreach ([false,true] as $wrapped) {
        $account=['id'=>'fixture','login'=>'tester','pass'=>'PRIVATE','generations_limit'=>10,'generations_used'=>10];
        file_put_contents($root.'/data/accounts.json',json_encode($wrapped?['accounts'=>[$account],'metadata'=>'keep']:[$account]));
        for ($i=0;$i<15;$i++) manual_check(af_record_manual_tryon($account,'result-'.$i),'Manual result refused');
        manual_check(af_record_manual_tryon($account,'result-14'),'Retry refused');
        $row=af_find_account(af_accounts(),'fixture');$public=af_public_account($row);
        manual_check($public['manual_generations_used']===15,'Duplicate counted or unlimited manual quota failed');
        manual_check($public['generations_used']===10 && $public['generations_limit']===10,'AI quota modified');
        manual_check(!isset($public['pass']) && !isset($public['manual_generation_ids']),'Private data exposed');
        manual_check(!af_record_manual_tryon(['id'=>'missing'],'missing'),'Unknown account accepted');
        if ($wrapped) manual_check(json_decode(file_get_contents($root.'/data/accounts.json'),true)['metadata']==='keep','Metadata lost');
    }
    $_SESSION=[];
    for ($i=0;$i<15;$i++) manual_check(af_record_manual_tryon(null,'guest-'.$i),'Guest quota incorrectly limited');
    af_record_manual_tryon(null,'guest-14');
    manual_check(af_guest_activity()['manual_generations_used']===15,'Guest count incorrect');
    manual_check(af_public_account(af_find_account(af_accounts(),'fixture'))['manual_generations_used']===15,'Guest changed account');
    echo "PASS: manual results unlimited, idempotent, guest/account isolated, AI quota untouched\n";
} finally {
    unlink($root.'/data/accounts.json');foreach (['_account.php','_usage.php','_manual_tryon.php'] as $name) unlink($root.'/public/api/'.$name);
    rmdir($root.'/data');rmdir($root.'/public/api');rmdir($root.'/public');rmdir($root);
}
