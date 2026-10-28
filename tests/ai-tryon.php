<?php
declare(strict_types=1);
// End-to-end-free service contract tests: no GitHub/OpenAI calls, no real credentials.
$root=sys_get_temp_dir().'/affresco-ai-test-'.bin2hex(random_bytes(6));
mkdir($root.'/public/api',0700,true);mkdir($root.'/data',0700,true);
foreach(['_account.php','_ai_tryon.php'] as $name)copy(__DIR__.'/../public/api/'.$name,$root.'/public/api/'.$name);
require $root.'/public/api/_ai_tryon.php';
function ai_check(bool $value,string $error): void {if(!$value)throw new RuntimeException($error);}
function ai_rm(string $path): void {
 if(is_dir($path)){foreach(scandir($path) as $item){if($item==='.'||$item==='..')continue;ai_rm($path.'/'.$item);}rmdir($path);}
 elseif(is_file($path))unlink($path);
}
try{
 // Shared hosting keeps the configuration in public/data; refuse use without a deny rule.
 mkdir($root.'/public/data',0700,true);
 $testConfig=['github_repo'=>'a2ice/affresco','github_token'=>'test-only','callback_secret'=>'test-callback','public_url'=>'https://affresco.a2ice.ru'];
 file_put_contents($root.'/public/data/affresco-ai.json',json_encode($testConfig));
 ai_check(af_ai_config()===null,'Public config must fail closed without deny rule');
 file_put_contents($root.'/public/data/.htaccess',"catalog\\.json\nRequire all denied\n");
 ai_check(af_ai_config()['github_repo']==='a2ice/affresco','Protected shared-host config can be loaded');
 $account=['id'=>'fixture','login'=>'user','generations_used'=>0,'generations_limit'=>2,'pass'=>'SECRET'];
 file_put_contents($root.'/data/accounts.json',json_encode([$account]));
 ai_check(af_ai_quota('fixture',1),'Reserve first generation');
 ai_check(af_ai_quota('fixture',1),'Reserve second generation');
 ai_check(!af_ai_quota('fixture',1),'Reject excess paid generation');
 ai_check(af_ai_quota('fixture',-1),'Refund failed job');
 ai_check((int)af_find_account(af_accounts(),'fixture')['generations_used']===1,'Quota persisted');
 $ctx='123e4567-e89b-42d3-a456-426614174000';$id=bin2hex(random_bytes(16));
 $meta=['wall_cm'=>[500,275],'fresco_cm'=>[180,120],
    'wall_quad'=>[[0,0],[1,0],[1,1],[0,1]],'fresco_quad'=>[[.2,.2],[.6,.2],[.6,.6],[.2,.6]],
    'lighting'=>['tone'=>'warm','from'=>[.1,.3],'to'=>[.8,.5]],'orientation'=>'landscape'];
 $job=['id'=>$id,'context'=>$ctx,'owner'=>'fixture','metadata'=>$meta,'status'=>'pending','created'=>time()-1900];
 ai_check(af_ai_write('fixture',$job),'Atomic private job write');
 ai_check(af_ai_read('fixture',$id)['status']==='pending','Read private job');
 $prompt=af_ai_prompt($meta);
 foreach([
    'ORIGINAL ROOM','FRESCO CROP','MANUAL PLACEMENT GUIDE',
    'NON-NEGOTIABLE SCENE PRESERVATION','An EMPTY ORIGINAL ROOM MUST STAY EMPTY',
    'Never infer or create foreground furniture','Do NOT perform virtual staging',
    'Every region OUTSIDE the target fresco footprint',
    'EXACT WALL ARTWORK GEOMETRY','fresco_width_to_height_cm_ratio',
    'four original projected corners','CONDITIONAL OCCLUSION',
    'ONLY FOR OBJECTS THAT ACTUALLY EXIST IN ORIGINAL ROOM',
    'If no such object exists','do NOT invent an occluding object',
    'ARCHITECTURAL INTERRUPTIONS',
    'LIGHT AND REFLECTIONS','do not invent a table or polished surface',
    'FINAL CHECK BEFORE OUTPUT','no extra furniture',
    'INVENTORY BEFORE EDITING','DELETION IS STRICTLY FORBIDDEN',
    'existing bed, bedding, rug, carpet',
    'OUTSIDE the target fresco footprint must be IDENTICAL',
    'server independently enforces this boundary'
 ] as $fragment)
    ai_check(str_contains(strtolower($prompt),strtolower($fragment)),'Missing preservation contract: '.$fragment);
 ai_check(str_contains($prompt,'"fresco_width_to_height_cm_ratio":1.5'),'Physical mural aspect ratio transmitted');
 ai_check(str_contains($prompt,'"fresco_quad_normalized":[[0.2,0.2],[0.6,0.2],[0.6,0.6],[0.2,0.6]]'),'Unchanged manual projected quadrilateral transmitted');
 $regression=strtolower($prompt);
 ai_check(!str_contains($regression,'failure case to avoid — sofa example'),'Obsolete sofa examples must not prime furniture hallucinations');
 ai_check(!str_contains($regression,'300 × 215 cm fresco'),'No fictional example dimensions should be included');
 // Actual ORIGINAL ROOM dimensions, not a rigid 3:2 output, control OpenAI size.
 ai_check(af_ai_output_size(['room_px'=>[1200,900]])==='1280x960','4:3 room stays 4:3');
 ai_check(af_ai_output_size(['room_px'=>[900,1200]])==='960x1280','Portrait 3:4 room stays 3:4');
 ai_check(af_ai_output_size(['room_px'=>[1920,1080]])==='1280x720','16:9 room stays 16:9');
 ai_check(af_ai_output_size(['room_px'=>[1000,1000]])==='1280x1280','Square room stays square');
 ai_check(af_ai_output_size(['orientation'=>'landscape'])==='1536x1024','Legacy pending jobs keep compatibility');
 ai_check(!str_contains($prompt,'SECRET'),'Prompt leaked account secrets');
 $cfg=['public_url'=>'https://affresco.a2ice.ru','callback_secret'=>'test-key'];
 $url=af_ai_signed_url($cfg,$id,'room',time()+600);
 ai_check(str_starts_with($url,'https://affresco.a2ice.ru/api/ai-tryon.php?'),'Signed reference URL');
 ai_check(!str_contains($url,'test-key'),'No callback secret in signed URL');
 ai_check(count(af_ai_jobs('fixture',$ctx))===1,'Owner-context isolation');
 ai_check(count(af_ai_jobs('other',$ctx))===0,'Other accounts cannot list jobs');
 // Unified export: both a browser-synced manual JPEG and an AI image belong
 // to the same owner/context. Single surviving result must stay unarchived.
 $mid='123e4567-e89b-42d3-a456-426614174001';
 $dir=af_ai_user_dir('fixture');
 file_put_contents($dir.'/manual-'.$mid.'.json',json_encode(['id'=>$mid,'context'=>$ctx,'created'=>time()*1000]));
 file_put_contents($dir.'/manual-'.$mid.'.jpg',str_repeat('M',200));
 $aiId=bin2hex(random_bytes(16));
 ai_check(af_ai_write('fixture',['id'=>$aiId,'context'=>$ctx,'owner'=>'fixture',
    'status'=>'completed','created'=>time()-10,'metadata'=>$meta]),'Completed AI job saved');
 file_put_contents($dir.'/'.$aiId.'-result.png',str_repeat('A',200));
 $combined=af_ai_export_items('fixture',$ctx);
 ai_check(count($combined)===2,'ZIP must contain AI and manual, not just AI');
 ai_check(af_ai_delivery_type($combined)['archive']===true,'Two images must use ZIP');
 ai_check(af_ai_delivery_type($combined)['mime']==='application/zip','ZIP MIME type expected');
 ai_check($combined[0]['type']==='ai'&&$combined[1]['type']==='manual','Chronological merge of mixed source images');
 ai_check($combined[0]['mime']==='image/png'&&$combined[1]['mime']==='image/jpeg','Preserve actual source formats');
 ai_check(count(af_ai_library_items('fixture'))===2,'Cabinet lists both server image types');
 ai_check(count(af_ai_library_items('other'))===0,'Cabinet cannot enumerate other users');
 @unlink($dir.'/manual-'.$mid.'.json');@unlink($dir.'/manual-'.$mid.'.jpg');
 ai_check(count(af_ai_export_items('fixture',$ctx))===1,'Single remaining image must be a direct file');
 ai_check(af_ai_delivery_type(af_ai_export_items('fixture',$ctx))['archive']===false,'One image must not be zipped');
 ai_check(af_ai_delivery_type(af_ai_export_items('fixture',$ctx))['mime']==='image/png','One AI image retains PNG MIME');

 $expired=af_ai_expire('fixture',$job);
 ai_check($expired['status']==='failed','Timed-out job failed');
 ai_check((int)af_find_account(af_accounts(),'fixture')['generations_used']===0,'Timeout refund');
 ai_check(af_ai_expire('fixture',$expired)['status']==='failed','Terminal state idempotent');
 ai_check((int)af_find_account(af_accounts(),'fixture')['generations_used']===0,'No double refund');
 ai_check(!isset(af_ai_public($job)['metadata']),'Private photo metadata stays out of browser status');
 echo "PASS: scene preservation, correct room aspect ratio, HMAC, quotas and owner-isolated exports\n";
}finally{ai_rm($root);}
