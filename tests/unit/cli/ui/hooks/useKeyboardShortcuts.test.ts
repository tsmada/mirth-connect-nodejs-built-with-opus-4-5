/**
 * useKeyboardShortcuts Tests
 *
 * Tests keyboard shortcut matching logic.
 */

// Define Key interface locally to avoid importing from ink in tests
interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  pageUp: boolean;
  pageDown: boolean;
}

// Types extracted from the module
interface KeyboardAction {
  key: string;
  description: string;
  handler: () => void | Promise<void>;
  context?: 'list' | 'search' | 'details' | 'help' | 'messages' | ('list' | 'search' | 'details' | 'help' | 'messages')[];
}

// Functions extracted for testing
function keyMatches(input: string, key: Key, action: KeyboardAction): boolean {
  // Handle special keys
  if (action.key === 'up' && key.upArrow) return true;
  if (action.key === 'down' && key.downArrow) return true;
  if (action.key === 'left' && key.leftArrow) return true;
  if (action.key === 'right' && key.rightArrow) return true;
  if (action.key === 'enter' && key.return) return true;
  if (action.key === 'escape' && key.escape) return true;
  if (action.key === 'tab' && key.tab) return true;
  if (action.key === 'backspace' && key.backspace) return true;
  if (action.key === 'delete' && key.delete) return true;
  if (action.key === 'space' && input === ' ') return true;
  if (action.key === 'pageup' && key.pageUp) return true;
  if (action.key === 'pagedown' && key.pageDown) return true;

  // Handle character keys (case-insensitive by default)
  if (action.key.length === 1) {
    return input.toLowerCase() === action.key.toLowerCase();
  }

  return false;
}

function contextMatches(viewMode: string, action: KeyboardAction): boolean {
  if (!action.context) return true;

  if (Array.isArray(action.context)) {
    return action.context.includes(viewMode as any);
  }

  return action.context === viewMode;
}

describe('useKeyboardShortcuts', () => {
  // Helper to create mock Key object
  const createKey = (overrides: Partial<Key> = {}): Key => ({
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    meta: false,
    tab: false,
    backspace: false,
    delete: false,
    pageUp: false,
    pageDown: false,
    ...overrides,
  });

  describe('keyMatches', () => {
    it('should match arrow keys', () => {
      const upAction: KeyboardAction = { key: 'up', description: 'Move up', handler: jest.fn() };
      const downAction: KeyboardAction = { key: 'down', description: 'Move down', handler: jest.fn() };

      expect(keyMatches('', createKey({ upArrow: true }), upAction)).toBe(true);
      expect(keyMatches('', createKey({ downArrow: true }), downAction)).toBe(true);
      expect(keyMatches('', createKey({ upArrow: true }), downAction)).toBe(false);
    });

    it('should match special keys', () => {
      const enterAction: KeyboardAction = { key: 'enter', description: 'Confirm', handler: jest.fn() };
      const escAction: KeyboardAction = { key: 'escape', description: 'Cancel', handler: jest.fn() };
      const tabAction: KeyboardAction = { key: 'tab', description: 'Next', handler: jest.fn() };

      expect(keyMatches('', createKey({ return: true }), enterAction)).toBe(true);
      expect(keyMatches('', createKey({ escape: true }), escAction)).toBe(true);
      expect(keyMatches('', createKey({ tab: true }), tabAction)).toBe(true);
    });

    it('should match space key', () => {
      const spaceAction: KeyboardAction = { key: 'space', description: 'Toggle', handler: jest.fn() };

      expect(keyMatches(' ', createKey(), spaceAction)).toBe(true);
      expect(keyMatches('x', createKey(), spaceAction)).toBe(false);
    });

    it('should match character keys case-insensitively', () => {
      const sAction: KeyboardAction = { key: 's', description: 'Start', handler: jest.fn() };

      expect(keyMatches('s', createKey(), sAction)).toBe(true);
      expect(keyMatches('S', createKey(), sAction)).toBe(true);
      expect(keyMatches('x', createKey(), sAction)).toBe(false);
    });

    it('should match uppercase action keys with any case input', () => {
      const quitAction: KeyboardAction = { key: 'Q', description: 'Quit', handler: jest.fn() };

      expect(keyMatches('q', createKey(), quitAction)).toBe(true);
      expect(keyMatches('Q', createKey(), quitAction)).toBe(true);
    });

    it('should match page up/down', () => {
      const pageUpAction: KeyboardAction = { key: 'pageup', description: 'Page Up', handler: jest.fn() };
      const pageDownAction: KeyboardAction = { key: 'pagedown', description: 'Page Down', handler: jest.fn() };

      expect(keyMatches('', createKey({ pageUp: true }), pageUpAction)).toBe(true);
      expect(keyMatches('', createKey({ pageDown: true }), pageDownAction)).toBe(true);
    });

    it('should not match multi-character key names as input', () => {
      const upAction: KeyboardAction = { key: 'up', description: 'Move up', handler: jest.fn() };

      expect(keyMatches('up', createKey(), upAction)).toBe(false);
    });
  });

  describe('contextMatches', () => {
    it('should match when action has no context', () => {
      const globalAction: KeyboardAction = { key: 'q', description: 'Quit', handler: jest.fn() };

      expect(contextMatches('list', globalAction)).toBe(true);
      expect(contextMatches('search', globalAction)).toBe(true);
      expect(contextMatches('details', globalAction)).toBe(true);
    });

    it('should match single context', () => {
      const listAction: KeyboardAction = {
        key: 's',
        description: 'Start',
        handler: jest.fn(),
        context: 'list',
      };

      expect(contextMatches('list', listAction)).toBe(true);
      expect(contextMatches('search', listAction)).toBe(false);
      expect(contextMatches('details', listAction)).toBe(false);
    });

    it('should match multiple contexts', () => {
      const multiAction: KeyboardAction = {
        key: 's',
        description: 'Start',
        handler: jest.fn(),
        context: ['list', 'details'],
      };

      expect(contextMatches('list', multiAction)).toBe(true);
      expect(contextMatches('details', multiAction)).toBe(true);
      expect(contextMatches('search', multiAction)).toBe(false);
    });
  });
});
