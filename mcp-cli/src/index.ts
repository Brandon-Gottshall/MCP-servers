import { Command } from 'commander';
import { 
    GitManager, 
    StateManager, 
    DockerComposeManager, 
    ShellExecutor 
} from './utils';
import { existsSync } from 'fs';
import path from 'path';

const program = new Command();

// --- Configuration (from utils, slightly adjusted for context) ---
const WORKSPACE_ROOT = (() => {
    const isRunningInCliDir = path.basename(process.cwd()) === 'mcp-cli';
    return isRunningInCliDir ? path.resolve(process.cwd(), '..') : process.cwd();
})();
const DOCKER_COMPOSE_FILE = path.join(WORKSPACE_ROOT, 'docker-compose.yml');

program
    .version('0.1.0') // Update version as needed
    .description('CLI tool to manage MCP server deployments');

program
    .command('add <serverName>')
    .description('Download and configure an MCP server')
    .action(async (serverName: string) => {
        console.log(`Attempting to add server: ${serverName}...`);
        if (!serverName || serverName.trim() === '') {
            console.error('Error: Server name cannot be empty.');
            process.exit(1);
        }
        try {
            const state = StateManager.readState();
            if (state.addedServers.includes(serverName)) {
                console.warn(`Server \'${serverName}\' is already managed. If you want to update, use 'mcp update'.`);
                return;
            }

            await GitManager.ensureRepoInitialized();
            
            const updatedServers = [...state.addedServers, serverName];
            await GitManager.updateSparseCheckoutConfig(updatedServers);
            console.log('Attempting to pull source code (this might take a moment)...')
            await GitManager.pullLatest(); // Pulls the newly added directory
            console.log('Source code pulled.')

            const dockerComposeConfig = DockerComposeManager.readDockerCompose();
            DockerComposeManager.addService(dockerComposeConfig, serverName);
            DockerComposeManager.writeDockerCompose(dockerComposeConfig);

            StateManager.writeState({ addedServers: updatedServers });

            console.log(`✅ Server '${serverName}' added successfully.`);
            console.log('You can now start it using: mcp start', serverName);
        } catch (error) {
            console.error(`❌ Error adding server '${serverName}':`);
            // Log specific error message if available
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(1); // Exit with error code
        }
    });

program
    .command('remove <serverName>')
    .description('Remove an MCP server configuration')
    .action(async (serverName: string) => {
        console.log(`Attempting to remove server: ${serverName}...`);
         if (!serverName || serverName.trim() === '') {
             console.error('Error: Server name cannot be empty.');
             process.exit(1);
         }
        try {
            const state = StateManager.readState();
            if (!state.addedServers.includes(serverName)) {
                console.error(`Error: Server \'${serverName}\' is not currently managed.`);
                process.exit(1);
            }

            const updatedServers = state.addedServers.filter(s => s !== serverName);
            
            // Update sparse checkout first
            await GitManager.ensureRepoInitialized(); // Ensure repo is there before modifying
            await GitManager.updateSparseCheckoutConfig(updatedServers);
            console.log('Updated sparse checkout configuration.');
            // Optional: Clean up files (could be added later or done manually)
            // Consider `git read-tree` or simply informing the user.

            const dockerComposeConfig = DockerComposeManager.readDockerCompose();
            DockerComposeManager.removeService(dockerComposeConfig, serverName);
            DockerComposeManager.writeDockerCompose(dockerComposeConfig);

            StateManager.writeState({ addedServers: updatedServers });

            console.log(`✅ Server '${serverName}' removed successfully.`);
            console.log('Note: Source code files might still exist in the mcp-servers directory but will not be updated.');
             console.log('Run `docker-compose down` if the container was running.');

        } catch (error) {
            console.error(`❌ Error removing server '${serverName}':`);
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(1);
        }
    });

program
    .command('update')
    .description('Update source code for all managed MCP servers')
    .action(async () => {
        console.log('Attempting to update all managed servers...');
        try {
            const state = StateManager.readState();
             if (!state.addedServers || state.addedServers.length === 0) {
                 console.log('No servers are currently managed. Nothing to update.');
                 return;
             }
             console.log(`Updating servers: ${state.addedServers.join(', ')}`);
            await GitManager.ensureRepoInitialized();
            await GitManager.pullLatest();
            console.log('✅ All managed servers updated successfully from the repository.');
             console.log('Note: If servers were running, you might need to rebuild and restart them:');
             console.log('  mcp stop && docker-compose build && mcp start');
        } catch (error) {
            console.error('❌ Error updating servers:');
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(1);
        }
    });


