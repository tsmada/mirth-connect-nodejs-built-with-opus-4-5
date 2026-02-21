import * as fs from 'fs';
import * as path from 'path';

export class BackupManager {
  constructor(private backupDir?: string) {}

  /** Create backup of a file. Returns backup file path. */
  backup(filePath: string): string {
    const timestamp = this.formatTimestamp(new Date());
    const basename = path.basename(filePath);
    const backupName = `${basename}.${timestamp}.bak`;

    const targetDir = this.backupDir ?? path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const backupPath = path.join(targetDir, backupName);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  /** Restore a file from its most recent backup. */
  restore(filePath: string): boolean {
    const basename = path.basename(filePath);
    const searchDir = this.backupDir ?? path.dirname(filePath);

    if (!fs.existsSync(searchDir)) return false;

    const entries = fs.readdirSync(searchDir);
    const backups = entries
      .filter(e => e.startsWith(basename + '.') && e.endsWith('.bak'))
      .sort();

    if (backups.length === 0) return false;

    const mostRecent = backups[backups.length - 1]!;
    const backupPath = path.join(searchDir, mostRecent);
    fs.copyFileSync(backupPath, filePath);
    return true;
  }

  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}${mo}${d}-${h}${mi}${s}`;
  }
}
