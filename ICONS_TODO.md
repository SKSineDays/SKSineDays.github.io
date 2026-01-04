# Icon Generation TODO

## Current Status

The app currently has an SVG icon (`icon.svg`) but needs PNG versions for full PWA support.

## Required Icons

Generate these PNG files from `icon.svg`:

1. **icon-192.png** - 192x192px
2. **icon-512.png** - 512x512px
3. **favicon.png** - 32x32px (or .ico)
4. **apple-touch-icon.png** - 180x180px

## How to Generate Icons

### Option 1: Online Tool

1. Go to https://realfavicongenerator.net/
2. Upload `icon.svg`
3. Download generated icons
4. Replace placeholder files

### Option 2: Using ImageMagick (CLI)

```bash
# Install ImageMagick if needed
# macOS: brew install imagemagick
# Ubuntu: apt-get install imagemagick

# Generate icons
convert icon.svg -resize 192x192 icon-192.png
convert icon.svg -resize 512x512 icon-512.png
convert icon.svg -resize 32x32 favicon.png
convert icon.svg -resize 180x180 apple-touch-icon.png
```

### Option 3: Using Inkscape

1. Open `icon.svg` in Inkscape
2. File → Export PNG Image
3. Set width/height for each required size
4. Export

## Maskable Icons

For better Android support, consider creating maskable icons:
- Safe zone: 80% of canvas (icons may be cropped to circles)
- Tool: https://maskable.app/editor

## After Generation

1. Delete this file (ICONS_TODO.md)
2. Verify icons appear correctly when adding to home screen
3. Test on both iOS and Android
