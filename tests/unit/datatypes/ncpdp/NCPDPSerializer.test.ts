/**
 * NCPDP Serializer Tests
 *
 * Tests for NCPDP message parsing and serialization.
 */

import {
  NCPDPSerializer,
  NCPDPReader,
  NCPDPReference,
  NCPDPVersion,
  unescapeNCPDPDelimiter,
  escapeNCPDPDelimiter,
  detectNCPDPVersion,
  parseNCPDPToXML,
  convertXMLToNCPDP,
} from '../../../../src/datatypes/ncpdp/index.js';

// ASCII control characters for delimiters
const SEGMENT_DELIM = String.fromCharCode(0x1e); // Record Separator
const GROUP_DELIM = String.fromCharCode(0x1d); // Group Separator
const FIELD_DELIM = String.fromCharCode(0x1c); // File Separator

describe('NCPDPSerializer', () => {
  describe('unescapeNCPDPDelimiter', () => {
    it('should convert hex notation to characters', () => {
      expect(unescapeNCPDPDelimiter('0x1E')).toBe(String.fromCharCode(0x1e));
      expect(unescapeNCPDPDelimiter('0x1D')).toBe(String.fromCharCode(0x1d));
      expect(unescapeNCPDPDelimiter('0x1C')).toBe(String.fromCharCode(0x1c));
    });

    it('should handle lowercase hex', () => {
      expect(unescapeNCPDPDelimiter('0x1e')).toBe(String.fromCharCode(0x1e));
    });

    it('should handle escape sequences', () => {
      expect(unescapeNCPDPDelimiter('\\n')).toBe('\n');
      expect(unescapeNCPDPDelimiter('\\r')).toBe('\r');
      expect(unescapeNCPDPDelimiter('\\t')).toBe('\t');
    });

    it('should return plain characters unchanged', () => {
      expect(unescapeNCPDPDelimiter('~')).toBe('~');
      expect(unescapeNCPDPDelimiter('|')).toBe('|');
    });
  });

  describe('escapeNCPDPDelimiter', () => {
    it('should escape non-printable characters to hex', () => {
      expect(escapeNCPDPDelimiter(String.fromCharCode(0x1e))).toBe('0x1E');
      expect(escapeNCPDPDelimiter(String.fromCharCode(0x1d))).toBe('0x1D');
      expect(escapeNCPDPDelimiter(String.fromCharCode(0x1c))).toBe('0x1C');
    });

    it('should not escape printable characters', () => {
      expect(escapeNCPDPDelimiter('~')).toBe('~');
      expect(escapeNCPDPDelimiter('|')).toBe('|');
    });
  });

  describe('detectNCPDPVersion', () => {
    it('should detect D.0 version', () => {
      const message = `999999D0B1          1234567890123456789012345${SEGMENT_DELIM}`;
      expect(detectNCPDPVersion(message)).toBe(NCPDPVersion.D0);
    });

    it('should detect 5.1 version', () => {
      const message = `99999951B1          1234567890123456789012345${SEGMENT_DELIM}`;
      expect(detectNCPDPVersion(message)).toBe(NCPDPVersion.V51);
    });

    it('should default to D.0 when uncertain', () => {
      const message = `some random message`;
      expect(detectNCPDPVersion(message)).toBe(NCPDPVersion.D0);
    });

    it('should use first occurrence when both versions present', () => {
      const message = `D0 comes before 51 in this message`;
      expect(detectNCPDPVersion(message)).toBe(NCPDPVersion.D0);
    });
  });
});

