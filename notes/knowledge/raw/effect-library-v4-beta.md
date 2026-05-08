# Effect Library v4 Beta

**Source:** Web article / announcement

## Overview
Effect is a powerful TypeScript ecosystem for building robust, type-safe, and scalable applications.

## v4 Beta Key Improvements

### 1. Performance Overhaul
- Core fiber runtime rewritten from scratch
- Faster execution and lower memory overhead

### 2. Reduced Bundle Size
- Improved tree-shaking and module design
- Minimal program size: ~70 kB (v3) -> ~20 kB (v4)

### 3. Unified Versioning
- All ecosystem packages (SQL, AI, Platform, etc.) share a single version number
- Prevents dependency mismatches

### 4. Consolidated Core
- Previously separate packages merged into main `effect` package
- Simplified developer experience

### 5. Unstable Modules
- New features shipped under `effect/unstable/*`
- Allows rapid iteration without breaking semantic versioning for stable core

## Installation

```bash
npm install effect@beta
```

---

## Under the Hood: How the Fiber Runtime Works

Effect's "virtual thread" behavior is achieved through a clever combination of standard JavaScript features:

### 1. Generators (`function*` and `yield`)
- **Purpose:** Pause and resume execution
- **How it works:** When code needs to perform an effect (API call, sleep), it `yields` control back to the Effect Runtime. The runtime decides when to push the next value back into the generator to resume it.
- **Similar to:** Redux-Saga, Task libraries

### 2. The Event Loop (Cooperative Yielding)
- The v4 runtime is rewritten for performance and "cooperative" behavior
- **Work Queue:** Runtime keeps an internal queue of instructions
- **Yielding:** Uses `setImmediate` or `queueMicrotask` to voluntarily yield to the browser/Node.js event loop
- **Benefit:** Prevents "Long Task" problems and UI freezing

### 3. AsyncLocalStorage (for Context)
- **Purpose:** Dependency Injection without manually passing variables
- **How it works:** Context (e.g., database connection) is inherited by all child fibers spawned from a parent, even across async boundaries
- **Note:** Uses `AsyncLocalStorage` in Node.js, similar patterns in browser

### 4. `AbortController` (for Interruption)
- **Purpose:** Fiber interruption
- **How it works:** Interfaces with native `AbortController` API when dealing with external fetch requests
- **Function:** Tells the browser to stop network requests immediately

### Summary Table
| Feature | Role in Effect |
| :--- | :--- |
| **Generators** | Allows the runtime to "pause" your code mid-function |
| **Microtasks** | Allows the runtime to schedule work without blocking the UI |
| **Closures** | Used heavily to capture state and environment within layers |
| **Proxy Objects** | Often used in `Schema` and `Service` modules for type-safe access |

> **Key Insight:** Effect team built a **scheduler** (like a real OS scheduler) entirely out of standard JavaScript asynchronous patterns.

## OS Scheduler Deep Dive

An **OS Scheduler** is the "traffic cop" of your computer - it decides which program gets to use the CPU, for how long, and in what order.

### Problem It Solves: Resource Scarcity
Your computer usually has more tasks wanting to run than CPU cores. Without a scheduler:
- **Monopolization:** One greedy program could freeze your entire computer
- **Inefficiency:** CPU sits idle while waiting for user input or file loading
- **Unresponsiveness:** Mouse/keyboard unresponsive while other programs work

The scheduler creates the **illusion of simultaneity** (multitasking) by switching between tasks so fast you don't notice.

### Core Features

#### 1. Context Switching
Ability to "save the state" of a running program (code position, memory/registers) and "load the state" of another. Like pausing a movie on one TV and resuming a different one on another.

#### 2. Preemption (The "Interrupt")
Modern schedulers are **Preemptive** - the OS can forcibly kick a program off the CPU if its time is up or a more important task needs attention.
> This is exactly what the **Effect Fiber runtime** does at the software level - it "yields" so no single task blocks the app.

