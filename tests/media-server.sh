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
 local kind="$1" cookie="$2" name="$3"
 curl -fsS -c "$cookie" -b "$cookie" -H 'X-Affresco-Request: 1' \
 -F action=upload -F kind="$kind" -F "name=$name" \
 -F width_cm=200 -F height_cm=150 \
 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=$kind"
}
upload room "$cookie1" "First room" >"$tmp/first.json"
id1="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["item"]["id"])' "$tmp/first.json")"
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie2" -b "$cookie2" "$base/media.php?kind=room&id=$id1")" = 404
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie1" -b "$cookie1" "$base/media.php?kind=room&id=$id1")" = 200
upload room "$cookie1" "Replacement room" >"$tmp/replacement.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie1" "$base/media.php?kind=room&id=$id1")" = 404
curl -fsS -b "$cookie1" "$base/media.php?kind=room" >"$tmp/guest-list.json"
python3 - "$tmp/guest-list.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]));assert len(data['items'])==1
assert data['items'][0]['name']=='Replacement room'
PY
upload fresco "$cookie1" "My fresco" >"$tmp/guest-fresco.json"
upload fresco "$cookie1" "Another fresco" >"$tmp/guest-fresco2.json"
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
test "$(curl -sS -o /dev/null -w '%{http_code}' -c "$account" -b "$account" \
 -H 'X-Affresco-Request: 1' -F action=upload -F kind=fresco -F name=Fourth \
 -F width_cm=200 -F height_cm=150 -F "image=@$tmp/photo.jpg;type=image/jpeg" "$base/media.php?kind=fresco")" = 409
php -r '$a=json_decode(file_get_contents("data/accounts.json"),true);$rows=$a[0]["media_assets"]??[];if(count($rows)!==3)exit(1);'
curl -fsS -b "$account" "$base/media.php?kind=fresco" >"$tmp/account-fresco-list.json"
python3 - "$tmp/account-fresco-list.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))['items'])==3
PY
echo 'PASS: PHP media endpoint guest replace, account 3/4 limit, private GET, owner isolation, accounts.json metadata'
