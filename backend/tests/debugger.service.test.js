
import DebuggerService from '../src/services/debugger.service.js';
import GdbMiParser from '../src/parsers/gdb-mi-parser.js';

jest.mock('../src/parsers/gdb-mi-parser.js');

describe('DebuggerService', () => {
  let debuggerService;
  let mockGdbMiParser;

  beforeEach(() => {
    // Create a new mock for each test
    mockGdbMiParser = new GdbMiParser();
    GdbMiParser.mockClear(); // Clear constructor mocks
    
    // Manually mock the instance methods
    mockGdbMiParser.start = jest.fn();
    mockGdbMiParser.sendCommand = jest.fn();
    
    // Point the constructor mock to return our instance
    GdbMiParser.mockImplementation(() => mockGdbMiParser);

    debuggerService = new DebuggerService('session123');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create an instance of DebuggerService', () => {
    expect(debuggerService).toBeInstanceOf(DebuggerService);
    expect(GdbMiParser).toHaveBeenCalledTimes(1);
    expect(GdbMiParser).toHaveBeenCalledWith(debuggerService.sessionId);
  });

  it('should call gdbMiParser.start when starting the debugger', async () => {
    const executablePath = '/path/to/executable';
    await debuggerService.start(executablePath);
    expect(mockGdbMiParser.start).toHaveBeenCalledTimes(1);
    expect(mockGdbMiParser.start).toHaveBeenCalledWith(executablePath);
  });

  it('should call gdbMiParser.sendCommand when sending a command', async () => {
    const command = 'test command';
    await debuggerService.sendCommand(command);
    expect(mockGdbMiParser.sendCommand).toHaveBeenCalledTimes(1);
    expect(mockGdbMiParser.sendCommand).toHaveBeenCalledWith(command);
  });
});
