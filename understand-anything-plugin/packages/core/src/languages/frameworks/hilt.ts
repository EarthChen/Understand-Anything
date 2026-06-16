import type { FrameworkConfig } from "../types.js";

export const hiltConfig = {
  id: "hilt",
  displayName: "Hilt/Dagger",
  languages: ["java", "kotlin"],
  detectionKeywords: [
    "hilt-android",
    "dagger",
    "dagger.hilt",
    "com.google.dagger",
  ],
  manifestFiles: ["build.gradle", "build.gradle.kts"],
  promptSnippetPath: "./frameworks/android.md",
  entryPoints: [
    "**/*Application.java",
    "**/*Application.kt",
    "**/*Activity.java",
    "**/*Activity.kt",
    "**/*ViewModel.java",
    "**/*ViewModel.kt",
  ],
  layerHints: {
    activity: "ui",
    fragment: "ui",
    viewmodel: "service",
    repository: "data",
    module: "config",
    dao: "data",
    worker: "service",
    compose: "ui",
  },
} satisfies FrameworkConfig;