describe('NCPDPReference', () => {
  let reference: NCPDPReference;

  beforeAll(() => {
    reference = NCPDPReference.getInstance();
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const ref1 = NCPDPReference.getInstance();
      const ref2 = NCPDPReference.getInstance();
      expect(ref1).toBe(ref2);
    });
  });

  describe('getTransactionName', () => {
    it('should return Billing for B1', () => {
      expect(reference.getTransactionName('B1')).toBe('Billing');
    });

    it('should return Reversal for B2', () => {
      expect(reference.getTransactionName('B2')).toBe('Reversal');
    });

    it('should return EligibilityVerification for E1', () => {
      expect(reference.getTransactionName('E1')).toBe('EligibilityVerification');
    });

    it('should return code unchanged for unknown', () => {
      expect(reference.getTransactionName('XX')).toBe('XX');
    });
  });

  describe('getSegment', () => {
    it('should return Patient for AM01 in D.0', () => {
      expect(reference.getSegment('AM01', NCPDPVersion.D0)).toBe('Patient');
    });

    it('should return Claim for AM07 in D.0', () => {
      expect(reference.getSegment('AM07', NCPDPVersion.D0)).toBe('Claim');
    });

    it('should return segment ID unchanged for unknown', () => {
      expect(reference.getSegment('XXXX', NCPDPVersion.D0)).toBe('XXXX');
    });
  });

  describe('getDescription', () => {
    it('should return CardholderId for C2 in D.0', () => {
      expect(reference.getDescription('C2', NCPDPVersion.D0)).toBe('CardholderId');
    });

    it('should return DateOfBirth for C4 in D.0', () => {
      expect(reference.getDescription('C4', NCPDPVersion.D0)).toBe('DateOfBirth');
    });

    it('should return empty string for unknown field', () => {
      expect(reference.getDescription('XX', NCPDPVersion.D0)).toBe('');
    });
  });

  describe('getCodeByName', () => {
    it('should return C2 for CardholderId in D.0', () => {
      expect(reference.getCodeByName('CardholderId', NCPDPVersion.D0)).toBe('C2');
    });

    it('should return description unchanged for unknown', () => {
      expect(reference.getCodeByName('UnknownField', NCPDPVersion.D0)).toBe('UnknownField');
    });
  });

  describe('isRepeatingField', () => {
    it('should return true for RejectCode', () => {
      expect(reference.isRepeatingField('RejectCode', NCPDPVersion.D0)).toBe(true);
    });

    it('should return true for DiagnosisCode', () => {
      expect(reference.isRepeatingField('DiagnosisCode', NCPDPVersion.D0)).toBe(true);
    });

    it('should return false for CardholderId', () => {
      expect(reference.isRepeatingField('CardholderId', NCPDPVersion.D0)).toBe(false);
    });
  });
});

describe('NCPDPReader', () => {
  describe('parse', () => {
    it('should throw for empty message', () => {
      const reader = new NCPDPReader();
      expect(() => reader.parse('')).toThrow('Unable to parse');
    });

    it('should throw for message too short', () => {
      const reader = new NCPDPReader();
      expect(() => reader.parse('AB')).toThrow('Unable to parse');
    });

    it('should parse a simple D.0 billing request', () => {
      // Construct a minimal D.0 billing request
      // Header: BIN(6) + Version(2) + TxCode(2) + PCN(10) + Count(1) + SPIdQual(2) + SPId(15) + DOS(8) + VendorId(10)
      const header =
        '999999' + // BIN Number
        'D0' + // Version
        'B1' + // Transaction Code (Billing)
        '          ' + // PCN (10 spaces)
        '1' + // Transaction Count
        '01' + // Service Provider ID Qualifier
        '1234567890ABCDE' + // Service Provider ID (15 chars)
        '20260201' + // Date of Service
        'TESTVENDOR'; // Software Vendor ID (10 chars)

      // Patient segment
      const patientSegment =
        FIELD_DELIM +
        'AM01' + // Segment ID
        FIELD_DELIM +
        'C2' +
        'CARD12345' + // Cardholder ID
        FIELD_DELIM +
        'C4' +
        '19800515'; // Date of Birth

      const message = header + SEGMENT_DELIM + patientSegment;

      const reader = new NCPDPReader();
      const xml = reader.parse(message);

      // Verify XML structure
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<NCPDP_D0_Billing_Request>');
      expect(xml).toContain('<TransactionHeaderRequest>');
      expect(xml).toContain('<BinNumber>999999</BinNumber>');
      expect(xml).toContain('<VersionReleaseNumber>D0</VersionReleaseNumber>');
      expect(xml).toContain('<TransactionCode>B1</TransactionCode>');
      expect(xml).toContain('<Patient>');
      expect(xml).toContain('<CardholderId>CARD12345</CardholderId>');
      expect(xml).toContain('<DateOfBirth>19800515</DateOfBirth>');
      expect(xml).toContain('</Patient>');
      expect(xml).toContain('</NCPDP_D0_Billing_Request>');
    });

    it('should parse a D.0 response message', () => {
      // Response header: Version(2) + TxCode(2) + Count(1) + Status(1) + SPIdQual(2) + SPId(15) + DOS(8)
      const header =
        'D0' + // Version
        'B1' + // Transaction Code
        '1' + // Transaction Count
        'A' + // Header Response Status (Accepted)
        '01' + // Service Provider ID Qualifier
        '1234567890ABCDE' + // Service Provider ID
        '20260201'; // Date of Service

      // Response status segment
      const statusSegment =
        FIELD_DELIM +
        'AM21' + // Response Status segment
        FIELD_DELIM +
        'AN' +
        'A' + // Transaction Response Status
        FIELD_DELIM +
        'F3' +
        '123456789012'; // Authorization Number

      const message = header + SEGMENT_DELIM + statusSegment;

      const reader = new NCPDPReader();
      const xml = reader.parse(message);

      expect(xml).toContain('<NCPDP_D0_Billing_Response>');
      expect(xml).toContain('<TransactionHeaderResponse>');
      expect(xml).toContain('<HeaderResponseStatus>A</HeaderResponseStatus>');
      expect(xml).toContain('<ResponseStatus>');
      expect(xml).toContain('<TransactionResponseStatus>A</TransactionResponseStatus>');
      expect(xml).toContain('<AuthorizationNumber>123456789012</AuthorizationNumber>');
    });

    it('should handle multiple transactions (groups)', () => {
      // Header for a request with transaction count = 2
      // BIN(6) + Version(2) + TxCode(2) + PCN(10) + Count(1) + SPIdQual(2) + SPId(15) + DOS(8) + VendorId(10)
      const header =
        '999999' + // BIN Number (6)
        'D0' + // Version (2)
        'B1' + // Transaction Code (2)
        '          ' + // PCN (10)
        '2' + // Transaction Count (1) - 2 transactions
        '01' + // Service Provider ID Qualifier (2)
        '1234567890ABCDE' + // Service Provider ID (15)
        '20260201' + // Date of Service (8)
        'TESTVENDOR'; // Software Vendor ID (10)

      // First claim segment (before any group delimiter, not in TRANSACTION)
      const claimSegment1 =
        FIELD_DELIM +
        'AM07' + // Claim segment
        FIELD_DELIM +
        'D7' +
        '12345678901'; // Product Service ID

      // Group delimiter starts a new transaction
      // Second claim segment (inside TRANSACTION)
      const claimSegment2 =
        FIELD_DELIM +
        'AM07' +
        FIELD_DELIM +
        'D7' +
        '98765432100';

      const message =
        header +
        SEGMENT_DELIM +
        claimSegment1 +
        GROUP_DELIM + // This starts a new TRANSACTION group
        claimSegment2;

      const reader = new NCPDPReader();
      const xml = reader.parse(message);

      // Verify structure: first segment is NOT in a TRANSACTION,
      // but after group delimiter, we have TRANSACTIONS containing TRANSACTION counter="1"
      expect(xml).toContain('<Claim>');
      expect(xml).toContain('<ProductServiceId>12345678901</ProductServiceId>');
      expect(xml).toContain('<TRANSACTIONS>');
      expect(xml).toContain('<TRANSACTION counter="1">');
      expect(xml).toContain('<ProductServiceId>98765432100</ProductServiceId>');
      expect(xml).toContain('</TRANSACTIONS>');
    });
  });
});

