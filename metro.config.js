// Metro ignores the generated native folders: a Gradle build rewriting app/android
// otherwise keeps the web/dev watcher busy and the dev server stops answering.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.blockList = [/[\/]android[\/](app[\/]build|build|\.gradle)[\/].*/, /[\/]ios[\/](build|Pods)[\/].*/];

module.exports = config;
