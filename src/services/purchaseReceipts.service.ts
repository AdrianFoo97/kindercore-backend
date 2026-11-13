import { MB, discardUploads, privateFolder, privateUpload, toAttachment } from './privateUploads.service.js';

// Receipt photos for bought items — private upload root, shown only to
// shopping-list managers.

export { discardUploads, toAttachment };

export const PURCHASE_RECEIPTS_DIR = privateFolder('purchase-receipts');
export const MAX_RECEIPT_BYTES = 10 * MB;

/** Accepts the "bought" form as multipart, with at most one photo under "receipt". */
export const purchaseReceiptUpload = privateUpload({
  dir: PURCHASE_RECEIPTS_DIR,
  field: 'receipt',
  maxFiles: 1,
  maxBytes: MAX_RECEIPT_BYTES,
  kinds: ['image'],
  typeMessage: 'The receipt must be a photo (JPG, PNG, WebP or GIF)',
  tooBigMessage: `The receipt photo must be under ${MAX_RECEIPT_BYTES / MB} MB`,
  tooManyMessage: 'Attach one receipt photo',
});
