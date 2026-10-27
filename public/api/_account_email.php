<?php
declare(strict_types=1);
/* Account email is stored in the existing FTP accounts.json. This file must
 * remain non-public over HTTP. Never return pass or other private attributes. */
function af_save_account_email(string $userId, string $email): bool {
    $email=trim($email);
    if (strlen($email)>254 || !filter_var($email,FILTER_VALIDATE_EMAIL)) return false;
    $file=af_accounts_path();
    if (!is_file($file) || !is_writable($file)) return false;
    $handle=@fopen($file,'r+');
    if (!$handle) return false;
    if (!flock($handle,LOCK_EX)) { fclose($handle); return false; }
    $raw=stream_get_contents($handle);
    $root=is_string($raw) && strlen($raw)<1048576 ? json_decode($raw,true):null;
    $wrapped=is_array($root) && isset($root['accounts']) && is_array($root['accounts']);
    $entries=$wrapped?$root['accounts']:$root;
    $found=false;
    if (is_array($entries)) {
        foreach ($entries as &$entry) {
            if (is_array($entry) && (string)($entry['id']??'')===$userId) {
                $entry['email']=$email;
                $found=true;
                break;
            }
        }
        unset($entry);
    }
    $ok=false;
    if ($found) {
        $data=$wrapped?array_replace($root,['accounts'=>$entries]):$entries;
        $out=json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);
        if (is_string($out) && strlen($out)<1048576 && rewind($handle) &&
            ftruncate($handle,0) && fwrite($handle,$out."\n")===strlen($out)+1 && fflush($handle)) {
            $ok=true;
        }
    }
    flock($handle,LOCK_UN);
    fclose($handle);
    return $ok;
}
