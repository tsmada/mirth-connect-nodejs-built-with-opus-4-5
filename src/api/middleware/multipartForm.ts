/**
 * Multipart Form Data Middleware
 *
 * Java Mirth Administrator GUI sends bulk update endpoints as multipart/form-data
 * with @FormDataParam-annotated XML string fields. Express's built-in body parsers
 * (json, urlencoded, text) don't handle multipart. This middleware:
 *
 * 1. Detects multipart/form-data Content-Type
 * 2. Uses Multer to extract text form fields into req.body
 * 3. Parses XML string values into objects (matching contentNegotiation.ts config)
 * 4. Passes through for non-multipart requests (JSON body already parsed)
 *
 * Usage: Add to route middleware chain for endpoints that Java sends as multipart.
 */

import { Request, Response, NextFunction } from 'express';
import * as multer from 'multer';
import { XMLParser } from 'fast-xml-parser';

const upload = multer.default({ storage: multer.memoryStorage() });

// Match the XMLParser config from contentNegotiation.ts
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

/**
 * Middleware that handles multipart/form-data for non-file endpoints.
 * Safe to chain with express.json() — only activates for multipart requests.
 */
export function multipartFormMiddleware() {
  const multerNone = upload.none();

  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.get('Content-Type') || '';
    if (!contentType.startsWith('multipart/form-data')) {
      next();
      return;
    }

    multerNone(req, res, (err: unknown) => {
      if (err) {
        next(err);
        return;
      }

      // Parse XML string values in form fields
      if (req.body && typeof req.body === 'object') {
        for (const [key, value] of Object.entries(req.body)) {
          if (typeof value === 'string' && value.trim().startsWith('<')) {
            try {
              req.body[key] = xmlParser.parse(value);
            } catch {
              // Keep original string if XML parsing fails
            }
          }
        }
      }

      next();
    });
  };
}
