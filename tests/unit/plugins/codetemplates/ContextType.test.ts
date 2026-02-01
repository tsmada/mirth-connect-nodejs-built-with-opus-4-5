import { ContextType } from '../../../../src/plugins/codetemplates/models/ContextType';
import { CodeTemplateContextSet } from '../../../../src/plugins/codetemplates/models/CodeTemplateContextSet';

describe('ContextType', () => {
  describe('ContextType enum values', () => {
    it('should have correct values', () => {
      expect(ContextType.GLOBAL_DEPLOY).toBe('GLOBAL_DEPLOY');
      expect(ContextType.GLOBAL_UNDEPLOY).toBe('GLOBAL_UNDEPLOY');
      expect(ContextType.GLOBAL_PREPROCESSOR).toBe('GLOBAL_PREPROCESSOR');
      expect(ContextType.GLOBAL_POSTPROCESSOR).toBe('GLOBAL_POSTPROCESSOR');
      expect(ContextType.CHANNEL_DEPLOY).toBe('CHANNEL_DEPLOY');
      expect(ContextType.CHANNEL_UNDEPLOY).toBe('CHANNEL_UNDEPLOY');
      expect(ContextType.CHANNEL_PREPROCESSOR).toBe('CHANNEL_PREPROCESSOR');
      expect(ContextType.CHANNEL_POSTPROCESSOR).toBe('CHANNEL_POSTPROCESSOR');
      expect(ContextType.CHANNEL_ATTACHMENT).toBe('CHANNEL_ATTACHMENT');
      expect(ContextType.CHANNEL_BATCH).toBe('CHANNEL_BATCH');
      expect(ContextType.SOURCE_RECEIVER).toBe('SOURCE_RECEIVER');
      expect(ContextType.SOURCE_FILTER_TRANSFORMER).toBe('SOURCE_FILTER_TRANSFORMER');
      expect(ContextType.DESTINATION_FILTER_TRANSFORMER).toBe('DESTINATION_FILTER_TRANSFORMER');
      expect(ContextType.DESTINATION_DISPATCHER).toBe('DESTINATION_DISPATCHER');
      expect(ContextType.DESTINATION_RESPONSE_TRANSFORMER).toBe('DESTINATION_RESPONSE_TRANSFORMER');
    });

    it('should have all 15 context types', () => {
      expect(Object.values(ContextType).length).toBe(15);
    });
  });
});

describe('CodeTemplateContextSet', () => {
  describe('constructor', () => {
    it('should create empty set by default', () => {
      const set = new CodeTemplateContextSet();
      expect(set.size).toBe(0);
    });

    it('should accept initial values', () => {
      const set = new CodeTemplateContextSet([
        ContextType.SOURCE_FILTER_TRANSFORMER,
        ContextType.DESTINATION_FILTER_TRANSFORMER,
      ]);
      expect(set.size).toBe(2);
      expect(set.has(ContextType.SOURCE_FILTER_TRANSFORMER)).toBe(true);
      expect(set.has(ContextType.DESTINATION_FILTER_TRANSFORMER)).toBe(true);
    });
  });

  describe('getGlobalContextSet', () => {
    it('should return set with all contexts (global in scope)', () => {
      const set = CodeTemplateContextSet.getGlobalContextSet();
      // This returns ALL contexts, not just GLOBAL_ prefixed ones
      expect(set.size).toBe(15);
      for (const context of Object.values(ContextType)) {
        expect(set.has(context)).toBe(true);
      }
    });
  });

  describe('getChannelContextSet', () => {
    it('should return set with channel and connector contexts', () => {
      const set = CodeTemplateContextSet.getChannelContextSet();
      // Channel contexts
      expect(set.has(ContextType.CHANNEL_DEPLOY)).toBe(true);
      expect(set.has(ContextType.CHANNEL_UNDEPLOY)).toBe(true);
      expect(set.has(ContextType.CHANNEL_PREPROCESSOR)).toBe(true);
      expect(set.has(ContextType.CHANNEL_POSTPROCESSOR)).toBe(true);
      expect(set.has(ContextType.CHANNEL_ATTACHMENT)).toBe(true);
      expect(set.has(ContextType.CHANNEL_BATCH)).toBe(true);
      // Also includes connector contexts
      expect(set.has(ContextType.SOURCE_RECEIVER)).toBe(true);
      expect(set.has(ContextType.SOURCE_FILTER_TRANSFORMER)).toBe(true);
      expect(set.size).toBe(11); // 6 channel + 5 connector contexts
    });
  });

  describe('getConnectorContextSet', () => {
    it('should return set with all connector contexts', () => {
      const set = CodeTemplateContextSet.getConnectorContextSet();
      expect(set.has(ContextType.SOURCE_RECEIVER)).toBe(true);
      expect(set.has(ContextType.SOURCE_FILTER_TRANSFORMER)).toBe(true);
      expect(set.has(ContextType.DESTINATION_FILTER_TRANSFORMER)).toBe(true);
      expect(set.has(ContextType.DESTINATION_DISPATCHER)).toBe(true);
      expect(set.has(ContextType.DESTINATION_RESPONSE_TRANSFORMER)).toBe(true);
      expect(set.size).toBe(5);
    });
  });


  describe('toArray', () => {
    it('should return array of contexts', () => {
      const set = new CodeTemplateContextSet([
        ContextType.SOURCE_FILTER_TRANSFORMER,
        ContextType.DESTINATION_FILTER_TRANSFORMER,
      ]);
      const array = set.toArray();
      expect(Array.isArray(array)).toBe(true);
      expect(array.length).toBe(2);
      expect(array).toContain(ContextType.SOURCE_FILTER_TRANSFORMER);
      expect(array).toContain(ContextType.DESTINATION_FILTER_TRANSFORMER);
    });
  });

  describe('fromArray', () => {
    it('should create set from array', () => {
      const array = [ContextType.GLOBAL_DEPLOY, ContextType.CHANNEL_DEPLOY];
      const set = CodeTemplateContextSet.fromArray(array);
      expect(set.size).toBe(2);
      expect(set.has(ContextType.GLOBAL_DEPLOY)).toBe(true);
      expect(set.has(ContextType.CHANNEL_DEPLOY)).toBe(true);
    });
  });
});
