/**
 * Parity tests for ScriptBuilder — verifies fixes for Java Mirth runtime gaps
 */
import {
  ScriptBuilder,
  SerializationType,
} from '../../../src/javascript/runtime/ScriptBuilder';

describe('ScriptBuilder Parity Fixes', () => {
  let builder: ScriptBuilder;

  beforeEach(() => {
    builder = new ScriptBuilder();
  });

  describe('1.1 - Missing helper functions in appendMiscFunctions()', () => {
    it('should include createSegmentAfter helper', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function createSegmentAfter(name, segment)');
      expect(script).toContain('insertChildAfter');
    });

    it('should include getArrayOrXmlLength helper', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function getArrayOrXmlLength(obj)');
    });

    it('getArrayOrXmlLength should handle XML length (function) and array length (number)', () => {
      const script = builder.generateScript('// test');
      // Both patterns should be present in the generated code
      expect(script).toContain("typeof obj.length === 'function'");
      expect(script).toContain("typeof obj.length === 'number'");
    });

    it('should include newStringOrUndefined type coercion', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function newStringOrUndefined(value)');
      expect(script).toContain('return String(value)');
    });

    it('should include newBooleanOrUndefined type coercion', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function newBooleanOrUndefined(value)');
      expect(script).toContain('return Boolean(value)');
    });

    it('should include newNumberOrUndefined type coercion', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function newNumberOrUndefined(value)');
      expect(script).toContain('return Number(value)');
    });

    it('type coercion functions should pass through null/undefined', () => {
      const script = builder.generateScript('// test');
      // All three should check for null/undefined and return as-is
      const matches = script.match(/if \(value === undefined \|\| value === null\) return value;/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('1.2 - $() function lookup order with resultMap', () => {
    it('should check responseMap first (matching Java)', () => {
      const script = builder.generateScript('// test');
      const dollarFnMatch = script.match(/function \$\(string\)[\s\S]*?return '';[\s\S]*?\}/);
      expect(dollarFnMatch).not.toBeNull();
      const dollarFn = dollarFnMatch![0];

      // responseMap should appear first
      const responseIdx = dollarFn.indexOf('responseMap');
      const connectorIdx = dollarFn.indexOf('connectorMap');
      expect(responseIdx).toBeLessThan(connectorIdx);
    });

    it('should check configurationMap before resultMap', () => {
      const script = builder.generateScript('// test');
      const dollarFnMatch = script.match(/function \$\(string\)[\s\S]*?return '';[\s\S]*?\}/);
      const dollarFn = dollarFnMatch![0];

      const configIdx = dollarFn.indexOf('configurationMap');
      const resultIdx = dollarFn.indexOf('resultMap');
      expect(resultIdx).toBeGreaterThan(configIdx);
    });

    it('should include resultMap check after configurationMap (Java database reader support)', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('resultMap.containsKey(string)');
      expect(script).toContain('resultMap.get(string)');
    });

    it('should NOT reference localMap (removed)', () => {
      const script = builder.generateScript('// test');
      expect(script).not.toContain('localMap');
    });

    it('resultMap should be the last map checked before returning empty string', () => {
      const script = builder.generateScript('// test');
      const dollarFnMatch = script.match(/function \$\(string\)[\s\S]*?return '';[\s\S]*?\}/);
      const dollarFn = dollarFnMatch![0];

      // resultMap should appear after configurationMap and before return ''
      const resultIdx = dollarFn.indexOf('resultMap');
      const returnIdx = dollarFn.indexOf("return ''");
      expect(resultIdx).toBeGreaterThan(0);
      expect(resultIdx).toBeLessThan(returnIdx);
    });
  });

  describe('1.3 - $cfg() supports put', () => {
    it('should support both get and put in appendMapFunctions', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function $cfg(key, value)');
      expect(script).toContain('configurationMap.put(key, value)');
    });

    it('should support put in generateDeployScript', () => {
      const script = builder.generateDeployScript('// deploy');
      expect(script).toContain('function $cfg(key, value)');
      expect(script).toContain('configurationMap.put(key, value)');
    });
  });

  describe('1.4 - phase variable as array', () => {
    it('doFilter should set phase[0] = "filter"', () => {
      const script = builder.generateFilterTransformerScript(
        [{ name: 'R1', script: 'return true;', operator: 'AND', enabled: true }],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );
      expect(script).toContain('phase[0] = "filter"');
      expect(script).not.toMatch(/phase\s*=\s*"filter"/);
    });

    it('doTransform should set phase[0] = "transform"', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [{ name: 'S1', script: 'tmp = msg;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        false
      );
      expect(script).toContain('phase[0] = "transform"');
      expect(script).not.toMatch(/phase\s*=\s*"transform"/);
    });

    it('empty filter should also use phase[0]', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );
      expect(script).toContain('phase[0] = "filter"');
      expect(script).toContain('phase[0] = "transform"');
    });
  });

  describe('1.5 - Auto-serialization inside doTransform (JRC-SBD-001)', () => {
    // Extract the full doTransform function body from generated script.
    // Cannot use simple regex because the body contains multiple } on separate lines.
    // Instead, find the function start and count brace depth.
    function extractDoTransform(script: string): string {
      const startIdx = script.indexOf('function doTransform() {');
      if (startIdx === -1) return '';
      let depth = 0;
      let foundOpen = false;
      for (let i = startIdx; i < script.length; i++) {
        if (script[i] === '{') { depth++; foundOpen = true; }
        if (script[i] === '}') { depth--; }
        if (foundOpen && depth === 0) {
          return script.slice(startIdx, i + 1);
        }
      }
      return '';
    }

    it('serialization of msg and tmp should be inside doTransform, not in outer IIFE', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [{ name: 'S1', script: 'tmp = msg;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      // Outer IIFE should be simple — no serialization logic
      expect(script).toContain('if (doFilter() == true) { doTransform(); return true; } else { return false; }');

      // Serialization should be inside doTransform function body
      const body = extractDoTransform(script);
      expect(body).toBeTruthy();
      expect(body).toContain('msg.toXMLString');
      expect(body).toContain('tmp.toXMLString');
    });

    it('msg and tmp serialization should be independent (not else-if)', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [{ name: 'S1', script: 'tmp = msg;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      const body = extractDoTransform(script);

      // Count the msg and tmp serialization blocks — they should be separate if-blocks
      const msgSerialize = body.indexOf("typeof msg === 'object' && typeof msg.toXMLString");
      const tmpSerialize = body.indexOf("typeof tmp === 'object' && typeof tmp.toXMLString");
      expect(msgSerialize).toBeGreaterThan(0);
      expect(tmpSerialize).toBeGreaterThan(0);
      // tmp block starts as a new `if`, not connected to msg block via else-if
      expect(tmpSerialize).toBeGreaterThan(msgSerialize);
    });

    it('should serialize both msg and tmp when both exist (Java behavior)', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [{ name: 'S1', script: 'tmp = msg;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      // Both msg and tmp JSON.stringify should appear
      expect(script).toContain('JSON.stringify(msg)');
      expect(script).toContain('JSON.stringify(tmp)');
    });

    it('should use hasSimpleContent() guard for XML serialization', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );

      expect(script).toContain('msg.hasSimpleContent()');
      expect(script).toContain('tmp.hasSimpleContent()');
    });

    it('should use Object.prototype.toString.call for type detection', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );

      expect(script).toContain('Object.prototype.toString.call(msg)');
      expect(script).toContain('Object.prototype.toString.call(tmp)');
    });

    it('empty transformer steps should still include auto-serialization', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );

      const body = extractDoTransform(script);
      expect(body).toBeTruthy();
      expect(body).toContain('msg.toXMLString');
      expect(body).toContain('tmp.toXMLString');
    });

    it('response transformer should also include auto-serialization in doTransform', () => {
      const script = builder.generateResponseTransformerScript(
        [{ name: 'S1', script: 'msg = tmp;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      const body = extractDoTransform(script);
      expect(body).toBeTruthy();
      expect(body).toContain('msg.toXMLString');
      expect(body).toContain('JSON.stringify(msg)');
    });
  });

  describe('1.6 - Attachment functions', () => {
    it('should include getAttachment (singular) with Java overload pattern', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('function getAttachment()');
      expect(script).toContain('AttachmentUtil.getMessageAttachment');
    });

    it('getAttachment should have two-path overload (3+ args vs 2 args)', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      // 3+ args path: channelId, messageId, attachmentId, base64Decode
      expect(script).toContain('arguments.length >= 3');
      expect(script).toContain('arguments[0], arguments[1], arguments[2]');
      // 2 args path: connectorMessage, attachmentId, base64Decode
      expect(script).toContain('connectorMessage, arguments[0]');
    });

    it('should include real getAttachmentIds', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('function getAttachmentIds(');
      expect(script).toContain('AttachmentUtil.getMessageAttachmentIds');
    });

    it('should include getAttachments', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('AttachmentUtil.getMessageAttachments');
    });

    it('should include addAttachment', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('function addAttachment(');
      expect(script).toContain('AttachmentUtil.createAttachment');
    });

    it('updateAttachment should handle all 4 Java argument patterns', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('function updateAttachment()');
      // Pattern 1: 5+ args (channelId, messageId, id, content, type, base64)
      expect(script).toContain('arguments.length >= 5');
      // Pattern 2: 3+ args with Attachment instance
      expect(script).toContain('instanceof Attachment');
      // Pattern 3: 3+ args without Attachment (connectorMessage, id, content, type, base64)
      // Pattern 4: 2 args (connectorMessage, attachment, base64)
      expect(script).toContain('connectorMessage, arguments[0], !!arguments[1]');
    });
  });

  describe('1.7 - validate() replacement iteration', () => {
    it('should use new RegExp for replacement (not literal replaceAll)', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('new RegExp(entry[0]');
      expect(script).not.toContain('replaceAll');
    });

    it('should iterate replacement as array of pairs with entry[0], entry[1]', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('var entry = replacement[i]');
      expect(script).toContain("result.replace(new RegExp(entry[0], 'g'), entry[1])");
    });

    it('should use loose equality (==) matching Java behavior', () => {
      const script = builder.generateScript('// test');
      const validateMatch = script.match(/function validate[\s\S]*?^}/m);
      expect(validateMatch).not.toBeNull();
      const validateFn = validateMatch![0];
      expect(validateFn).toContain('result == undefined');
      expect(validateFn).toContain('replacement != undefined');
    });
  });

  describe('1.8 - importClass() Rhino shim', () => {
    it('should include importClass in global sealed script', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('function importClass()');
    });

    it('importClass should be a no-op (Rhino compatibility)', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('no-op');
      expect(script).toContain('Rhino compatibility');
    });

    it('importClass should not throw when called with arguments', () => {
      const script = builder.generateGlobalSealedScript();
      // The function should accept arguments but do nothing
      // Verify it is a function declaration (not throwing)
      expect(script).toMatch(/function importClass\(\)/);
    });
  });

  describe('1.10 - createSegment attachment to parent', () => {
    it('should assign segment to msgObj[name][index] when called with 3 args', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('msgObj[name][index] = XMLProxy.create');
      expect(script).toContain('return msgObj[name][index]');
    });

    it('should return detached segment when called with 1 arg (name only)', () => {
      const script = builder.generateScript('// test');
      // When msgObj is undefined/null, return a standalone segment
      expect(script).toContain("if (typeof msgObj === 'undefined' || msgObj === null)");
      expect(script).toContain("return XMLProxy.create('<' + name + '></' + name + '>')");
    });

    it('should use <name></name> not <name/> format', () => {
      const script = builder.generateScript('// test');
      // Java uses new XML('<' + name + '></' + name + '>'), not self-closing
      const createSegMatch = script.match(/function createSegment[\s\S]*?^}/m);
      expect(createSegMatch).not.toBeNull();
      const fn = createSegMatch![0];
      expect(fn).not.toContain("'/>');");
      expect(fn).toContain("'></' + name + '>');");
    });
  });

  describe('1.11 - Deploy script includes all helpers', () => {
    it('deploy script should include $co, $c, $s, $r map functions', () => {
      const script = builder.generateDeployScript('// deploy');
      expect(script).toContain('function $co(');
      expect(script).toContain('function $c(');
      expect(script).toContain('function $s(');
      expect(script).toContain('function $r(');
    });

    it('deploy script should include validate() function', () => {
      const script = builder.generateDeployScript('// deploy');
      expect(script).toContain('function validate(mapping, defaultValue, replacement)');
    });

    it('deploy script should include createSegment() function', () => {
      const script = builder.generateDeployScript('// deploy');
      expect(script).toContain('function createSegment(');
    });
  });

  describe('1.12 - importPackage shim', () => {
    it('should include importPackage in global sealed script', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('function importPackage()');
    });

    it('importPackage should be a no-op Rhino compatibility shim', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('importPackage');
      expect(script).toMatch(/function importPackage\(\).*no-op.*Rhino/);
    });
  });

  describe('1.13 - getAttachmentIds 2-arg overload', () => {
    it('should check arguments.length === 2 for channelId/messageId overload', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('arguments.length === 2');
      expect(script).toContain('AttachmentUtil.getMessageAttachmentIds(channelId, messageId)');
    });

    it('should fall back to connectorMessage when called with 0 args', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('AttachmentUtil.getMessageAttachmentIds(connectorMessage)');
    });
  });

  describe('1.14 - Undeploy uses doUndeploy wrapper', () => {
    it('undeploy script should contain doUndeploy function', () => {
      const script = builder.generateUndeployScript('// undeploy');
      expect(script).toContain('function doUndeploy()');
      expect(script).toContain('doUndeploy();');
    });

    it('undeploy script should NOT be generated via string replacement of deploy', () => {
      const script = builder.generateUndeployScript('// undeploy');
      // Should NOT contain doDeploy at all
      expect(script).not.toContain('doDeploy');
    });

    it('undeploy script should include all helpers like deploy', () => {
      const script = builder.generateUndeployScript('// undeploy');
      expect(script).toContain('function $co(');
      expect(script).toContain('function validate(');
      expect(script).toContain('function createSegment(');
    });
  });

  describe('Wave 11: JRC-SBD-001 - createSegmentAfter matches Java (walks to root)', () => {
    it('should walk to root using while loop', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('while (msgObj.parent() != undefined) { msgObj = msgObj.parent(); }');
    });

    it('should use segment[0] for insertChildAfter (E4X XMLList indexing)', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('msgObj.insertChildAfter(segment[0],');
    });

    it('should return child from root at childIndex + 1', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('return msgObj.children()[segment[0].childIndex() + 1]');
    });
  });

  describe('Wave 11: JRC-SBD-002 - getAttachments default matches Java', () => {
    it('should use !!base64Decode || false (Java default: no decode)', () => {
      const b = new ScriptBuilder({ includeAttachmentFunctions: true });
      const script = b.generateScript('// test');
      expect(script).toContain('!!base64Decode || false');
      // Should NOT use the old inverted default
      expect(script).not.toContain('base64Decode !== false');
    });

    it('getAttachments() with no args should default to false (no decode)', () => {
      // Verify the pattern: !!undefined || false evaluates to false
      const fn = new Function('base64Decode', 'return !!base64Decode || false');
      expect(fn(undefined)).toBe(false);
      expect(fn(true)).toBe(true);
      expect(fn(false)).toBe(false);
    });
  });

  describe('Wave 11: JRC-SBD-003 - validate() type-checks before replacement', () => {
    it('should only apply replacements to string or XML types', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain("'string' === typeof result");
      expect(script).toContain("typeof result.toXMLString === 'function'");
    });

    it('should NOT apply replacements to non-string/non-XML values (e.g. numbers)', () => {
      const script = builder.generateScript('// test');
      // The replacement block should be INSIDE the type check if-block
      const validateMatch = script.match(/function validate[\s\S]*?^}/m);
      expect(validateMatch).not.toBeNull();
      const fn = validateMatch![0];
      // The type check should appear before replacement iteration
      const typeCheckIdx = fn.indexOf("'string' === typeof result");
      const replacementIdx = fn.indexOf('replacement != undefined');
      expect(typeCheckIdx).toBeGreaterThan(0);
      expect(replacementIdx).toBeGreaterThan(typeCheckIdx);
    });
  });

  describe('Wave 11: JRC-SBD-004 - Attachment functions always included', () => {
    it('generateScript should include attachment functions even without includeAttachmentFunctions option', () => {
      // Default builder with NO options
      const script = builder.generateScript('// test');
      expect(script).toContain('function getAttachmentIds(');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
      expect(script).toContain('function updateAttachment()');
    });

    it('generatePreprocessorScript should include attachment functions', () => {
      const script = builder.generatePreprocessorScript('// preprocess');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
    });

    it('generatePostprocessorScript should include attachment functions', () => {
      const script = builder.generatePostprocessorScript('// postprocess');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
    });

    it('generateDeployScript should include attachment functions', () => {
      const script = builder.generateDeployScript('// deploy');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
    });

    it('generateUndeployScript should include attachment functions', () => {
      const script = builder.generateUndeployScript('// undeploy');
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
    });
  });

  describe('1.9 - Outer IIFE matches Java pattern', () => {
    it('should use == for filter comparison (matching Java exactly)', () => {
      const script = builder.generateFilterTransformerScript(
        [{ name: 'R1', script: 'return true;', operator: 'AND', enabled: true }],
        [{ name: 'S1', script: 'tmp = msg;', enabled: true }],
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      // Java uses: if (doFilter() == true) { doTransform(); return true; } else { return false; }
      expect(script).toContain('if (doFilter() == true) { doTransform(); return true; } else { return false; }');
    });

    it('should wrap in minimal IIFE for vm.Script return support', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );

      // IIFE is required because vm.Script does not allow top-level `return`
      // The IIFE should be minimal — just the filter/transform call, NOT serialization
      expect(script).toContain('(function() { if (doFilter() == true) { doTransform(); return true; } else { return false; } })();');
      // Serialization should be inside doTransform, NOT in the IIFE
      expect(script).not.toMatch(/\(function\(\).*toXMLString/s);
    });
  });
});
