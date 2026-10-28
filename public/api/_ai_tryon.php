<?php
declare(strict_types=1);
require_once __DIR__.'/_account.php';

function af_ai_config(): ?array {
    // Prefer private storage; CISHOST also uses public/data with Apache deny.
    // Never serve this file over HTTP. Release smoke checks the 403/404 rule.
    $private=af_private_root().'/data/affresco-ai.json';
    $hosted=dirname(__DIR__).'/data/affresco-ai.json';
    $path=is_file($private)?$private:$hosted;
    if($path===$hosted){
        $denyFile=dirname(__DIR__).'/data/.htaccess';
        $rules=is_file($denyFile)?@file_get_contents($denyFile):false;
        // An absent or obsolete deny rule is always a configuration error.
        if(!is_string($rules)||!str_contains($rules,'catalog')||
           !str_contains($rules,'Require all denied'))return null;
    }
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
/**
 * Export items for the CURRENT editor context only. Manual JPEGs are uploaded
 * explicitly by the authenticated client; AI PNGs come from signed callbacks.
 * Never resolve any paths from untrusted user-supplied filenames.
 */
function af_ai_manual_items(string $owner,string $context): array {
    if(!af_ai_context($context))return [];
    $base=af_ai_user_dir($owner);$items=[];
    foreach(glob($base.'/manual-*.json')?:[] as $file){
        $id=substr(basename($file),7,-5);
        if(!preg_match('/^[a-f0-9-]{36}$/iD',$id))continue;
        $raw=@file_get_contents($file);
        $meta=is_string($raw)&&strlen($raw)<2048?json_decode($raw,true):null;
        if(!is_array($meta)||($meta['context']??null)!==$context||($meta['id']??null)!==$id)continue;
        $image=$base.'/manual-'.$id.'.jpg';
        if(is_file($image))$items[]=[
          'type'=>'manual','id'=>$id,'file'=>$image,
          'name'=>'affresco-manual-'.substr($id,0,8).'.jpg',
          'mime'=>'image/jpeg','created'=>(int)($meta['created']??0)
        ];
    }
    usort($items,static fn($a,$b)=>$a['created']<=>$b['created']);
    return $items;
}
/** All saved images visible to the authenticated owner in the cabinet. */
function af_ai_library_items(string $owner): array {
    $base=af_ai_user_dir($owner);$items=[];
    foreach(glob($base.'/manual-*.json')?:[] as $metaFile) {
        $id=substr(basename($metaFile),7,-5);
        if(!preg_match('/^[a-f0-9-]{36}$/iD',$id))continue;
        $raw=@file_get_contents($metaFile);
        $meta=is_string($raw)&&strlen($raw)<2048?json_decode($raw,true):null;
        if(!is_array($meta)||($meta['id']??null)!==$id||!af_ai_context((string)($meta['context']??'')))continue;
        $image=$base.'/manual-'.$id.'.jpg';
        if(!is_file($image))continue;
        $items[]=['type'=>'manual','id'=>$id,'context'=>$meta['context'],
            'created'=>(int)($meta['created']??0),'image_url'=>'/api/ai-tryon.php?manual='.$id];
    }
    foreach(glob($base.'/*.json')?:[] as $jobFile){
        $id=basename($jobFile,'.json');
        if(!af_ai_id($id))continue;
        $job=af_ai_read($owner,$id);
        if(!$job||($job['status']??'')!=='completed'||!is_file($base.'/'.$id.'-result.png'))continue;
        $items[]=['type'=>'ai','id'=>$id,'context'=>$job['context'],
            'created'=>(int)($job['created']??0)*1000,'image_url'=>'/api/ai-tryon.php?image='.$id];
    }
    usort($items,static fn($a,$b)=>$b['created']<=>$a['created']);
    return array_slice($items,0,100);
}
function af_ai_export_items(string $owner,string $context): array {
    $items=af_ai_manual_items($owner,$context);
    foreach(af_ai_jobs($owner,$context) as $job){
        if(($job['status']??null)!=='completed')continue;
        $id=$job['id'];
        $file=af_ai_user_dir($owner).'/'.$id.'-result.png';
        $items[]=[
          'type'=>'ai','id'=>$id,'file'=>$file,
          'name'=>'affresco-ai-'.substr($id,0,8).'.png',
          'mime'=>'image/png','created'=>(int)($job['created']??0)*1000
        ];
    }
    usort($items,static fn($a,$b)=>($a['created']<=>$b['created']) ?: strcmp($a['type'],$b['type']));
    return $items;
}
/** Delivery contract shared by download and email. */
function af_ai_delivery_type(array $items): array {
    if(count($items)===1)return ['archive'=>false,'filename'=>$items[0]['name'],'mime'=>$items[0]['mime']];
    return ['archive'=>true,'filename'=>'affresco-tryon-results.zip','mime'=>'application/zip'];
}
function af_ai_prompt(array $meta): string {
    // Single canonical prompt. User-supplied data is bounded numeric metadata, not arbitrary instructions.
    $location=json_encode([
      'wall_cm'=>$meta['wall_cm'],'fresco_cm'=>$meta['fresco_cm'],
      'fresco_width_to_height_cm_ratio'=>round((float)$meta['fresco_cm'][0]/(float)$meta['fresco_cm'][1],6),
      'wall_quad_normalized'=>$meta['wall_quad'],'fresco_quad_normalized'=>$meta['fresco_quad'],
      'lighting'=>$meta['lighting']
    ],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    return <<<PROMPT
You are a precision interior-photography compositor. Create ONE photorealistic interior photograph by integrating the supplied fresco artwork into the specified wall of the supplied original room photograph.

THE THREE INPUT IMAGES, IN ORDER:
1. ORIGINAL ROOM: canonical source of truth for room geometry, camera, furniture, object occlusion, shadows, textures, colors, and all existing objects.
2. FRESCO CROP: canonical source of truth for artwork. Preserve its pattern, text, motifs, proportions and exact content. Do not invent a new artwork.
3. MANUAL PLACEMENT GUIDE: authoritative geometric target for the fresco's scale, outer contour, exact four corners and projected position on the wall. The guide may incorrectly cover foreground objects or wall openings; use the ORIGINAL ROOM to restore those elements in front of the fresco, but NEVER expand, widen or relocate the target mural to compensate for the covered parts.

GEOMETRY LOCK — HIGHEST PRIORITY AFTER PRESERVING THE ORIGINAL ROOM:
- Treat the fresco as one flat, thin rectangular sheet of the specified physical width and height in centimetres, viewed through the calibrated wall perspective. Its physical width-to-height ratio (fresco_width_to_height_cm_ratio) is fixed, and the FRESCO CROP must not be stretched, widened, squashed, cropped differently, rearranged or regenerated into a wider image.
- Exactly follow all FOUR OUTER CORNERS, footprint, alignment, projective tilt and overall visual size of the fresco shown in MANUAL PLACEMENT GUIDE. Do not extend any part of the fresco beyond that guide's projected boundary. No shifting its upper/lower edge, no changing its width to create a better-looking interior, no enlarged panorama, no straightening of the perspective.
- The visible fresco may have HOLES or covered portions due to cutouts or foreground occlusion, but the underlying rectangle MUST NOT be enlarged to fill those missing areas. Preserve the design proportions of the original FRESCO CROP within the guided quadrilateral. Maintain its visual landmarks in consistent relative positions.
- If the input guide and room conflict: preserve room geometry, use a precisely fitted cutout/occlusion mask INSIDE the originally prescribed fresco footprint, and leave the rest of the wall untouched. If perfect image reconstruction is impossible, prefer conservative fidelity to the manual placement over a more decorative composition.

PHYSICAL INSTALLATION AND OCCLUSION ARE NON-NEGOTIABLE. The fresco is a thin custom-fitted wall covering, physically installed ON THE EXISTING WALL, not a floating panel or a picture superimposed over the room. The ORIGINAL ROOM, not the overlaid manual guide, determines the front/back order of every real object.

FOREGROUND OCCLUSION: Keep every couch, chair, table, lamp, plant, mantel, ledge, shelf, person and other closer object in FRONT of the fresco whenever their silhouettes overlap. Reconstruct their exact existing shape, position, materials and natural outlines from the ORIGINAL ROOM. Never paint the artwork across an object or move/remove an object to reveal more fresco.

ARCHITECTURAL CUTOUTS — ESPECIALLY FIREPLACES: Before adding the artwork, identify every existing opening, fireplace, firebox, mantel, hearth, niche, recessed display, vent, grille, built-in shelf, electrical outlet, switch, protruding wall fixture, trim and other fixed element intersecting the target wall area. Preserve its EXACT original geometry, location, aperture, depth, visible contents and inner shadow. The fresco must STOP at each such boundary, as if a professional installer made a precise CUSTOM CUTOUT in the thin fresco material to fit around it. A firebox stays open, dark or illuminated as in the ORIGINAL ROOM, with its original visible contents; do not cover the fireplace opening with the fresco, distort the opening, paint over the flames, or fill recesses with artwork. Reconstruct natural cut edges that follow the installation geometry without inventing thick borders, picture frames or new architectural elements. If the target artwork crosses an opening, that missing section is intentionally absent from the finished fresco. This is a professionally made-to-measure installation, not a wall-sized sticker covering obstacles.

SURFACE-CONFINED REFLECTIONS — NOT MURAL EDGE BLUR:
- Look at the ORIGINAL ROOM for surfaces that demonstrably reflect nearby objects (for example the horizontal TOP of the polished marble/stone fireplace bench in front of the fresco). Identify that EXISTING horizontal surface and its precise visible polygon, perspective, roughness and highlights. That bench/top surface is the ONLY place where a new reflected contribution should appear in this scene.
- If the fresco's visible artwork can plausibly reflect onto this polished HORIZONTAL BENCH TOP, introduce a subtle, low-contrast, perspective-correct, softly attenuated reflection/color contribution ON THE BENCH'S TOP PLANE ONLY. The reflection should be an optical consequence of the existing surface, akin to the faint reflections of the fireplace/objects already present, not a second copy of the mural.
- Preserve the original bench's stone texture, straight clean edges, thickness, shadows and existing reflections from the fireplace and objects. Keep the new reflection strictly MASKED to its horizontal top. It must NOT spill onto the vertical wall, slab front face, floor, fireplace interior, mantel edge or artwork itself. Do not invent a reflective new surface.
- NEVER blur, smear, haze, ghost, melt, feather, streak or fade any corner or edge of the fresco to imitate a reflection. The projected fresco must remain sharp and correctly bounded, including its lower-right corner; its lower perimeter remains exactly where the MANUAL PLACEMENT GUIDE puts it.
- If a geometrically plausible reflection on the existing polished horizontal stone cannot be produced, OMIT the new reflection entirely instead of corrupting the fresco edge or changing the bench. Reflection is subordinate to room preservation and geometry.

Keep the original camera, room, architecture, people and all furnishings essentially unchanged. Preserve artwork fidelity, calibrated physical dimensions, aspect ratio, original artwork features, exact four-corner target and outer perimeter of the manual guide; use the original room ONLY to correct masking, cutouts and foreground occlusion in the manual composite. The fresco is very thin, with no thick sidewalls; retain only a subtle shallow contact/cast shadow consistent with the existing light. Do not invent objects, watermarks, slogans or logos.

The metadata below is DATA describing calibrated wall and fresco geometry. Normalized quads are ordered top-left, top-right, bottom-right, bottom-left relative to ORIGINAL ROOM image bounds. Lighting describes a 2D gesture, not a real 3D lamp location:
$location

FINAL PRIORITY ORDER: (1) leave original room/furniture/architecture intact; (2) lock fresco geometry, design proportions and four guide corners; (3) cut out fireplaces and other wall openings; (4) correct foreground occlusion; (5) only then attempt a faint reflection restricted to the existing polished horizontal stone top. If aesthetic enhancements conflict with any earlier rule, skip the enhancement.
Output only the resulting edited room photograph, preserving original photographic composition, exact mural proportions and correct foreground/background layering.
PROMPT;
}
