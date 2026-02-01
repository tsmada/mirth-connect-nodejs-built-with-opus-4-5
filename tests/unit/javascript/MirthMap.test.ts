import {
  MirthMap,
  SourceMap,
  ChannelMap,
  ResponseMap,
  GlobalMap,
  GlobalChannelMapStore,
  ConfigurationMap,
} from '../../../src/javascript/userutil/MirthMap';

describe('MirthMap', () => {
  describe('basic operations', () => {
    let map: MirthMap;

    beforeEach(() => {
      map = new MirthMap();
    });

    it('should put and get values', () => {
      map.put('key1', 'value1');
      expect(map.get('key1')).toBe('value1');
    });

    it('should return previous value on put', () => {
      map.put('key1', 'value1');
      const previous = map.put('key1', 'value2');
      expect(previous).toBe('value1');
      expect(map.get('key1')).toBe('value2');
    });

    it('should return undefined for missing key', () => {
      expect(map.get('nonexistent')).toBeUndefined();
    });

    it('should check containsKey', () => {
      map.put('key1', 'value1');
      expect(map.containsKey('key1')).toBe(true);
      expect(map.containsKey('nonexistent')).toBe(false);
    });

    it('should remove key and return value', () => {
      map.put('key1', 'value1');
      const removed = map.remove('key1');
      expect(removed).toBe('value1');
      expect(map.containsKey('key1')).toBe(false);
    });

    it('should clear all entries', () => {
      map.put('key1', 'value1');
      map.put('key2', 'value2');
      map.clear();
      expect(map.size()).toBe(0);
      expect(map.isEmpty()).toBe(true);
    });

    it('should return size', () => {
      expect(map.size()).toBe(0);
      map.put('key1', 'value1');
      expect(map.size()).toBe(1);
      map.put('key2', 'value2');
      expect(map.size()).toBe(2);
    });

    it('should return keySet', () => {
      map.put('key1', 'value1');
      map.put('key2', 'value2');
      const keys = map.keySet();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should return values', () => {
      map.put('key1', 'value1');
      map.put('key2', 'value2');
      const values = map.values();
      expect(values).toContain('value1');
      expect(values).toContain('value2');
    });

    it('should convert to object', () => {
      map.put('key1', 'value1');
      map.put('key2', 'value2');
      const obj = map.toObject();
      expect(obj).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('constructor', () => {
    it('should initialize from Map', () => {
      const initial = new Map<string, unknown>([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      const map = new MirthMap(initial);
      expect(map.get('key1')).toBe('value1');
      expect(map.get('key2')).toBe('value2');
    });

    it('should initialize from object', () => {
      const map = new MirthMap({ key1: 'value1', key2: 'value2' });
      expect(map.get('key1')).toBe('value1');
      expect(map.get('key2')).toBe('value2');
    });
  });
});

describe('SourceMap', () => {
  it('should allow put with warning', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const map = new SourceMap();
    map.put('key1', 'value1');
    expect(map.get('key1')).toBe('value1');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('ChannelMap', () => {
  it('should fall back to sourceMap', () => {
    const sourceMap = new SourceMap();
    jest.spyOn(console, 'warn').mockImplementation();
    sourceMap.put('sourceKey', 'sourceValue');

    const channelMap = new ChannelMap(undefined, sourceMap);
    expect(channelMap.get('sourceKey')).toBe('sourceValue');
  });

  it('should prefer channelMap over sourceMap', () => {
    const sourceMap = new SourceMap();
    jest.spyOn(console, 'warn').mockImplementation();
    sourceMap.put('key', 'sourceValue');

    const channelMap = new ChannelMap(undefined, sourceMap);
    channelMap.put('key', 'channelValue');

    expect(channelMap.get('key')).toBe('channelValue');
  });

  it('should check containsKey in both maps', () => {
    const sourceMap = new SourceMap();
    jest.spyOn(console, 'warn').mockImplementation();
    sourceMap.put('sourceKey', 'sourceValue');

    const channelMap = new ChannelMap(undefined, sourceMap);
    channelMap.put('channelKey', 'channelValue');

    expect(channelMap.containsKey('sourceKey')).toBe(true);
    expect(channelMap.containsKey('channelKey')).toBe(true);
    expect(channelMap.containsKey('nonexistent')).toBe(false);
  });
});

describe('ResponseMap', () => {
  it('should store destination ID mapping', () => {
    const destIdMap = new Map([
      ['Destination 1', 1],
      ['Destination 2', 2],
    ]);
    const responseMap = new ResponseMap(undefined, destIdMap);

    expect(responseMap.getDestinationId('Destination 1')).toBe(1);
    expect(responseMap.getDestinationId('Destination 2')).toBe(2);
    expect(responseMap.getDestinationId('Unknown')).toBeUndefined();
  });
});

describe('GlobalMap', () => {
  afterEach(() => {
    GlobalMap.resetInstance();
  });

  it('should be a singleton', () => {
    const map1 = GlobalMap.getInstance();
    const map2 = GlobalMap.getInstance();
    expect(map1).toBe(map2);
  });

  it('should persist values across getInstance calls', () => {
    const map1 = GlobalMap.getInstance();
    map1.put('key', 'value');

    const map2 = GlobalMap.getInstance();
    expect(map2.get('key')).toBe('value');
  });
});

describe('GlobalChannelMapStore', () => {
  afterEach(() => {
    GlobalChannelMapStore.resetInstance();
  });

  it('should be a singleton', () => {
    const store1 = GlobalChannelMapStore.getInstance();
    const store2 = GlobalChannelMapStore.getInstance();
    expect(store1).toBe(store2);
  });

  it('should create separate maps per channel', () => {
    const store = GlobalChannelMapStore.getInstance();

    const map1 = store.get('channel-1');
    const map2 = store.get('channel-2');

    map1.put('key', 'value1');
    map2.put('key', 'value2');

    expect(store.get('channel-1').get('key')).toBe('value1');
    expect(store.get('channel-2').get('key')).toBe('value2');
  });

  it('should return same map for same channel', () => {
    const store = GlobalChannelMapStore.getInstance();

    const map1 = store.get('channel-1');
    map1.put('key', 'value');

    const map2 = store.get('channel-1');
    expect(map2.get('key')).toBe('value');
  });

  it('should clear channel map', () => {
    const store = GlobalChannelMapStore.getInstance();

    store.get('channel-1').put('key', 'value');
    store.clear('channel-1');

    // Getting the channel again should create a new empty map
    expect(store.get('channel-1').get('key')).toBeUndefined();
  });
});

describe('ConfigurationMap', () => {
  afterEach(() => {
    ConfigurationMap.resetInstance();
  });

  it('should be a singleton', () => {
    const map1 = ConfigurationMap.getInstance();
    const map2 = ConfigurationMap.getInstance();
    expect(map1).toBe(map2);
  });

  it('should load configuration from object', () => {
    const map = ConfigurationMap.getInstance();
    map.load({
      'server.name': 'Test Server',
      'server.port': 8080,
    });

    expect(map.get('server.name')).toBe('Test Server');
    expect(map.get('server.port')).toBe(8080);
  });
});
