#!/bin/bash
# Usage: mux.sh <framesDir> <mixWav> <outMp4>
set -e
ffmpeg -y -loglevel error -framerate 30 -i "$1/f%05d.png" -i "$2" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -vf "format=yuv420p" \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t 30 -shortest "$3"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration,bit_rate -show_entries format=duration,size -of default=noprint_wrappers=1 "$3"
