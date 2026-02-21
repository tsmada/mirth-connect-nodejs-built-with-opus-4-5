import * as fs from 'fs';
import type { TransformResult } from '../types.js';

export class ChannelXmlWriter {
  /** Write transformed scripts back to channel XML file */
  writeChannelXml(xmlPath: string, results: TransformResult[]): void {
    let xml = fs.readFileSync(xmlPath, 'utf-8');

    for (const result of results) {
      if (!result.changed) continue;

      // Use exact string matching — scripts may contain regex-special chars
      const idx = xml.indexOf(result.original);
      if (idx === -1) continue;

      xml = xml.slice(0, idx) + result.transformed + xml.slice(idx + result.original.length);
    }

    fs.writeFileSync(xmlPath, xml, 'utf-8');
  }

  /** Write transformed scripts back to artifact repo files */
  writeArtifactRepo(results: TransformResult[]): void {
    for (const result of results) {
      if (!result.changed) continue;

      const filePath = result.location.filePath;
      fs.writeFileSync(filePath, result.transformed, 'utf-8');
    }
  }
}
