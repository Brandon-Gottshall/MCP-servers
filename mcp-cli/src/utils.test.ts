import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import path from 'path';
import type * as FsModule from 'fs';
import { execa } from 'execa';
import { parse as actualParse, stringify as actualStringify } from 'yaml';

// --- Define mocks at the TOP LEVEL using vi ---
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof FsModule>();
    return {
        ...actual, // Keep actual implementations for non-mocked parts
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        // Provide a default export if the module is imported as `import fs from 'fs'`
        default: {
            existsSync: vi.fn(),
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            // Include other fs functions if needed by utils.ts default import
        }
    };
});
vi.mock('execa', async (importOriginal) => {
    const actual = await importOriginal<typeof import('execa')>();
     return { 
         ...actual, 
         execa: vi.fn()
     }; 
});
vi.mock('yaml', async (importOriginal) => {
    const actual = await importOriginal<typeof import('yaml')>();
    const mockedParse = vi.fn();
    const mockedStringify = vi.fn();
    return {
        ...actual,
        parse: mockedParse,
        stringify: mockedStringify,
        // Provide a default export if the module is imported as `import YAML from 'yaml'`
        default: {
             parse: mockedParse,
             stringify: mockedStringify,
            // Include other YAML functions if needed
        }
    };
});

// --- Import actual modules AFTER mocks are defined ---
// These imports will now get the mocked versions
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import YAML from 'yaml'; // Import default and named if needed

// --- Module-level variables for managers (will be assigned in beforeEach) ---
let GitManager: typeof import('./utils').GitManager;
let StateManager: typeof import('./utils').StateManager;
let DockerComposeManager: typeof import('./utils').DockerComposeManager;
let ShellExecutor: typeof import('./utils').ShellExecutor;
import type { DockerComposeConfig } from './utils';

// --- Test constants ---
// Calculate paths relative to the *project root*, assuming tests run from mcp-cli
const PROJECT_ROOT_FOR_TESTS = path.resolve(__dirname, '..', '..'); // Assumes __dirname is .../mcp-cli/src or similar
const STATE_FILE_TEST = path.join(PROJECT_ROOT_FOR_TESTS, 'mcp-state.json');
const DOCKER_COMPOSE_FILE_TEST = path.join(PROJECT_ROOT_FOR_TESTS, 'docker-compose.yml');
const MCP_SERVERS_DIR_TEST = path.join(PROJECT_ROOT_FOR_TESTS, 'mcp-servers');

// --- Setup ---
beforeEach(async () => {
    // 1. Reset mocks using global vi
    vi.resetAllMocks();

    // 2. Dynamically import the module under test
    //    This ensures it gets the mocked dependencies defined above
    const utils = await import('./utils');
    GitManager = utils.GitManager;
    StateManager = utils.StateManager;
    DockerComposeManager = utils.DockerComposeManager;
    ShellExecutor = utils.ShellExecutor;
});


// --- Test Suites --- (Keep these as they were)

describe('ShellExecutor', () => {
    it('runCommand should call execa with correct arguments and cwd', async () => {
        const command = 'ls';
        const args = ['-la'];
        const cwd = '/test/dir';
        // Mock directly on the imported execa *within the test*
        const mockExeca = vi.mocked(execa).mockResolvedValue({ stdout: '...', stderr: '', exitCode: 0 } as any);

        await ShellExecutor.runCommand(command, args, cwd);

        expect(mockExeca).toHaveBeenCalledOnce();
        expect(mockExeca).toHaveBeenCalledWith(command, args, { cwd, stdio: 'pipe' });

        mockExeca.mockRestore(); // Clean up mock if needed, though resetAllMocks should handle it
    });

    it('runCommand should handle and rethrow errors from execa', async () => {
        const command = 'git';
        const args = ['fail'];
        const cwd = '/';
        const mockError = new Error('Command failed');
        Object.assign(mockError, { stderr: 'error output', stdout: '', exitCode: 1 });
        // Mock directly on the imported execa *within the test*
        const mockExeca = vi.mocked(execa).mockRejectedValue(mockError);

        await expect(ShellExecutor.runCommand(command, args, cwd))
            .rejects.toThrow('Command failed');
        expect(mockExeca).toHaveBeenCalledWith(command, args, { cwd, stdio: 'pipe' });
        
        mockExeca.mockRestore();
    });
});

