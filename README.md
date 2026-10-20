# SineDay Wave

> Your personal 18-day energy cycle, visualized

A beautiful, native-feeling Progressive Web App that calculates and visualizes your personal SineDay based on your birthdate. Built with vanilla JavaScript and designed for iPhone-first experiences.

![SineDay Wave Preview](Day9.jpeg)

## What is SineDay?

SineDay is a personal cycle system that maps your life to an 18-day rhythm. Each day represents a different energy phase:

- **Days 1-5**: Rising energy, initiation, momentum building
- **Days 6-9**: Peak energy, balance, insights, challenges
- **Days 10-13**: Descending energy, reflection, release
- **Days 14-16**: Trough energy, inner work, healing
- **Days 17-18**: Emerging energy, preparation for renewal

## Features

✨ **Premium Dark UI** - Glass morphism design with smooth animations
🌊 **Animated Sine Wave** - Beautiful Canvas-based visualization with breathing motion
📱 **Mobile-First** - Optimized for iPhone with safe-area support
♿ **Accessible** - Respects reduced-motion preferences, high-contrast mode
🚀 **PWA-Ready** - Install to home screen, works offline
🎨 **Day Images** - Each SineDay has a unique visual representation
📤 **Share** - Share your SineDay via Web Share API

## How to Run Locally

### Prerequisites

- A modern web browser (Chrome, Safari, Firefox, Edge)
- A local web server (required for ES modules)

### Option 1: Using Python (simplest)

```bash
# If you have Python 3.x installed:
python -m http.server 8000

# Visit http://localhost:8000
```

### Option 2: Using Node.js

```bash
# Install a simple server (one-time)
npm install -g http-server

# Run from project directory
http-server -p 8000

# Visit http://localhost:8000
```

### Option 3: Using VS Code

1. Install the "Live Server" extension
2. Right-click `index.html`
3. Select "Open with Live Server"

## How to Deploy on GitHub Pages

This repository is already configured for GitHub Pages.

### Initial Setup

1. **Fork or Clone** this repository
2. **Go to Settings** → Pages
3. **Set Source** to `main` branch (or your default branch)
4. **Save** and wait a few minutes

Your site will be live at: `https://[your-username].github.io/[repo-name]/`

### Updating the Site

Simply push changes to the main branch:

```bash
git add .
git commit -m "Update SineDay Wave"
git push origin main
```

GitHub Pages will automatically rebuild and deploy.

## Project Structure

```
SKSineDays.github.io/
├── index.html              # Main HTML file
├── styles.css              # Premium dark theme styles
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline functionality
├── js/
│   ├── sineday-engine.js   # Core calculation logic
│   ├── wave-canvas.js      # Animated wave visualization
│   └── ui.js               # UI coordination and events
├── ai/
│   ├── log-change.mjs      # Changelog helper script
│   └── ai_changelog.jsonl  # Machine-readable changelog
├── AI_CHANGELOG.md         # Human-readable changelog
├── Day1.jpeg ... Day18.jpeg # Day images
└── README.md               # This file
```

## How to Add Features

The codebase is modular and designed for extensibility.

### Adding a New Day Description

Edit `js/sineday-engine.js`:

```javascript
export const DAY_DATA = [
  {
    day: 1,
    phase: "RISING • INITIATION",
    description: "Your new description here", // ← Edit this
    imageUrl: "Day1.jpeg"
  },
  // ... rest of days
];
```

### Customizing Colors

Edit `styles.css` CSS variables:

```css
:root {
  --color-accent: #7AA7FF;  /* Change accent color */
  --color-bg: #05060A;      /* Change background */
}
```

### Adding a New UI Component

1. Add HTML to `index.html`
2. Add styles to `styles.css`
3. Add logic to `js/ui.js` or create a new module in `/js/`

### Wave Customization

Edit wave parameters in `js/ui.js`:

```javascript
this.waveRenderer = new WaveCanvas(this.elements.waveCanvas, {
  accentColor: '#7AA7FF',
  amplitude: 0.25,        // Wave height (0-1)
  frequency: 1.5,         // Number of waves
  breathingSpeed: 0.0008, // Animation speed
});
```

## Technology Stack

- **HTML5** - Semantic markup, Canvas API
- **CSS3** - Custom properties, Grid, Flexbox, backdrop-filter
- **JavaScript (ES6+)** - Modules, Classes, async/await
- **No frameworks** - Vanilla JS for maximum performance
- **No build step** - Direct ES module imports

## Browser Support

- ✅ Safari (iOS 14+)
- ✅ Chrome/Edge (90+)
- ✅ Firefox (88+)
- ⚠️ Older browsers may lack backdrop-filter support (graceful degradation)

## Performance

- Lighthouse score: 95+ (mobile)
- First Contentful Paint: < 1s
- Canvas animation: 60fps on modern devices
- Reduced motion support for accessibility

## Contributing

Want to improve SineDay Wave?

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test locally
4. Use the changelog helper:
   ```bash
   node ai/log-change.mjs --files "file1,file2" \
     --summary "Your change" \
     --rationale "Why you did it"
   ```
5. Commit: `git commit -m "Add amazing feature"`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

## Changelog

See [AI_CHANGELOG.md](AI_CHANGELOG.md) for detailed development history.

## License

This project is open source. Feel free to use, modify, and share.

## Credits

- SineDay concept and calculation
- Premium UI design inspired by iOS Human Interface Guidelines
- Day images: Original photography

---

**Enjoy your SineDay journey! 🌊**

## Day-photo collection

The website day scenes use ten approved photographs per SineDay, with one still
photo per visit. See [rotation behavior, provenance and release checks](docs/art-direction/day-photo-rotation.md).
Run `npm run check:day-photos` to verify the full 180-photo collection, and
`npm run test:day-photos:browser` for responsive homepage/dashboard checks.
