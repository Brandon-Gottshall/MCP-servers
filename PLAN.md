# MCP Server Management CLI (`mcp`) - Development Plan

This document outlines the plan for creating a command-line interface (CLI) tool named `mcp` to manage Model Context Protocol (MCP) server deployments using Docker Compose and Git sparse checkout. The tool will be built with Bun and TypeScript and packaged for installation via Homebrew.

## 1. Project Setup (`mcp-cli` Directory)

* **Create Directory:** Establish a dedicated directory `./mcp-cli` for the CLI's source code.
* **Initialize Project:** Use `bun init -y` within `./mcp-cli` to set up a Bun project.
* **Install Dependencies:** Add necessary packages using Bun:
  * `commander`: For parsing command-line arguments and structuring the CLI.
  * `yaml`: For safely reading, parsing, and writing the `docker-compose.yml` file.
  * `execa`: For reliably executing external shell commands (like `git` and `docker-compose`).
  * `@types/bun`, `@types/node`: For TypeScript type support.

## 2. Core Configuration & State Management

* **Source Directory (`./mcp-servers`):**
  * Designate a directory within the workspace root (e.g., `./mcp-servers`) where the CLI will manage local copies of MCP server source code.
  * This directory will be initialized as a Git repository configured for sparse checkout, linked to the `modelcontextprotocol/servers` GitHub repository.
* **State File (`./mcp-state.json`):**
  * Implement a JSON file in the workspace root (e.g., `./mcp-state.json`) to persist the state of managed servers.
  * This file will store an array or object listing the names of servers currently "added" and managed by the CLI.
* **Docker Compose File (`./docker-compose.yml`):**
  * The CLI will target the `docker-compose.yml` file located in the workspace root for adding, removing, and managing service definitions.

## 3. Helper Utilities (`mcp-cli/src/utils.ts`)

Create a dedicated utilities module to encapsulate reusable logic:

* **Git/Sparse Checkout Manager:**
  * `ensureRepoInitialized()`: Checks if `./mcp-servers` exists and is a valid Git repo with the correct remote (`mcp-origin` pointing to `modelcontextprotocol/servers`) and sparse checkout enabled. Initializes/configures if necessary.
  * `updateSparseCheckoutConfig(serverNames: string[])`: Updates the `./mcp-servers/.git/info/sparse-checkout` file based on the provided list of server names (e.g., adding lines like `src/github/`).
  * `pullLatest()`: Executes `git pull mcp-origin main` within `./mcp-servers` to fetch updates for the configured sparse checkout paths.
* **State Manager:**
  * `readState()`: Reads and parses `./mcp-state.json`, returning the list of added servers. Handles file not existing.
  * `writeState(serverNames: string[])`: Writes the updated list of server names back to `./mcp-state.json`.
* **Docker Compose Manager:**
  * `readDockerCompose()`: Reads and parses `./docker-compose.yml` using the `yaml` library. Handles file not existing.
  * `addService(config: object, serverName: string)`: Adds a new service definition for `<serverName>` to the parsed Docker Compose configuration object. The build context should point to `./mcp-servers/src/<serverName>`. Uses a standard service template (including necessary environment variables like `GITHUB_PERSONAL_ACCESS_TOKEN`, `stdin_open`, `tty`).
  * `removeService(config: object, serverName: string)`: Removes the service definition for `<serverName>` from the configuration object.
  * `writeDockerCompose(config: object)`: Writes the modified configuration object back to `./docker-compose.yml` as YAML.
* **Shell Executor:**
  * `runCommand(command: string, args: string[])`: A wrapper around `execa` to execute shell commands, providing consistent output/error handling.

## 4. CLI Command Implementation (`mcp-cli/src/index.ts`)

Structure the main CLI entry point using `commander`:

