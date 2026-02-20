import * as vm from 'vm';
import {
  ScriptBuilder,
  SerializationType,
} from '../../../../src/javascript/runtime/ScriptBuilder';

/**
 * Tests for generated JavaScript code quality — bugs that are invisible to
 * string-comparison tests but crash at runtime inside the VM.
 *
 * BUG 5 (RISK 5): hasSimpleContent() guard prevented complex XML from being
 *   serialized. Java always calls toXMLString() regardless of content type.
 *   Fix: removed hasSimpleContent guard — always serialize XML objects.
 *
 * BUG 6 (RISK 6): $() function wrapped every map lookup in try/catch, silently
 *   swallowing backend errors (e.g., database-backed map connection failures).
 *   Java's JavaScriptBuilder.java has no try/catch in $().
 *   Fix: removed try/catch — errors propagate to user script.
 */
describe('ScriptBuilder — generated code VM execution', () => {
  let builder: ScriptBuilder;

  beforeEach(() => {
    builder = new ScriptBuilder();
  });

  /**
   * Create a minimal scope for running generated scripts in a VM context.
   * All map stubs return false/undefined by default.
   */
  function makeBaseScope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const mapStub = () => ({ containsKey: () => false, get: () => undefined, put: () => {} });
    return {
      connectorMessage: {
        getTransformedData: () => '',
        getProcessedRawData: () => null,
        getRawData: () => '',
      },
      phase: [''],
      msg: undefined,
      tmp: undefined,
      XMLProxy: { create: (s: string) => s },
      channelMap: mapStub(),
      sourceMap: mapStub(),
      globalMap: mapStub(),
      globalChannelMap: mapStub(),
      configurationMap: mapStub(),
      responseMap: mapStub(),
      connectorMap: mapStub(),
      resultMap: mapStub(),
      logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      alerts: { sendAlert: () => {} },
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // BUG 5: hasSimpleContent() guard removed — always serialize XML via toXMLString
  // ---------------------------------------------------------------------------
  describe('auto-serialization: always serialize XML objects', () => {
    /**
     * Run auto-serialization with a custom msg value set via transformer step.
     */
    function runAutoSerializationWithMsg(msgExpr: string): Record<string, unknown> {
      const script = builder.generateFilterTransformerScript(
        [], // no filter rules
        [{ name: 'setMsg', script: `msg = ${msgExpr};`, enabled: true }],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );

      const scope = makeBaseScope({
        connectorMessage: {
          getTransformedData: () => 'raw-data',
          getProcessedRawData: () => null,
          getRawData: () => 'raw-data',
        },
      });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);
      return scope;
    }

    it('should serialize complex XML (hasSimpleContent=false) via toXMLString', () => {
      // Before fix: complex XML was NOT serialized because hasSimpleContent() returned false
      const scope = runAutoSerializationWithMsg(
        "{ toXMLString: function() { return '<root><child>text</child></root>'; }, hasSimpleContent: function() { return false; } }"
      );
      // After fix: always serialized regardless of hasSimpleContent
      expect(typeof scope['msg']).toBe('string');
      expect(scope['msg']).toBe('<root><child>text</child></root>');
    });

    it('should serialize simple XML (hasSimpleContent=true) via toXMLString', () => {
      const scope = runAutoSerializationWithMsg(
        "{ toXMLString: function() { return '<patient/>'; }, hasSimpleContent: function() { return true; } }"
      );
      expect(scope['msg']).toBe('<patient/>');
    });

    it('should not throw when msg has toXMLString but no hasSimpleContent', () => {
      // Object with toXMLString but without hasSimpleContent — should still serialize
      expect(() => {
        const scope = runAutoSerializationWithMsg(
          "{ toXMLString: function() { return '<custom/>'; } }"
        );
        expect(scope['msg']).toBe('<custom/>');
      }).not.toThrow();
    });

    it('should serialize complex XML tmp when template is used', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        [{
          name: 'setTmp',
          script: "tmp = { toXMLString: function() { return '<complex><a/><b/></complex>'; }, hasSimpleContent: function() { return false; } };",
          enabled: true,
        }],
        SerializationType.RAW,
        SerializationType.RAW,
        true // has template — enables tmp serialization path
      );

      const scope = makeBaseScope({
        connectorMessage: {
          getTransformedData: () => 'raw-data',
          getProcessedRawData: () => null,
          getRawData: () => 'raw-data',
        },
        template: 'template-data',
      });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);
      // Before fix: tmp remained as object because hasSimpleContent returned false
      expect(typeof scope['tmp']).toBe('string');
      expect(scope['tmp']).toBe('<complex><a/><b/></complex>');
    });

    it('should JSON.stringify plain objects without toXMLString', () => {
      const scope = runAutoSerializationWithMsg("{ name: 'John', age: 30 }");
      expect(scope['msg']).toBe('{"name":"John","age":30}');
    });

    it('should leave primitive msg values unchanged', () => {
      const scope = runAutoSerializationWithMsg("'plain string'");
      expect(scope['msg']).toBe('plain string');
    });

    it('should JSON.stringify arrays', () => {
      const scope = runAutoSerializationWithMsg("[1, 2, 3]");
      expect(scope['msg']).toBe('[1,2,3]');
    });
  });

  // ---------------------------------------------------------------------------
  // BUG 6: $() function error propagation (no try/catch — matches Java)
  // ---------------------------------------------------------------------------
  describe('$() function error propagation', () => {
    it('should propagate errors from map.containsKey() to caller', () => {
      const throwingMap = {
        containsKey: () => { throw new Error('Redis connection lost'); },
        get: () => undefined,
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('testKey');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        responseMap: throwingMap,
      });

      const context = vm.createContext(scope);

      // After fix: error propagates — no silent swallowing
      expect(() => {
        new vm.Script(script).runInContext(context);
      }).toThrow('Redis connection lost');
    });

    it('should propagate errors from map.get() to caller', () => {
      const throwingGetMap = {
        containsKey: (k: string) => k === 'myKey',
        get: () => { throw new Error('DB read failed'); },
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('myKey');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        channelMap: throwingGetMap,
      });

      const context = vm.createContext(scope);

      expect(() => {
        new vm.Script(script).runInContext(context);
      }).toThrow('DB read failed');
    });

    it('should return value from working map when key exists', () => {
      const workingMap = {
        containsKey: (k: string) => k === 'patientId',
        get: () => 'P12345',
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('patientId');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        sourceMap: workingMap,
      });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);

      expect(scope['lookupResult']).toBe('P12345');
    });

    it('should return empty string when no maps contain the key', () => {
      const script = builder.generateScript("lookupResult = $('nonExistent');");
      const scope = makeBaseScope({ lookupResult: undefined });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);

      expect(scope['lookupResult']).toBe('');
    });

    it('should follow Java lookup order: responseMap first wins', () => {
      const withKey = {
        containsKey: (k: string) => k === 'key1',
        get: () => 'from-responseMap',
        put: () => {},
      };
      const alsoWithKey = {
        containsKey: (k: string) => k === 'key1',
        get: () => 'from-channelMap',
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('key1');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        responseMap: withKey,
        channelMap: alsoWithKey,
      });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);

      // responseMap is checked before channelMap
      expect(scope['lookupResult']).toBe('from-responseMap');
    });

    it('should check globalMap when earlier maps do not have the key', () => {
      const noMap = { containsKey: () => false, get: () => undefined, put: () => {} };
      const globalMapWithValue = {
        containsKey: (k: string) => k === 'key1',
        get: () => 'from-globalMap',
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('key1');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        responseMap: noMap,
        connectorMap: noMap,
        channelMap: noMap,
        sourceMap: noMap,
        globalChannelMap: noMap,
        globalMap: globalMapWithValue,
        configurationMap: noMap,
        resultMap: noMap,
      });

      const context = vm.createContext(scope);
      new vm.Script(script).runInContext(context);

      expect(scope['lookupResult']).toBe('from-globalMap');
    });

    it('should propagate error from mid-chain map (globalMap) when earlier maps pass', () => {
      const noMap = { containsKey: () => false, get: () => undefined, put: () => {} };
      const throwingMap = {
        containsKey: () => { throw new Error('DB unreachable'); },
        get: () => undefined,
        put: () => {},
      };

      const script = builder.generateScript("lookupResult = $('key');");
      const scope = makeBaseScope({
        lookupResult: undefined,
        responseMap: noMap,
        connectorMap: noMap,
        channelMap: noMap,
        sourceMap: noMap,
        globalChannelMap: noMap,
        globalMap: throwingMap, // 6th in chain throws
      });

      const context = vm.createContext(scope);

      expect(() => {
        new vm.Script(script).runInContext(context);
      }).toThrow('DB unreachable');
    });
  });

  // ---------------------------------------------------------------------------
  // String-level verification of generated code structure
  // ---------------------------------------------------------------------------
  describe('generated code string verification', () => {
    it('should NOT contain hasSimpleContent in auto-serialization', () => {
      const script = builder.generateFilterTransformerScript(
        [], [], SerializationType.RAW, SerializationType.RAW, false
      );
      // hasSimpleContent guard was removed — always serialize
      expect(script).not.toContain('hasSimpleContent');
    });

    it('should always call toXMLString unconditionally for XML objects', () => {
      const script = builder.generateFilterTransformerScript(
        [], [{ name: 'step', script: '// noop', enabled: true }],
        SerializationType.RAW, SerializationType.RAW, false
      );
      expect(script).toContain("msg = msg.toXMLString()");
    });

    it('should always call toXMLString for tmp unconditionally', () => {
      const script = builder.generateFilterTransformerScript(
        [], [{ name: 'step', script: '// noop', enabled: true }],
        SerializationType.RAW, SerializationType.RAW, true
      );
      expect(script).toContain("tmp = tmp.toXMLString()");
    });

    it('should NOT contain try/catch in $() function', () => {
      const script = builder.generateScript('// test');
      // Extract the $() function
      const fnStart = script.indexOf('function $(string)');
      const fnEnd = script.indexOf('\n}', fnStart + 1);
      const dollarFn = script.slice(fnStart, fnEnd + 2);

      expect(dollarFn).not.toContain('try');
      expect(dollarFn).not.toContain('catch');
    });

    it('should NOT contain logger.error in $() function', () => {
      const script = builder.generateScript('// test');
      const fnStart = script.indexOf('function $(string)');
      const fnEnd = script.indexOf('\n}', fnStart + 1);
      const dollarFn = script.slice(fnStart, fnEnd + 2);

      expect(dollarFn).not.toContain('logger.error');
    });
  });
});
