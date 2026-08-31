import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // IMP-001 lint-baseline closure — narrow, documented exceptions:
  // 1) Generated shadcn modules (src/components/ui, hooks/use-mobile.ts).
  //    These canonically co-locate components with cva variant helpers and
  //    hooks (react-refresh), sync with external systems in effects (embla
  //    in carousel, matchMedia in use-mobile), and use decorative skeleton
  //    width variance (sidebar skeleton — cosmetic, not domain/fixture
  //    data). Project rule: prefer wrapping over editing generated code, so
  //    the three rules are relaxed for these generated paths only.
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/hooks/use-mobile.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  // 2) Established app modules that pair a component with stable named
  //    helpers/hooks (context provider + hooks, component + palette/lookup
  //    helpers). The rule stays ON for these files; only the enumerated
  //    export names are allowed — no blanket suppression.
  {
    files: [
      'src/components/StatusPill.tsx',
      'src/components/CountUp.tsx',
      'src/components/AskCAOS.tsx',
      'src/data/store.tsx',
      'src/pages/landing/EnterDemoButton.tsx',
      'src/pages/review/QueueRow.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowExportNames: [
            'statusPalette',
            'prefersReducedMotion',
            'useCountUp',
            'useTypewriter',
            'useDemoStore',
            'useLiveAggregates',
            'ownerOf',
            'useEnterDemo',
            'waitingDays',
          ],
        },
      ],
    },
  },
])
