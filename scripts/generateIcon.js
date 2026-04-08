const sharp = require('sharp');
const path = require('path');

// 1024x1024 black background with centered bold orange "R"
// Uses SVG text rendering via sharp + SVG overlay

async function generateIcon() {
  const SIZE = 1024;

  // SVG with black background + orange R lettermark
  const svg = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
  <text
    x="50%"
    y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    fill="#f97316"
    font-size="580"
    font-weight="700"
    font-family="Arial Black, Arial, sans-serif"
    letter-spacing="-10"
  >R</text>
</svg>`;

  const outPath = path.join(__dirname, '..', 'assets', 'icon.png');

  await sharp(Buffer.from(svg))
    .png()
    .toFile(outPath);

  console.log(`✓ icon.png generated at ${outPath} (${SIZE}x${SIZE})`);

  // Also generate adaptive icon foreground (same design, slightly smaller R for safe zone)
  const svgAdaptive = `
<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
  <text
    x="50%"
    y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    fill="#f97316"
    font-size="500"
    font-weight="700"
    font-family="Arial Black, Arial, sans-serif"
    letter-spacing="-10"
  >R</text>
</svg>`;

  const adaptivePath = path.join(__dirname, '..', 'assets', 'adaptive-icon.png');
  await sharp(Buffer.from(svgAdaptive)).png().toFile(adaptivePath);
  console.log(`✓ adaptive-icon.png generated`);
}

generateIcon().catch((e) => { console.error(e); process.exit(1); });
