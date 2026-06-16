# React Native Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when React Native is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## React Native Project Structure

When analyzing a React Native project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `App.tsx`, `App.js` | Root application component | `entry-point`, `ui` |
| `index.js` | Application entry point — registers root component via `AppRegistry` | `entry-point` |
| `*Screen.tsx`, `*Screen.js` | Screen-level components mapped to navigation routes | `ui`, `screen` |
| `*Navigator.tsx`, `*Stack.tsx`, `*Tab.tsx` | Navigation configuration (React Navigation) | `config`, `routing` |
| `components/*.tsx`, `components/**/*.tsx` | Reusable UI components | `ui` |
| `hooks/*.ts`, `hooks/*.tsx` | Custom React hooks | `service`, `utility` |
| `store/*.ts`, `slices/*.ts` | State management (Redux Toolkit / Zustand / MobX) | `service`, `state` |
| `services/*.ts`, `api/*.ts` | API client functions and service layer | `service`, `api` |
| `utils/*.ts`, `helpers/*.ts` | Pure utility functions | `utility` |
| `types/*.ts`, `types/*.d.ts` | TypeScript type definitions | `type-definition` |
| `constants/*.ts` | App-wide constants | `config` |
| `*.ios.tsx`, `*.ios.js` | Platform-specific iOS implementations | `ui`, `platform` |
| `*.android.tsx`, `*.android.js` | Platform-specific Android implementations | `ui`, `platform` |
| `native-modules/*.ts`, `native-modules/**/*.ts` | Native module bridges (Objective-C/Swift/Java/Kotlin) | `service`, `native` |
| `__tests__/*.test.tsx` | Unit and integration tests | `test` |
| `e2e/*.test.ts` | Detox / Maestro end-to-end tests | `test` |

### Edge Patterns to Look For

**Screen registration** — When a Navigator registers Screen components in its Stack/Tab/Drawer, create `routes` edges from the Navigator to each Screen.

**Navigation calls** — When a Screen calls `navigation.navigate('OtherScreen')`, create `navigates_to` edges from the source Screen to the target Screen.

**Hook usage** — When a component imports and calls a custom hook (`useAuth()`, `useApi()`, etc.), create `depends_on` edges from the consumer to the hook module.

**Store usage** — When a component uses a Redux selector or Zustand store, create `depends_on` edges from the consumer to the store.

**API service calls** — When a hook or component invokes an API service function, create `calls` edges from the consumer to the API service.

**Platform-specific resolution** — When `.ios.tsx` and `.android.tsx` variants exist for the same module, create `platform_variant` edges linking them.

### Architectural Layers for React Native

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | Screen components, reusable components, platform-specific UI |
| `layer:navigation` | Navigation Layer | Navigators, route definitions, deep link handlers |
| `layer:state` | State Layer | Redux stores/slices, Zustand stores, MobX stores, Context providers |
| `layer:service` | Service Layer | API clients, services, custom hooks with business logic |
| `layer:native` | Native Layer | Native modules, native UI components, platform bridges |
| `layer:utility` | Utility Layer | Utils, helpers, constants, type definitions |
| `layer:test` | Test Layer | Unit tests, E2E tests, test utilities |

### Notable Patterns to Capture in languageLesson

- **React Navigation**: `@react-navigation/native` provides Stack, Tab, and Drawer navigators — screens are registered as children and navigated to by name
- **Platform-specific code**: `.ios.tsx` / `.android.tsx` file extensions enable platform-specific implementations resolved at build time
- **Native modules**: Turbo Modules and the old Native Modules system bridge JavaScript to platform-native code — these are critical integration points
- **Conditional platform code**: `Platform.OS === 'ios'` / `Platform.select()` inline branching within shared files
- **Deep linking**: `Linking.createURL()` and navigation `linking` config map URLs to screen routes
- **State management**: Redux Toolkit with `createSlice` is the most common pattern; Zustand is gaining popularity for simpler apps
- **Flipper / Hermes**: Hermes is the default JS engine; Flipper provides debugging — both affect runtime behavior
