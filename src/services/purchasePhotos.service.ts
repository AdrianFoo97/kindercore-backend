import { MB, discardUploads, privateFolder, privateUpload, toAttachment, type StoredAttachment } from './privateUploads.service.js';

// Photos attached to a purchase request (e.g. the exact product). Kept in the
// PRIVATE upload root and served only through an authenticated endpoint — to
// the requester, the shopping-list managers and Admins.

export { discardUploads, toAttachment };
export type PurchasePhoto = StoredAttachment;

export const PURCHASE_PHOTOS_DIR = privateFolder('purchase-requests');
export const MAX_PURCHASE_PHOTOS = 3;
export const MAX_PURCHASE_PHOTO_BYTES = 10 * MB;

/** Accepts the request form as multipart, with up to MAX_PURCHASE_PHOTOS photos under "photos". (Plain JSON still works.) */
export const purchasePhotosUpload = privateUpload({
  dir: PURCHASE_PHOTOS_DIR,
  field: 'photos',
  maxFiles: MAX_PURCHASE_PHOTOS,
  maxBytes: MAX_PURCHASE_PHOTO_BYTES,
  kinds: ['image'],
  typeMessage: 'Only photos (JPG, PNG, WebP, GIF) can be attached',
  tooBigMessage: `Each photo must be under ${MAX_PURCHASE_PHOTO_BYTES / MB} MB`,
  tooManyMessage: `Attach up to ${MAX_PURCHASE_PHOTOS} photos`,
});
