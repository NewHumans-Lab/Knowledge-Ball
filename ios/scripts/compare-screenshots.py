from PIL import Image, ImageChops, ImageStat
import sys

web = Image.open(sys.argv[1]).convert('RGB')
ios = Image.open(sys.argv[2]).convert('RGB')
if ios.size != web.size:
    ios = ios.resize(web.size, Image.Resampling.LANCZOS)
# Ignore the unavoidable iOS status/home-indicator bands; product layout is the shared center.
h = web.height
box = (0, round(h * 0.04), web.width, round(h * 0.96))
diff = ImageChops.difference(web.crop(box), ios.crop(box))
mean = sum(ImageStat.Stat(diff).mean) / 3
changed = sum(1 for px in diff.convert('L').getdata() if px > 32) / (diff.width * diff.height)
print(f'visual parity: mean_abs_error={mean:.2f}, changed_pixels={changed:.2%}')
if mean > 32 or changed > 0.28:
    raise SystemExit('iOS/Web screenshot difference exceeds WKWebView rasterization tolerance')
