import { execa } from 'execa';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import YAML from 'yaml';

// --- Configuration ---
// Correctly resolve workspace root assuming script might be run from mcp-cli or project root
const isRunningInCliDir = path.basename(process.cwd()) === 'mcp-cli';
const WORKSPACE_ROOT = isRunningInCliDir ? path.resolve(process.cwd(), '..') : process.cwd();
const MCP_SERVERS_DIR = path.join(WORKSPACE_ROOT, 'mcp-servers');
const STATE_FILE = path.join(WORKSPACE_ROOT, 'mcp-state.json');
const DOCKER_COMPOSE_FILE = path.join(WORKSPACE_ROOT, 'docker-compose.yml');
const MCP_REPO_URL = 'https://github.com/modelcontextprotocol/servers.git';
const MCP_REMOTE_NAME = 'mcp-origin';

interface McpState {
    addedServers: string[];
}

interface DockerComposeService {
    build?: {
        context: string;
        dockerfile?: string;
    } | string;
    image?: string;
    environment?: string[] | Record<string, string>;
    ports?: string[];
    volumes?: string[];
    restart?: string;
    stdin_open?: boolean;
    tty?: boolean;
    // Add other common docker-compose service properties if needed
}

export interface DockerComposeConfig {
    version?: string;
    services: Record<string, DockerComposeService>;
    // Add other top-level docker-compose keys if needed (volumes, networks, etc.)
}


// --- Git/Sparse Checkout Manager ---
export class GitManager {
    static async ensureRepoInitialized(): Promise<void> {
        console.log('Ensuring MCP servers repository is initialized...');
        if (!existsSync(MCP_SERVERS_DIR)) {
            console.log(`Creating directory: ${MCP_SERVERS_DIR}`);
            mkdirSync(MCP_SERVERS_DIR, { recursive: true });
        }

        const gitDir = path.join(MCP_SERVERS_DIR, '.git');
        let isInitialized = existsSync(gitDir);

        if (!isInitialized) {
            console.log('Initializing Git repository...');
            await ShellExecutor.runCommand('git', ['init'], MCP_SERVERS_DIR);
            console.log('Adding remote repository...');
            await ShellExecutor.runCommand('git', ['remote', 'add', MCP_REMOTE_NAME, MCP_REPO_URL], MCP_SERVERS_DIR);
            console.log('Enabling sparse checkout...');
            await ShellExecutor.runCommand('git', ['config', 'core.sparseCheckout', 'true'], MCP_SERVERS_DIR);
            // Initialize sparse-checkout file
            await ShellExecutor.runCommand('bash', ['-c', '> .git/info/sparse-checkout'], MCP_SERVERS_DIR);
            console.log('Repository initialized successfully.');
        } else {
            // Verify remote and sparse checkout config? (Optional enhancement)
             console.log('Repository already initialized.');
        }
    }

    static async updateSparseCheckoutConfig(serverNames: string[]): Promise<void> {
         console.log(`Updating sparse checkout config for: ${serverNames.join(', ')}`);
         const sparseCheckoutFile = path.join(MCP_SERVERS_DIR, '.git', 'info', 'sparse-checkout');
         // Ensure the .git/info directory exists
         mkdirSync(path.dirname(sparseCheckoutFile), { recursive: true });

         const configContent = serverNames.map(name => `src/${name}/\n`).join(''); // Add trailing slash for directories
         writeFileSync(sparseCheckoutFile, configContent);
         console.log('Sparse checkout config updated.');
    }

    static async pullLatest(): Promise<void> {
        console.log(`Pulling latest changes from ${MCP_REMOTE_NAME}/main...`);
        try {
            // Use read-tree to update the index first, then checkout
            // This is often more reliable with sparse checkout than a direct pull
            await ShellExecutor.runCommand('git', ['fetch', MCP_REMOTE_NAME, 'main'], MCP_SERVERS_DIR);
            await ShellExecutor.runCommand('git', ['checkout', 'main'], MCP_SERVERS_DIR); // Ensure we are on main if it exists, otherwise failsafe needed
            // Alternative: git pull - might work but can have issues with sparse checkout state
            // await ShellExecutor.runCommand('git', ['pull', MCP_REMOTE_NAME, 'main'], MCP_SERVERS_DIR);
            console.log('Pull successful.');
        } catch (error) {
             console.error('Error pulling latest changes:');
             // Check if it's an execa-like error before accessing properties
             if (error && typeof error === 'object') {
                 const execaError = error as { stderr?: string; stdout?: string; message?: string };
                 if (execaError.stderr) console.error(`Stderr: ${execaError.stderr}`);
                 if (execaError.stdout) console.error(`Stdout: ${execaError.stdout}`);
                 if (!execaError.stderr && !execaError.stdout) console.error(execaError.message || error);
             } else {
                 console.error(error);
             }
             // Rethrow or handle appropriately
             throw error;
        }
    }
}

// --- State Manager ---
export class StateManager {
    static readState(): McpState {
        console.log(`Reading state from ${STATE_FILE}...`);
        if (!existsSync(STATE_FILE)) {
             console.log('State file not found, returning default state.');
            return { addedServers: [] };
        }
        try {
            const content = readFileSync(STATE_FILE, 'utf-8');
            const state = JSON.parse(content);
             // Add validation here if needed
             console.log('State read successfully:', state);
            return state as McpState; // Assert type after successful parse
        } catch (error) {
            console.error(`Error reading or parsing state file ${STATE_FILE}:`);
            if (error instanceof Error) {
                console.error(error.message);
            } else {
                 console.error('Caught non-Error object:', error);
            }
            // Return default state or rethrow?
            return { addedServers: [] };
        }
    }

