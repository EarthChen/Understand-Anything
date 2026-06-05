# Objective-C Language Prompt Snippet

## Key Concepts

- **Message Passing**: `[receiver message:arg]` syntax; methods are resolved at runtime via `objc_msgSend`
- **Protocols**: Interface contracts declared with `@protocol`; adopted via `<ProtocolName>` in class declaration
- **Categories**: Add methods to existing classes without subclassing (`@interface NSString (MyCategory)`)
- **Properties**: `@property` declarations with attributes (`nonatomic`, `strong`, `weak`, `copy`, `readonly`)
- **Memory Management**: ARC (Automatic Reference Counting) with `strong`, `weak`, `assign`, `copy` ownership semantics
- **Blocks**: Closure syntax `^(params){ body }` for callbacks and functional patterns
- **Key-Value Coding/Observing**: Runtime introspection via `valueForKey:` and change observation via KVO
- **Header/Implementation Split**: `@interface` in `.h` (public API), `@implementation` in `.m` (implementation)
- **Class Extensions**: Anonymous categories in `.m` files for private interface declarations
- **NSObject Root Class**: Nearly all classes inherit from `NSObject`, providing runtime introspection and reference counting

## Import Patterns

- `#import "Header.h"` — import a project-local header
- `#import <Framework/Header.h>` — import a system or framework header
- `@import Module;` — Clang module import (modern style)
- `#include "header.h"` — C-style include (also valid in ObjC)

## File Patterns

- `*.h` — header files (interface declarations, protocols, constants)
- `*.m` — implementation files (method bodies, class extensions)
- `*.mm` — Objective-C++ files (mixed ObjC and C++ code)
- `AppDelegate.m` — application lifecycle entry point (iOS/macOS)
- `main.m` — program entry point with `main()` function and `@autoreleasepool`
- `Podfile` — CocoaPods dependency manager configuration
- `*.xcodeproj` / `*.xcworkspace` — Xcode project/workspace files

## Common Frameworks

- **UIKit** — iOS user interface framework (view controllers, table views, navigation)
- **Foundation** — Core data types, collections, networking, and OS services
- **CoreData** — Object graph and persistence framework with managed object context
- **AFNetworking** — HTTP networking library (predecessor to Alamofire)
- **SDWebImage** — Async image downloading and caching
- **Masonry / SnapKit** — Auto Layout DSL for programmatic constraints
- **ReactiveCocoa** — Reactive programming framework for Cocoa/Cocoa Touch

## Example Language Notes

> Uses `@protocol` and delegate pattern for loose coupling between view controller
> and data source. The `<UITableViewDataSource, UITableViewDelegate>` conformance
> declares required callbacks that UIKit invokes at runtime via message dispatch.
>
> Properties declared with `nonatomic, strong` indicate ARC-managed ownership with
> no thread-safety guarantees (typical for UI-thread-only objects). The `weak` attribute
> on delegate properties prevents retain cycles in parent-child relationships.
