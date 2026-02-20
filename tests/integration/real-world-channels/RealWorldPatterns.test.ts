/**
 * Real-World JavaScript Pattern Integration Tests
 *
 * These tests exercise JavaScript patterns found in actual Mirth channels
 * on GitHub (nextgenhealthcare/connect-examples, RSNA, SwissTPH, community gists).
 *
 * Each test creates a VM sandbox with the full Mirth scope, transpiles E4X,
 * and executes code to verify correct behavior end-to-end.
 *
 * Sources:
 * - nextgenhealthcare/connect-examples (official)
 * - RSNA/isn-edge-server-hl7-receiver
 * - SwissTPH/Mirth-Channels
 * - gist.github.com/shadowdoc/5884834
 * - gist.github.com/jakeceballos
 * - gist.github.com/marlycormar
 */

import * as vm from 'vm';
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import { buildBasicScope } from '../../../src/javascript/runtime/ScopeBuilder.js';


/** Helper: execute a user script in a full Mirth VM sandbox */
function executeInMirthScope(userScript: string, extraScope: Record<string, unknown> = {}): Record<string, unknown> {
  const transpiler = new E4XTranspiler();
  const transpiled = transpiler.transpile(userScript).code;

  const scope = { ...buildBasicScope(), ...extraScope };
  const context = vm.createContext(scope);

  // Run Java String.prototype setup first (B4: equals, matches, etc.)
  if (scope.__javaStringSetup) {
    vm.runInContext(scope.__javaStringSetup as string, context);
  }

  // Run the transpiled user script
  const script = new vm.Script(transpiled, { filename: 'test-channel.js' });
  script.runInContext(context);

  return scope;
}

