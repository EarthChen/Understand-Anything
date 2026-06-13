import type { AnnotationInfo } from "../types.js";

interface ClassAnnotations {
  name: string;
  annotations: AnnotationInfo[];
}

export function resolveMetaAnnotations(
  className: string,
  allClassesOrMap: ClassAnnotations[] | Map<string, ClassAnnotations>,
): AnnotationInfo[] {
  const classMap = allClassesOrMap instanceof Map
    ? allClassesOrMap
    : new Map(allClassesOrMap.map((c) => [c.name, c]));
  const target = classMap.get(className);
  if (!target) return [];

  const result: AnnotationInfo[] = [];
  const visited = new Set<string>();

  function resolve(annName: string) {
    if (visited.has(annName)) return;
    visited.add(annName);

    result.push({ name: annName });

    const annClass = classMap.get(annName);
    if (!annClass) return;

    for (const meta of annClass.annotations) {
      resolve(meta.name);
    }
  }

  // Only start resolving from annotations that are themselves annotated classes
  for (const ann of target.annotations) {
    const annClass = classMap.get(ann.name);
    if (annClass && annClass.annotations.length > 0) {
      resolve(ann.name);
    }
  }

  return result;
}
