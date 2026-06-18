// electron-builder afterPack hook.
//
// With `mac.identity: null` electron-builder skips signing, which leaves the
// stock Electron ad-hoc signature in place. Once app.asar and the unpacked
// native modules (node-pty) are inserted, that seal no longer matches the
// bundle contents. On Apple Silicon the OS then refuses to posix_spawn the
// nested node-pty `spawn-helper`, so every in-app terminal session dies with
// "An internal error occurred (EPERM)".
//
// Re-signing the fully assembled bundle ad-hoc (`codesign -s -`) repairs the
// seal. No Developer ID / certificate required; this is enough for local
// distribution (users still clear quarantine on first launch).
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] ad-hoc deep re-signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });

  // Fail the build loudly if the seal still doesn't verify.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log('[afterPack] signature verified');
};
