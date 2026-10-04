// @ts-nocheck
/**
 * A model's attachment points (where a hand holds a weapon), read from the raw M2 file:
 * `@wowserhq/format` parses them but does not keep them. In a 3.3.5a M2 the array is a count and an
 * offset at header byte 0xF0, each entry 40 bytes: id, bone, padding, position, then a visibility
 * track (skipped). Layout from https://wowdev.wiki/M2#Attachments.
 */

type M2Attachment = { id: number; bone: number; position: [number, number, number] };

const ATTACHMENTS_AT = 0xf0;
const ENTRY_SIZE = 40;

const readAttachments = (m2: ArrayBuffer): M2Attachment[] => {
  if (m2.byteLength < ATTACHMENTS_AT + 8) {
    return [];
  }

  const view = new DataView(m2);
  const count = view.getUint32(ATTACHMENTS_AT, true);
  const offset = view.getUint32(ATTACHMENTS_AT + 4, true);
  if (count === 0 || offset + count * ENTRY_SIZE > m2.byteLength) {
    return [];
  }

  const attachments: M2Attachment[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + i * ENTRY_SIZE;
    attachments.push({
      id: view.getUint32(at, true),
      bone: view.getUint16(at + 4, true),
      position: [view.getFloat32(at + 8, true), view.getFloat32(at + 12, true), view.getFloat32(at + 16, true)],
    });
  }
  return attachments;
};

export { readAttachments };
export type { M2Attachment };