describe('NCPDPSerializer', () => {
  describe('toXML', () => {
    it('should convert NCPDP message to XML', () => {
      const header =
        '999999D0B1          11234567890ABCDE20260201TESTVENDOR';
      const segment =
        FIELD_DELIM +
        'AM01' +
        FIELD_DELIM +
        'C2' +
        'TEST123';

      const message = header + SEGMENT_DELIM + segment;
      const serializer = new NCPDPSerializer();
      const xml = serializer.toXML(message);

      expect(xml).toContain('<NCPDP_D0_Billing_Request>');
      expect(xml).toContain('<CardholderId>TEST123</CardholderId>');
    });
  });

  describe('fromXML', () => {
    it('should convert XML back to NCPDP', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NCPDP_D0_Billing_Request>
  <TransactionHeaderRequest>
    <BinNumber>999999</BinNumber>
    <VersionReleaseNumber>D0</VersionReleaseNumber>
    <TransactionCode>B1</TransactionCode>
    <ProcessorControlNumber>          </ProcessorControlNumber>
    <TransactionCount>1</TransactionCount>
    <ServiceProviderIdQualifier>01</ServiceProviderIdQualifier>
    <ServiceProviderId>1234567890ABCDE</ServiceProviderId>
    <DateOfService>20260201</DateOfService>
    <SoftwareVendorCertificationId>TESTVENDOR</SoftwareVendorCertificationId>
  </TransactionHeaderRequest>
  <Patient>
    <CardholderId>TEST123</CardholderId>
  </Patient>
</NCPDP_D0_Billing_Request>`;

      const serializer = new NCPDPSerializer();
      const ncpdp = serializer.fromXML(xml);

      // Verify header fields
      expect(ncpdp.substring(0, 6)).toBe('999999'); // BIN
      expect(ncpdp.substring(6, 8)).toBe('D0'); // Version
      expect(ncpdp.substring(8, 10)).toBe('B1'); // Transaction Code

      // Verify segment delimiter present
      expect(ncpdp).toContain(SEGMENT_DELIM);

      // Verify field delimiter present
      expect(ncpdp).toContain(FIELD_DELIM);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('should extract metadata from request', () => {
      const header =
        '999999D0B1          11234567890ABCDE20260201TESTVENDOR';
      const message = header + SEGMENT_DELIM;

      const serializer = new NCPDPSerializer();
      const metadata = serializer.getMetaDataFromMessage(message);

      expect(metadata.version).toBe('D0');
      expect(metadata.type).toBe('Billing');
      expect(metadata.source).toBeDefined();
    });

    it('should extract metadata from response', () => {
      const header = 'D0B11A011234567890ABCDE20260201';
      const message = header + SEGMENT_DELIM;

      const serializer = new NCPDPSerializer();
      const metadata = serializer.getMetaDataFromMessage(message);

      expect(metadata.version).toBe('D0');
      expect(metadata.type).toBe('Billing');
    });
  });

  describe('transformWithoutSerializing', () => {
    it('should replace delimiters', () => {
      const message = `TEST${SEGMENT_DELIM}DATA${FIELD_DELIM}FIELD`;

      const serializer = new NCPDPSerializer();
      const result = serializer.transformWithoutSerializing(message, {
        segmentDelimiter: '~',
        groupDelimiter: '^',
        fieldDelimiter: '|',
      });

      expect(result).toBe('TEST~DATA|FIELD');
    });

    it('should return null if no transformation needed', () => {
      const message = `TEST${SEGMENT_DELIM}DATA${FIELD_DELIM}FIELD`;

      const serializer = new NCPDPSerializer();
      const result = serializer.transformWithoutSerializing(message, {
        segmentDelimiter: SEGMENT_DELIM,
        groupDelimiter: GROUP_DELIM,
        fieldDelimiter: FIELD_DELIM,
      });

      expect(result).toBeNull();
    });
  });
});

describe('Convenience functions', () => {
  describe('parseNCPDPToXML', () => {
    it('should parse NCPDP to XML', () => {
      const header = '999999D0B1          11234567890ABCDE20260201TESTVENDOR';
      const message = header + SEGMENT_DELIM;

      const xml = parseNCPDPToXML(message);

      expect(xml).toContain('<NCPDP_D0_Billing_Request>');
    });
  });

  describe('convertXMLToNCPDP', () => {
    it('should convert XML to NCPDP', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NCPDP_D0_Billing_Request>
  <TransactionHeaderRequest>
    <BinNumber>999999</BinNumber>
    <VersionReleaseNumber>D0</VersionReleaseNumber>
    <TransactionCode>B1</TransactionCode>
    <ProcessorControlNumber>          </ProcessorControlNumber>
    <TransactionCount>1</TransactionCount>
    <ServiceProviderIdQualifier>01</ServiceProviderIdQualifier>
    <ServiceProviderId>1234567890ABCDE</ServiceProviderId>
    <DateOfService>20260201</DateOfService>
  </TransactionHeaderRequest>
</NCPDP_D0_Billing_Request>`;

      const ncpdp = convertXMLToNCPDP(xml);

      expect(ncpdp.substring(0, 6)).toBe('999999');
      expect(ncpdp.substring(6, 8)).toBe('D0');
    });
  });
});

