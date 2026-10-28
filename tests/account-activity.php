<?php
declare(strict_types=1);
// Isolated private fixtures; no connection to the hosting or its accounts.
$root=sys_get_temp_dir().'/affresco-activity-test-'.bin2hex(random_bytes(8));
mkdir($root.'/public/api',0700,true);
mkdir($root.'/data',0700,true);
foreach (['_account.php','_usage.php'] as $name) copy(__DIR__.'/../public/api/'.$name,$root.'/public/api/'.$name);
require $root.'/public/api/_account.php';
require $root.'/public/api/_usage.php';
function check(bool $condition,string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
try {
    foreach ([false,true] as $wrapped) {
        $rows=[['id'=>'fixture','login'=>'tester','pass'=>'PRIVATE_FIXTURE','login_count'=>3,'updates_count'=>7]];
        file_put_contents($root.'/data/accounts.json',json_encode($wrapped?['accounts'=>$rows,'metadata'=>'keep']:$rows));
        af_track_usage('fixture','login');
        af_track_usage('fixture','edit','6039');
        af_track_usage('fixture','email');
        af_track_usage('missing','email');
        $account=af_find_account(af_accounts(),'fixture');
        check($account!==null,'Fixture missing');
        $public=af_public_account($account);
        check($public['login_count']===4,'Login count stale');
        check($public['updates_count']===8,'Save count stale');
        check($public['emails_count']===1,'SMTP acceptance count incorrect');
        check($public['last_email']!==null,'Missing mail date');
        check(!isset($public['pass']),'Credential exposed');
        if ($wrapped) check(json_decode(file_get_contents($root.'/data/accounts.json'),true)['metadata']==='keep','Wrapper metadata lost');
    }
    $_SESSION=[];
    check(af_guest_activity()['emails_count']===0,'Unexpected guest history');
    af_track_guest_email();af_track_guest_email();
    check(af_guest_activity()['emails_count']===2,'Guest mail count incorrect');
    check(af_public_account(af_find_account(af_accounts(),'fixture'))['emails_count']===1,'Guest changed account history');
    echo "PASS: account counters, wrapper preservation, private fields, guest isolation\n";
} finally {
    unlink($root.'/data/accounts.json');
    foreach (['_account.php','_usage.php'] as $name) unlink($root.'/public/api/'.$name);
    rmdir($root.'/public/api');rmdir($root.'/public');rmdir($root.'/data');rmdir($root);
}
