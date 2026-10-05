// The web build only talks to the desktop hub, which already converts AVCHD to MP4 and hides the
// .MTS once the .mp4 exists, so there's nothing to convert in the browser.
export function needsMp4Conversion(_filename: string): boolean {
  return false;
}

export async function convertToMp4(): Promise<never> {
  throw new Error('Video conversion is not available in the browser.');
}
