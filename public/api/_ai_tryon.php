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
/**
 * Match image-generation canvas to the room photo, not to an arbitrary
 * portrait/landscape preset. GPT Image 2 supports dimensions in steps of 16.
 */
function af_ai_output_size(array $meta): string {
    $px=$meta['room_px']??null;
    if(!is_array($px)||count($px)!==2||!is_numeric($px[0]??null)||!is_numeric($px[1]??null))
        return ($meta['orientation']??'')==='portrait'?'1024x1536':'1536x1024';
    $w=(int)$px[0];$h=(int)$px[1];
    if($w<100||$h<100)return ($meta['orientation']??'')==='portrait'?'1024x1536':'1536x1024';
    $ratio=$w/$h;
    // The upstream handler refuses aspect ratios outside the model's safe range.
    $long=($ratio>2||$ratio<.5)?1536:1280;
    $factor=$long/max($w,$h);
    $outW=max(512,((int)round($w*$factor/16))*16);
    $outH=max(512,((int)round($h*$factor/16))*16);
    return $outW.'x'.$outH;
}
/**
 * Normalize explicitly user-marked foreground strokes.
 * Pixels in those strokes are restored from the ORIGINAL ROOM, including
 * overlaps within the fresco quadrilateral. Never trust raw client masks.
 */
