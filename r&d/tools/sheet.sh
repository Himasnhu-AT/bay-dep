#!/bin/zsh
# sheet.sh <video> <out.png> [n=12]: evenly spaced frames tiled 4 across
in=$1; out=$2; n=${3:-12}
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $in)
ffmpeg -loglevel error -y -i $in -vf "fps=$n/$d,scale=640:-2,tile=4x$(( (n+3)/4 ))" -frames:v 1 $out
