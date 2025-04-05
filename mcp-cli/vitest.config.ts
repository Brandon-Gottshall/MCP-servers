import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Re-enable globals
    environment: 'node', // Specify environment
    // Add other Vitest configurations if needed
  },
}); 