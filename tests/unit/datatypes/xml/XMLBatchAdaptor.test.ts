import {
  XMLBatchAdaptor,
  XMLBatchAdaptorFactory,
  XMLSplitType,
} from '../../../../src/datatypes/xml/XMLBatchAdaptor.js';

/** Helper: drain all messages from an adaptor */
async function drainAll(adaptor: XMLBatchAdaptor): Promise<string[]> {
  const results: string[] = [];
  let msg = await adaptor.getMessage();
  while (msg !== null) {
    results.push(msg);
    msg = await adaptor.getMessage();
  }
  return results;
}

// -------------------------------------------------------------------
// Test XML fixtures
// -------------------------------------------------------------------

const SIMPLE_BATCH = `<root>
  <item><name>A</name></item>
  <item><name>B</name></item>
  <item><name>C</name></item>
</root>`;

const NESTED_BATCH = `<root>
  <group>
    <item><name>A</name></item>
    <item><name>B</name></item>
  </group>
  <group>
    <item><name>C</name></item>
  </group>
</root>`;

const NAMESPACED_BATCH = `<ns:root xmlns:ns="http://example.com">
  <ns:item><ns:name>A</ns:name></ns:item>
  <ns:item><ns:name>B</ns:name></ns:item>
</ns:root>`;

const MULTI_LEVEL = `<root>
  <level1a>
    <level2a><val>1</val></level2a>
    <level2b><val>2</val></level2b>
  </level1a>
  <level1b>
    <level2c><val>3</val></level2c>
  </level1b>
</root>`;

// -------------------------------------------------------------------
// Element_Name mode
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - Element_Name mode', () => {
  it('should split by element name at any depth', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('<name>A</name>');
    expect(messages[1]).toContain('<name>B</name>');
    expect(messages[2]).toContain('<name>C</name>');
  });

  it('should find nested elements at any depth', async () => {
    const adaptor = new XMLBatchAdaptor(NESTED_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('<name>A</name>');
    expect(messages[2]).toContain('<name>C</name>');
  });

  it('should return empty when no elements match', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'nonexistent',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(0);
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('should find namespaced elements by local name', async () => {
    const adaptor = new XMLBatchAdaptor(NAMESPACED_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(2);
  });

  it('should return raw message when elementName is empty', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: '',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('<root>');
  });

  it('should split by group elements', async () => {
    const adaptor = new XMLBatchAdaptor(NESTED_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'group',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(2);
    // First group has 2 items, second has 1
    expect(messages[0]).toContain('<name>A</name>');
    expect(messages[0]).toContain('<name>B</name>');
    expect(messages[1]).toContain('<name>C</name>');
  });
});

// -------------------------------------------------------------------
// Level mode
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - Level mode', () => {
  it('should extract direct children of root (level 1)', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Level,
      level: 1,
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('<name>A</name>');
    expect(messages[1]).toContain('<name>B</name>');
    expect(messages[2]).toContain('<name>C</name>');
  });

  it('should extract grandchildren of root (level 2)', async () => {
    const adaptor = new XMLBatchAdaptor(MULTI_LEVEL, {
      splitType: XMLSplitType.Level,
      level: 2,
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('<val>1</val>');
    expect(messages[1]).toContain('<val>2</val>');
    expect(messages[2]).toContain('<val>3</val>');
  });

  it('should extract root element at level 0', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Level,
      level: 0,
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('<root>');
  });

  it('should return empty for level deeper than document', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Level,
      level: 10,
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(0);
  });

  it('should default level to 1 when not specified', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Level,
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
  });
});

// -------------------------------------------------------------------
// XPath_Query mode
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - XPath_Query mode', () => {
  it('should select elements by simple path', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.XPath_Query,
      xpathQuery: '/root/item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('<name>A</name>');
  });

  it('should support wildcard path', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.XPath_Query,
      xpathQuery: '/root/*',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
  });

  it('should support descendant shortcut //', async () => {
    const adaptor = new XMLBatchAdaptor(NESTED_BATCH, {
      splitType: XMLSplitType.XPath_Query,
      xpathQuery: '//item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
  });

  it('should support multi-level path', async () => {
    const adaptor = new XMLBatchAdaptor(NESTED_BATCH, {
      splitType: XMLSplitType.XPath_Query,
      xpathQuery: '/root/group/item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
  });

  it('should throw on complex XPath with predicates', async () => {
    expect(() => {
      new XMLBatchAdaptor(SIMPLE_BATCH, {
        splitType: XMLSplitType.XPath_Query,
        xpathQuery: '/root/item[@id="1"]',
      });
    }).toThrow(/Unsupported XPath/);
  });

  it('should throw on XPath without leading /', async () => {
    expect(() => {
      new XMLBatchAdaptor(SIMPLE_BATCH, {
        splitType: XMLSplitType.XPath_Query,
        xpathQuery: 'root/item',
      });
    }).toThrow(/must start with/);
  });

  it('should return raw message when xpathQuery is empty', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.XPath_Query,
      xpathQuery: '',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(1);
  });
});

// -------------------------------------------------------------------
// JavaScript mode
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - JavaScript mode', () => {
  it('should delegate to ScriptBatchAdaptor', async () => {
    let callCount = 0;
    const items = ['<item>1</item>', '<item>2</item>'];
    const script = () => {
      if (callCount < items.length) {
        return items[callCount++]!;
      }
      return null;
    };

    const adaptor = new XMLBatchAdaptor(
      SIMPLE_BATCH,
      { splitType: XMLSplitType.JavaScript, batchScript: 'test' },
      script
    );

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe('<item>1</item>');
    expect(messages[1]).toBe('<item>2</item>');
  });

  it('should throw when no batch script function is provided', () => {
    expect(() => {
      new XMLBatchAdaptor(SIMPLE_BATCH, {
        splitType: XMLSplitType.JavaScript,
        batchScript: 'something',
      });
    }).toThrow(/No batch script was set/);
  });

  it('should track sequence IDs via ScriptBatchAdaptor', async () => {
    let callCount = 0;
    const script = () => {
      if (callCount++ < 2) return '<msg/>';
      return null;
    };

    const adaptor = new XMLBatchAdaptor(
      '<root/>',
      { splitType: XMLSplitType.JavaScript },
      script
    );

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);
    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);
  });

  it('should propagate sourceMap to script', async () => {
    const sourceMap = new Map<string, unknown>([['key', 'value']]);
    let capturedMap: Map<string, unknown> | undefined;

    const script = (ctx: { reader: any; sourceMap: Map<string, unknown> }) => {
      capturedMap = ctx.sourceMap;
      return null;
    };

    const adaptor = new XMLBatchAdaptor(
      '<root/>',
      { splitType: XMLSplitType.JavaScript },
      script,
      sourceMap
    );

    await adaptor.getMessage();
    expect(capturedMap).toBeDefined();
    expect(capturedMap!.get('key')).toBe('value');
  });
});

