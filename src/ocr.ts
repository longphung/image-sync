import { extractTextFromImage, isSupported } from 'expo-text-extractor';

export function isTextRecognitionSupported(): boolean {
  return isSupported;
}

export async function extractTextLines(photoUri: string): Promise<string[]> {
  if (!isSupported) {
    throw new Error('Text recognition is not supported on this device.');
  }
  try {
    const lines = await extractTextFromImage(photoUri);
    return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  } catch (err) {
    console.warn('OCR extraction failed:', err);
    throw new Error(
      "Couldn't read text from that photo. Try retaking it with the label in better light and fully in frame.",
    );
  }
}