describe('StateManager', () => {
    const stateFilePath = STATE_FILE_TEST;

    it('readState should return default state if file does not exist', async () => {
        // Use vi.mocked on the imported (mocked) fs functions
        vi.mocked(existsSync).mockReturnValue(false);
        const state = StateManager.readState();
        expect(existsSync).toHaveBeenCalledWith(stateFilePath);
        expect(readFileSync).not.toHaveBeenCalled();
        expect(state).toEqual({ addedServers: [] });
    });

    it('readState should parse and return state from existing file', async () => {
        const mockState = { addedServers: ['github', 'jira'] };
        const fileContent = JSON.stringify(mockState);
        // Use vi.mocked on imported (mocked) fs functions
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(fileContent);
        const state = StateManager.readState();
        expect(existsSync).toHaveBeenCalledWith(stateFilePath);
        expect(readFileSync).toHaveBeenCalledWith(stateFilePath, 'utf-8');
        expect(state).toEqual(mockState);
    });

     it('readState should return default state on JSON parse error', async () => {
         const invalidJson = '{ "addedServers": [ "github", ] }';
         // Use vi.mocked on imported (mocked) fs functions
         vi.mocked(existsSync).mockReturnValue(true);
         vi.mocked(readFileSync).mockReturnValue(invalidJson);
         // Use vi.spyOn
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
         const state = StateManager.readState();
         expect(existsSync).toHaveBeenCalledWith(stateFilePath);
         expect(readFileSync).toHaveBeenCalledWith(stateFilePath, 'utf-8');
         expect(state).toEqual({ addedServers: [] });
         expect(consoleErrorSpy).toHaveBeenCalled();
         consoleErrorSpy.mockRestore();
     });

    it('writeState should call writeFileSync with correct path and stringified data', async () => {
        const stateToWrite = { addedServers: ['slack'] };
        const expectedJson = JSON.stringify(stateToWrite, null, 2);
        StateManager.writeState(stateToWrite);
        // Check call on imported (mocked) fs function
        expect(writeFileSync).toHaveBeenCalledOnce();
        expect(writeFileSync).toHaveBeenCalledWith(stateFilePath, expectedJson, 'utf-8');
    });

     it('writeState should handle errors during file write', async () => {
         const stateToWrite = { addedServers: ['gitlab'] };
         const writeError = new Error('Disk full');
         // Use vi.mocked on imported (mocked) fs function
         vi.mocked(writeFileSync).mockImplementation(() => { throw writeError; });
         // Use vi.spyOn
         const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
         expect(() => StateManager.writeState(stateToWrite)).toThrow(writeError);
         expect(consoleErrorSpy).toHaveBeenCalled();
         consoleErrorSpy.mockRestore();
     });
});

