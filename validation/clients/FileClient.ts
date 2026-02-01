import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modifiedTime: Date;
  content?: string;
}

export interface FileComparisonResult {
  match: boolean;
  file1Exists: boolean;
  file2Exists: boolean;
  sizeDifference?: number;
  contentDifference?: string;
}

export class FileClient {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.ensureDirectory(basePath);
  }

  /**
   * Ensure a directory exists, creating it if necessary
   */
  ensureDirectory(dirPath: string): void {
    const fullPath = this.resolvePath(dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  /**
   * Resolve a path relative to the base path
   */
  resolvePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.join(this.basePath, relativePath);
  }

  /**
   * Write content to a file
   */
  writeFile(relativePath: string, content: string | Buffer): void {
    const fullPath = this.resolvePath(relativePath);
    const dir = path.dirname(fullPath);
    this.ensureDirectory(dir);
    fs.writeFileSync(fullPath, content);
  }

  /**
   * Read content from a file
   */
  readFile(relativePath: string): string | null {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fs.readFileSync(fullPath, 'utf8');
  }

  /**
   * Read file as buffer
   */
  readFileBuffer(relativePath: string): Buffer | null {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fs.readFileSync(fullPath);
  }

  /**
   * Check if a file exists
   */
  fileExists(relativePath: string): boolean {
    const fullPath = this.resolvePath(relativePath);
    return fs.existsSync(fullPath);
  }

  /**
   * Delete a file
   */
  deleteFile(relativePath: string): boolean {
    const fullPath = this.resolvePath(relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  }

  /**
   * Delete all files in a directory
   */
  clearDirectory(relativePath: string): void {
    const fullPath = this.resolvePath(relativePath);
    if (fs.existsSync(fullPath)) {
      const files = fs.readdirSync(fullPath);
      for (const file of files) {
        const filePath = path.join(fullPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        } else if (stat.isDirectory()) {
          this.clearDirectory(filePath);
          fs.rmdirSync(filePath);
        }
      }
    }
  }

  /**
   * List files in a directory
   */
  listFiles(relativePath: string, pattern?: RegExp): FileInfo[] {
    const fullPath = this.resolvePath(relativePath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const files = fs.readdirSync(fullPath);
    const result: FileInfo[] = [];

    for (const file of files) {
      if (pattern && !pattern.test(file)) {
        continue;
      }

      const filePath = path.join(fullPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        result.push({
          path: filePath,
          name: file,
          size: stat.size,
          modifiedTime: stat.mtime,
        });
      }
    }

    return result.sort((a, b) => a.modifiedTime.getTime() - b.modifiedTime.getTime());
  }

  /**
   * Wait for a file to appear
   */
  async waitForFile(
    relativePath: string,
    timeoutMs = 30000,
    pollIntervalMs = 500
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this.fileExists(relativePath)) {
        return true;
      }
      await this.delay(pollIntervalMs);
    }

    return false;
  }

  /**
   * Wait for any new file in a directory
   */
  async waitForNewFile(
    relativePath: string,
    timeoutMs = 30000,
    pollIntervalMs = 500
  ): Promise<FileInfo | null> {
    const startTime = Date.now();
    const initialFiles = new Set(this.listFiles(relativePath).map((f) => f.name));

    while (Date.now() - startTime < timeoutMs) {
      const currentFiles = this.listFiles(relativePath);
      const newFile = currentFiles.find((f) => !initialFiles.has(f.name));
      if (newFile) {
        return newFile;
      }
      await this.delay(pollIntervalMs);
    }

    return null;
  }

  /**
   * Compare two files
   */
  compareFiles(path1: string, path2: string): FileComparisonResult {
    const fullPath1 = this.resolvePath(path1);
    const fullPath2 = this.resolvePath(path2);

    const exists1 = fs.existsSync(fullPath1);
    const exists2 = fs.existsSync(fullPath2);

    if (!exists1 || !exists2) {
      return {
        match: false,
        file1Exists: exists1,
        file2Exists: exists2,
      };
    }

    const content1 = fs.readFileSync(fullPath1, 'utf8');
    const content2 = fs.readFileSync(fullPath2, 'utf8');

    if (content1 === content2) {
      return {
        match: true,
        file1Exists: true,
        file2Exists: true,
      };
    }

    return {
      match: false,
      file1Exists: true,
      file2Exists: true,
      sizeDifference: content1.length - content2.length,
      contentDifference: this.generateDiff(content1, content2),
    };
  }

  /**
   * Generate a simple diff between two strings
   */
  private generateDiff(str1: string, str2: string): string {
    const lines1 = str1.split('\n');
    const lines2 = str2.split('\n');
    const diffLines: string[] = [];

    const maxLines = Math.max(lines1.length, lines2.length);
    for (let i = 0; i < maxLines; i++) {
      const line1 = lines1[i];
      const line2 = lines2[i];

      if (line1 === undefined) {
        diffLines.push(`+ ${i + 1}: ${line2}`);
      } else if (line2 === undefined) {
        diffLines.push(`- ${i + 1}: ${line1}`);
      } else if (line1 !== line2) {
        diffLines.push(`- ${i + 1}: ${line1}`);
        diffLines.push(`+ ${i + 1}: ${line2}`);
      }
    }

    return diffLines.join('\n');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create file clients for Java and Node.js test data directories
 */
export function createFileClients(
  javaTestDataPath: string,
  nodeTestDataPath: string
): {
  java: FileClient;
  node: FileClient;
} {
  return {
    java: new FileClient(javaTestDataPath),
    node: new FileClient(nodeTestDataPath),
  };
}
