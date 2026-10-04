import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { FFmpegKit, FFmpegSession, FFprobeKit, ReturnCode } from '@mtd1410/react-native-ffmpegkit';

// AVCHD (.MTS/.M2TS) is rejected by the iOS Photos library, and Android galleries often play it
// silently (AC-3 audio). Its 60i modes are also interlaced, which iOS can't play at all.
export function needsMp4Conversion(filename: string): boolean {
  return /\.(mts|m2ts)$/i.test(filename);
}

const INTERLACED_FIELD_ORDERS = new Set(['tt', 'bb', 'tb', 'bt']);

// Converts `src` to an H.264/AAC MP4 next to it and returns that file; the original is kept.
// Progressive video is copied as-is (fast, lossless). Interlaced video is deinterlaced and
// re-encoded on the hardware encoder. Like downloadToPhotosDir(), writes to a `.part` file
// first, so an interrupted run is never mistaken for a finished one.
export async function convertToMp4(
  src: File,
  onPercent?: (percent: number) => void,
): Promise<File> {
  const dest = new File(src.parentDirectory, src.name.replace(/\.[^.]+$/, '.mp4'));
  if (dest.exists) return dest;
  const part = new File(src.parentDirectory, `${dest.name}.part`);

  const info = (await FFprobeKit.getMediaInformation(toPath(src))).getMediaInformation();
  const durationMs = Number(info?.getDuration()) * 1000;
  const fieldOrder = info?.getStreams().find((s) => s.getType() === 'video')?.getStringProperty('field_order');
  const videoArgs = INTERLACED_FIELD_ORDERS.has(fieldOrder ?? '')
    ? ['-vf', 'bwdif', '-c:v', Platform.OS === 'ios' ? 'h264_videotoolbox' : 'h264_mediacodec', '-b:v', '20M']
    : ['-c:v', 'copy'];

  const args = [
    '-y', '-i', toPath(src),
    '-map', '0:v:0', '-map', '0:a:0?',
    ...videoArgs,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-f', 'mp4', toPath(part),
  ];
  const session = await new Promise<FFmpegSession>((resolve, reject) => {
    FFmpegKit.executeWithArgumentsAsync(args, resolve, undefined, (stats) => {
      if (onPercent && durationMs > 0) {
        onPercent(Math.min(100, Math.floor((stats.getTime() * 100) / durationMs)));
      }
    }).catch(reject);
  });

  if (!ReturnCode.isSuccess(await session.getReturnCode())) {
    if (part.exists) part.delete();
    const logs = (await session.getAllLogsAsString()).trim().split('\n');
    console.log('[convertToMp4] ffmpeg failed', { args, logs: logs.slice(-20) });
    throw new Error(`Video conversion failed: ${logs.slice(-2).join(' ')}`);
  }
  await part.move(dest);
  return dest;
}

// FFmpeg wants a plain filesystem path, not a file:// URI.
function toPath(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}
