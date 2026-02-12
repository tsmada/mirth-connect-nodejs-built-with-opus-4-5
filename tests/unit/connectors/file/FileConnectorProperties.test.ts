import {
  getDefaultFileReceiverProperties,
  getDefaultFileDispatcherProperties,
  globToRegex,
  matchesFilter,
  generateOutputFilename,
  FileScheme,
  AfterProcessingAction,
  FileSortBy,
} from '../../../../src/connectors/file/FileConnectorProperties';

describe('FileConnectorProperties', () => {
  describe('getDefaultFileReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultFileReceiverProperties();

      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.host).toBe('');
      expect(props.anonymous).toBe(true);       // Java default: true
      expect(props.username).toBe('anonymous');  // Java default: "anonymous"
      expect(props.password).toBe('anonymous');  // Java default: "anonymous"
      expect(props.directory).toBe('');
      expect(props.fileFilter).toBe('*');
      expect(props.regex).toBe(false);
      expect(props.directoryRecursion).toBe(false);
      expect(props.ignoreDot).toBe(true);
      expect(props.binary).toBe(false);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.afterProcessingAction).toBe(AfterProcessingAction.NONE);
      expect(props.pollInterval).toBe(5000);
      expect(props.sortBy).toBe(FileSortBy.DATE);
      expect(props.secure).toBe(true);           // Java default: true (FTPS)
    });

    it('should return independent instances', () => {
      const props1 = getDefaultFileReceiverProperties();
      const props2 = getDefaultFileReceiverProperties();

      props1.directory = '/test/path';
      expect(props2.directory).toBe('');
    });
  });

  describe('getDefaultFileDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultFileDispatcherProperties();

      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.host).toBe('');
      expect(props.anonymous).toBe(true);       // Java default: true
      expect(props.username).toBe('anonymous');  // Java default: "anonymous"
      expect(props.password).toBe('anonymous');  // Java default: "anonymous"
      expect(props.directory).toBe('');
      expect(props.outputPattern).toContain('${date:');
      expect(props.outputPattern).toContain('${UUID}');
      expect(props.outputAppend).toBe(true);
      expect(props.template).toBe('');
      expect(props.binary).toBe(false);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.secure).toBe(true);           // Java default: true (FTPS)
    });

    it('should return independent instances', () => {
      const props1 = getDefaultFileDispatcherProperties();
      const props2 = getDefaultFileDispatcherProperties();

      props1.directory = '/output/path';
      expect(props2.directory).toBe('');
    });
  });

  describe('globToRegex', () => {
    it('should convert simple wildcard', () => {
      const regex = globToRegex('*.txt');
      expect(regex.test('file.txt')).toBe(true);
      expect(regex.test('document.txt')).toBe(true);
      expect(regex.test('file.csv')).toBe(false);
    });

    it('should convert multiple wildcards', () => {
      const regex = globToRegex('file_*_*.dat');
      expect(regex.test('file_2024_001.dat')).toBe(true);
      expect(regex.test('file_test_backup.dat')).toBe(true);
      expect(regex.test('file_single.dat')).toBe(false);
    });

    it('should convert single character wildcard', () => {
      const regex = globToRegex('file?.txt');
      expect(regex.test('file1.txt')).toBe(true);
      expect(regex.test('fileA.txt')).toBe(true);
      expect(regex.test('file12.txt')).toBe(false);
    });

    it('should escape regex special characters', () => {
      const regex = globToRegex('file[1].txt');
      expect(regex.test('file[1].txt')).toBe(true);
      expect(regex.test('file1.txt')).toBe(false);
    });

    it('should be case insensitive', () => {
      const regex = globToRegex('*.TXT');
      expect(regex.test('FILE.txt')).toBe(true);
      expect(regex.test('file.TXT')).toBe(true);
    });
  });

  describe('matchesFilter', () => {
    describe('glob patterns', () => {
      it('should match all files with asterisk', () => {
        expect(matchesFilter('file.txt', '*', false)).toBe(true);
        expect(matchesFilter('document.pdf', '*', false)).toBe(true);
      });

      it('should match extension patterns', () => {
        expect(matchesFilter('file.txt', '*.txt', false)).toBe(true);
        expect(matchesFilter('file.csv', '*.txt', false)).toBe(false);
      });

      it('should match prefix patterns', () => {
        expect(matchesFilter('data_001.xml', 'data_*.xml', false)).toBe(true);
        expect(matchesFilter('log_001.xml', 'data_*.xml', false)).toBe(false);
      });

      it('should handle empty pattern', () => {
        expect(matchesFilter('file.txt', '', false)).toBe(true);
      });
    });

    describe('regex patterns', () => {
      it('should match regex patterns', () => {
        expect(matchesFilter('file123.txt', 'file\\d+\\.txt', true)).toBe(true);
        expect(matchesFilter('fileabc.txt', 'file\\d+\\.txt', true)).toBe(
          false
        );
      });

      it('should handle complex regex', () => {
        expect(
          matchesFilter('data_2024-01-15.csv', 'data_\\d{4}-\\d{2}-\\d{2}\\.csv', true)
        ).toBe(true);
      });

      it('should handle invalid regex gracefully', () => {
        expect(matchesFilter('file.txt', '[invalid', true)).toBe(false);
      });
    });
  });

  describe('generateOutputFilename', () => {
    it('should replace UUID pattern', () => {
      const filename = generateOutputFilename('output_${UUID}.txt');
      expect(filename).toMatch(/^output_[a-f0-9-]{36}\.txt$/);
    });

    it('should replace date patterns', () => {
      const filename = generateOutputFilename('log_${date:yyyy-MM-dd}.txt');
      expect(filename).toMatch(/^log_\d{4}-\d{2}-\d{2}\.txt$/);
    });

    it('should replace datetime patterns', () => {
      const filename = generateOutputFilename('file_${date:yyyyMMddHHmmss}.txt');
      expect(filename).toMatch(/^file_\d{14}\.txt$/);
    });

    it('should replace custom variables', () => {
      const filename = generateOutputFilename('msg_${messageId}_${channelId}.txt', {
        messageId: '12345',
        channelId: 'abc-def',
      });
      expect(filename).toBe('msg_12345_abc-def.txt');
    });

    it('should handle multiple replacements', () => {
      const filename = generateOutputFilename(
        '${channelId}_${date:yyyy}_${UUID}.txt',
        { channelId: 'test' }
      );
      expect(filename).toMatch(/^test_\d{4}_[a-f0-9-]{36}\.txt$/);
    });

    it('should preserve patterns without match', () => {
      const filename = generateOutputFilename('static_filename.txt');
      expect(filename).toBe('static_filename.txt');
    });
  });

  describe('FileScheme enum', () => {
    it('should have correct values', () => {
      expect(FileScheme.FILE).toBe('FILE');
      expect(FileScheme.FTP).toBe('FTP');
      expect(FileScheme.SFTP).toBe('SFTP');
      expect(FileScheme.S3).toBe('S3');
      expect(FileScheme.SMB).toBe('SMB');
    });
  });

  describe('AfterProcessingAction enum', () => {
    it('should have correct values', () => {
      expect(AfterProcessingAction.NONE).toBe('NONE');
      expect(AfterProcessingAction.MOVE).toBe('MOVE');
      expect(AfterProcessingAction.DELETE).toBe('DELETE');
    });
  });

  describe('FileSortBy enum', () => {
    it('should have correct values', () => {
      expect(FileSortBy.NAME).toBe('NAME');
      expect(FileSortBy.SIZE).toBe('SIZE');
      expect(FileSortBy.DATE).toBe('DATE');
    });
  });
});
