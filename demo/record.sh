#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES_DIR="$DIR/frames"
OUTPUT_DIR="$(dirname "$DIR")/demos"
OUTPUT="$OUTPUT_DIR/flywheel-demo.gif"
PALETTE="$DIR/palette.png"
FPS=12

echo "==> Installing puppeteer..."
cd "$DIR"
[ -f package.json ] || echo '{}' > package.json
npm install --save puppeteer 2>&1 | tail -1

echo "==> Capturing frames with Puppeteer..."
node capture.js

echo "==> Generating GIF with ffmpeg..."
mkdir -p "$OUTPUT_DIR"

# Pass 1: generate palette
ffmpeg -y -framerate "$FPS" -i "$FRAMES_DIR/frame-%05d.png" \
  -vf "scale=800:600:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
  "$PALETTE" 2>/dev/null

# Pass 2: render GIF with palette
ffmpeg -y -framerate "$FPS" -i "$FRAMES_DIR/frame-%05d.png" -i "$PALETTE" \
  -lavfi "scale=800:600:flags=lanczos,tpad=stop_duration=2 [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4" \
  "$OUTPUT" 2>/dev/null

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "==> Done: $OUTPUT ($SIZE)"

# Cleanup
rm -rf "$FRAMES_DIR" "$PALETTE"
echo "==> Cleaned up frames and palette"
