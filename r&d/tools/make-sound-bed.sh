#!/bin/zsh
# make-sound-bed.sh <out-dir> — an original, license-clean launch-film soundtrack, generated from
# ffmpeg sources only (no samples): a 110 BPM bed (soft kick on the beat, closed hat on the off-beat,
# a warm I–V–vi–IV pad), plus a UI click, a whoosh and a bell. 56 s = 26 bars at 110 BPM (bar = 2.1818 s).
set -eu
O=$1; mkdir -p "$O"; F=${FFMPEG:-/opt/homebrew/bin/ffmpeg}; B=0.545454; D=56
# kick: pitch-dropping sine burst on every beat
$F -loglevel error -y -f lavfi -i "aevalsrc='0.9*sin(2*PI*(45+90*exp(-40*mod(t,$B)))*mod(t,$B))*exp(-9*mod(t,$B))':s=48000:d=${D}" "$O/kick.wav"
# hat: high-passed noise tick on the off-beat
$F -loglevel error -y -f lavfi -i "anoisesrc=d=${D}:c=white:r=48000:a=0.5" -af "highpass=f=7000,volume='if(lt(mod(t+$B/2,$B),0.03),0.35*exp(-120*mod(t+$B/2,$B)),0)':eval=frame" "$O/hat.wav"
# pad: I–V–vi–IV in C (C, G, Am, F), two bars each, three sines per chord, slow swell, low-passed
P="0.08*(sin(2*PI*F1*t)+sin(2*PI*F2*t)+sin(2*PI*F3*t))*(0.6+0.4*sin(PI*mod(t,4*$B*2)/(4*$B*2)))"
C=$(( 4 * 2 )) ; L=$(python3 -c "print(4*$B*2)")
F1="if(lt(mod(t,4*$L),$L),261.6,if(lt(mod(t,4*$L),2*$L),196.0,if(lt(mod(t,4*$L),3*$L),220.0,174.6)))"
F2="if(lt(mod(t,4*$L),$L),329.6,if(lt(mod(t,4*$L),2*$L),246.9,if(lt(mod(t,4*$L),3*$L),261.6,220.0)))"
F3="if(lt(mod(t,4*$L),$L),392.0,if(lt(mod(t,4*$L),2*$L),293.7,if(lt(mod(t,4*$L),3*$L),329.6,261.6)))"
EXPR=${P//F1/$F1}; EXPR=${EXPR//F2/$F2}; EXPR=${EXPR//F3/$F3}
$F -loglevel error -y -f lavfi -i "aevalsrc='$EXPR':s=48000:d=${D}" -af "lowpass=f=1800,aecho=0.8:0.6:120:0.25" "$O/pad.wav"
$F -loglevel error -y -i "$O/kick.wav" -i "$O/hat.wav" -i "$O/pad.wav" -filter_complex "[0][1][2]amix=inputs=3:normalize=0,afade=t=in:d=0.5,afade=t=out:st=$((D-3)):d=3,loudnorm=I=-18:TP=-2,aresample=48000" -ac 2 "$O/music-bed-110bpm.wav"
# sfx: click (short filtered noise), whoosh (noise sweep), bell (two decaying partials)
$F -loglevel error -y -f lavfi -i "anoisesrc=d=0.06:c=pink:r=48000:a=0.8" -af "bandpass=f=3200:w=1800,afade=t=out:d=0.05" -ac 2 "$O/sfx-click.wav"
$F -loglevel error -y -f lavfi -i "anoisesrc=d=0.9:c=pink:r=48000:a=0.6" -af "highpass=f=300,lowpass=f=6000,volume='sin(PI*t/0.9)':eval=frame" -ac 2 "$O/sfx-whoosh.wav"
$F -loglevel error -y -f lavfi -i "aevalsrc='0.5*sin(2*PI*1318.5*t)*exp(-3*t)+0.25*sin(2*PI*2637*t)*exp(-5*t)':s=48000:d=2.5" -ac 2 "$O/sfx-bell.wav"
/bin/rm -f "$O/kick.wav" "$O/hat.wav" "$O/pad.wav"; ls -la "$O"
