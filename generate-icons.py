#!/usr/bin/env python3
"""
Generate placeholder PNG icons for SineDay Wave PWA
Creates simple gradient icons with sine wave pattern
"""

try:
    from PIL import Image, ImageDraw
    import math
except ImportError:
    print("PIL (Pillow) not installed. Install with: pip install Pillow")
    print("Alternatively, use the online tool or ImageMagick (see ICONS_TODO.md)")
    exit(1)

def create_icon(size, filename):
    """Create a simple icon with sine wave"""
    # Create image with dark background
    img = Image.new('RGB', (size, size), color='#05060A')
    draw = ImageDraw.Draw(img)

    # Draw sine wave
    points = []
    wave_amplitude = size * 0.15
    wave_center_y = size // 2
    wave_frequency = 1.5

    for x in range(0, size):
        # Calculate sine wave y position
        normalized_x = (x / size) * 2 * math.pi * wave_frequency
        y = wave_center_y + math.sin(normalized_x) * wave_amplitude
        points.append((x, int(y)))

    # Draw wave line
    draw.line(points, fill='#7AA7FF', width=max(2, size // 100))

    # Draw marker dot
    marker_x = size // 2
    marker_y = wave_center_y - int(wave_amplitude * 0.5)
    marker_radius = max(6, size // 40)

    # Marker glow
    glow_radius = marker_radius + 4
    draw.ellipse(
        [marker_x - glow_radius, marker_y - glow_radius,
         marker_x + glow_radius, marker_y + glow_radius],
        fill='#7AA7FF40'
    )

    # Marker dot
    draw.ellipse(
        [marker_x - marker_radius, marker_y - marker_radius,
         marker_x + marker_radius, marker_y + marker_radius],
        fill='#7AA7FF'
    )

    # Save
    img.save(filename, 'PNG')
    print(f"✓ Created {filename} ({size}x{size})")

if __name__ == '__main__':
    print("Generating SineDay Wave icons...")
    create_icon(192, 'icon-192.png')
    create_icon(512, 'icon-512.png')
    create_icon(32, 'favicon.png')
    create_icon(180, 'apple-touch-icon.png')
    print("\n✓ All icons generated successfully!")
    print("\nYou can now delete ICONS_TODO.md and this script.")
