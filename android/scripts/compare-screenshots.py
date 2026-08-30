"""Reject gross native-WebView drift while tolerating WebView font/GPU rasterization."""
import sys
from PIL import Image, ImageChops, ImageStat

native = Image.open(sys.argv[1]).convert("RGB")
reference = Image.open(sys.argv[2]).convert("RGB")
# Android system bars are shell-owned. Compare the app viewport, scaled to the
# equivalent Web viewport; a 22% mean-channel tolerance permits font/WebGL
# rasterization but catches blank screens and large layout/color drift.
if native.height > native.width * 1.5:
    native = native.crop((0, 24, native.width, native.height - 24))
native = native.resize(reference.size)
mean = sum(ImageStat.Stat(ImageChops.difference(native, reference)).mean) / (3 * 255)
print(f"Android/Web screenshot normalized mean difference: {mean:.4f}")
if mean > 0.22:
    raise SystemExit("Android packaged app differs materially from the equivalent Web viewport")
