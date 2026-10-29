<?php
declare(strict_types=1);
require __DIR__.'/_account.php';
af_session();
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
header('X-Robots-Tag: noindex, nofollow');
$account=af_current_account();
$kind=(string)($_GET['kind']??$_POST['kind']??'');
if (!in_array($kind,['room','fresco'],true)) af_response(422,['error'=>'invalid_kind']);
$method=$_SERVER['REQUEST_METHOD']??'GET';
if (!in_array($method,['GET','POST'],true)) af_response(405,['error'=>'method_not_allowed']);
$owner=$account?'account:'.(string)$account['id']:'guest:'.session_id();
$root=dirname(af_account_state_file('media-storage')).'/.affresco-user-media';
$folder=$root.'/'.hash('sha256',$owner);
function af_media_items(?array $account,string $kind):array {
    $items=$account!==null?($account['media_assets']??[]):($_SESSION['affresco_media_assets']??[]);
    if (!is_array($items))return [];
    return array_values(array_filter($items,static fn($e)=>is_array($e)&&($e['kind']??null)===$kind));
}
function af_media_meta(array $row):array {
    return [
        'id'=>$row['id'],'kind'=>$row['kind'],'sku'=>$row['sku']??null,
        'name'=>$row['name'],'width_cm'=>$row['width_cm']??null,
        'height_cm'=>$row['height_cm']??null,'created'=>$row['created'],
        'url'=>'/api/media.php?kind='.rawurlencode($row['kind']).'&id='.rawurlencode($row['id']),
    ];
}
function af_media_update(?array $account,callable $callback):?array {
    if ($account===null) {
        $rows=is_array($_SESSION['affresco_media_assets']??null)?$_SESSION['affresco_media_assets']:[];
        $next=$callback($rows);
        if(!is_array($next))return null;
        $_SESSION['affresco_media_assets']=$next;
        return $next;
    }
    $path=af_accounts_path();
    $h=@fopen($path,'c+');
    if(!$h||!flock($h,LOCK_EX)){if(is_resource($h))fclose($h);return null;}
    try {
        rewind($h);$raw=stream_get_contents($h);
        if(!is_string($raw)||strlen($raw)>1048576)return null;
        $parsed=json_decode($raw,true);
        if(!is_array($parsed))return null;
        $wrapped=isset($parsed['accounts'])&&is_array($parsed['accounts']);
        $list=$wrapped?$parsed['accounts']:$parsed;
        if(!is_array($list))return null;
        $updated=null;
        foreach($list as &$row){
            if(!is_array($row)||(string)($row['id']??'')!==(string)$account['id'])continue;
            $before=is_array($row['media_assets']??null)?$row['media_assets']:[];
            $updated=$callback($before);
            if(!is_array($updated))return null;
            $row['media_assets']=$updated;
            break;
        }
        unset($row);
        if($updated===null)return null;
        $out=json_encode($wrapped?array_replace($parsed,['accounts'=>$list]):$list,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);
        if(!is_string($out)||strlen($out)>1048576)return null;
        rewind($h);
        if(!ftruncate($h,0)||fwrite($h,$out."\n")!==strlen($out)+1||!fflush($h))return null;
        return $updated;
    } finally {flock($h,LOCK_UN);fclose($h);}
}
function af_media_safe_file(string $folder,string $id):string{
    return $folder.'/'.$id.'.jpg';
}
if ($method==='GET') {
    if(!isset($_GET['id'])) {
        $items=af_media_items($account,$kind);
        af_response(200,['items'=>array_map('af_media_meta',$items),'limit'=>$account?3:1,'scope'=>$account?'account':'guest']);
    }
    $id=(string)$_GET['id'];
    if(preg_match('/^[a-f0-9]{32}$/D',$id)!==1)af_response(404,['error'=>'not_found']);
    $item=null;
    foreach(af_media_items($account,$kind) as $row){if(hash_equals((string)($row['id']??''),$id)){$item=$row;break;}}
    if($item===null)af_response(404,['error'=>'not_found']);
    $path=af_media_safe_file($folder,$id);
    if(!is_file($path)||!is_readable($path))af_response(404,['error'=>'not_found']);
    header('Content-Type: image/jpeg');
    header('Content-Disposition: inline; filename="affresco-'.$kind.'-'.$id.'.jpg"');
    header('Content-Length: '.(string)filesize($path));
    readfile($path);
    exit;
}
af_guard_post();
$action=(string)($_POST['action']??'');
if($action==='delete'){
    $id=(string)($_POST['id']??'');
    if(preg_match('/^[a-f0-9]{32}$/D',$id)!==1)af_response(422,['error'=>'invalid_id']);
    $removed=false;
    $rows=af_media_update($account,static function(array $items)use($kind,$id,&$removed):array {
        $next=[];
        foreach($items as $row) {
            if(is_array($row)&&($row['kind']??'')===$kind&&($row['id']??'')===$id){$removed=true;continue;}
            $next[]=$row;
        }
        return $next;
    });
    if($rows===null)af_response(503,['error'=>'storage_unavailable']);
    if($removed)@unlink(af_media_safe_file($folder,$id));
    af_response(200,['deleted'=>$removed]);
}
if($action!=='upload')af_response(422,['error'=>'invalid_action']);
$upload=$_FILES['image']??null;
if(!is_array($upload)||($upload['error']??null)!==UPLOAD_ERR_OK||!is_uploaded_file((string)($upload['tmp_name']??'')))
    af_response(422,['error'=>'invalid_image']);
