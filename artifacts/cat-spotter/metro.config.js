const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SYC-148: the website's fonts are .woff2 files (lib/fontSources.web.ts).
if (!config.resolver.assetExts.includes('woff2')) {
  config.resolver.assetExts.push('woff2');
}

module.exports = config;