// -------------------------------------------------------------------
// Empty / malformed input
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - edge cases', () => {
  it('should return empty for empty string', async () => {
    const adaptor = new XMLBatchAdaptor('', {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(0);
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('should return empty for whitespace-only string', async () => {
    const adaptor = new XMLBatchAdaptor('   \n  ', {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(0);
  });

  it('should handle malformed XML gracefully (parser is lenient)', async () => {
    // fast-xml-parser auto-closes unclosed tags, so this parses but has no 'item' match
    const malformed = '<root><unclosed>';
    const adaptor = new XMLBatchAdaptor(malformed, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(0);
  });

  it('should handle non-XML content as single raw message', async () => {
    // fast-xml-parser wraps plain text in a text node; parsed result has
    // no element structure, so splitMessages falls through to [rawMessage]
    const notXml = 'this is not xml at all';
    const adaptor = new XMLBatchAdaptor(notXml, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const messages = await drainAll(adaptor);
    // fast-xml-parser wraps plain text into a parsed object; Element_Name finds no match
    // but the adaptor returns the text as-is (single message fallback)
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(notXml);
  });
});

// -------------------------------------------------------------------
// Sequence ID tracking
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - sequence tracking', () => {
  it('should track 1-based sequence IDs', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    expect(adaptor.getBatchSequenceId()).toBe(0);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(3);
  });

  it('should report batch complete after all messages consumed', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    expect(adaptor.isBatchComplete()).toBe(false);
    await drainAll(adaptor);
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('should return null after batch is exhausted', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    await drainAll(adaptor);
    expect(await adaptor.getMessage()).toBeNull();
    expect(await adaptor.getMessage()).toBeNull();
  });
});

// -------------------------------------------------------------------
// Cleanup
// -------------------------------------------------------------------

describe('XMLBatchAdaptor - cleanup', () => {
  it('should reset state on cleanup', async () => {
    const adaptor = new XMLBatchAdaptor(SIMPLE_BATCH, {
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    adaptor.cleanup();
    expect(adaptor.getBatchSequenceId()).toBe(0);
    expect(adaptor.isBatchComplete()).toBe(true);
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should cleanup JavaScript mode adaptor', async () => {
    let callCount = 0;
    const script = () => {
      if (callCount++ < 1) return '<item/>';
      return null;
    };

    const adaptor = new XMLBatchAdaptor(
      '<root/>',
      { splitType: XMLSplitType.JavaScript },
      script
    );

    await adaptor.getMessage();
    adaptor.cleanup();
    expect(adaptor.isBatchComplete()).toBe(true);
  });
});

// -------------------------------------------------------------------
// Factory
// -------------------------------------------------------------------

describe('XMLBatchAdaptorFactory', () => {
  it('should create adaptors with configured properties', async () => {
    const factory = new XMLBatchAdaptorFactory({
      splitType: XMLSplitType.Element_Name,
      elementName: 'item',
    });

    const adaptor = factory.createBatchAdaptor(SIMPLE_BATCH);
    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(3);
  });

  it('should create adaptors with JavaScript mode', async () => {
    let callCount = 0;
    const factory = new XMLBatchAdaptorFactory(
      { splitType: XMLSplitType.JavaScript },
      () => {
        if (callCount++ < 1) return '<msg/>';
        return null;
      }
    );

    const adaptor = factory.createBatchAdaptor('<root/>');
    const messages = await drainAll(adaptor);
    expect(messages).toHaveLength(1);
  });

  it('should create independent adaptors', async () => {
    const factory = new XMLBatchAdaptorFactory({
      splitType: XMLSplitType.Level,
      level: 1,
    });

    const adaptor1 = factory.createBatchAdaptor(SIMPLE_BATCH);
    const adaptor2 = factory.createBatchAdaptor(NESTED_BATCH);

    const msgs1 = await drainAll(adaptor1);
    const msgs2 = await drainAll(adaptor2);

    expect(msgs1).toHaveLength(3);
    expect(msgs2).toHaveLength(2); // 2 <group> children of root
  });
});