if(($upload['size']??0)<100||($upload['size']??0)>12*1024*1024)af_response(413,['error'=>'image_too_large']);
$info=@getimagesize((string)$upload['tmp_name']);
if(!is_array($info)||!in_array($info[2]??null,[IMAGETYPE_JPEG,IMAGETYPE_PNG,IMAGETYPE_WEBP],true)
    ||$info[0]<100||$info[1]<100||$info[0]*$info[1]>60000000)af_response(422,['error'=>'invalid_image']);
// Binary content is re-encoded in the browser as JPEG; server accepts JPEG only
// for persistence to prevent a MIME/extension mismatch or embedded active content.
if(($info[2]??null)!==IMAGETYPE_JPEG)af_response(422,['error'=>'jpeg_required']);
$name=trim((string)($_POST['name']??''));
if($name===''&&$kind==='fresco')$name='Моя фреска';
if($name==='')$name='Фото интерьера';
if(strlen($name)>255)$name=substr($name,0,255);
$replaceId=trim((string)($_POST['replace_id']??''));
if($replaceId!==''&&preg_match('/^[a-f0-9]{32}$/D',$replaceId)!==1)af_response(422,['error'=>'invalid_replace_id']);
$width=null;$height=null;$sku=null;
if($kind==='fresco'){
    $width=filter_var($_POST['width_cm']??null,FILTER_VALIDATE_FLOAT);
    $height=filter_var($_POST['height_cm']??null,FILTER_VALIDATE_FLOAT);
    if($width===false||$height===false||!is_finite($width)||!is_finite($height)||
        $width<30||$height<30||$width>1000||$height>1000)af_response(422,['error'=>'invalid_dimensions']);
}
if(!is_dir($folder)&&!@mkdir($folder,0700,true)&&!is_dir($folder))af_response(503,['error'=>'storage_unavailable']);
$id=bin2hex(random_bytes(16));
$sku='own-'.$id;
$entry=['id'=>$id,'kind'=>$kind,'name'=>$name,'created'=>time()];
if($kind==='fresco'){$entry['width_cm']=$width;$entry['height_cm']=$height;$entry['sku']=$sku;}
$target=af_media_safe_file($folder,$id);
if(!move_uploaded_file($upload['tmp_name'],$target))af_response(503,['error'=>'storage_unavailable']);
@chmod($target,0600);
$replacedId=null;$rejection=null;
$rows=af_media_update($account,static function(array $items)use($entry,$kind,$account,$replaceId,&$replacedId,&$rejection):?array {
    $selected=array_values(array_filter($items,static fn($x)=>is_array($x)&&($x['kind']??'')===$kind));
    $limit=$account?3:1;
    if($replaceId!==''){
        $found=false;
        foreach($items as $index=>$row){
            if(is_array($row)&&($row['kind']??'')===$kind&&($row['id']??'')===$replaceId){
                unset($items[$index]);$found=true;$replacedId=$replaceId;break;
            }
        }
        if(!$found){$rejection='replace_target_not_found';return null;}
    } elseif(count($selected)>=$limit){
        $rejection='media_limit_reached';return null;
    }
    $items[]=$entry;
    return array_values($items);
});
if($rows===null){@unlink($target);af_response($rejection?409:503,['error'=>$rejection??'storage_unavailable']);}
if($replacedId!==null)@unlink(af_media_safe_file($folder,$replacedId));
af_response(201,['item'=>af_media_meta($entry),'replaced_id'=>$replacedId,'limit'=>$account?3:1]);
