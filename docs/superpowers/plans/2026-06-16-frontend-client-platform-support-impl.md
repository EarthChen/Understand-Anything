# Frontend & Client Platform Support — Implementation Plan

> Date: 2026-06-16
> Spec: [2026-06-16-frontend-client-platform-support-design.md](../specs/2026-06-16-frontend-client-platform-support-design.md)
> Status: IN PROGRESS

## Execution Strategy

- **TDD**: Where applicable (rule engine, extract-domain-context.py), write tests first
- **Subagent-Driven**: Parallelize independent tasks via subagents
- **Incremental**: Each task produces a verifiable deliverable

---

## P0 — Core Support (10 tasks)

### Task 1: `frameworks/android.md`

**File:** `understand-anything-plugin/skills/understand/frameworks/android.md`
**Type:** NEW

**Content structure:**
- Canonical File Roles (Activity, Fragment, Composable Screen, ViewModel, Repository, UseCase, DAO, Entity, NavGraph, AndroidManifest.xml, res/layout/*.xml, build.gradle.kts)
- Edge Patterns:
  - Activity→Fragment: `contains`
  - Fragment/Activity→ViewModel: `depends_on`
  - ViewModel→Repository: `depends_on`
  - Repository→DAO/API: `calls`
  - Compose NavHost→Screen: `routes`
  - Screen→Screen (Intent/Navigation): `navigates_to`
  - @Inject property→injected class: `injects` (deferred to rule engine)
- Architectural Layers: Presentation → Domain → Data → Navigation → DI
- Notable Patterns: Hilt DI, Coroutines Flow, Room, Retrofit, Compose Navigation

**Verification:** Ensure addendum follows exact format of existing `vue.md`/`react.md`

---

### Task 2: `frameworks/ios.md`

**File:** `understand-anything-plugin/skills/understand/frameworks/ios.md`
**Type:** NEW

**Content structure:**
- Canonical File Roles (ViewController, SwiftUI View, Coordinator, ViewModel, Service, Repository, Entity, Storyboard, AppDelegate, SceneDelegate, @main App)
- Edge Patterns:
  - ViewController→ChildVC: `contains`
  - View→ViewModel: `depends_on`
  - Coordinator→VC: `navigates_to`
  - NavigationStack→View: `routes`
  - ViewModel→Service: `depends_on`
  - Service→Repository: `calls`
- Architectural Layers: Presentation → Domain → Data → Navigation → DI
- Notable Patterns: Combine, @Published/@State/@Binding, Core Data, URLSession/Alamofire, Swinject

**Verification:** Follows format of existing addendums

---

### Task 3: Restructure `understand-domain/SKILL.md`

**File:** `understand-anything-plugin/skills/understand-domain/SKILL.md`
**Type:** MODIFY

**Changes:**
1. Add Phase 1.5 (Platform Detection) between Phase 1 and Phase 2
2. Modify Phase 4c to reference platform-specific flow files
3. Add `./platforms/` directory reference

**Key addition — Phase 1.5:**
```markdown
### Phase 1.5: Platform Type Detection

Detect the project's platform type for downstream flow extraction strategy.

1. Read `project.frameworks` from KG (or scan results for Path 1)
2. Classify:
   - Contains Android/iOS/Flutter/React Native/HarmonyOS frameworks → `mobile-client`
   - Contains Vue/React/Next.js/Nuxt/Svelte without backend → `frontend`
   - Contains Spring/Express/Django/FastAPI/Gin/Rails → `backend`
   - Contains both frontend AND backend → `fullstack`
   - Default: `backend`
3. Store as `$PLATFORM_TYPE`
```

---

### Task 4: `platforms/backend-flow.md`

**File:** `understand-anything-plugin/skills/understand-domain/platforms/backend-flow.md`
**Type:** NEW

Extract existing backend flow logic from `domain-flow-extractor.md` into standalone file:
- Entry points: HTTP endpoints, RPC providers, event subscribers, cron handlers
- Edge tracing: `calls` edges from entry → service → repository → DB
- entryType values: `http`, `cli`, `event`, `cron`
- Worked example (current one from domain-flow-extractor.md)

---

### Task 5: `platforms/frontend-flow.md`

**File:** `understand-anything-plugin/skills/understand-domain/platforms/frontend-flow.md`
**Type:** NEW

- Entry points: Page routes, screen components
- Edge tracing: `routes` → `depends_on` (state) → `consumes_api` → render
- entryType values: `navigation`, `screen`, `interaction`
- Worked example: Vue Login flow
- Domain splitting: by feature module, NOT by API group

---

### Task 6: `platforms/mobile-flow.md`

**File:** `understand-anything-plugin/skills/understand-domain/platforms/mobile-flow.md`
**Type:** NEW

- Entry points: Activity, Fragment, ViewController, Compose Screen
- Edge tracing: `navigates_to` → `depends_on` (ViewModel) → `calls` (Repository) → `consumes_api`
- entryType values: `screen`, `deep-link`
- Worked example: Android Create Post flow
- Domain splitting: by feature/screen group

---

### Task 7: Modify `extract-domain-context.py`

**File:** `understand-anything-plugin/skills/understand-domain/extract-domain-context.py`
**Type:** MODIFY

**TDD approach:**
1. Write test cases for new patterns first
2. Add new ENTRY_POINT_PATTERNS:
   - `("navigation", "Vue Router route", ...)`
   - `("navigation", "React Router Route", ...)`
   - `("screen", "Android Activity", ...)`
   - `("screen", "Android Fragment", ...)`
   - `("screen", "Jetpack Compose Screen", ...)`
   - `("screen", "iOS ViewController", ...)`
   - `("screen", "SwiftUI View struct", ...)`
   - `("screen", "Flutter Screen/Page Widget", ...)`
   - `("screen", "React Native Screen", ...)`

---

### Task 8: Modify `schema-reference.md`

**File:** `understand-anything-plugin/skills/understand/docs/schema-reference.md`
**Type:** MODIFY

Add `navigates_to` to Edge Types table:
- Category: Behavioral
- Weight: 0.7
- Semantics: Screen/Page → Screen/Page navigation relationship

Also add to `KNOWN_EDGE_TYPES` in `rule-engine.ts` (line 32).

---

### Task 9: Modify understand `SKILL.md` Phase 0 entry points

**File:** `understand-anything-plugin/skills/understand/SKILL.md`
**Type:** MODIFY

Add to entry point detection list (line ~188):
- `app/src/main/java/**/MainActivity.kt`
- `app/src/main/java/**/MainActivity.java`
- `AppDelegate.swift`
- `*App.swift` (@main)
- `SceneDelegate.swift`

---

### Task 10: Add Hilt/Dagger rules to rule-engine.ts

**File:** `understand-anything-plugin/packages/core/src/analyzer/rule-engine.ts`
**Type:** MODIFY

**TDD approach:**
1. Add test cases to `rule-engine.test.ts`
2. Add new BUILTIN_RULES entry:
```typescript
{
  id: "hilt",
  displayName: "Hilt/Dagger",
  detectionKeywords: ["hilt-android", "dagger", "dagger.hilt", "com.google.dagger"],
  annotations: {
    "HiltAndroidApp": { edge: "configures", weight: 0.8 },
    "AndroidEntryPoint": { edge: "injects", weight: 0.9 },
    "HiltViewModel": { edge: "injects", weight: 0.9 },
    "Inject": { edge: "injects", weight: 0.9, role: "target" },
    "Module": { edge: "configures", weight: 0.7 },
    "Provides": { edge: "provides_api", weight: 0.8 },
    "Binds": { edge: "provides_api", weight: 0.8 },
    "InstallIn": { edge: "configures", weight: 0.6 },
  },
}
```

---

## Execution Order (Dependency Graph)

```
Independent (can parallel):
  Task 1 (android.md)
  Task 2 (ios.md)
  Task 4 (backend-flow.md)
  Task 5 (frontend-flow.md)
  Task 6 (mobile-flow.md)
  Task 8 (schema-reference.md)
  Task 9 (understand SKILL.md)
  Task 10 (rule-engine.ts — after adding navigates_to to KNOWN_EDGE_TYPES)

Sequential:
  Task 8 → Task 10 (navigates_to must be in KNOWN_EDGE_TYPES before rule validation)
  Task 4+5+6 → Task 3 (SKILL.md references platforms/ files)
  Task 7 (extract-domain-context.py — independent)
```

## Verification Checklist

- [ ] `frameworks/android.md` follows exact structure of `vue.md`
- [ ] `frameworks/ios.md` follows exact structure of `react.md`
- [ ] `pnpm --filter @understand-anything/core test` passes (rule-engine tests)
- [ ] `python -m pytest test_*.py` passes for extract-domain-context tests
- [ ] understand-domain SKILL.md references all 3 platform files correctly
- [ ] `navigates_to` appears in both schema-reference.md AND rule-engine.ts KNOWN_EDGE_TYPES
