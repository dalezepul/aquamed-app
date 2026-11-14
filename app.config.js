const fs = require('fs');

// google-services.json (FCM, both packages) is gitignored; EAS builds get it from the
// GOOGLE_SERVICES_JSON file secret, local builds from ./google-services.json.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(`${__dirname}/google-services.json`) ? './google-services.json' : undefined);

// APP_VARIANT=test builds a side-by-side test app (own package id), so it never
// collides with — or needs to wipe — an installed store/older build.
module.exports = ({ config }) => {
  const android = { ...config.android, ...(googleServicesFile && { googleServicesFile }) };
  if (process.env.APP_VARIANT !== 'test') return { ...config, android };
  return {
    ...config,
    name: `${config.name} Test`,
    scheme: `${config.scheme}-test`, // widget deep links must open this build, not the store one
    android: { ...android, package: `${config.android.package}.test` },
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.test` },
  };
};
