#!/bin/sh
# bed_c.wav — a 48 s bed in three harmonic sections, so the music moves under the turn
# (19 s) and into the payoff (33 s) instead of holding one chord for the whole runtime.
# A1+E2 -> F1+C2 -> G1+D2, pink-noise wash, 0.5 Hz pulse.
seg() { # $1 root $2 fifth $3 dur $4 out
  ffmpeg -y -loglevel error \
    -f lavfi -i "sine=frequency=$1:duration=$3" \
    -f lavfi -i "sine=frequency=$2:duration=$3" \
    -f lavfi -i "sine=frequency=$(echo "$1*4" | bc -l):duration=$3" \
    -f lavfi -i "anoisesrc=d=$3:c=pink:a=0.9" \
    -filter_complex "[0:a]volume=0.60[a];[1:a]volume=0.34[b];[2:a]volume=0.10[c];\
[3:a]lowpass=f=520,volume=0.06[d];[a][b][c][d]amix=inputs=4:normalize=0[m];\
[m]tremolo=f=0.5:d=0.45,highpass=f=32,lowpass=f=2200,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[o]" \
    -map "[o]" -t "$3" "$4"
}
seg 55    82.41 21 /tmp/bed_a.wav
seg 43.65 65.41 16 /tmp/bed_b.wav
seg 49    73.42 17 /tmp/bed_c3.wav
ffmpeg -y -loglevel error -i /tmp/bed_a.wav -i /tmp/bed_b.wav -i /tmp/bed_c3.wav \
  -filter_complex "[0:a][1:a]acrossfade=d=2:c1=tri:c2=tri[x];[x][2:a]acrossfade=d=2:c1=tri:c2=tri[y];\
[y]afade=t=in:st=0:d=1.2,afade=t=out:st=45.0:d=1.5,volume=0.9[o]" -map "[o]" bed_c.wav
