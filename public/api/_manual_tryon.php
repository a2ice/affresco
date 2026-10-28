<?php
declare(strict_types=1);
/** Record one manual result idempotently. AI counters and limits are untouched. */
function af_record_manual_tryon(?array $account,string $id): bool {
    if ($account===null) {
        $activity=af_guest_activity();
        $ids=$_SESSION['affresco_manual_ids']??[];
        if (!is_array($ids)) $ids=[];
        if (!in_array($id,$ids,true)) {
            $activity['manual_generations_used']++;
            $activity['last_manual_generation']=gmdate('c');
            $ids[]=$id;
            $_SESSION['affresco_manual_ids']=array_slice($ids,-256);
            $_SESSION['affresco_guest_activity']=$activity;
        }
        return true;
    }
    $file=af_accounts_path();
    $handle=@fopen($file,'r+');
    if (!$handle) return false;
    if (!flock($handle,LOCK_EX)) {fclose($handle);return false;}
    try {
        $raw=stream_get_contents($handle);
        if (!is_string($raw) || strlen($raw)>1048576) return false;
        $rows=json_decode($raw,true);
        if (!is_array($rows)) return false;
        $wrapped=isset($rows['accounts'])&&is_array($rows['accounts']);
        $list=$wrapped?$rows['accounts']:$rows;
        $found=false;
        foreach ($list as &$entry) {
            if (!is_array($entry) || (string)($entry['id']??'')!==(string)$account['id']) continue;
            $found=true;
            $ids=is_array($entry['manual_generation_ids']??null)?$entry['manual_generation_ids']:[];
            if (in_array($id,$ids,true)) return true;
            $entry['manual_generations_used']=max(0,(int)($entry['manual_generations_used']??0))+1;
            $entry['last_manual_generation']=gmdate('c');
            $ids[]=$id;$entry['manual_generation_ids']=array_slice($ids,-256);
            break;
        }
        unset($entry);
        if (!$found) return false;
        $final=$wrapped?array_replace($rows,['accounts'=>$list]):$list;
        $encoded=json_encode($final,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);
        if (!is_string($encoded) || strlen($encoded)>1048576) return false;
        rewind($handle);
        return ftruncate($handle,0) && fwrite($handle,$encoded."\n")===strlen($encoded)+1 && fflush($handle);
    } finally {flock($handle,LOCK_UN);fclose($handle);}
}