* **`mcp add <serverName>`:**
  * Validate the provided `<serverName>`.
  * Use `State Manager` to check if the server is already added.
  * Call `Git/Sparse Checkout Manager.ensureRepoInitialized()`.
  * Get the current list of servers from `State Manager`, add the new server.
  * Call `Git/Sparse Checkout Manager.updateSparseCheckoutConfig()` with the updated list.
  * Call `Git/Sparse Checkout Manager.pullLatest()` to download the source.
  * Read `docker-compose.yml` using `Docker Compose Manager`.
  * Call `Docker Compose Manager.addService()` to add the service definition.
  * Write the updated config using `Docker Compose Manager.writeDockerCompose()`.
  * Update the state using `State Manager.writeState()`.
* **`mcp remove <serverName>`:**
  * Validate `<serverName>`.
  * Use `State Manager` to check if the server is currently added. If not, exit with an error.
  * Get the current server list, remove the server.
  * Call `Git/Sparse Checkout Manager.updateSparseCheckoutConfig()` with the updated list.
  * *(Optional Cleanup): Consider adding steps to remove the source code locally (e.g., `git read-tree --empty && git checkout main -- src/<serverName>` or `rm -rf ./mcp-servers/src/<serverName>`).*
  * Read `docker-compose.yml` using `Docker Compose Manager`.
  * Call `Docker Compose Manager.removeService()`.
  * Write the updated config using `Docker Compose Manager.writeDockerCompose()`.
  * Update the state using `State Manager.writeState()`.
* **`mcp update [serverName]`:**
  * *(Note: This currently updates all managed servers regardless of the argument, as sparse pull fetches all configured paths)*.
  * Call `Git/Sparse Checkout Manager.ensureRepoInitialized()`.
  * Call `Git/Sparse Checkout Manager.pullLatest()`.
  * Provide feedback to the user.
* **`mcp start [serverName]`:**
  * Read added servers using `State Manager`.
  * If `<serverName>` is provided:
    * Validate it and check if it's in the state.
    * Run `docker-compose up -d <serverName>` using `Shell Executor`.
  * If no `<serverName>`:
    * Construct the command `docker-compose up -d <server1> <server2> ...` using the list from the state.
    * Run the command using `Shell Executor`.
* **`mcp stop [serverName]`:**
  * Read added servers using `State Manager`.
  * If `<serverName>` is provided:
    * Validate it and check if it's in the state.
    * Run `docker-compose stop <serverName>` using `Shell Executor`.
  * If no `<serverName>`:
    * Construct the command `docker-compose stop <server1> <server2> ...`.
    * Run the command using `Shell Executor`.

## 5. Build Process (`mcp-cli/package.json`)

* Define a `build` script in `scripts`:
    
    ```json
    "scripts": {
      "build:darwin-x64": "bun build ./src/index.ts --compile --outfile ../mcp-darwin-x64 --target=bun-darwin-x64",
      "build:darwin-arm64": "bun build ./src/index.ts --compile --outfile ../mcp-darwin-arm64 --target=bun-darwin-arm64",
      "build": "bun run build:darwin-x64 && bun run build:darwin-arm64",
      "start": "bun run ./src/index.ts" 
    }
    ```
    
    *(Rely on GitHub Actions to build for specific targets during release.)*

## 6. Testing

Implement a comprehensive testing suite before publishing.

*   **Framework:** Use `vitest` for unit and integration testing.
*   **Setup:**
    *   Add `vitest` as a dev dependency: `bun add -d vitest`.
    *   Configure `vitest` (e.g., in `vitest.config.ts` or `package.json`).
    *   Add a `test` script to `package.json`: `"test": "vitest run"`.
*   **Unit Tests (`mcp-cli/src/utils.test.ts`):**
    *   Test individual functions/methods in `utils.ts`.
    *   Mock external dependencies like `fs`, `execa`, `yaml` to isolate logic.
    *   Verify correct Git command construction, state manipulation, Docker Compose object changes, etc.
    *   Test error handling paths within the utilities.
