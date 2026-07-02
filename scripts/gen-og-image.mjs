// Generates the social-share OG image (public/og-image.png, 1200x630)
// and the favicon (src/app/favicon.ico) from the ERP Realsoft brand palette.
// Uses @napi-rs/canvas, already a project dependency.
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

const NAVY = '#1E3A5F';
const NAVY_DARK = '#142a45';
const GREEN = '#1B7A50';
const WHITE = '#FFFFFF';

// ---------- OG image ----------
function buildOgImage() {
  const W = 1200, H = 630;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // background gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, NAVY);
  g.addColorStop(1, NAVY_DARK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // green top accent bar
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, 12);

  // logo tile
  ctx.fillStyle = GREEN;
  roundRect(ctx, 80, 90, 96, 96, 18);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 60px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', 128, 140);

  // wordmark
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 44px Helvetica, Arial, sans-serif';
  ctx.fillText('ERP Realsoft', 200, 152);

  // headline
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 76px Helvetica, Arial, sans-serif';
  ctx.fillText('From RFQ Email to', 80, 330);
  ctx.fillStyle = '#7CC4A0';
  ctx.fillText('BOQ Quotation — Automated', 80, 420);

  // subline
  ctx.fillStyle = '#C7D4E3';
  ctx.font = '32px Helvetica, Arial, sans-serif';
  ctx.fillText('AI MEP estimation • Electrical · HVAC · Plumbing · Fire', 80, 490);

  // location chip
  ctx.fillStyle = GREEN;
  roundRect(ctx, 80, 525, 250, 52, 26);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 24px Helvetica, Arial, sans-serif';
  ctx.fillText('Dubai · UAE', 110, 559);

  const out = path.resolve('public/og-image.png');
  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log('Wrote ' + out);
}

// ---------- favicon.ico (PNG-in-ICO, valid in all modern browsers) ----------
function buildFavicon() {
  const S = 32;
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');

  ctx.fillStyle = NAVY;
  roundRect(ctx, 0, 0, S, S, 6);
  ctx.fill();
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, S, 3);
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 22px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', S / 2, S / 2 + 2);

  const png = c.toBuffer('image/png');

  // ICONDIR (6) + ICONDIRENTRY (16) + PNG payload
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(1, 4);   // count
  header.writeUInt8(S, 6);      // width
  header.writeUInt8(S, 7);      // height
  header.writeUInt8(0, 8);      // colors in palette
  header.writeUInt8(0, 9);      // reserved
  header.writeUInt16LE(1, 10);  // color planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14); // size of image data
  header.writeUInt32LE(22, 18); // offset to image data

  const out = path.resolve('src/app/favicon.ico');
  fs.writeFileSync(out, Buffer.concat([header, png]));
  console.log('Wrote ' + out);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

buildOgImage();
buildFavicon();
