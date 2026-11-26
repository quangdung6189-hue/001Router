"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const EXT_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(EXT_DIR, "..");
const PUBLIC_VSIX = path.join(ROOT_DIR, "web", "public", "001router-code.vsix");

// --- CRC32 & Pure Node ZIP / PNG helpers ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lenSq));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function blendPixel(buf, offset, r, g, b, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, Math.max(0, alpha));
  const inv = 1 - a;
  buf[offset] = Math.round(buf[offset] * inv + r * a);
  buf[offset + 1] = Math.round(buf[offset + 1] * inv + g * a);
  buf[offset + 2] = Math.round(buf[offset + 2] * inv + b * a);
  buf[offset + 3] = Math.round(Math.min(255, buf[offset + 3] + 255 * a * (1 - buf[offset + 3] / 255)));
}

/**
 * Render an anti-aliased 128x128 RGBA PNG of the 001Router emblem.
 */
function renderBrandPng(size = 128) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const stride = size * 4 + 1;

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const off = y * stride + 1 + x * 4;
      const t = (x + y) / (2 * size);

      // Outer terracotta squircle
      const dOuter = sdRoundedRect(x + 0.5, y + 0.5, 64, 64, 58, 58, 28);
      if (dOuter < 1) {
        const aOuter = Math.max(0, Math.min(1, 0.5 - dOuter));
        const r = Math.round(241 * (1 - t) + 201 * t);
        const g = Math.round(120 * (1 - t) + 74 * t);
        const b = Math.round(86 * (1 - t) + 43 * t);
        blendPixel(raw, off, r, g, b, aOuter);
      }

      // Inner dark obsidian squircle
      const dInner = sdRoundedRect(x + 0.5, y + 0.5, 64, 64, 50, 50, 22);
      if (dInner < 1) {
        const aInner = Math.max(0, Math.min(1, 0.5 - dInner));
        blendPixel(raw, off, 23, 21, 23, aInner);
      }

      // Routing paths: center-left (36,64) to top (91,40), mid (91,64), bottom (91,88)
      const dMid = distToSegment(x + 0.5, y + 0.5, 36, 64, 91, 64);
      if (dMid < 4.4) {
        blendPixel(raw, off, 255, 255, 255, Math.max(0, Math.min(1, 4.1 - dMid)));
      }
      const dTop = Math.min(
        distToSegment(x + 0.5, y + 0.5, 36, 64, 62, 64),
        distToSegment(x + 0.5, y + 0.5, 62, 64, 76, 40),
        distToSegment(x + 0.5, y + 0.5, 76, 40, 91, 40)
      );
      if (dTop < 4.0) {
        blendPixel(raw, off, 248, 162, 139, Math.max(0, Math.min(1, 3.6 - dTop)));
      }
      const dBot = Math.min(
        distToSegment(x + 0.5, y + 0.5, 62, 64, 76, 88),
        distToSegment(x + 0.5, y + 0.5, 76, 88, 91, 88)
      );
      if (dBot < 4.0) {
        blendPixel(raw, off, 248, 162, 139, Math.max(0, Math.min(1, 3.6 - dBot)));
      }

      // Nodes with white rings
      const drawNode = (cx, cy, radius, cr, cg, cb) => {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < radius + 1) {
          const ringAlpha = Math.max(0, Math.min(1, radius + 0.5 - d));
          blendPixel(raw, off, 255, 255, 255, ringAlpha);
        }
        if (d < radius - 2.2) {
          const coreAlpha = Math.max(0, Math.min(1, radius - 2.6 - d));
          blendPixel(raw, off, cr, cg, cb, coreAlpha);
        }
      };

      drawNode(36, 64, 12, 229, 106, 74); // hub (terracotta)
      drawNode(91, 40, 9.5, 16, 185, 129); // low (emerald)
      drawNode(91, 64, 10, 245, 158, 11); // high (amber)
      drawNode(91, 88, 9.5, 236, 72, 153); // max (magenta)
    }
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = zlib.deflateRawSync(rawData);
    const useDeflate = deflated.length < rawData.length;
    const method = useDeflate ? 8 : 0;
    const compData = useDeflate ? deflated : rawData;
    const crc = crc32(rawData);

    const localHdr = Buffer.allocUnsafe(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4); // version needed
    localHdr.writeUInt16LE(0x0800, 6); // UTF-8
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(0, 10); // mod time
    localHdr.writeUInt16LE(0x5421, 12); // mod date
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(compData.length, 18);
    localHdr.writeUInt32LE(rawData.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    localParts.push(localHdr, nameBuf, compData);

    const centHdr = Buffer.allocUnsafe(46);
    centHdr.writeUInt32LE(0x02014b50, 0);
    centHdr.writeUInt16LE(20, 4);
    centHdr.writeUInt16LE(20, 6);
    centHdr.writeUInt16LE(0x0800, 8);
    centHdr.writeUInt16LE(method, 10);
    centHdr.writeUInt16LE(0, 12);
    centHdr.writeUInt16LE(0x5421, 14);
    centHdr.writeUInt32LE(crc, 16);
    centHdr.writeUInt32LE(compData.length, 20);
    centHdr.writeUInt32LE(rawData.length, 24);
    centHdr.writeUInt16LE(nameBuf.length, 28);
    centHdr.writeUInt16LE(0, 30);
    centHdr.writeUInt16LE(0, 32);
    centHdr.writeUInt16LE(0, 34);
    centHdr.writeUInt16LE(0, 36);
    centHdr.writeUInt32LE(0, 38);
    centHdr.writeUInt32LE(offset, 42);

    centralParts.push(centHdr, nameBuf);
    offset += localHdr.length + nameBuf.length + compData.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const WEB_PROVIDERS_DIR = path.join(ROOT_DIR, "web", "public", "providers");
const EXT_PROVIDERS_DIR = path.join(EXT_DIR, "media", "providers");

const BUNDLED_PROVIDER_LOGOS = [
  "agentrouter.png",
  "anthropic.png",
  "antigravity.png",
  "azure.png",
  "baidu.png",
  "bedrock.png",
  "byteplus.png",
  "cerebras.png",
  "chutes.png",
  "claude.png",
  "cloudflare-ai.png",
  "codex.png",
  "cohere.png",
  "deepseek.png",
  "featherless.png",
  "fireworks.png",
  "gemini.png",
  "gemini-cli.png",
  "github.png",
  "gitlab.png",
  "glm.png",
  "groq.png",
  "huggingface.png",
  "hyperbolic.png",
  "kimi.png",
  "kimi-coding.png",
  "local-device.png",
  "minimax.png",
  "mistral.png",
  "muse.png",
  "nebius.png",
  "nous.png",
  "novita.png",
  "nvidia.png",
  "ollama.png",
  "openai.png",
  "openrouter.png",
  "perplexity.png",
  "qwen.png",
  "reka.png",
  "sambanova.png",
  "siliconflow.png",
  "tencent.png",
  "together.png",
  "venice.png",
  "vercel-ai-gateway.png",
  "vertex.png",
  "xai.png",
  "xiaomi-mimo.png"
];

function syncProviderLogos() {
  fs.mkdirSync(EXT_PROVIDERS_DIR, { recursive: true });
  const copied = [];
  for (const filename of BUNDLED_PROVIDER_LOGOS) {
    const src = path.join(WEB_PROVIDERS_DIR, filename);
    const dst = path.join(EXT_PROVIDERS_DIR, filename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      copied.push(`media/providers/${filename}`);
    } else if (fs.existsSync(dst)) {
      copied.push(`media/providers/${filename}`);
    }
  }
  return copied;
}

function packVsix() {
  const pkg = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "package.json"), "utf8"));
  const iconPng = renderBrandPng(128);
  fs.writeFileSync(path.join(EXT_DIR, "media", "icon.png"), iconPng);
  const bundledLogos = syncProviderLogos();

  const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Publisher="${escapeXml(pkg.publisher)}" />
    <DisplayName>${escapeXml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description)}</Description>
    <Tags>${escapeXml((pkg.keywords || []).join(","))}</Tags>
    <Categories>${escapeXml((pkg.categories || []).join(","))}</Categories>
    <Icon>extension/media/icon.png</Icon>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines?.vscode || "^1.85.0")}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${escapeXml(pkg.repository?.url || "")}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;

  const includeFiles = [
    "package.json",
    "extension.js",
    "README.md",
    "LICENSE",
    "media/icon.svg",
    "media/icon-activity.svg",
    "media/icon.png",
    "media/webview.css",
    "media/webview.js",
    ...bundledLogos
  ];

  const entries = [
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "extension.vsixmanifest", data: manifestXml }
  ];

  for (const rel of includeFiles) {
    const abs = path.join(EXT_DIR, rel);
    entries.push({
      name: `extension/${rel}`,
      data: fs.readFileSync(abs)
    });
  }

  const vsixBuffer = buildZip(entries);
  const vsixName = `${pkg.name}-${pkg.version}.vsix`;
  const outPath = path.join(EXT_DIR, vsixName);
  fs.writeFileSync(outPath, vsixBuffer);
  fs.mkdirSync(path.dirname(PUBLIC_VSIX), { recursive: true });
  fs.writeFileSync(PUBLIC_VSIX, vsixBuffer);

  return {
    outPath,
    publicPath: PUBLIC_VSIX,
    bytes: vsixBuffer.length,
    entryCount: entries.length
  };
}

module.exports = { packVsix };

if (require.main === module) {
  const res = packVsix();
  console.log(`Packed VSIX: ${res.outPath} (${res.bytes} bytes, ${res.entryCount} entries)`);
  console.log(`Copied VSIX to: ${res.publicPath}`);
}