    static writeState(state: McpState): void {
        console.log(`Writing state to ${STATE_FILE}:`, state);
        try {
            const content = JSON.stringify(state, null, 2); // Pretty print JSON
            writeFileSync(STATE_FILE, content, 'utf-8');
             console.log('State written successfully.');
        } catch (error) {
            console.error(`Error writing state file ${STATE_FILE}:`);
             if (error instanceof Error) {
                 console.error(error.message);
             } else {
                 console.error('Caught non-Error object:', error);
             }
            // Rethrow or handle?
             throw error;
        }
    }
}

// --- Docker Compose Manager ---
export class DockerComposeManager {
    static readDockerCompose(): DockerComposeConfig {
         console.log(`Reading Docker Compose file: ${DOCKER_COMPOSE_FILE}`);
        if (!existsSync(DOCKER_COMPOSE_FILE)) {
             console.log('Docker Compose file not found, returning default structure.');
            // Return a default structure if the file doesn't exist
            return { version: '3.8', services: {} };
        }
        try {
            const fileContent = readFileSync(DOCKER_COMPOSE_FILE, 'utf-8');
            const config = YAML.parse(fileContent);
             // Basic validation
            if (typeof config !== 'object' || config === null) {
                throw new Error('Invalid YAML content: root is not an object.');
            }
             config.services = config.services || {}; // Ensure services object exists
             console.log('Docker Compose file read successfully.');
            return config as DockerComposeConfig; // Add type assertion
        } catch (error) {
            console.error(`Error reading or parsing Docker Compose file ${DOCKER_COMPOSE_FILE}:`);
            const message = error instanceof Error ? error.message : String(error);
            // Throw a more specific error to be caught by the command handler
            throw new Error(`Failed to process docker-compose.yml: ${message}`);
        }
    }

    static addService(config: DockerComposeConfig, serverName: string): void {
        console.log(`Adding service '${serverName}' to Docker Compose config...`);
        if (config.services[serverName]) {
             console.warn(`Service '${serverName}' already exists in docker-compose.yml. Overwriting.`);
        }
         // Define a standard template for MCP services
         const serviceDefinition: DockerComposeService = {
             // Build context points to the sparsely checked-out source
             build: {
                context: path.relative(path.dirname(DOCKER_COMPOSE_FILE), path.join(MCP_SERVERS_DIR, 'src', serverName)),
                // We assume a Dockerfile exists in the server's root directory
                // dockerfile: 'Dockerfile' // Optional if it's named Dockerfile
             },
             restart: 'unless-stopped',
             stdin_open: true, // Required for MCP interaction
             tty: true,        // Required for MCP interaction
             environment: [
                 // Pass through environment variables needed by the server
                 // Example: GitHub token needs to be available
                 'GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}',
                 // Add other common variables if known, or make this configurable
             ],
             // Add other common configurations like ports or volumes if necessary
         };

        config.services[serverName] = serviceDefinition;
        console.log(`Service '${serverName}' added.`);
    }

    static removeService(config: DockerComposeConfig, serverName: string): void {
        console.log(`Removing service '${serverName}' from Docker Compose config...`);
        if (config.services && config.services[serverName]) {
            delete config.services[serverName];
             console.log(`Service '${serverName}' removed.`);
        } else {
             console.warn(`Service '${serverName}' not found in docker-compose.yml.`);
        }
    }

    static writeDockerCompose(config: DockerComposeConfig): void {
        console.log(`Writing updated Docker Compose configuration to ${DOCKER_COMPOSE_FILE}...`);
        try {
            const yamlString = YAML.stringify(config);
            writeFileSync(DOCKER_COMPOSE_FILE, yamlString, 'utf-8');
            console.log('Docker Compose file written successfully.');
        } catch (error) {
            console.error(`Error writing Docker Compose file ${DOCKER_COMPOSE_FILE}:`);
             if (error instanceof Error) {
                 console.error(error.message);
             } else {
                 console.error('Caught non-Error object:', error);
             }
            throw error;
        }
    }
}


// --- Shell Executor ---
export class ShellExecutor {
    static async runCommand(command: string, args: string[], cwd: string = WORKSPACE_ROOT): Promise<{ stdout: string; stderr: string }> {
        console.log(`Executing: ${command} ${args.join(' ')} in ${cwd}`);
        try {
            const result = await execa(command, args, { cwd, stdio: 'pipe' }); // Use pipe to capture output
            console.log(`Command output (stdout):\n${result.stdout}`);
            if (result.stderr) {
                 console.log(`Command output (stderr):\n${result.stderr}`);
            }
             console.log(`Command finished successfully.`);
            return { stdout: result.stdout, stderr: result.stderr };
        } catch (error) {
            console.error(`Error executing command: ${command} ${args.join(' ')}`);
            // Type guard for execa-like error structure
            if (error && typeof error === 'object') {
                const execaError = error as { stderr?: string; stdout?: string; exitCode?: number; message?: string }; // Type assertion
                if (execaError.stderr) {
                    console.error(`Stderr:\n${execaError.stderr}`);
                }
                 if (execaError.stdout) {
                     console.error(`Stdout:\n${execaError.stdout}`);
                 }
                if (execaError.exitCode !== undefined) {
                     console.error(`Exit Code: ${execaError.exitCode}`);
                }
                 // Add message if other fields are empty
                 if (!execaError.stderr && !execaError.stdout && execaError.message) {
                     console.error(`Message: ${execaError.message}`);
                 } else if (!execaError.stderr && !execaError.stdout && !execaError.message) {
                     console.error('Caught error object with no details:', error);
                 }
            } else {
                 console.error('Caught non-object error:', error);
            }
            // Rethrow the original error so callers can handle it
            throw error;
        }
    }
} 