const { withGradleProperties, withPodfile } = require('expo/config-plugins');

// @mtd1410/react-native-ffmpegkit defaults to the "https" build (adds OpenSSL). The MTS -> MP4
// conversion only needs FFmpeg's built-in demuxers/codecs plus the platform hardware encoders,
// all of which are in "min" (~10 MB smaller on iOS, ~2 MB on Android).
const VARIANT = 'min';

module.exports = function withFfmpegKitMin(config) {
  config = withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter((item) => item.key !== 'ffmpegKitPackage');
    config.modResults.push({ type: 'property', key: 'ffmpegKitPackage', value: VARIANT });
    return config;
  });
  return withPodfile(config, (config) => {
    const line = `ENV['FFMPEGKIT_PACKAGE'] ||= '${VARIANT}'`;
    if (!config.modResults.contents.includes(line)) {
      config.modResults.contents = `${line}\n${config.modResults.contents}`;
    }
    return config;
  });
};
