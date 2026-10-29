#!/usr/bin/env bash
set -euo pipefail
tmp="$(mktemp -d)"
port=18779
cleanup(){ kill "$server" 2>/dev/null || :; wait "$server" 2>/dev/null || :; rm -rf "$tmp" data/accounts.json; rmdir data 2>/dev/null || :; }
trap cleanup EXIT
printf '%s' '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABIMDRANCxIQDhAUExIVGywdGxgYGzYnKSAsQDlEQz85Pj1HUGZXR0thTT0+WXlaYWltcnNyRVV9hnxvhWZwcm7/2wBDARMUFBsXGzQdHTRuST5Jbm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm7/wAARCABkAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBlFFFZFhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//2Q==' | base64 -d > "$tmp/photo.jpg"
mkdir -p data
php -r '$h=password_hash("only-for-ci",PASSWORD_DEFAULT);file_put_contents("data/accounts.json",json_encode([["id"=>"ci-test","login"=>"ci_test","pass"=>$h,"generations_limit"=>0]]));'
php -S 127.0.0.1:$port -t public > "$tmp/php.log" 2>&1 &
server=$!
sleep 1
base="http://127.0.0.1:$port/api"
cookie1="$tmp/guest.cookie";cookie2="$tmp/stranger.cookie"
curl -fsS -c "$cookie1" -b "$cookie1" "$base/media.php?kind=room" >"$tmp/empty.json"
python3 - "$tmp/empty.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))["limit"]==1
PY
status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -F action=upload -F kind=room -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=room")"
test "$status" = 403
upload(){
 local kind="$1" cookie="$2" name="$3" replace_id="${4:-}"
 curl -fsS -c "$cookie" -b "$cookie" -H 'X-Affresco-Request: 1' \
 -F action=upload -F kind="$kind" -F "name=$name" -F "replace_id=$replace_id" \
 -F width_cm=200 -F height_cm=150 \
 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=$kind"
}
upload room "$cookie1" "First room" >"$tmp/first.json"
id1="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/first.json")"
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie2" -b "$cookie2" "$base/media.php?kind=room&id=$id1")" = 404
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie1" -b "$cookie1" "$base/media.php?kind=room&id=$id1")" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" -c "$cookie1" -H 'X-Affresco-Request: 1' -F action=upload -F kind=room -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=room")" = 409
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" "$base/media.php?kind=room&id=$id1")" = 200
upload room "$cookie1" "Replacement room" "$id1" >"$tmp/replacement.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" "$base/media.php?kind=room&id=$id1")" = 404
curl -fsS -b "$cookie1" "$base/media.php?kind=room" >"$tmp/guest-list.json"
python3 - "$tmp/guest-list.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]));assert len(data['items'])==1
assert data['items'][0]['name']=='Replacement room'
PY
upload fresco "$cookie1" "My fresco" >"$tmp/guest-fresco.json"
guest_fresco_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/guest-fresco.json")"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" -c "$cookie1" -H 'X-Affresco-Request: 1' -F action=upload -F kind=fresco -F width_cm=200 -F height_cm=150 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=fresco")" = 409
upload fresco "$cookie1" "Another fresco" "$guest_fresco_id" >"$tmp/guest-fresco2.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" "$base/media.php?kind=fresco&id=$guest_fresco_id")" = 404
curl -fsS -b "$cookie1" "$base/media.php?kind=fresco" >"$tmp/guest-fresco-list.json"
python3 - "$tmp/guest-fresco-list.json" <<'PY'
import json,sys
a=json.load(open(sys.argv[1]));assert len(a['items'])==1
assert a['items'][0]['name']=='Another fresco'
assert a['items'][0]['width_cm']==200
PY
account="$tmp/account.cookie"
curl -fsS -b "$account" -c "$account" -H 'X-Affresco-Request: 1' -H 'Content-Type: application/json' \
 -d '{"action":"login","login":"ci_test","password":"only-for-ci"}' "$base/auth.php" >"$tmp/login.json"
python3 - "$tmp/login.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['authenticated'] is True
PY
for n in 1 2 3; do upload fresco "$account" "Registered $n" >"$tmp/account-$n.json"; done
# The private accounts file may be readable but not writable by the PHP process.
chmod 0444 data/accounts.json
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$account" -b "$account" \
 -H 'X-Affresco-Request: 1' -F action=upload -F kind=fresco -F name=Fourth \
 -F width_cm=200 -F height_cm=150 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=fresco")" = 409
