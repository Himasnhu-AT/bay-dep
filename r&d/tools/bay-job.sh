#!/bin/zsh
# bay-job.sh <project-name> <brief.md> <recording.mp4> <file...>
# Drives the running bay (CDP 9222) like a user: saves the open project, creates a new one, names
# it, drops the files onto the media pool, types the brief into the agent and sends it, while
# recording the window. Stop the recording later with: touch "$STOPDIR/stop-<project-name>".
# Needs agent-browser (session "bay"), node 22+ and this folder's record-stream.mjs / drop.mjs.
set -u
T="$(cd "$(dirname "$0")" && pwd)"
NAME=$1; BRIEF=$2; REC=$3; shift 3
STOPDIR="${STOPDIR:-${TMPDIR:-/tmp}/bay-jobs}"; mkdir -p "$STOPDIR"
SLUG=$(echo "$NAME" | tr ' A-Z' '-a-z'); STOP="$STOPDIR/stop-$SLUG"; rm -f "$STOP"
# agent-browser follows new targets (composition windows) and tab ids change after a restart, so
# every call first selects the editor tab by its title, "bay".
baytab(){ local l t; l=$(agent-browser --session bay tab 2>/dev/null); echo "$l" | grep -qE '^→ \[t[0-9]+\] bay - ' && return 0; t=$(echo "$l" | grep -E '\] bay - ' | grep -oE 't[0-9]+' | head -1); [ -n "$t" ] && agent-browser --session bay tab $t >/dev/null 2>&1; }
b(){ baytab; agent-browser --session bay "$@"; }
mark(){ echo "$1" > "$STOP.mark"; sleep 0.3; }

b connect http://127.0.0.1:9222 >/dev/null 2>&1
[ "$(b eval 'document.title')" = '"bay"' ] || { echo "not attached to bay"; exit 1; }
node "$T/record-stream.mjs" 9222 index.html "$REC" "$STOP" 2560 > "$STOPDIR/$SLUG-rec.log" 2>&1 &
sleep 2; mark start

# leave the current project (saving it) and create a new one
ref=$(b snapshot -i | grep -oE 'button "All projects" \[ref=e[0-9]+\]' | grep -oE 'e[0-9]+')
[ -n "$ref" ] && { b click @$ref >/dev/null 2>&1; sleep 2; b eval "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save' && x.closest('.fixed'))?.click()" >/dev/null; sleep 2; }
# the projects list scrolls under a sticky header; a scrolled list puts the button beneath it
b eval "document.querySelectorAll('*').forEach(e=>{if(e.scrollTop>0)e.scrollTop=0}); window.scrollTo(0,0); true" >/dev/null
b find text "Create new project" click >/dev/null; sleep 3; mark "new project"
ref=$(b snapshot -i | grep -oE 'button "[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+" \[ref=e[0-9]+\]' | head -1 | grep -oE 'e[0-9]+')
b click @$ref >/dev/null; sleep .5; b press Meta+a >/dev/null; b keyboard type "$NAME" >/dev/null; b press Enter >/dev/null; sleep 1; mark renamed

# drop the media where the empty media pool says "No media yet"
P=$(b eval "(()=>{const r=[...document.querySelectorAll('*')].find(e=>e.textContent.trim()==='No media yet');if(!r)return 'none';const x=r.getBoundingClientRect();return Math.round(x.left+x.width/2)+' '+Math.round(x.top+x.height/2)})()" | tr -d '"')
# Never drop into a project that already has media: that means the new project was not created
# and the brief would go to whatever was open (it did once, into a finished project).
case "$P" in ''|none|*[!0-9\ ]*) echo "refusing: no empty media pool (got '$P'); the new project was not created"; touch "$STOP"; exit 1;; esac
mark "drop media"; node "$T/drop.mjs" 9222 index.html ${=P} "$@"; sleep 6
echo "media: $(b eval "document.body.innerText.match(/Media Pool\s*(\d+)/)?.[1]")"

# type the brief (the opening visibly, the rest inserted) and send
b click textarea >/dev/null; mark "typing brief"
PROMPT=$(cat "$BRIEF"); b keyboard type "${PROMPT:0:80}" >/dev/null; b keyboard inserttext "${PROMPT:80}" >/dev/null; sleep .6
b find role button click --name "Send" >/dev/null 2>&1; mark "sent brief"; sleep 5
echo "working: $(b eval "/Working…/.test(document.body.innerText)")  stop file: $STOP"
