import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	launchArgs: [
		'--disable-updates',
		'--skip-release-notes',
		'--disable-workspace-trust',
	],
	env: {
		DONT_PROMPT_WSL_INSTALL: '1',
	},
});
