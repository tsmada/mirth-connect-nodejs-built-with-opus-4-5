/**
 * Unit tests for VMRouter userutil class
 */

import {
  VMRouter,
  setChannelController,
  setEngineController,
  getChannelController,
  getEngineController,
  IChannelController,
  IEngineController,
  ILogger,
} from '../../../../src/javascript/userutil/VMRouter.js';
import { RawMessage } from '../../../../src/javascript/userutil/RawMessage.js';
import { Response } from '../../../../src/model/Response.js';
import { Status } from '../../../../src/model/Status.js';

describe('VMRouter', () => {
  // Mock controllers
  let mockChannelController: IChannelController;
  let mockEngineController: IEngineController;
  let mockLogger: ILogger;
  let loggedErrors: string[];

  beforeEach(() => {
    loggedErrors = [];

    mockChannelController = {
      getDeployedChannelByName: jest.fn(),
      getDeployedChannelById: jest.fn(),
    };

    mockEngineController = {
      dispatchRawMessage: jest.fn(),
    };

    mockLogger = {
      error: jest.fn((msg: string) => {
        loggedErrors.push(msg);
      }),
    };

    // Set up global controllers
    setChannelController(mockChannelController);
    setEngineController(mockEngineController);
  });

  afterEach(() => {
    // Clean up singleton state
    setChannelController(null as any);
    setEngineController(null as any);
  });

  describe('constructor', () => {
    it('should create VMRouter with global controllers', () => {
      const router = new VMRouter();
      expect(router).toBeInstanceOf(VMRouter);
    });

    it('should create VMRouter with custom controllers', () => {
      const customChannelController: IChannelController = {
        getDeployedChannelByName: jest.fn(),
      };
      const customEngineController: IEngineController = {
        dispatchRawMessage: jest.fn(),
      };

      const router = new VMRouter(undefined, customChannelController, customEngineController);
      expect(router).toBeInstanceOf(VMRouter);
    });

    it('should throw when no channel controller is available', () => {
      setChannelController(null as any);

      expect(() => new VMRouter()).toThrow(
        'No channel controller available. Call setChannelController() during startup.'
      );
    });

    it('should throw when no engine controller is available', () => {
      setEngineController(null as any);

      expect(() => new VMRouter()).toThrow(
        'No engine controller available. Call setEngineController() during startup.'
      );
    });
  });

  describe('routeMessage by channel name', () => {
    it('should route string message to channel by name', async () => {
      (mockChannelController.getDeployedChannelByName as jest.Mock).mockReturnValue({
        id: 'channel-123',
      });
      const expectedResponse = Response.sent('ACK');
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue({
        selectedResponse: expectedResponse,
      });

      const router = new VMRouter();
      const response = await router.routeMessage('Test Channel', 'Hello World');

      expect(mockChannelController.getDeployedChannelByName).toHaveBeenCalledWith('Test Channel');
      expect(mockEngineController.dispatchRawMessage).toHaveBeenCalledWith(
        'channel-123',
        expect.objectContaining({
          rawData: 'Hello World',
        }),
        false,
        true
      );
      expect(response).toBe(expectedResponse);
    });

    it('should route RawMessage to channel by name', async () => {
      (mockChannelController.getDeployedChannelByName as jest.Mock).mockReturnValue({
        id: 'channel-456',
      });
      const expectedResponse = Response.sent('OK');
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue({
        selectedResponse: expectedResponse,
      });

      const sourceMap = new Map<string, unknown>([['key', 'value']]);
      const rawMessage = new RawMessage('Test Data', [1, 2], sourceMap);

      const router = new VMRouter();
      const response = await router.routeMessage('My Channel', rawMessage);

      expect(mockEngineController.dispatchRawMessage).toHaveBeenCalledWith(
        'channel-456',
        expect.objectContaining({
          rawData: 'Test Data',
          destinationMetaDataIds: new Set([1, 2]),
        }),
        false,
        true
      );
      expect(response).toBe(expectedResponse);
    });

    it('should return ERROR response when channel not found', async () => {
      (mockChannelController.getDeployedChannelByName as jest.Mock).mockReturnValue(null);

      const router = new VMRouter(mockLogger);
      const response = await router.routeMessage('Non Existent', 'test');

      expect(response).not.toBeNull();
      expect(response!.getStatus()).toBe(Status.ERROR);
      expect(response!.getMessage()).toContain('Could not find channel');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('routeMessageByChannelId', () => {
    it('should route string message by channel ID', async () => {
      const expectedResponse = Response.sent('Success');
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue({
        selectedResponse: expectedResponse,
      });

      const router = new VMRouter();
      const response = await router.routeMessageByChannelId('id-789', 'Message Data');

      expect(mockEngineController.dispatchRawMessage).toHaveBeenCalledWith(
        'id-789',
        expect.objectContaining({
          rawData: 'Message Data',
        }),
        false,
        true
      );
      expect(response).toBe(expectedResponse);
    });

    it('should route RawMessage by channel ID', async () => {
      const expectedResponse = Response.sent('Done');
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue({
        selectedResponse: expectedResponse,
      });

      const rawMessage = new RawMessage('Binary Test');

      const router = new VMRouter();
      const response = await router.routeMessageByChannelId('id-abc', rawMessage);

      expect(response).toBe(expectedResponse);
    });

    it('should return null when no response from dispatch', async () => {
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue(null);

      const router = new VMRouter();
      const response = await router.routeMessageByChannelId('id-null', 'test');

      expect(response).toBeNull();
    });

    it('should return null when dispatch result has no selectedResponse', async () => {
      (mockEngineController.dispatchRawMessage as jest.Mock).mockResolvedValue({});

      const router = new VMRouter();
      const response = await router.routeMessageByChannelId('id-empty', 'test');

      expect(response).toBeNull();
    });

    it('should return ERROR response on dispatch error', async () => {
      (mockEngineController.dispatchRawMessage as jest.Mock).mockRejectedValue(
        new Error('Connection refused')
      );

      const router = new VMRouter(mockLogger);
      const response = await router.routeMessageByChannelId('id-error', 'test');

      expect(response).not.toBeNull();
      expect(response!.getStatus()).toBe(Status.ERROR);
      expect(response!.getStatusMessage()).toContain('Error routing message');
      expect(response!.getStatusMessage()).toContain('Connection refused');
      expect(response!.getError()).toContain('VMRouter');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      (mockEngineController.dispatchRawMessage as jest.Mock).mockRejectedValue('string error');

      const router = new VMRouter(mockLogger);
      const response = await router.routeMessageByChannelId('id-string-error', 'test');

      expect(response).not.toBeNull();
      expect(response!.getStatus()).toBe(Status.ERROR);
    });
  });

  describe('global controller functions', () => {
    it('should get and set channel controller', () => {
      const controller: IChannelController = {
        getDeployedChannelByName: jest.fn(),
      };

      setChannelController(controller);
      expect(getChannelController()).toBe(controller);
    });

    it('should get and set engine controller', () => {
      const controller: IEngineController = {
        dispatchRawMessage: jest.fn(),
      };

      setEngineController(controller);
      expect(getEngineController()).toBe(controller);
    });
  });
});
