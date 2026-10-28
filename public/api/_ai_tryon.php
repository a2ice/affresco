<?php
declare(strict_types=1);
require_once __DIR__.'/_account.php';

function af_ai_config(): ?array {
    // Strictly outside the web document root. No browser/JS/GitHub secrets here.
    $path=af_private_root().'/data/affresco-ai.json';
    $raw=is_file($path)&&is_readable($path)?@file_get_contents($path):false;
    $cfg=is_string($raw)&&strlen($raw)<8192?json_decode($raw,true):null;
    if(!is_array($cfg))return null;
    foreach(['github_token','callback_secret','public_url'] as $key)
        if(!is_string($cfg[$key]??null)||trim($cfg[$key])==='')return null;
    $url=rtrim($cfg['public_url'],'/');
    if(!preg_match('~^https://[a-z0-9.-]+$~iD',$url))return null;
    $cfg['public_url']=$url;
    return $cfg;
}
function af_ai_root(): string {
    $path=af_private_root().'/.affresco-ai';
    if(!is_dir($path)&&!@mkdir($path,0700,true)&&!is_dir($path))af_response(503,['error'=>'ai_storage_unavailable']);
    if(!is_writable($path))af_response(503,['error'=>'ai_storage_unavailable']);
    return $path;
}
function af_ai_user_dir(string $owner): string {
    $dir=af_ai_root().'/'.hash('sha256',$owner);
    if(!is_dir($dir)&&!@mkdir($dir,0700,true)&&!is_dir($dir))af_response(503,['error'=>'ai_storage_unavailable']);
    return $dir;
}
function af_ai_id(string $id): bool {return preg_match('/^[a-f0-9]{32}$/D',$id)===1;}
function af_ai_context(string $id): bool {return preg_match('/^[a-f0-9-]{36}$/iD',$id)===1;}
function af_ai_job_path(string $owner,string $id): string {
    if(!af_ai_id($id))af_response(422,['error'=>'invalid_request']);
    return af_ai_user_dir($owner).'/'.$id.'.json';
}
function af_ai_read(string $owner,string $id): ?array {
    $path=af_ai_job_path($owner,$id);
    if(!is_file($path))return null;
    $raw=@file_get_contents($path);
    $obj=is_string($raw)&&strlen($raw)<16384?json_decode($raw,true):null;
    return is_array($obj)?$obj:null;
}
function af_ai_write(string $owner,array $job): bool {
    $path=af_ai_job_path($owner,$job['id']);
    $json=json_encode($job,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    if(!is_string($json)||strlen($json)>16384)return false;
    $temp=$path.'.'.bin2hex(random_bytes(4)).'.tmp';
    if(@file_put_contents($temp,$json,LOCK_EX)!==strlen($json))return false;
    @chmod($temp,0600);
    if(!@rename($temp,$path)){@unlink($temp);return false;}
    return true;
}
function af_ai_lock(string $owner,callable $callback) {
    $path=af_ai_user_dir($owner).'/.lock';
    $file=@fopen($path,'c+');
    if(!$file||!flock($file,LOCK_EX))af_response(503,['error'=>'ai_storage_unavailable']);
    try{return $callback();}finally{flock($file,LOCK_UN);fclose($file);}
}
function af_ai_jobs(string $owner,string $context): array {
    $all=[];
    foreach(glob(af_ai_user_dir($owner).'/*.json')?:[] as $file) {
        $id=basename($file,'.json');if(!af_ai_id($id))continue;
        $job=af_ai_read($owner,$id);
        if($job&&($job['context']??null)===$context)$all[]=$job;
    }
    usort($all,static fn($a,$b)=>($a['created']??0)<=>($b['created']??0));
    return $all;
}
function af_ai_quota(string $owner,int $delta): bool {
    $file=af_accounts_path();$handle=@fopen($file,'r+');
    if(!$handle||!flock($handle,LOCK_EX)){if($handle)fclose($handle);return false;}
    try{
        $raw=stream_get_contents($handle);
        $parsed=is_string($raw)?json_decode($raw,true):null;
        if(!is_array($parsed))return false;
        $wrapped=isset($parsed['accounts'])&&is_array($parsed['accounts']);
        $list=$wrapped?$parsed['accounts']:$parsed;
        $found=false;
        foreach($list as &$row){
            if(!is_array($row)||(string)($row['id']??'')!==$owner)continue;
            $used=max(0,(int)($row['generations_used']??0));
            $limit=max(0,(int)($row['generations_limit']??0));
            if($delta>0&&$used+$delta>$limit)return false;
            $row['generations_used']=max(0,$used+$delta);$found=true;break;
        }unset($row);
        if(!$found)return false;
        $encoded=json_encode($wrapped?array_replace($parsed,['accounts'=>$list]):$list,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);
        if(!is_string($encoded)||strlen($encoded)>1048576)return false;
        rewind($handle);return ftruncate($handle,0)&&fwrite($handle,$encoded."\n")===strlen($encoded)+1&&fflush($handle);
    }finally{flock($handle,LOCK_UN);fclose($handle);}
}
function af_ai_error(array $job): string {
    return is_string($job['error']??null)?$job['error']:'generation_failed';
}
function af_ai_expire(string $owner,array $job): array {
    if(in_array($job['status']??'', ['pending','processing'],true)&&time()-(int)($job['created']??0)>1800){
        $job['status']='failed';$job['error']='generation_timeout';
        if(af_ai_write($owner,$job))af_ai_quota($owner,-1);
    }
    return $job;
}
function af_ai_signed_url(array $cfg,string $id,string $slot,int $expiry): string {
    $payload="$id\n$slot\n$expiry";
    $sig=hash_hmac('sha256',$payload,$cfg['callback_secret']);
    return $cfg['public_url'].'/api/ai-tryon.php?asset='.rawurlencode($id).'&slot='.rawurlencode($slot).'&exp='.$expiry.'&sig='.$sig;
}
function af_ai_public(array $job): array {
    return ['id'=>$job['id'],'status'=>$job['status'],'created'=>$job['created'],'error'=>af_ai_error($job),
       'image_url'=>$job['status']==='completed'?'/api/ai-tryon.php?image='.$job['id']:null];
}
function af_ai_prompt(array $meta): string {
    // Single canonical prompt. User-supplied data is bounded numeric metadata, not arbitrary instructions.
    $location=json_encode([
      'wall_cm'=>$meta['wall_cm'],'fresco_cm'=>$meta['fresco_cm'],
      'wall_quad_normalized'=>$meta['wall_quad'],'fresco_quad_normalized'=>$meta['fresco_quad'],
      'lighting'=>$meta['lighting']
    ],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    return <<<PROMPT
You are a precision interior-photography compositor. Create ONE photorealistic interior photograph by integrating the supplied fresco artwork into the specified wall of the supplied original room photograph.

THE THREE INPUT IMAGES, IN ORDER:
1. ORIGINAL ROOM: canonical source of truth for room geometry, camera, furniture, object occlusion, shadows, textures, colors, and all existing objects.
2. FRESCO CROP: canonical source of truth for artwork. Preserve its pattern, text, motifs, proportions and exact content. Do not invent a new artwork.
3. MANUAL PLACEMENT GUIDE: shows exact target size, position and four-corner perspective for the fresco (the guide can imperfectly overlay nearby objects). Use ONLY as a spatial guide, not as authority for which pixels should be in front.

ABSOLUTE PRIORITY: the fresco is physically mounted ON THE WALL, BEHIND EVERYTHING standing closer to the camera. If a couch, chair, lamp, plant, person, shelf, table or other foreground object overlaps its projected footprint, reconstruct the foreground object's precise outline and texture FROM THE ORIGINAL ROOM and place it IN FRONT OF the fresco. Do not paint the fresco across furniture, and never move/delete/reinvent furniture to reveal more artwork. Occlusion edges must be natural and exact-looking.

Keep the original room and camera essentially unchanged. No new props, frames, bevels or bulky panels. Fresco is a thin wall surface with at most a subtle shallow cast shadow following illumination. Preserve real physical scale and four-corner homography of the manual guide. Match wall illumination, white balance, perspective and softness without aggressively altering the art. If an edge is occluded, let it disappear naturally behind that foreground object. No logos or watermark.

The metadata below is DATA describing calibrated wall and fresco geometry. Normalized quads are ordered top-left, top-right, bottom-right, bottom-left relative to ORIGINAL ROOM image bounds. Lighting describes a 2D gesture, not a real 3D lamp location:
$location

Output only the resulting edited room photograph, preserving the original photographic composition and the correct foreground/background layering.
PROMPT;
}