describe('Real-World Channel Pattern Integration Tests', () => {
  // ==========================================================================
  // Category A: E4X Transpiler — Computed Attributes & Tags
  // ==========================================================================

  describe('E4X Computed Attributes (SwissTPH database schema builder)', () => {
    it('should evaluate {expr} in XML attributes at runtime', () => {
      // FROM: SwissTPH/Mirth-Channels — database schema builder
      const script = `
        function addRow(columnName, type, defaultValue, size) {
          var dataEntry = <columns column={columnName} name={columnName} type={type}
              default_value={defaultValue} size={size} />;
          return dataEntry;
        }
        var row = addRow("_URI", "VARCHAR", "none", "80");
        var result = {
          column: row.attr('column'),
          name: row.attr('name'),
          type: row.attr('type'),
          default_value: row.attr('default_value'),
          size: row.attr('size')
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, string>;
      expect(result.column).toBe('_URI');
      expect(result.name).toBe('_URI');
      expect(result.type).toBe('VARCHAR');
      expect(result.default_value).toBe('none');
      expect(result.size).toBe('80');
    });

    it('should handle computed attrs with mixed static and dynamic values', () => {
      const script = `
        var myType = "string";
        var node = <field type={myType} required="true" />;
        var result = {
          type: node.attr('type'),
          required: node.attr('required')
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, string>;
      expect(result.type).toBe('string');
      expect(result.required).toBe('true');
    });
  });

  describe('E4X Computed Tag Names (connect-examples unescape pattern)', () => {
    it('should create XML elements with dynamic tag names', () => {
      const script = `
        var tagName = "PID";
        var content = "test content";
        var node = <{tagName}>{content}</{tagName}>;
        var result = node.toXMLString();
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toContain('<PID>');
      expect(scope.result).toContain('test content');
    });
  });

  describe('E4X Empty XMLList literal', () => {
    it('should create empty XMLList with <></>', () => {
      const script = `
        var children = <></>;
        var result = children.length();
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe(0);
    });

    it('should allow appending to empty XMLList', () => {
      const script = `
        var list = <></>;
        list = list.append(XMLProxy.create('<item>a</item>'));
        list = list.append(XMLProxy.create('<item>b</item>'));
        var result = list.length();
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe(2);
    });
  });

  // ==========================================================================
  // Category B: Java Interop Shims
  // ==========================================================================

  describe('HL7 Date Parsing with SimpleDateFormat (RSNA pattern)', () => {
    it('should parse HL7 date strings using java.text.SimpleDateFormat', () => {
      // FROM: RSNA/isn-edge-server-hl7-receiver
      // Note: instanceof Date fails across VM realms (shim creates Date in outer realm,
      // VM has its own Date constructor). Real channels use .getFullYear() etc. not instanceof.
      const script = `
        var parser = new java.text.SimpleDateFormat("yyyyMMdd");
        var dateStr = "20250115";
        var date = parser.parse(dateStr);
        var year = date.getFullYear();
        var hasGetTime = typeof date.getTime === 'function';
        var result = { year: year, hasGetTime: hasGetTime };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.year).toBe(2025);
      expect(result.hasGetTime).toBe(true);
    });

    it('should format dates back to strings', () => {
      const script = `
        var formatter = new java.text.SimpleDateFormat("yyyy-MM-dd");
        var date = new Date(2025, 0, 15);  // Jan 15, 2025
        var result = formatter.format(date);
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('2025-01-15');
    });
  });

  describe('Database Query with ArrayList Params (RSNA pattern)', () => {
    it('should create ArrayList and add elements', () => {
      // FROM: RSNA/isn-edge-server-hl7-receiver
      const script = `
        var params = new java.util.ArrayList();
        params.add("MRN12345");
        params.add("Smith");
        params.add("John");
        var result = {
          size: params.size(),
          first: params.get(0),
          second: params.get(1),
          third: params.get(2),
          isEmpty: params.isEmpty()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.size).toBe(3);
      expect(result.first).toBe('MRN12345');
      expect(result.second).toBe('Smith');
      expect(result.third).toBe('John');
      expect(result.isEmpty).toBe(false);
    });

    it('should support ArrayList iteration with for loop', () => {
      const script = `
        var list = new java.util.ArrayList();
        list.add("a");
        list.add("b");
        list.add("c");
        var collected = "";
        for (var i = 0; i < list.size(); i++) {
          collected += list.get(i);
        }
        var result = collected;
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('abc');
    });
  });

  describe('HashMap Usage (SwissTPH/connect-examples)', () => {
    it('should create HashMap with put/get/containsKey', () => {
      const script = `
        var map = new java.util.HashMap();
        map.put("name", "John");
        map.put("age", 30);
        map.put("active", true);
        var result = {
          name: map.get("name"),
          age: map.get("age"),
          active: map.get("active"),
          hasName: map.containsKey("name"),
          hasMissing: map.containsKey("missing"),
          size: map.size()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.name).toBe('John');
      expect(result.age).toBe(30);
      expect(result.active).toBe(true);
      expect(result.hasName).toBe(true);
      expect(result.hasMissing).toBe(false);
      expect(result.size).toBe(3);
    });

    it('should support LinkedHashMap (preserves insertion order)', () => {
      const script = `
        var map = new java.util.LinkedHashMap();
        map.put("z", 1);
        map.put("a", 2);
        map.put("m", 3);
        var keys = [];
        var entries = map.entrySet();
        for (var i = 0; i < entries.length; i++) {
          keys.push(entries[i].getKey());
        }
        var result = keys.join(",");
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('z,a,m');
    });
  });

  describe('String.equals() / equalsIgnoreCase() (RSNA/SwissTPH)', () => {
    it('should support .equals() on string values', () => {
      // FROM: RSNA/isn-edge-server-hl7-receiver
      const script = `
        var status = "ACTIVE";
        var result = {
          equalsActive: status.equals("ACTIVE"),
          equalsInactive: status.equals("INACTIVE"),
          equalsEmpty: status.equals(""),
          equalsIgnoreCase: status.equalsIgnoreCase("active"),
          equalsIgnoreCaseMixed: "Yes".equalsIgnoreCase("yes")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, boolean>;
      expect(result.equalsActive).toBe(true);
      expect(result.equalsInactive).toBe(false);
      expect(result.equalsEmpty).toBe(false);
      expect(result.equalsIgnoreCase).toBe(true);
      expect(result.equalsIgnoreCaseMixed).toBe(true);
    });

    it('should support .matches() with regex patterns', () => {
      const script = `
        var phone = "555-1234";
        var result = {
          matchesDigits: "12345".matches("[0-9]+"),
          matchesPhone: phone.matches("[0-9]{3}-[0-9]{4}"),
          noMatch: "abc".matches("[0-9]+")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, boolean>;
      expect(result.matchesDigits).toBe(true);
      expect(result.matchesPhone).toBe(true);
      expect(result.noMatch).toBe(false);
    });

    it('should support .isEmpty() and .contains()', () => {
      const script = `
        var result = {
          emptyIsEmpty: "".isEmpty(),
          nonEmptyIsEmpty: "hello".isEmpty(),
          containsHello: "hello world".contains("world"),
          containsMissing: "hello".contains("xyz"),
          replaceAllDigits: "abc123def456".replaceAll("[0-9]", ""),
          replaceFirst: "aaa".replaceFirst("a", "b")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.emptyIsEmpty).toBe(true);
      expect(result.nonEmptyIsEmpty).toBe(false);
      expect(result.containsHello).toBe(true);
      expect(result.containsMissing).toBe(false);
      expect(result.replaceAllDigits).toBe('abcdef');
      expect(result.replaceFirst).toBe('baa');
    });
  });

  describe('Thread-Safe GlobalMap (connect-examples pattern)', () => {
    it('should support lock/unlock/containsKeySync/putSync (no-op stubs)', () => {
      // FROM: nextgenhealthcare/connect-examples — Thread-safe globalMap singleton
      const script = `
        function getInstance(key, initializer) {
          globalMap.lock(key);
          try {
            if (!globalMap.containsKeySync(key)) {
              globalMap.putSync(key, initializer());
            }
            return globalMap.get(key);
          } finally {
            globalMap.unlock(key);
          }
        }

        var counter = getInstance("myCounter", function() { return 42; });
        var result = counter;
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe(42);
    });

    it('should return existing value on second call', () => {
      const script = `
        globalMap.put("existingKey", "first");

        globalMap.lock("existingKey");
        try {
          if (!globalMap.containsKeySync("existingKey")) {
            globalMap.putSync("existingKey", "second");
          }
        } finally {
          globalMap.unlock("existingKey");
        }

        var result = globalMap.get("existingKey");
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('first');
    });
  });

  describe('StringUtils (Apache Commons Lang3 — connect-examples)', () => {
    it('should support StringUtils.countMatches', () => {
      // FROM: nextgenhealthcare/connect-examples — xmlToHL7
      const script = `
        var qname = "urn:hl7-org:v3:PRPA_IN201301UV02";
        var result = StringUtils.countMatches(qname, ":");
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe(3);
    });

    it('should support StringUtils.isBlank/isNotBlank', () => {
      const script = `
        var result = {
          nullBlank: StringUtils.isBlank(null),
          emptyBlank: StringUtils.isBlank(""),
          spaceBlank: StringUtils.isBlank("  "),
          valueBlank: StringUtils.isBlank("hello"),
          valueNotBlank: StringUtils.isNotBlank("hello"),
          emptyNotBlank: StringUtils.isNotBlank("")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, boolean>;
      expect(result.nullBlank).toBe(true);
      expect(result.emptyBlank).toBe(true);
      expect(result.spaceBlank).toBe(true);
      expect(result.valueBlank).toBe(false);
      expect(result.valueNotBlank).toBe(true);
      expect(result.emptyNotBlank).toBe(false);
    });

    it('should support StringUtils via Packages.org.apache.commons.lang3 path', () => {
      const script = `
        var SU = Packages.org.apache.commons.lang3.StringUtils;
        var result = {
          trimmed: SU.trimToEmpty("  hello  "),
          padded: SU.leftPad("42", 5, "0"),
          sub: SU.substringBefore("user@domain.com", "@")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, string>;
      expect(result.trimmed).toBe('hello');
      expect(result.padded).toBe('00042');
      expect(result.sub).toBe('user');
    });
  });

  describe('StringBuffer (HTTP response reading pattern)', () => {
    it('should support java.lang.StringBuffer/StringBuilder', () => {
      // FROM: Multiple gists — HTTP response body reading
      const script = `
        var sb = new java.lang.StringBuilder();
        sb.append("Hello");
        sb.append(" ");
        sb.append("World");
        sb.append("!");
        var result = sb.toString();
        var len = sb.length();
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('Hello World!');
      expect(scope.len).toBe(12);
    });

    it('should support StringBuffer chained appends', () => {
      const script = `
        var result = new java.lang.StringBuffer("start")
          .append("-")
          .append("middle")
          .append("-")
          .append("end")
          .toString();
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('start-middle-end');
    });
  });

  describe('java.lang.System (environment access)', () => {
    it('should support System.getenv and currentTimeMillis', () => {
      const script = `
        var home = java.lang.System.getenv("HOME") || java.lang.System.getenv("USERPROFILE") || "unknown";
        var time = java.lang.System.currentTimeMillis();
        var sep = java.lang.System.lineSeparator();
        var result = {
          homeIsString: typeof home === "string",
          timeIsNumber: typeof time === "number",
          timeIsRecent: time > 1700000000000,
          sepIsNewline: sep === "\\n"
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, boolean>;
      expect(result.homeIsString).toBe(true);
      expect(result.timeIsNumber).toBe(true);
      expect(result.timeIsRecent).toBe(true);
      expect(result.sepIsNewline).toBe(true);
    });

    it('should support System.getProperty for common keys', () => {
      const script = `
        var result = {
          fileSep: java.lang.System.getProperty("file.separator"),
          lineSep: java.lang.System.getProperty("line.separator"),
          unknown: java.lang.System.getProperty("nonexistent.key")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.fileSep).toBe('/');
      expect(result.lineSep).toBe('\n');
      expect(result.unknown).toBeNull();
    });
  });

  // ==========================================================================
  // Category C: XMLProxy Methods
  // ==========================================================================

  describe('XMLProxy .child() method (connect-examples fixHL7NodeOrder)', () => {
    it('should access children by numeric index via .child(i)', () => {
      // FROM: nextgenhealthcare/connect-examples — fixHL7NodeOrder
      const script = `
        var xml = XMLProxy.create('<root><a>1</a><b>2</b><c>3</c></root>');
        var first = xml.child(0);
        var second = xml.child(1);
        var third = xml.child(2);
        var result = {
          firstName: first.name().toString(),
          secondName: second.name().toString(),
          thirdName: third.name().toString(),
          firstValue: first.toString(),
          outOfBounds: xml.child(99).length()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.firstName).toBe('a');
      expect(result.secondName).toBe('b');
      expect(result.thirdName).toBe('c');
      expect(result.firstValue).toBe('1');
      expect(result.outOfBounds).toBe(0);
    });

    it('should access children by name via .child("name")', () => {
      const script = `
        var xml = XMLProxy.create('<msg><PID>patient</PID><PV1>visit</PV1></msg>');
        var pid = xml.child("PID");
        var pv1 = xml.child("PV1");
        var result = {
          pid: pid.toString(),
          pv1: pv1.toString()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, string>;
      expect(result.pid).toBe('patient');
      expect(result.pv1).toBe('visit');
    });
  });

  // ==========================================================================
  // Composite Patterns: Multiple features working together
  // ==========================================================================

  describe('OBX Report Concatenation (RSNA descendant pattern)', () => {
    it('should concatenate OBX.5.1 values using E4X descendants + for each', () => {
      // FROM: RSNA/isn-edge-server-hl7-receiver — report concatenation
      const script = `
        var msg = XMLProxy.create(
          '<HL7Message>' +
            '<OBX><OBX.1>1</OBX.1><OBX.5><OBX.5.1>Line one</OBX.5.1></OBX.5></OBX>' +
            '<OBX><OBX.1>2</OBX.1><OBX.5><OBX.5.1>Line two</OBX.5.1></OBX.5></OBX>' +
            '<OBX><OBX.1>3</OBX.1><OBX.5><OBX.5.1>Line three</OBX.5.1></OBX.5></OBX>' +
          '</HL7Message>'
        );

        var reportParts = [];
        var obxList = msg.descendants('OBX');
        for (var i = 0; i < obxList.length(); i++) {
          var obx = obxList[i];
          var text = obx['OBX.5']['OBX.5.1'].toString();
          reportParts.push(text);
        }
        var result = reportParts.join("\\n");
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('Line one\nLine two\nLine three');
    });
  });

  describe('JSON-to-HL7 Mapping (marlycormar pattern)', () => {
    it('should assign values to HL7 XML paths using bracket notation', () => {
      // FROM: gist.github.com/marlycormar — JSON to HL7 mapping
      const script = `
        var tmp = XMLProxy.create(
          '<HL7Message>' +
            '<MSH><MSH.3><MSH.3.1></MSH.3.1></MSH.3><MSH.9><MSH.9.1></MSH.9.1><MSH.9.2></MSH.9.2></MSH.9></MSH>' +
          '</HL7Message>'
        );

        // Simulate JSON-to-HL7 mapping
        tmp['MSH']['MSH.3']['MSH.3.1'] = 'SENDING_APP';
        tmp['MSH']['MSH.9']['MSH.9.1'] = 'ADT';
        tmp['MSH']['MSH.9']['MSH.9.2'] = 'A01';

        var result = {
          sendingApp: tmp['MSH']['MSH.3']['MSH.3.1'].toString(),
          msgType: tmp['MSH']['MSH.9']['MSH.9.1'].toString(),
          msgEvent: tmp['MSH']['MSH.9']['MSH.9.2'].toString()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, string>;
      expect(result.sendingApp).toBe('SENDING_APP');
      expect(result.msgType).toBe('ADT');
      expect(result.msgEvent).toBe('A01');
    });
  });

  describe('Strip Empty XML Nodes (connect-examples pattern)', () => {
    it('should remove empty elements from XML tree', () => {
      // FROM: nextgenhealthcare/connect-examples — stripEmptyNodes
      const script = `
        var xml = XMLProxy.create(
          '<root>' +
            '<name>John</name>' +
            '<empty></empty>' +
            '<nested><inner></inner><value>keep</value></nested>' +
          '</root>'
        );

        // Strip empty leaf nodes (simplified version of connect-examples pattern)
        function stripEmpty(node) {
          var children = node.children();
          for (var i = children.length() - 1; i >= 0; i--) {
            var child = children[i];
            if (child.hasComplexContent()) {
              stripEmpty(child);
              // Re-check after recursive strip
              if (child.children().length() === 0) {
                delete node.children()[i];
              }
            } else if (child.toString().length === 0) {
              delete node.children()[i];
            }
          }
        }

        stripEmpty(xml);
        var xmlStr = xml.toXMLString();
        var result = {
          hasName: xmlStr.indexOf('<name>John</name>') >= 0,
          hasEmpty: xmlStr.indexOf('<empty') >= 0,
          hasValue: xmlStr.indexOf('<value>keep</value>') >= 0
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, boolean>;
      expect(result.hasName).toBe(true);
      expect(result.hasEmpty).toBe(false);
      expect(result.hasValue).toBe(true);
    });
  });

  // ==========================================================================
  // Unsupported Java Classes — Throw with Clear Error Messages
  // ==========================================================================

  describe('Unsupported Java Internals throw clear errors', () => {
    it('should throw for java.lang.Runtime', () => {
      const script = `
        try {
          java.lang.Runtime();
          var result = "no error";
        } catch (e) {
          var result = e.message;
        }
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toContain('java.lang.Runtime');
      expect(scope.result).toContain('not available');
    });

    it('should throw for java.lang.Thread', () => {
      const script = `
        try {
          new java.lang.Thread();
          var result = "no error";
        } catch (e) {
          var result = e.message;
        }
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toContain('java.lang.Thread');
      expect(scope.result).toContain('single-threaded');
    });

    it('should throw for System.exit()', () => {
      const script = `
        try {
          java.lang.System.exit(0);
          var result = "no error";
        } catch (e) {
          var result = e.message;
        }
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toContain('System.exit()');
      expect(scope.result).toContain('not allowed');
    });

    it('should throw for org.apache.log4j.Logger', () => {
      const script = `
        try {
          Packages.org.apache.log4j.Logger.getLogger("test");
          var result = "no error";
        } catch (e) {
          var result = e.message;
        }
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toContain('log4j');
      expect(scope.result).toContain('not available');
    });
  });

  // ==========================================================================
  // importPackage / importClass (Rhino shims — should not throw)
  // ==========================================================================

  describe('Rhino importPackage / importClass shims', () => {
    it('should silently no-op for importPackage calls', () => {
      const script = `
        importPackage(Packages.com.mirth.connect.server.userutil);
        importPackage(Packages.com.mirth.connect.userutil);
        var result = "no error";
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('no error');
    });

    it('should silently no-op for importClass calls', () => {
      const script = `
        importClass(Packages.java.util.ArrayList);
        var result = "no error";
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('no error');
    });
  });

  // ==========================================================================
  // java.sql.Date / Timestamp (common in HL7 date handling)
  // ==========================================================================

  describe('java.sql.Date and Timestamp', () => {
    it('should create Date from milliseconds', () => {
      // Note: instanceof Date fails across VM realms. Test behavior instead.
      const script = `
        var d = new java.sql.Date(1705363200000);  // Jan 16, 2024 UTC
        var result = {
          hasGetTime: typeof d.getTime === 'function',
          year: d.getUTCFullYear()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.hasGetTime).toBe(true);
      expect(result.year).toBe(2024);
    });

    it('should create Timestamp with getNanos()', () => {
      const script = `
        var ts = new java.sql.Timestamp(1705363200123);
        var result = {
          hasGetTime: typeof ts.getTime === 'function',
          nanos: ts.getNanos()
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.hasGetTime).toBe(true);
      expect(result.nanos).toBe(123000000);
    });
  });

  // ==========================================================================
  // HashSet pattern (deduplication in channel scripts)
  // ==========================================================================

  describe('HashSet deduplication pattern', () => {
    it('should deduplicate values using java.util.HashSet', () => {
      const script = `
        var seen = new java.util.HashSet();
        var items = ["a", "b", "a", "c", "b", "d"];
        var unique = [];
        for (var i = 0; i < items.length; i++) {
          if (seen.add(items[i])) {
            unique.push(items[i]);
          }
        }
        var result = unique.join(",");
      `;
      const scope = executeInMirthScope(script);
      expect(scope.result).toBe('a,b,c,d');
    });
  });

  // ==========================================================================
  // Combined E4X + Java interop (realistic multi-feature scenarios)
  // ==========================================================================

  describe('Combined E4X + Java Interop', () => {
    it('should use ArrayList with XML descendants in a realistic HL7 loop', () => {
      const script = `
        var msg = XMLProxy.create(
          '<HL7Message>' +
            '<PID><PID.3><PID.3.1>MRN001</PID.3.1></PID.3></PID>' +
            '<OBX><OBX.3><OBX.3.1>WBC</OBX.3.1></OBX.3><OBX.5><OBX.5.1>7.2</OBX.5.1></OBX.5></OBX>' +
            '<OBX><OBX.3><OBX.3.1>RBC</OBX.3.1></OBX.3><OBX.5><OBX.5.1>4.5</OBX.5.1></OBX.5></OBX>' +
          '</HL7Message>'
        );

        var results = new java.util.ArrayList();
        var obxList = msg.descendants('OBX');

        for (var i = 0; i < obxList.length(); i++) {
          var obx = obxList[i];
          var code = obx['OBX.3']['OBX.3.1'].toString();
          var value = obx['OBX.5']['OBX.5.1'].toString();

          if (!code.isEmpty()) {
            var entry = new java.util.HashMap();
            entry.put("code", code);
            entry.put("value", value);
            results.add(entry);
          }
        }

        var result = {
          count: results.size(),
          firstCode: results.get(0).get("code"),
          firstValue: results.get(0).get("value"),
          secondCode: results.get(1).get("code"),
          secondValue: results.get(1).get("value")
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.count).toBe(2);
      expect(result.firstCode).toBe('WBC');
      expect(result.firstValue).toBe('7.2');
      expect(result.secondCode).toBe('RBC');
      expect(result.secondValue).toBe('4.5');
    });

    it('should use StringUtils with XML data extraction', () => {
      // Note: 'name' conflicts with XMLProxy.name() method, so we use child('name')
      // for explicit element access. In real HL7 channels this conflict doesn't arise
      // because HL7 segments use PID/OBX/MSH etc. which don't collide with methods.
      const script = `
        var msg = XMLProxy.create(
          '<patient>' +
            '<fullName>  Smith, John  </fullName>' +
            '<mrn>MRN-12345</mrn>' +
            '<email></email>' +
          '</patient>'
        );

        var patientName = StringUtils.trimToEmpty(msg['fullName'].toString());
        var mrn = StringUtils.substringAfter(msg['mrn'].toString(), "MRN-");
        var email = StringUtils.defaultIfBlank(msg['email'].toString(), "noemail@hospital.org");

        var result = {
          name: patientName,
          mrn: mrn,
          email: email,
          mrnIsNumeric: StringUtils.isNumeric(mrn)
        };
      `;
      const scope = executeInMirthScope(script);
      const result = scope.result as Record<string, unknown>;
      expect(result.name).toBe('Smith, John');
      expect(result.mrn).toBe('12345');
      expect(result.email).toBe('noemail@hospital.org');
      expect(result.mrnIsNumeric).toBe(true);
    });
  });
});