program
    .command('start [serverName]')
    .description('Start specified MCP server or all managed servers using Docker Compose')
    .action(async (serverName: string | undefined) => {
        console.log(serverName ? `Attempting to start server: ${serverName}...` : 'Attempting to start all managed servers...');
        try {
             if (!existsSync(DOCKER_COMPOSE_FILE)) {
                 console.error(`Error: Docker Compose file not found at ${DOCKER_COMPOSE_FILE}. Cannot start servers.`);
                 process.exit(1);
             }
            const state = StateManager.readState();
            const dockerConfig = DockerComposeManager.readDockerCompose(); // Read to verify services exist
            const managedServers = state.addedServers;
            let serversToStart: string[] = [];

            if (serverName) {
                if (!serverName || serverName.trim() === '') {
                     console.error('Error: Provided server name cannot be empty.');
                     process.exit(1);
                 }
                if (!managedServers.includes(serverName)) {
                    console.error(`Error: Server \'${serverName}\' is not managed by mcp. Use 'mcp add ${serverName}' first.`);
                    process.exit(1);
                }
                 if (!dockerConfig.services[serverName]) {
                     console.error(`Error: Service \'${serverName}\' not found in ${DOCKER_COMPOSE_FILE}. Try adding it again.`);
                    process.exit(1);
                 }
                serversToStart = [serverName];
            } else {
                if (managedServers.length === 0) {
                    console.log('No servers are currently managed. Nothing to start.');
                    return;
                }
                 serversToStart = managedServers.filter(name => {
                     const exists = !!dockerConfig.services[name];
                     if (!exists) {
                         console.warn(`Warning: Managed server \'${name}\' not found in ${DOCKER_COMPOSE_FILE}. Skipping start.`);
                     }
                     return exists;
                 });
                 if (serversToStart.length === 0) {
                     console.log('No managed servers found in Docker Compose file. Nothing to start.');
                     return;
                 }
            }
            
            console.log(`Starting Docker Compose service(s): ${serversToStart.join(', ')}`);
            await ShellExecutor.runCommand('docker-compose', ['up', '-d', ...serversToStart], WORKSPACE_ROOT);
            console.log(`✅ Started service(s): ${serversToStart.join(', ')}`);

        } catch (error) {
            console.error(serverName ? `❌ Error starting server '${serverName}':` : '❌ Error starting servers:');
            // execa errors often include stderr which is helpful for docker-compose issues
            if (error && typeof error === 'object') {
                 const execaError = error as { stderr?: string; message?: string };
                 if (execaError.stderr) console.error(`Stderr: ${execaError.stderr}`);
                 else console.error(execaError.message || error);
            } else {
                 console.error(error);
            }
            process.exit(1);
        }
    });

program
    .command('stop [serverName]')
    .description('Stop specified MCP server or all managed servers using Docker Compose')
    .action(async (serverName: string | undefined) => {
        console.log(serverName ? `Attempting to stop server: ${serverName}...` : 'Attempting to stop all managed servers...');
        try {
             if (!existsSync(DOCKER_COMPOSE_FILE)) {
                 // Maybe don't error if stopping and file missing? Warn instead.
                 console.warn(`Warning: Docker Compose file not found at ${DOCKER_COMPOSE_FILE}. Cannot guarantee stopping specific services.`);
                 // Allow to proceed, maybe user wants to stop manually or file was removed.
                 // If serverName is specified, we probably *should* error.
                 if (serverName) {
                     console.error('Error: Cannot stop specific server without docker-compose.yml')
                     process.exit(1);
                 }
                 // If no serverName, maybe try `docker-compose down`? Too risky.
                 console.log('Cannot determine which services to stop.')
                 return;
             }
            const state = StateManager.readState();
            const dockerConfig = DockerComposeManager.readDockerCompose(); // Read to verify services exist
            const managedServers = state.addedServers;
            let serversToStop: string[] = [];

            if (serverName) {
                 if (!serverName || serverName.trim() === '') {
                     console.error('Error: Provided server name cannot be empty.');
                     process.exit(1);
                 }
                // Don't strictly require it to be in state for stopping
                // if (!managedServers.includes(serverName)) {
                //     console.error(`Error: Server \'${serverName}\' is not managed by mcp.`);
                //     process.exit(1);
                // }
                if (!dockerConfig.services[serverName]) {
                     console.error(`Error: Service \'${serverName}\' not found in ${DOCKER_COMPOSE_FILE}. Cannot stop it.`);
                    process.exit(1);
                 }
                serversToStop = [serverName];
            } else {
                if (managedServers.length === 0) {
                    console.log('No servers were managed by mcp. Checking docker-compose file for potential running services to stop.');
                    // If state is empty, attempt to stop *all* services defined in docker-compose? Risky.
                    // Safer: only stop services that *were* managed.
                     serversToStop = Object.keys(dockerConfig.services); // Stop all defined services? Let's stick to managed.
                     console.log('No managed servers found in state. Stopping nothing.');
                     return;
                }
                 serversToStop = managedServers.filter(name => {
                     const exists = !!dockerConfig.services[name];
                     // Don't warn if service doesn't exist during stop, just skip.
                     return exists;
                 });
                 if (serversToStop.length === 0) {
                     console.log('No managed servers found in Docker Compose file. Nothing to stop.');
                     return;
                 }
            }

            console.log(`Stopping Docker Compose service(s): ${serversToStop.join(', ')}`);
            await ShellExecutor.runCommand('docker-compose', ['stop', ...serversToStop], WORKSPACE_ROOT);
            console.log(`✅ Stopped service(s): ${serversToStop.join(', ')}`);

        } catch (error) {
            console.error(serverName ? `❌ Error stopping server '${serverName}':` : '❌ Error stopping servers:');
             if (error && typeof error === 'object') {
                 const execaError = error as { stderr?: string; message?: string };
                 if (execaError.stderr) console.error(`Stderr: ${execaError.stderr}`);
                 else console.error(execaError.message || error);
             } else {
                 console.error(error);
             }
            process.exit(1);
        }
    });

// Finalize program setup and parse arguments
program.parse(process.argv); 