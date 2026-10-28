<?php
declare(strict_types=1);
function af_track_usage(string $userId, string $event, ?string $sku=null): void {
    $primary=dirname(__DIR__,2).'/data/accounts.json';
    $file=is_file($primary)?$primary:dirname(__DIR__).'/data/accounts.json';
    if (!is_file($file) || !is_writable($file))return;
    $handle=@fopen($file,'r+');
    if (!$handle)return;
    if (!flock($handle,LOCK_EX)){fclose($handle);return;}
    $raw=stream_get_contents($handle);
    $rows=is_string($raw)?json_decode($raw,true):null;
    $wrapped=is_array($rows)&&isset($rows['accounts'])&&is_array($rows['accounts']);
    $list=$wrapped?$rows['accounts']:$rows;
    $changed=false;
    if (is_array($list)){
        foreach ($list as &$entry){
            if (!is_array($entry) || (string)($entry['id']??'')!==$userId)continue;
            if ($event==='login'){
                $entry['last_login']=gmdate('c');
                $entry['login_count']=max(0,(int)($entry['login_count']??0))+1;
                $changed=true;
            } elseif ($event==='email'){
                $entry['last_email']=gmdate('c');
                $entry['emails_count']=max(0,(int)($entry['emails_count']??0))+1;
                $changed=true;
            } elseif ($event==='edit' && $sku!==null){
                $entry['last_update']=gmdate('c');
                $entry['updates_count']=max(0,(int)($entry['updates_count']??0))+1;
                $listSkus=is_array($entry['updated_items_sku']??null)?$entry['updated_items_sku']:[];
                if (!in_array($sku,$listSkus,true))$listSkus[]=$sku;
                $entry['updated_items_sku']=array_values($listSkus);
                $changed=true;
            }
            break;
        }
        unset($entry);
    }
    if ($changed){
        $final=$wrapped?array_replace($rows,['accounts'=>$list]):$list;
        $encoded=json_encode($final,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);
        if (is_string($encoded) && strlen($encoded)<1048576){
            rewind($handle);
            if (ftruncate($handle,0)){
                fwrite($handle,$encoded."\n");
                fflush($handle);
            }
        }
    }
    flock($handle,LOCK_UN);
    fclose($handle);
}


/** Guest mail activity is isolated from account history and retained in session. */
function af_guest_activity(): array {
    $activity=$_SESSION['affresco_guest_activity']??[];
    if (!is_array($activity)) $activity=[];
    return [
        'emails_count'=>max(0,(int)($activity['emails_count']??0)),
        'last_email'=>is_string($activity['last_email']??null)?$activity['last_email']:null,
        'manual_generations_used'=>max(0,(int)($activity['manual_generations_used']??0)),
        'last_manual_generation'=>is_string($activity['last_manual_generation']??null)?$activity['last_manual_generation']:null
    ];
}
function af_track_guest_email(): void {
    $activity=af_guest_activity();
    $activity['emails_count']++;
    $activity['last_email']=gmdate('c');
    $_SESSION['affresco_guest_activity']=$activity;
}

