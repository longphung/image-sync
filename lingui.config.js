import { defineConfig } from '@lingui/cli';

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'vi'],
  catalogs: [
    {
      path: 'src/locales/{locale}/messages',
      include: ['app', 'src'],
      exclude: ['**/node_modules/**', 'src/locales/**'],
    },
  ],
});