describe('Round-trip conversion', () => {
  it('should preserve data through NCPDP -> XML -> NCPDP', () => {
    // Create an NCPDP message
    const header =
      '999999D0B1          11234567890ABCDE20260201TESTVENDOR';
    const segment =
      FIELD_DELIM +
      'AM01' +
      FIELD_DELIM +
      'C2' +
      'CARD12345' +
      FIELD_DELIM +
      'CA' +
      'JOHN' +
      FIELD_DELIM +
      'CB' +
      'DOE';

    const originalMessage = header + SEGMENT_DELIM + segment;

    // Convert to XML
    const serializer = new NCPDPSerializer();
    const xml = serializer.toXML(originalMessage);

    // Verify XML contains expected data
    expect(xml).toContain('<CardholderId>CARD12345</CardholderId>');
    expect(xml).toContain('<PatientFirstName>JOHN</PatientFirstName>');
    expect(xml).toContain('<PatientLastName>DOE</PatientLastName>');

    // Convert back to NCPDP
    const roundTripped = serializer.fromXML(xml);

    // Verify header is preserved
    expect(roundTripped.substring(0, 6)).toBe('999999');
    expect(roundTripped.substring(6, 8)).toBe('D0');
    expect(roundTripped.substring(8, 10)).toBe('B1');

    // Verify data is present (field values should be in the output)
    expect(roundTripped).toContain('CARD12345');
    expect(roundTripped).toContain('JOHN');
    expect(roundTripped).toContain('DOE');
  });
});