#### 3. Priority Levels
Not all tasks are equal:
- **High priority:** I/O bound tasks (screen updates, user input), critical OS functions
- **Low priority:** CPU bound tasks (background updates, file compression)

#### 4. Scheduling Algorithms
- **First-Come, First-Served (FCFS):** Simple, but slow tasks block everything
- **Round Robin:** Every task gets a tiny time slice (e.g., 10ms), then moves to back of line
- **Multi-level Feedback Queues:** Most common modern approach. Learns which tasks are "interactive" and gives them priority, while pushing "heavy" tasks to background queues

### OS Scheduling Goals (Applicable to Fiber Runtime)

| Goal | Description |
| :--- | :--- |
| **Throughput** | Finish as many tasks as possible per hour. |
| **Fairness** | Ensure every process gets a chance to run eventually (no "starvation"). |
| **Latency** | Respond to user input (like a keystroke) almost instantly. |
| **Utilization** | Keep the expensive CPU working at 100% whenever possible. |

---

## What is a Fiber?

A **Fiber** is a lightweight "virtual thread" that manages the execution of your program. Similar to **Goroutines** in Go.

### Core Difference from Standard JS
- Standard JavaScript: single-threaded, "run-to-completion" model (once a function starts, it can't be paused from the outside)
- Effect's fiber runtime: gives you much more control over execution

### How It Works Under the Hood

1. **The Virtual Stack**
   - Effect maintains its own internal "instruction stack" instead of using the native JS call stack for everything
   - Allows the runtime to pause, resume, or move execution between different fibers without blocking the main thread

2. **Yielding & Cooperation**
   - The fiber runtime is "cooperative"
   - Periodically yields control back to the JS event loop
   - Ensures UI remains responsive during heavy computations

3. **Structured Concurrency**
   - Fibers are organized hierarchically
   - If a "parent" fiber is cancelled or fails, the runtime automatically cleans up all "child" fibers
   - Prevents "zombie" background tasks and memory leaks

### Key Capabilities of Fibers

| Capability | Description |
| :--- | :--- |
| **Interruption (Cancellation)** | `fork` a fiber to run in background, then `interrupt` it later. Runtime stops execution and runs cleanup logic automatically. Unlike standard JS where you can't easily stop a `Promise`. |
| **Concurrency vs. Parallelism** | Run thousands of fibers concurrently. Runtime switches between them so quickly they appear to run at the same time. |
| **Supervision** | Every fiber has a "supervisor" that monitors its health. Can restart crashed fibers, ignore errors, or shut down the system. |

### Mental Model

| Concept | Analogy |
| :--- | :--- |
| **Promise** | Like a **triggered trap**: once set off, it's going to finish one way or another |
| **Fiber** | Like a **video tape**: you can play it, pause it, rewind it, or stop it and take it out at any time |

---

## React Fiber vs. Effect Fiber

Both libraries use Fibers to solve the same problem: **blocking the main thread.**

### Why React uses Fibers
Before React 16, reconciliation was recursive and couldn't stop until finished. This caused UI "jank" or freezing during heavy updates.

**React Fiber** breaks rendering work into small units, enabling:
- **Pause work:** Handle user input (e.g., keystrokes) during heavy renders
- **Prioritize updates:** Animation > background data fetch
- **Reuse work:** Skip unchanged components

### Comparison Table

| Feature | **React Fiber** | **Effect Fiber** |
| :--- | :--- | :--- |
| **Purpose** | Smooth UI updates and "Concurrent Mode." | Robust logic, error handling, and concurrency. |
| **Primary Goal** | Prevent UI jank during rendering. | Prevent "zombie" tasks and handle async safely. |
| **Control** | Mostly handled by React internally. | Explicitly controlled by you (you can `fork` and `interrupt`). |
| **Interruption** | React interrupts rendering if a higher-priority event occurs. | You interrupt a fiber if, for example, a user navigates away from a page. |

### The "Concurrent" Connection
Both libraries are moving toward **Structured Concurrency** - away from "Fire and Forget" toward a model where every task has a parent, can be tracked, and can be **cancelled** the moment it's no longer useful.
