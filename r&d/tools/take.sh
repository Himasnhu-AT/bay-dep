#!/bin/zsh
# take.sh <name> <query> <seconds>  — record one choreographed take at 4K
S="$(cd "$(dirname "$0")/.." && pwd)"  # r&d/
M="${OUT:-$HOME/Movies/redassay-launch/v2}"
ab(){ agent-browser --session redassay "$@"; }
name=$1; q=$2; secs=$3
ab set viewport 3840 2160 1 >/dev/null
ab open "http://localhost:3000/demo?$q" >/dev/null; sleep 2.5
ab eval "$(cat $S/tools/prep.js)" >/dev/null
ab eval "$(cat $S/tools/film.js)" >/dev/null
ab eval "__film.fit()" >/dev/null
ab eval "$(cat $S/tools/takes.js)" >/dev/null
ab eval "document.activeElement?.blur(); __takes.setup('$name')" >/dev/null; sleep 0.4
WS=$(ab get cdp-url)
node $S/tools/screencast.mjs "$WS" $M/$name.mp4 $secs localhost:3000 > $S/tools/$name.log 2>&1 &
rec=$!
sleep 0.6
ab eval "(async()=>{await __takes['$name']();return JSON.stringify(__film.log)})()" > $M/$name.clicks.json
wait $rec
tail -1 $S/tools/$name.log
mv $M/$name.mp4.frames ${TMPDIR:-/tmp}/v2-$name.frames 2>/dev/null
echo "clicks: $(cat $M/$name.clicks.json)"