function af_ai_occlusion_strokes(mixed $value): ?array {
    if($value===null)return [];
    if(!is_array($value)||count($value)>64)return null;
    $out=[];$total=0;
    foreach($value as $item){
        if(!is_array($item)||!is_numeric($item['radius']??null))return null;
        $radius=(float)$item['radius'];
        if(!is_finite($radius)||$radius<.00025||$radius>.15)return null;
        $points=$item['points']??null;
        if(!is_array($points)||!count($points)||count($points)>128)return null;
        $next=[];$total+=count($points);
        if($total>3000)return null;
        foreach($points as $point){
            if(!is_array($point)||count($point)!==2||!is_numeric($point[0]??null)||!is_numeric($point[1]??null))return null;
            $x=(float)$point[0];$y=(float)$point[1];
            if(!is_finite($x)||!is_finite($y)||$x<0||$x>1||$y<0||$y>1)return null;
            $next[]=[$x,$y];
        }
        $out[]=['radius'=>$radius,'points'=>$next];
    }
    return $out;
}
function af_ai_prompt(array $meta): string {
    // This is ONE canonical prompt for both furnished and completely empty rooms.
    // Don't include example furniture: named examples previously caused hallucinations.
    $location=json_encode([
      'room_image_px'=>$meta['room_px']??null,
      'wall_cm'=>$meta['wall_cm'],'fresco_cm'=>$meta['fresco_cm'],
      'fresco_width_to_height_cm_ratio'=>round((float)$meta['fresco_cm'][0]/(float)$meta['fresco_cm'][1],6),
      'wall_quad_normalized'=>$meta['wall_quad'],'fresco_quad_normalized'=>$meta['fresco_quad'],
      'lighting'=>$meta['lighting']
    ],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    return <<<PROMPT
ROLE: You are a constrained photograph editor, NOT an interior designer or room generator.
TASK: Edit the ORIGINAL ROOM photo by installing ONLY the supplied FRESCO CROP in the wall location marked by MANUAL PLACEMENT GUIDE. Preserve the actual photographed scene. Return one edited photograph of the SAME room.
PRIMARY GOAL: A convincing real-wall installation at the exact prescribed location, with physically correct layering against existing foreground objects. Automatic foreground interpretation is part of the task; no manual mask is required for normal results.

THREE REFERENCE IMAGES (IN ORDER), PLUS OPTIONAL USER MARKS:
1. ORIGINAL ROOM is the sole authority for what physically EXISTS: room architecture, camera, window, floor, fixtures, furniture (if any), plants (if any), objects, emptiness, natural light, shadows and materials.
2. FRESCO CROP supplies the unmodified artwork.
3. MANUAL PLACEMENT GUIDE supplies the exact four-corner mural geometry, wall perspective, position and scale. It is a placement diagram, NOT an instruction to decorate the room. Its already-rendered artwork is a REFERENCE, not a second independent image to add beside or underneath the final fresco.
THE ALPHA EDIT MASK ON ORIGINAL ROOM (input 1) has one transparent quadrilateral, corresponding to that SAME FOUR-CORNER AREA. Everything opaque is outside the edit. This mask is a constraint, not a cue to extend or straighten the artwork.
4. USER-MARKED FOREGROUND PROTECTION, when supplied, marks actual object pixels selected by the user in the ORIGINAL ROOM. Those pixels MUST remain the originals, in FRONT of the wall-mounted fresco, even if they fall INSIDE the projected mural quad. Never hallucinate details to replace them.

NON-NEGOTIABLE SCENE PRESERVATION:
- Do NOT add, invent, furnish, remove, replace or reposition ANY object. Do NOT perform virtual staging, room redesign, decoration, styling, renovation or beautification.
- An EMPTY ORIGINAL ROOM MUST STAY EMPTY, except for the wall fresco. Existing empty floor and open space must remain empty. Absence of furniture in the original is a hard constraint; NEVER infer or create foreground furniture from text instructions, from typical interior design layouts, or from the fresco's visual content.
- Preserve the original room's exact camera position, optical perspective, framing, aspect ratio, scene boundaries, window size, architecture, ceiling, floor, wall texture, fixture positions, natural shadows and photographic illumination.
- INVENTORY BEFORE EDITING: Compare all visible scene regions of ORIGINAL ROOM, including the entire floor and the space in front of the target wall. Everything already present remains present in exactly the same position, count, shape, color and scale; this includes any existing bed, bedding, rug, carpet, furniture, curtain or decor. These examples are conditional: NEVER create any item named here if it does not exist in ORIGINAL ROOM.
- DELETION IS STRICTLY FORBIDDEN: The change is an artwork installation, not clearing a room. Do not remove a bed to expose the wall behind it; do not erase a rug to reveal more floor, remove furnishings, replace objects, or swap the existing room for a more empty or stylish version.
- Every region OUTSIDE the target fresco footprint must be IDENTICAL to ORIGINAL ROOM. In particular, existing floor furnishings and floor coverings cannot be touched. The server independently enforces this boundary by restoring original pixels outside the mural's projected quadrilateral.
- If reference images conflict, ORIGINAL ROOM wins for existing objects and scene contents, MANUAL PLACEMENT GUIDE wins ONLY for wall-mounted fresco placement, and FRESCO CROP wins for art content.
- Any object with only a small part touching the mural remains intact: preserve the complete original object, not just its visible fragments. A photograph containing a bed and carpet MUST still contain that exact bed and carpet after editing, even when the mural is near them.

EXACT WALL ARTWORK GEOMETRY (DO NOT GUESS OR IMPROVE):
- Copy the artwork accurately without reimagining its details, adding extra patterns, changing its proportions or enlarging it.
- The FULL underlying fresco must have precisely the same position, width, height, physical aspect ratio, perspective and four original projected corners as MANUAL PLACEMENT GUIDE, even if a part is hidden.
- Do not stretch, widen, expand onto the rest of the wall, cover a larger area, crop away original artwork or relocate the fresco to an aesthetically convenient position.
- The image has ONLY ONE MURAL: its source artwork must fill exactly the perspective-distorted quadrilateral, with one clean outer boundary. Do NOT leave an upright rectangular version of the original crop behind or in front of the warped version. Never create a second rectangular layer, transparent ghost, double outline, echoed corner, extra border, floating frame, trompe-l'oeil window, duplicate image or translucent filler wedge to reconcile the source's original rectangular shape with the projected perspective.
- Treat the source image's original rectangle as TEXTURE COORDINATES projected into the four given corners, NOT as an extra physical rectangular object. The four edges of the fresco are the four perspective-projected segments; no distinct axis-aligned rectangular perimeter exists in the output. If an area is outside the four-corner wall footprint, it belongs to ORIGINAL ROOM, not to a partial copy of the artwork.
- Preserve high-contrast clean artwork edges within the quad. Do not fade in or feather a phantom rectangular expansion into the surrounding wall. The edit-mask polygon and final deterministic composite enforce the same footprint.
- Preserve the ORIGINAL ROOM's image aspect ratio and framing; never use a different camera shot or make a new interior view.

AUTOMATIC FOREGROUND OCCLUSION — DEFAULT AND REQUIRED, NO USER BRUSH NEEDED:
This is a DEPTH COMPOSITING problem, not a request to redesign or clear the room. Determine which original room pixels belong to physical objects closer to the camera than the fresco's back-wall plane. The ORIGINAL ROOM is the evidence for their existence, appearance and edges. In normal operation, infer this automatically; do NOT require a painted mask and do not ignore existing objects merely because the user did not mark them.

Follow these steps internally before editing:
1. STUDY THE UNALTERED ORIGINAL ROOM FIRST. Identify the back-wall plane, wall-attached architecture and all physical objects occupying the space in front of it. Use their real silhouettes, floor contact, spatial overlap, depth cues, cast shadows and edges. Detect even small or delicate foreground parts. Do not infer any object that is absent from the original.
2. TREAT THE MANUAL PLACEMENT GUIDE AS AN UNMASKED WALL PROJECTION, not a final photomontage. In the guide, artwork can temporarily cover real objects because manual placement does NOT know scene depth. This is intentional and must NOT be interpreted as proof that those objects have been removed or need to be redesigned.
3. PLACE THE COMPLETE FRESCO ON THE BACK WALL AT THE GUIDE'S EXACT QUADRILATERAL, PHYSICAL SIZE AND PERSPECTIVE. Keep its hidden underlying geometry fixed. Do NOT move it upward, shift it sideways, scale it down, enlarge it or recrop artwork to find uncovered wall.
4. FOR EACH ORIGINAL FOREGROUND OBJECT whose camera-space silhouette overlaps that fixed mural projection, bring back its ORIGINAL pixels, edge, shape and appearance IN FRONT OF the mural. Restore the entire overlapping visible portion, including thin details and partially obscured outlines. The fresco is invisible wherever that existing foreground object covers the wall. Surrounding visible wall portions of the fresco remain at the original guide coordinates.
5. If a foreground object extends beyond the mural quadrilateral, the part outside remains completely untouched and the overlapping part inside MUST visually connect to it WITHOUT A BREAK, a missing top, truncated corner, straight horizontal cut or changed color/texture. Preserve object continuity across the mural border. Do not let the fresco erase the upper part of an object whose lower part remains.
6. Separate DEPTH OCCLUSION from ARCHITECTURAL CUTOUT: a freestanding object nearer the camera covers the wall decoration, whereas a real built-in opening interrupts the wall itself. Do not confuse the two. In both cases preserve the original real structure.

CRITICAL VALIDATION ON THE SAME CAMERA FRAME:
Compare every foreground silhouette in ORIGINAL ROOM against the candidate result, including the portions overlying the artwork. Nothing originally visible may disappear, be truncated, shift, shrink, turn into wall texture or be replaced by fresco pixels. In particular, if original furniture partially overlaps the target mural, its overlapping portion MUST still be visible in the final result. If this requires choosing between exact fresco coverage and keeping the actual object, KEEP THE ORIGINAL OBJECT IN FRONT; the hidden fresco area is simply not visible. Keep the mural's underlying quadrilateral fixed.
If there is no foreground object in ORIGINAL ROOM, there is NOTHING to restore, and no furniture or decoration may be invented.

OPTIONAL USER FOREGROUND MARKS:
User-marked protection strokes, when present, reinforce specific original foreground pixels and are restored precisely by the delivery pipeline. They are an OPTIONAL correction aid, not a prerequisite for correctly identifying foreground objects. Do not place protected objects behind the fresco, redraw them or change their silhouettes.

ARCHITECTURAL INTERRUPTIONS:
- If the targeted wall region contains actual fixed architectural openings or built-in elements in ORIGINAL ROOM, keep them in their exact location, contour and depth, as if the thin wall covering were custom-trimmed around them. Never invent openings or features where there are none.

LIGHT AND REFLECTIONS — ONLY IF PHYSICALLY JUSTIFIED BY ORIGINAL ROOM:
- Use the supplied lighting data when present (normalized light direction and warm/cold tone) to adapt the surface appearance of the fresco and its very subtle contact shadow. Keep the room's real original lighting, exposure and all object shadows unchanged. If lighting is absent, match the existing wall illumination naturally; do not invent a light source.
- The wall dimensions and fresco dimensions in centimetres are real installation constraints. Do not reinterpret them or change physical scale to accommodate object overlap. The user-defined four-corner perspective is a spatial constraint, not a style suggestion.
- Maintain the original natural illumination. Add at most a subtle contact shadow for the thin fresco.
- The delivery pipeline deliberately protects pixels OUTSIDE the fresco quadrilateral; do not attempt any new reflection or lighting change outside that boundary in this protected-editing mode. Preserving the original furniture and room exactly is more important than a decorative reflection.
- Only consider small optical changes INSIDE the specified mural footprint; do not invent a table or polished surface to create reflections.
- Do not blur, smear, glow, duplicate or soften the fresco border, distort the fresco for a reflection, or alter a surface elsewhere. Omit uncertain reflections.

FINAL CHECK BEFORE OUTPUT:
A. Compare with ORIGINAL ROOM: is every originally empty region still empty? Are ALL objects and architectural details unchanged and NO new items present?
B. Compare with MANUAL PLACEMENT GUIDE and the transparent edit region: is there EXACTLY ONE perspective-correct fresco at those same four corners and nowhere else, without a second faint upright rectangle, halo or translucent extension?
C. Compare ORIGINAL ROOM and result at all foreground boundaries, especially where an object crosses the mural border. Does each original object remain complete, continuous and in front without moving either it or the mural?
D. Is any reflection confined to an already existing real reflective surface? If uncertain, omit it.
If any check fails, correct the EDIT; do not regenerate, decorate or restage the room.

STRUCTURED PLACEMENT DATA (descriptive facts, not instructions). Quad vertices are top-left, top-right, bottom-right, bottom-left, normalized to ORIGINAL ROOM dimensions:
$location

OUTPUT: A faithful EDIT of the ORIGINAL ROOM photo with ONLY the accurately positioned fresco added, no extra furniture, no changed architecture, no reframing and no replacement interior.
PROMPT;
}