*   **Integration Tests (`mcp-cli/src/index.test.ts`):**
    *   Test the command actions defined in `index.ts`.
    *   Mock the utility classes/methods (`GitManager`, `StateManager`, etc.) to verify interactions.
    *   Verify that commands call the correct utility functions with expected arguments based on CLI input.
    *   Test argument parsing, validation logic, and flow control (e.g., checking if a server exists before removal).
    *   Verify user feedback (console logs) and process exit codes in success and error scenarios.

## 7. Homebrew Publishing

*   **Homebrew Tap Repository:**
    *   Requires a dedicated public GitHub repository (e.g., `github.com/<your-username>/homebrew-mytools`). You will need to create this repository.
*   **Homebrew Formula (`Formula/mcp.rb`):**
    *   Create this Ruby file within your Tap repository.
    *   It will define the `mcp` package for Homebrew.
    *   It needs to specify download URLs and SHA256 hashes for different architectures (arm64, x86_64 for macOS).
    *   Example structure:

        ```ruby
        class Mcp < Formula
          desc "CLI to manage MCP Servers"
          homepage "https://github.com/<your-username>/MCP-servers" # Link to your main project
          version "0.1.0" # This will be updated by automation

          on_macos do
            if Hardware::CPU.arm?
              url "https://github.com/<your-username>/MCP-servers/releases/download/v0.1.0/mcp-darwin-arm64" # Updated by automation
              sha256 "arm64_sha256_hash_here" # Updated by automation
            else
              url "https://github.com/<your-username>/MCP-servers/releases/download/v0.1.0/mcp-darwin-x64" # Updated by automation
              sha256 "x64_sha256_hash_here" # Updated by automation
            end
          end

          def install
            bin.install "mcp-darwin-#{Hardware::CPU.arch}" => "mcp"
          end

          test do
            system "#{bin}/mcp", "--version"
          end
        end
        ```

* **GitHub Actions Workflow (`mcp-cli/.github/workflows/release.yml`):**
  * Create a workflow triggered by pushing tags matching `v*.*.*`.
  * **Job 1: `build-release`**
    * Runs on `ubuntu-latest`.
    * Checks out the `mcp-cli` code.
    * Sets up Bun.
    * Runs `bun install`.
    * Builds binaries for macOS targets:
      * `bun build ./src/index.ts --compile --outfile ./dist/mcp-darwin-x64 --target=bun-darwin-x64`
      * `bun build ./src/index.ts --compile --outfile ./dist/mcp-darwin-arm64 --target=bun-darwin-arm64`
    * Calculates SHA256 hashes:
      * `shasum -a 256 ./dist/mcp-darwin-x64 > ./dist/mcp-darwin-x64.sha256`
      * `shasum -a 256 ./dist/mcp-darwin-arm64 > ./dist/mcp-darwin-arm64.sha256`
    * Uses a tool like `gh release create` (or an action like `softprops/action-gh-release`) to create a GitHub Release for the tag.
    * Uploads `mcp-darwin-x64`, `mcp-darwin-arm64`, and their `.sha256` files as release assets.
  * **Job 2: `update-tap` (depends on `build-release`)**
    * Runs on `ubuntu-latest`.
    * Checks out the Homebrew Tap repository (`github.com/<your-username>/homebrew-mytools`). Use a Personal Access Token (PAT) with `repo` scope stored as a GitHub Secret for push access.
    * Downloads the `.sha256` files from the release assets created in Job 1.
    * Uses `sed` or a script to update the `version`, `url`, and `sha256` values in `Formula/mcp.rb` based on the tag and the downloaded checksums.
    * Commits and pushes the updated `mcp.rb` to the Tap repository.

## 8. Documentation

* **`PLAN.md`:** This document (located in the workspace root).
* **`mcp-cli/README.md`:**
  * Provide clear instructions on how to install the CLI using Homebrew (`brew install <your-username>/mytools/mcp`).
  * Document all available CLI commands (`mcp add`, `mcp remove`, `mcp update`, `mcp start`, `mcp stop`) with examples.
  * Include basic setup for developers wanting to contribute (clone, bun install, build).

This plan provides a comprehensive roadmap for developing and distributing the `mcp` CLI tool.
