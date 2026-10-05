/// <reference types="node" />
// Run with `pnpm test` (Node's built-in runner; Node strips the TS types itself).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { desktopBaseUrl, parseDesktopImages, parseHostPort, parsePairingQr } from './desktop.ts';
import { parseDeviceDescription } from './discovery.ts';
import {
  parseBrowseResponse,
  parseDidl,
  pickOriginalRes,
  thumbnailUrl,
  type DidlRes,
} from './dlna.ts';
import { contentItemToImageItem } from './scalar.ts';
import { unescapeXmlEntitiesOnce } from './xml.ts';

describe('unescapeXmlEntitiesOnce', () => {
  test('resolves singly escaped entities to raw characters', () => {
    assert.equal(unescapeXmlEntitiesOnce('&lt;tag&gt;text&lt;/tag&gt;'), '<tag>text</tag>');
  });

  test('only removes one level from doubly escaped entities', () => {
    assert.equal(unescapeXmlEntitiesOnce('&amp;lt;'), '&lt;');
  });

  test('replaces &amp; last so it does not feed earlier replacements', () => {
    assert.equal(unescapeXmlEntitiesOnce('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  });

  test('is a no-op on plain text', () => {
    assert.equal(unescapeXmlEntitiesOnce('plain text'), 'plain text');
  });
});

describe('parseDeviceDescription', () => {
  const DD_URL = 'http://192.168.122.1:64321/DmsDesc.xml';
  const contentDirectoryService = `
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <controlURL>/upnp/control/ContentDirectory</controlURL>
      </service>
    </serviceList>`;

  test('parses a DLNA description and joins the control URL', () => {
    const xml = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:av="urn:schemas-sony-com:av">
  <device>
    <av:photoRoot>PhotoRoot</av:photoRoot>
    ${contentDirectoryService}
  </device>
</root>`;
    assert.deepEqual(parseDeviceDescription(xml, DD_URL).api, {
      kind: 'dlna',
      controlUrl: 'http://192.168.122.1:64321/upnp/control/ContentDirectory',
      photoRoot: 'PhotoRoot',
    });
  });

  test('parses a Scalar description and strips the trailing slash', () => {
    const xml = `<?xml version="1.0"?>
<root><device>
  <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony/</X_ScalarWebAPI_ActionList_URL>
</device></root>`;
    assert.deepEqual(parseDeviceDescription(xml, DD_URL).api, {
      kind: 'scalar',
      baseUrl: 'http://192.168.122.1:10000/sony',
    });
  });

  test('prefers Scalar when both are present', () => {
    const xml = `<?xml version="1.0"?>
<root><device>
  <X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony</X_ScalarWebAPI_ActionList_URL>
  ${contentDirectoryService}
</device></root>`;
    assert.equal(parseDeviceDescription(xml, DD_URL).api.kind, 'scalar');
  });

  test('throws on an unrecognized device', () => {
    const xml = '<?xml version="1.0"?><root><device><friendlyName>Nope</friendlyName></device></root>';
    assert.throws(() => parseDeviceDescription(xml, DD_URL), /unrecognized camera device description/);
  });

  test('defaults photoRoot to "0" when missing', () => {
    const xml = `<?xml version="1.0"?><root><device>${contentDirectoryService}</device></root>`;
    assert.deepEqual(parseDeviceDescription(xml, DD_URL).api, {
      kind: 'dlna',
      controlUrl: 'http://192.168.122.1:64321/upnp/control/ContentDirectory',
      photoRoot: '0',
    });
  });

  test('extracts friendlyName with entities and falls back to modelName', () => {
    const scalar =
      '<X_ScalarWebAPI_ActionList_URL>http://192.168.122.1:10000/sony</X_ScalarWebAPI_ActionList_URL>';
    let xml = `<?xml version="1.0"?><root><device>
    <friendlyName>Sony &amp; Co RX100M3</friendlyName>
    <modelName>DSC-RX100M3</modelName>${scalar}</device></root>`;
    assert.equal(parseDeviceDescription(xml, DD_URL).name, 'Sony & Co RX100M3');

    xml = `<?xml version="1.0"?><root><device>
    <friendlyName>  </friendlyName>
    <modelName>DSC-RX100M3</modelName>${scalar}</device></root>`;
    assert.equal(parseDeviceDescription(xml, DD_URL).name, 'DSC-RX100M3');
  });
});

describe('pickOriginalRes', () => {
  const res = (url: string, protocolInfo: string, size: number): DidlRes => ({
    url,
    protocolInfo,
    size,
  });
  const thumb = res('http://cam/thumb.jpg', 'http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN', 1000);
  const large = res('http://cam/large.jpg', 'http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG', 50000);

  test('prefers the original over converted resources', () => {
    const original = res('http://cam/ORG_DSC01309.JPG', 'http-get:*:image/jpeg:*', 4_500_000);
    assert.deepEqual(pickOriginalRes([thumb, large, original]), {
      url: 'http://cam/ORG_DSC01309.JPG',
      filename: 'ORG_DSC01309.JPG',
    });
  });

  test('falls back to the first converted resource when there is no original', () => {
    assert.equal(pickOriginalRes([thumb, large]).url, 'http://cam/thumb.jpg');
  });

  test('prefers a profiled video over the thumbnail', () => {
    const video = res(
      'http://cam/MAH01032.MP4',
      'http-get:*:video/mp4:DLNA.ORG_PN=AVC_MP4_HP_HD_AAC',
      90_000_000,
    );
    assert.deepEqual(pickOriginalRes([thumb, video]), {
      url: 'http://cam/MAH01032.MP4',
      filename: 'MAH01032.MP4',
    });
  });

  test('picks the largest among multiple originals', () => {
    const list = [
      res('http://cam/a.jpg', 'http-get:*:image/jpeg:*', 100),
      res('http://cam/b.jpg', 'http-get:*:image/jpeg:*', 200),
    ];
    assert.equal(pickOriginalRes(list).url, 'http://cam/b.jpg');
  });

  test('thumbnailUrl finds JPEG_TN', () => {
    assert.equal(thumbnailUrl([thumb]), 'http://cam/thumb.jpg');
    assert.equal(thumbnailUrl([]), '');
  });
});

describe('DIDL-Lite parsing', () => {
  test('parseDidl extracts items and containers', () => {
    const xml = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/">
<container id="1" childCount="3"/>
<item id="2" parentID="1">
  <dc:title>ORG_DSC01309</dc:title>
  <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN">http://cam/thumb.jpg</res>
  <res protocolInfo="http-get:*:image/jpeg:*" size="4500000">http://cam/ORG_DSC01309.JPG</res>
</item>
</DIDL-Lite>`;
    const nodes = parseDidl(xml);
    assert.equal(nodes.length, 2);
    assert.deepEqual(nodes[0], { kind: 'container', id: '1' });
    assert.equal(nodes[1].kind, 'item');
    if (nodes[1].kind !== 'item') return;
    assert.equal(nodes[1].item.title, 'ORG_DSC01309');
    assert.equal(nodes[1].item.res.length, 2);
    assert.equal(nodes[1].item.res[1].url, 'http://cam/ORG_DSC01309.JPG');
    assert.equal(nodes[1].item.res[1].size, 4_500_000);
  });

  test('parseBrowseResponse handles the double-escaped Result', () => {
    // The real DIDL-Lite document is:
    //   <DIDL-Lite ...><item id="2"><dc:title>Sample &amp; Title</dc:title>
    //   <res protocolInfo="..." size="123">http://cam/ORG.JPG</res></item></DIDL-Lite>
    // It is escaped once to become SOAP `<Result>` text, then a second time (every `&` becomes
    // `&amp;`), which is what the Python reference's html.unescape()-after-ElementTree-parse
    // implies about the real camera's wire format. The parser undoes the first layer and
    // unescapeXmlEntitiesOnce the second.
    const raw = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
<s:Body>
<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
<Result>&amp;lt;DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"&amp;gt;&amp;lt;item id="2"&amp;gt;&amp;lt;dc:title&amp;gt;Sample &amp;amp;amp; Title&amp;lt;/dc:title&amp;gt;&amp;lt;res protocolInfo="http-get:*:image/jpeg:*" size="123"&amp;gt;http://cam/ORG.JPG&amp;lt;/res&amp;gt;&amp;lt;/item&amp;gt;&amp;lt;/DIDL-Lite&amp;gt;</Result>
<NumberReturned>1</NumberReturned>
<TotalMatches>1</TotalMatches>
</u:BrowseResponse>
</s:Body>
</s:Envelope>`;
    const { nodes, total } = parseBrowseResponse(raw);
    assert.equal(total, 1);
    assert.ok(nodes);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, 'item');
    if (nodes[0].kind !== 'item') return;
    assert.equal(nodes[0].item.title, 'Sample & Title');
    assert.equal(nodes[0].item.res[0].url, 'http://cam/ORG.JPG');
    assert.equal(nodes[0].item.res[0].size, 123);
  });

  test('parseBrowseResponse returns null nodes without a Result', () => {
    const raw = '<Envelope><Body><BrowseResponse><TotalMatches>3</TotalMatches></BrowseResponse></Body></Envelope>';
    assert.deepEqual(parseBrowseResponse(raw), { nodes: null, total: 3 });
  });
});

describe('contentItemToImageItem', () => {
  test('uses the original when present', () => {
    const result = contentItemToImageItem({
      title: '2026-01-01 12:00:00+0000',
      content: {
        original: [{ url: 'http://cam/ORG_DSC01309.JPG', fileName: 'ORG_DSC01309.JPG' }],
        largeUrl: 'http://cam/large.jpg',
        thumbnailUrl: 'http://cam/thumb.jpg',
      },
    });
    assert.equal(result.url, 'http://cam/ORG_DSC01309.JPG');
    assert.equal(result.filename, 'ORG_DSC01309.JPG');
    assert.equal(result.thumbnailUrl, 'http://cam/thumb.jpg');
  });

  test('falls back to largeUrl, then thumbnailUrl', () => {
    let result = contentItemToImageItem({
      title: 't',
      content: { largeUrl: 'http://cam/large.jpg', thumbnailUrl: 'http://cam/thumb.jpg' },
    });
    assert.equal(result.url, 'http://cam/large.jpg');

    result = contentItemToImageItem({ title: 't', content: { thumbnailUrl: 'http://cam/thumb.jpg' } });
    assert.equal(result.url, 'http://cam/thumb.jpg');
  });

  test('falls back to the title when no filename is available', () => {
    const result = contentItemToImageItem({ title: 'MyPhoto', content: { thumbnailUrl: '' } });
    assert.equal(result.filename, 'MyPhoto');
  });
});

describe('desktop', () => {
  test('parseDesktopImages keeps well-formed items and drops the rest', () => {
    const item = {
      title: 'DSC00001.JPG',
      url: 'http://192.168.1.5:8765/files/2025-06-14/DSC00001.JPG?t=abc',
      filename: '2025-06-14_DSC00001.JPG',
      thumbnailUrl: 'http://192.168.1.5:8765/thumbs/2025-06-14/DSC00001.JPG?t=abc',
    };
    assert.deepEqual(parseDesktopImages(JSON.stringify([item, { title: 'x' }, null])), [item]);
  });

  test('parseDesktopImages rejects a non-list body', () => {
    assert.throws(() => parseDesktopImages('{}'), /did not return a list/);
  });

  test('parsePairingQr reads the v1 payload', () => {
    const qr = { v: 1, id: 'u1', name: 'mac', hosts: ['192.168.1.5', 'mac.tailnet.ts.net'], port: 8765, token: 'p' };
    assert.deepEqual(parsePairingQr(JSON.stringify(qr)), {
      id: 'u1',
      name: 'mac',
      hosts: ['192.168.1.5', 'mac.tailnet.ts.net'],
      port: 8765,
      token: 'p',
    });
  });

  test('parsePairingQr rejects other QR codes', () => {
    assert.throws(() => parsePairingQr('https://example.com'), /Not an image-sync pairing code/);
    assert.throws(() => parsePairingQr('{"v":2,"id":"u","hosts":["h"],"port":1,"token":"t"}'), /Not an/);
    assert.throws(() => parsePairingQr('{"v":1,"id":"u","hosts":[],"port":1,"token":"t"}'), /Not an/);
  });

  test('parseHostPort reads typed addresses', () => {
    assert.deepEqual(parseHostPort(' 192.168.1.5 '), { host: '192.168.1.5', port: 8765 });
    assert.deepEqual(parseHostPort('pc.tailnet.ts.net:9000'), { host: 'pc.tailnet.ts.net', port: 9000 });
    assert.deepEqual(parseHostPort('[fd7a::1]:9000'), { host: 'fd7a::1', port: 9000 });
    assert.equal(parseHostPort(''), null);
    assert.equal(parseHostPort('http://pc'), null);
    assert.equal(parseHostPort('pc:99999'), null);
  });

  test('desktopBaseUrl brackets IPv6 hosts', () => {
    assert.equal(desktopBaseUrl('192.168.1.5', 8765), 'http://192.168.1.5:8765');
    assert.equal(desktopBaseUrl('fd7a::1', 8765), 'http://[fd7a::1]:8765');
  });
});