account_first_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/account-1.json")"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$account" -c "$account" -H 'X-Affresco-Request: 1' -F action=upload -F kind=fresco -F replace_id="$guest_fresco_id" -F width_cm=200 -F height_cm=150 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=fresco")" = 409
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$account" "$base/media.php?kind=fresco&id=$account_first_id")" = 200
upload fresco "$account" "Registered replaced" "$account_first_id" >"$tmp/account-replaced.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$account" "$base/media.php?kind=fresco&id=$account_first_id")" = 404
php -r 'require "public/api/_account.php";$s=af_state("ci-test");if(count($s["media_assets"]??[])!==3)exit(1);'
curl -fsS -b "$account" "$base/media.php?kind=fresco" >"$tmp/account-fresco-list.json"
python3 - "$tmp/account-fresco-list.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))['items'])==3
PY
replacement_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/account-replaced.json")"
curl -fsS -b "$account" -c "$account" -H 'X-Affresco-Request: 1' -F action=delete -F kind=fresco -F id="$replacement_id" "$base/media.php?kind=fresco" >"$tmp/deleted.json"
python3 - "$tmp/deleted.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['deleted'] is True
PY
upload fresco "$account" "Space freed" >"$tmp/account-new.json"
curl -fsS -b "$account" "$base/media.php?kind=fresco" >"$tmp/account-after-delete.json"
python3 - "$tmp/account-after-delete.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))['items'])==3
PY
# Legacy account JSON metadata must migrate once, even when the profile JSON is read-only.
chmod 0644 data/accounts.json
php -r 'require "public/api/_account.php";af_state("ci-test",static function(array $s):array{unset($s["media_assets"]);return $s;});'
php -r '$p="data/accounts.json";$a=json_decode(file_get_contents($p),true);$id=str_repeat("a",32);$a[0]["media_assets"]=[["id"=>$id,"kind"=>"fresco","sku"=>"own-".$id,"name"=>"Legacy artwork","width_cm"=>200,"height_cm"=>150,"created"=>time()]];file_put_contents($p,json_encode($a));'
chmod 0444 data/accounts.json
curl -fsS -b "$account" "$base/media.php?kind=fresco" >"$tmp/legacy-before.json"
python3 - "$tmp/legacy-before.json" <<'PY'
import json,sys
items=json.load(open(sys.argv[1]))['items']
assert len(items)==1 and items[0]['name']=='Legacy artwork'
PY
legacy_id="$(printf 'a%.0s' {1..32})"
upload fresco "$account" "Migrated artwork" "$legacy_id" >"$tmp/legacy-after.json"
migrated_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/legacy-after.json")"
curl -fsS -b "$account" -c "$account" -H 'X-Affresco-Request: 1' -F action=delete -F kind=fresco -F id="$migrated_id" "$base/media.php?kind=fresco" >/dev/null
curl -fsS -b "$account" "$base/media.php?kind=fresco" >"$tmp/legacy-deleted.json"
python3 - "$tmp/legacy-deleted.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['items']==[], 'Legacy item should not reappear after deletion'
PY
chmod 0644 data/accounts.json
echo 'PASS: read-only account JSON, migrated legacy media, delete without resurrection'
echo 'PASS: explicit replacement guest/account, 409 quota, ownership isolation, delete frees quota'

# Temporary one-shot anonymous production probe for PR fix/media-upload-errors-20261029.
# Uses only a synthetic 100x100 JPEG and a fresh cookie jar, never touches real accounts.
if [[ "${GITHUB_HEAD_REF:-}" == "fix/media-upload-errors-20261029" ]]; then
  echo "DIAGNOSTIC: probing anonymous production media upload with synthetic image"
  probe_cookie="$tmp/probe.cookie"
  probe_body="$tmp/probe.json"
  probe_status="$(curl --silent --show-error --max-time 25 -o "$probe_body" -w '%{http_code}' \
    -c "$probe_cookie" -b "$probe_cookie" \
    -H 'X-Affresco-Request: 1' -H 'Origin: https://affresco.a2ice.ru' \
    -F action=upload -F kind=fresco -F name=diagnostic-ci-guest \
    -F width_cm=120 -F height_cm=120 \
    -F "image=@$tmp/photo.jpg;type=image/jpeg" \
    'https://affresco.a2ice.ru/api/media.php?kind=fresco' || true)"
  echo "DIAGNOSTIC: HTTP $probe_status"
  head -c 500 "$probe_body" | tr '\n' ' '; echo
  if [[ "$probe_status" == '201' ]]; then
    probe_id="$(python3 - "$probe_body" <<'PY'
import json,sys,re
try: id=json.load(open(sys.argv[1]))['item']['id']
except Exception: id=''
print(id if re.fullmatch(r'[a-f0-9]{32}',str(id)) else '')
PY
)"
    if [[ -n "$probe_id" ]]; then
      delete_code="$(curl --silent --show-error --max-time 25 -o "$tmp/probe-delete.json" -w '%{http_code}' \
        -c "$probe_cookie" -b "$probe_cookie" -H 'X-Affresco-Request: 1' -H 'Origin: https://affresco.a2ice.ru' \
        -F action=delete -F kind=fresco -F "id=$probe_id" \
        'https://affresco.a2ice.ru/api/media.php?kind=fresco' || true)"
      echo "DIAGNOSTIC: synthetic media cleanup HTTP $delete_code"
    fi
  fi
fi