describe('DockerComposeManager', () => {
    const dockerComposePath = DOCKER_COMPOSE_FILE_TEST;

    it('readDockerCompose should return default structure if file does not exist', async () => {
        // Use vi.mocked on imported (mocked) fs functions
        vi.mocked(existsSync).mockReturnValue(false);
        const config = DockerComposeManager.readDockerCompose();
        expect(existsSync).toHaveBeenCalledWith(dockerComposePath);
        expect(readFileSync).not.toHaveBeenCalled();
        expect(config).toEqual({ version: '3.8', services: {} });
    });

    it('readDockerCompose should parse existing valid YAML', async () => {
        const yamlContent = `
version: '3.8'
services:
  existing:
    image: test
`;
        const expectedConfig = { version: '3.8', services: { existing: { image: 'test' } } };
        // Use vi.mocked on imported mocks
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(yamlContent);
        vi.mocked(YAML.parse).mockReturnValue(expectedConfig);

        const config = DockerComposeManager.readDockerCompose();

        expect(existsSync).toHaveBeenCalledWith(dockerComposePath);
        expect(readFileSync).toHaveBeenCalledWith(dockerComposePath, 'utf-8');
        expect(YAML.parse).toHaveBeenCalledWith(yamlContent);
        expect(config).toEqual(expectedConfig);
    });

    it('readDockerCompose should throw on invalid YAML', async () => {
        const invalidYamlContent = `services: test: invalid`;
        const parseError = new Error('Invalid YAML');
        // Use vi.mocked on imported mocks
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(invalidYamlContent);
        vi.mocked(YAML.parse).mockImplementation(() => { throw parseError; });
        // Use vi.spyOn
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => DockerComposeManager.readDockerCompose()).toThrow(/Failed to process docker-compose.yml: Invalid YAML/);
        expect(YAML.parse).toHaveBeenCalledWith(invalidYamlContent);
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('addService should add a correctly formatted service definition', () => {
        const initialConfig: DockerComposeConfig = { version: '3.8', services: {} };
        const serverName = 'github';
        const expectedContext = path.relative(path.dirname(dockerComposePath), path.join(MCP_SERVERS_DIR_TEST, 'src', serverName));
        DockerComposeManager.addService(initialConfig, serverName);
        expect(initialConfig.services[serverName]).toBeDefined();
        expect(initialConfig.services[serverName].build).toEqual({ context: expectedContext });
        expect(initialConfig.services[serverName].restart).toBe('unless-stopped');
        expect(initialConfig.services[serverName].stdin_open).toBe(true);
        expect(initialConfig.services[serverName].tty).toBe(true);
        expect(initialConfig.services[serverName].environment).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}']);
    });

    it('removeService should remove existing service', () => {
         const initialConfig: DockerComposeConfig = { version: '3.8', services: { github: { image: 'test' } } };
         DockerComposeManager.removeService(initialConfig, 'github');
         expect(initialConfig.services['github']).toBeUndefined();
    });

     it('removeService should warn if service does not exist', () => {
         const initialConfig: DockerComposeConfig = { version: '3.8', services: {} };
         // Use vi.spyOn
         const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
         DockerComposeManager.removeService(initialConfig, 'nonexistent');
         expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
         expect(initialConfig.services['nonexistent']).toBeUndefined();
         consoleWarnSpy.mockRestore();
     });

    it('writeDockerCompose should call YAML.stringify and fs.writeFileSync', async () => {
        const configToWrite = { version: '3.8', services: { github: { image: 'test' } } };
        const expectedYaml = 'yaml output';
        // Use vi.mocked on imported (mocked) functions
        vi.mocked(YAML.stringify).mockReturnValue(expectedYaml);

        DockerComposeManager.writeDockerCompose(configToWrite);

        expect(YAML.stringify).toHaveBeenCalledWith(configToWrite);
        expect(writeFileSync).toHaveBeenCalledWith(dockerComposePath, expectedYaml, 'utf-8');
    });
});

describe('GitManager', () => {
    const serversDir = MCP_SERVERS_DIR_TEST;
    const sparseCheckoutFile = path.join(serversDir, '.git', 'info', 'sparse-checkout');

    it('ensureRepoInitialized should run git commands if dir or .git missing', async () => {
        vi.mocked(existsSync).mockReturnValue(false);
        vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
        await GitManager.ensureRepoInitialized();
        expect(mkdirSync).toHaveBeenCalledWith(serversDir, { recursive: true });
        expect(vi.mocked(execa)).toHaveBeenCalledWith('git', ['init'], serversDir);
        expect(vi.mocked(execa)).toHaveBeenCalledWith('git', ['remote', 'add', 'mcp-origin', expect.any(String)], serversDir);
        expect(vi.mocked(execa)).toHaveBeenCalledWith('git', ['config', 'core.sparseCheckout', 'true'], serversDir);
        expect(vi.mocked(execa)).toHaveBeenCalledWith('bash', ['-c', '> .git/info/sparse-checkout'], serversDir);
    });

    it('ensureRepoInitialized should do nothing if already initialized', async () => {
         vi.mocked(existsSync).mockReturnValue(true);
         await GitManager.ensureRepoInitialized();
         expect(mkdirSync).not.toHaveBeenCalled();
         expect(vi.mocked(execa)).not.toHaveBeenCalled();
     });

    it('updateSparseCheckoutConfig should write correct paths to sparse-checkout file', async () => {
        const serverNames = ['github', 'jira'];
        const expectedContent = 'src/github/\nsrc/jira/\n';
        const expectedDir = path.dirname(sparseCheckoutFile);
        await GitManager.updateSparseCheckoutConfig(serverNames);
        expect(mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
        expect(writeFileSync).toHaveBeenCalledWith(sparseCheckoutFile, expectedContent);
    });

    it('pullLatest should call git fetch and checkout', async () => {
        vi.mocked(execa).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
        await GitManager.pullLatest();
        expect(vi.mocked(execa)).toHaveBeenCalledWith('git', ['fetch', 'mcp-origin', 'main'], { cwd: serversDir, stdio: 'pipe' });
        expect(vi.mocked(execa)).toHaveBeenCalledWith('git', ['checkout', 'main'], { cwd: serversDir, stdio: 'pipe' });
    });
}); 