import { errorMessage, fetchText } from './http.ts';
import type { CameraApi, CameraInfo } from './types.ts';
import { childNodes, descendants, parseXml, tagName, textOf } from './xml.ts';

/**
 * The camera is always the DHCP gateway at this fixed IP once joined to its Wi-Fi access point
 * in "Send to Smartphone" mode — no SSDP/UDP discovery is needed. Callers can override this with
 * a manual IP for cameras that use a different gateway address.
 */
export const DEFAULT_HOST = '192.168.122.1';
const DEVICE_DESCRIPTION_PORT = 64321;

/** Fetch and classify the camera's device description (`DmsDesc.xml`) at `host`. */
export async function getCameraInfo(host?: string): Promise<CameraInfo> {
  const ddUrl = `http://${host ?? DEFAULT_HOST}:${DEVICE_DESCRIPTION_PORT}/DmsDesc.xml`;
  let xmlText: string;
  try {
    xmlText = await fetchText(ddUrl);
  } catch (err) {
    throw new Error(`HTTP request failed: GET ${ddUrl}: ${errorMessage(err)}`);
  }
  return parseDeviceDescription(xmlText, ddUrl);
}

/**
 * Parse a device description document and classify it as Scalar Web API or DLNA
 * ContentDirectory. Scalar is preferred when both are somehow present, matching the reference
 * client's precedence.
 */
export function parseDeviceDescription(xmlText: string, ddUrl: string): CameraInfo {
  let scalarBaseUrl: string | undefined;
  let dlnaControlUrl: string | undefined;
  let photoRoot: string | undefined;
  let friendlyName = '';
  let modelName = '';

  for (const node of descendants(parseXml(xmlText))) {
    switch (tagName(node)) {
      case 'X_ScalarWebAPI_ActionList_URL': {
        const text = textOf(node).trim();
        if (text) scalarBaseUrl = text.replace(/\/+$/, '');
        break;
      }
      case 'service': {
        if (dlnaControlUrl) break;
        let isContentDirectory = false;
        let controlUrl = '';
        for (const child of childNodes(node)) {
          if (tagName(child) === 'serviceType' && textOf(child).includes('ContentDirectory')) {
            isContentDirectory = true;
          } else if (tagName(child) === 'controlURL') {
            controlUrl = textOf(child).trim();
          }
        }
        if (isContentDirectory && controlUrl) dlnaControlUrl = `${origin(ddUrl)}${controlUrl}`;
        break;
      }
      case 'photoRoot': {
        const text = textOf(node).trim();
        if (text) photoRoot = text;
        break;
      }
      // First non-empty occurrence wins, so an embedded sub-device can't override the root's name.
      case 'friendlyName':
        friendlyName ||= textOf(node).trim();
        break;
      case 'modelName':
        modelName ||= textOf(node).trim();
        break;
    }
  }

  let api: CameraApi;
  if (scalarBaseUrl) {
    api = { kind: 'scalar', baseUrl: scalarBaseUrl };
  } else if (dlnaControlUrl) {
    api = { kind: 'dlna', controlUrl: dlnaControlUrl, photoRoot: photoRoot ?? '0' };
  } else {
    throw new Error(`unrecognized camera device description at ${ddUrl} (neither Scalar nor DLNA)`);
  }

  return { api, name: friendlyName || modelName || undefined };
}

/** The `scheme://host[:port]` origin of a URL, for joining against a relative `controlURL`. */
function origin(url: string): string {
  return /^[^:/]+:\/\/[^/]+/.exec(url)?.[0] ?? url;
}
