import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Component tests render through react-native-web, exactly as the
      // deployed web build does. Importing react-native directly fails: its
      // entrypoint is Flow-typed and vite cannot parse it.
      'react-native': 'react-native-web',
      '@': path.resolve(__dirname),
    },
  },
  test: {
    include: [
      'lib/**/*.test.ts',
      'context/**/*.test.tsx',
      'components/**/*.test.tsx',
    ],
    environment: 'node',
  },
});
