# Mobile Client Flow Extraction Strategy

Extract user journey flows from mobile client codebases (Android, iOS, Flutter, React Native) by tracing navigation, ViewModel, data, and API edges through the knowledge graph.

## Entry Points

Identify flow triggers from screen-level KG nodes:

| Platform | KG signals | Example |
|----------|------------|---------|
| Android | Activity, Fragment, Compose Screen | `CreatePostFragment`, `FeedActivity` |
| iOS | ViewController, SwiftUI View | `CreatePostViewController`, `CreatePostView` |
| Flutter | Widget/Screen with Screen/Page suffix | `CreatePostScreen`, `FeedPage` |
| React Native | Stack.Screen registered components | `CreatePostScreen`, `FeedScreen` |
| All | Deep link handlers | `myapp://post/create` (entryType: `deep-link`) |

Each flow starts at one entry point. `domainMeta.entryPoint` is a human label (e.g., `CreatePostFragment`); actual edge tracing uses KG node IDs from the edges list.

## Edge Tracing Strategy

For each entry point, trace four edge types in order:

### 1. TRACE NAVIGATION

Find `navigates_to` and `routes` edges between screens to map the user's path through the app.

```
CreatePostFragment → navigates_to → MediaPickerFragment
CaptionEditorFragment → navigates_to → FeedActivity
```

### 2. TRACE VIEWMODEL

Find `depends_on` edges from screens to ViewModels, Blocs, Presenters, or state holders.

```
CreatePostFragment → depends_on → CreatePostViewModel
```

### 3. TRACE DATA

Find `calls` edges from ViewModel to Repository, UseCase, or data layer.

```
CreatePostViewModel → calls → PostRepository.createPost()
FilterViewModel → calls → FilterViewModel.applyFilter()
```

### 4. TRACE API

Find `consumes_api` edges from Repository to API endpoints.

```
PostRepository.createPost() → consumes_api → POST /api/posts
```

Follow each trace depth 2–3 to build a complete user journey. Every flow MUST have at least 4 distinct steps derived from actual KG edges.

## entryType Values

Use these values in `domainMeta.entryType`:

| Value | When to use |
|-------|-------------|
| `screen` | Flow starting at a screen mount (Activity, Fragment, ViewController, Widget) |
| `deep-link` | Flow triggered by a deep link or universal link handler |

## Domain Splitting Heuristic

Group mobile domains by **Feature/Screen group**. Each feature module bundles:

- Screens for the feature
- ViewModels / Blocs / Presenters
- Feature-specific repository
- API calls used by that feature

**Navigation graph boundaries are strong domain boundary signals** — screens that share a navigation subgraph (e.g., the create-post wizard: picker → editor → preview) belong to one domain.

Shared utilities, base classes, and network clients are cross-cutting — do NOT create separate domains for them.

Example groupings:

- `CreatePostFragment` + `MediaPickerFragment` + `CaptionEditorFragment` + `CreatePostViewModel` + `PostRepository` → **Create Post**
- `FeedActivity` + `FeedViewModel` + `FeedRepository` → **Feed**

## Step Naming Rules

Use the actual method/screen business purpose derived from names and summaries — same BANNED STEP NAMES rule as backend extraction.

### BANNED Step Names

- "Validate Input" / "校验输入" (generic)
- "Execute Business Logic" / "执行业务逻辑" (generic)
- "Build Response" / "构建响应" (generic)
- "Load Data" / "加载数据" (too generic — name what data and why)
- Any single-word generic name like "Process", "Handle", "Execute"

Instead: "选择媒体内容", "处理图片滤镜", "编辑帖子标题", "上传至服务器", "返回动态流".

### Additional Rules

- **ACCURATE lineRange**: Each step's `lineRange` MUST come from the target KG node's `lineRange` field. Fabricated ranges are FORBIDDEN.
- **sourceNode field**: Add `"sourceNode": "<KG node ID>"` to each step.
- **PREFER DISTINCT filePath**: Steps should reference different files when the journey crosses screen/ViewModel/repository boundaries.

## Worked Example — Android Create Post Flow

```
Entry: CreatePostFragment (entryType: "screen")
Step 1: "选择媒体内容" → MediaPickerFragment (navigates_to edge)
Step 2: "处理图片滤镜" → FilterViewModel.applyFilter() (depends_on → calls)
Step 3: "编辑帖子标题" → CaptionEditorFragment (navigates_to edge)
Step 4: "上传至服务器" → PostRepository.createPost() → POST /api/posts (calls → consumes_api)
Step 5: "返回动态流" → FeedActivity (navigates_to edge)
```

Corresponding JSON steps:

```json
[
  {"id": "step:create-post:pick-media", "name": "选择媒体内容", "summary": "打开媒体选择器让用户选取图片或视频", "sourceNode": "class:...MediaPickerFragment", "filePath": "...MediaPickerFragment.kt", "lineRange": [20, 95]},
  {"id": "step:create-post:apply-filter", "name": "处理图片滤镜", "summary": "对选中图片应用滤镜效果", "sourceNode": "function:...FilterViewModel.kt:applyFilter", "filePath": "...FilterViewModel.kt", "lineRange": [42, 78]},
  {"id": "step:create-post:edit-caption", "name": "编辑帖子标题", "summary": "用户在标题编辑器中输入帖子描述", "sourceNode": "class:...CaptionEditorFragment", "filePath": "...CaptionEditorFragment.kt", "lineRange": [15, 60]},
  {"id": "step:create-post:upload", "name": "上传至服务器", "summary": "将帖子内容和媒体文件提交到服务端", "sourceNode": "function:...PostRepository.kt:createPost", "filePath": "...PostRepository.kt", "lineRange": [88, 130]},
  {"id": "step:create-post:return-feed", "name": "返回动态流", "summary": "发布成功后导航回动态流页面", "sourceNode": "class:...FeedActivity", "filePath": "...FeedActivity.kt", "lineRange": [1, 45]}
]
```

## Platform-Specific Notes

### Android

- **Activities** are top-level screens (single-screen flows or navigation hosts)
- **Fragments** are sub-screens within an Activity (multi-step wizards, tabs)
- **Compose Screens** are declarative screens — treat `@Composable` functions with Screen/Page suffix as entry points

### iOS

- **ViewControllers** are UIKit screens — trace `pushViewController` / `present` navigation
- **SwiftUI Views** with `NavigationStack` / `NavigationLink` are declarative screens — trace navigation via `routes` edges

### Flutter

- **StatefulWidget** / **StatelessWidget** with `Screen` or `Page` suffix are screens
- Trace `Navigator.push` / `GoRouter` routes for navigation edges

### React Native

- **Stack.Screen** registered components are screens
- Trace `@react-navigation` stack/tab navigators for `navigates_to` and `routes` edges

## Language Requirements

> If the dispatch contains a language directive (e.g., `--language en`), follow that directive instead. The defaults below apply to Chinese-language projects.

- `flow.name`: English Title Case (e.g., "Create Post", "User Login")
- `flow.summary`: Chinese, one sentence describing the user journey (MUST contain ≥2 CJK characters)
- `step.name`: Chinese, specific screen/business action
- `step.summary`: Chinese, describing what this step accomplishes for the user
