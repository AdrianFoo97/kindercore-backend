import {
  MB, attachmentKind, discardUploads, privateFolder, privateUpload, toAttachment, type StoredAttachment,
} from './privateUploads.service.js';

// Photos / videos attached to a facility issue. Kept in the PRIVATE upload
// root — pictures from inside the centre can show children — and served only
// through an authenticated endpoint to the reporter and facility managers.

export { discardUploads, toAttachment };
export type FacilityAttachment = StoredAttachment;

export const FACILITY_ATTACHMENTS_DIR = privateFolder('facility-issues');

export const MAX_FACILITY_ATTACHMENTS = 4;
export const MAX_FACILITY_IMAGE_BYTES = 10 * MB;
export const MAX_FACILITY_VIDEO_BYTES = 50 * MB;
const TYPE_MESSAGE = 'Only photos (JPG, PNG, WebP, GIF) or videos (MP4, MOV, WebM) can be attached';

/** Why these files can't be attached (type, size per kind, how many), or null when they're fine. */
export function attachmentProblem(files: { mimetype: string; size: number }[]): string | null {
  if (files.length > MAX_FACILITY_ATTACHMENTS) return `Attach up to ${MAX_FACILITY_ATTACHMENTS} photos or videos`;
  for (const f of files) {
    const kind = attachmentKind(f.mimetype);
    if (!kind) return TYPE_MESSAGE;
    const max = kind === 'video' ? MAX_FACILITY_VIDEO_BYTES : MAX_FACILITY_IMAGE_BYTES;
    if (f.size > max) return `Each ${kind} must be under ${max / MB} MB`;
  }
  return null;
}

/** Accepts the report form as multipart, with up to MAX_FACILITY_ATTACHMENTS files under "attachments". */
export const facilityAttachmentsUpload = privateUpload({
  dir: FACILITY_ATTACHMENTS_DIR,
  field: 'attachments',
  maxFiles: MAX_FACILITY_ATTACHMENTS,
  // Multer's cap is the larger (video) one; the per-kind check runs in the handler.
  maxBytes: MAX_FACILITY_VIDEO_BYTES,
  kinds: ['image', 'video'],
  typeMessage: TYPE_MESSAGE,
  tooBigMessage: `Each video must be under ${MAX_FACILITY_VIDEO_BYTES / MB} MB`,
  tooManyMessage: `Attach up to ${MAX_FACILITY_ATTACHMENTS} photos or videos`,
});
