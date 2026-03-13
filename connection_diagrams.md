# Frontend-Backend Connection Diagrams

These diagrams illustrate the lifecycle and communication between the CodeViz frontend and backend, including the fallback mechanisms for resilience.

## 1. Connection Working (Happy Path)

This diagram shows the standard startup and execution flow when all components (including the worker pool) are functioning correctly.

```mermaid
sequenceDiagram
    participant UI as Frontend (UI)
    participant Srv as Backend (Server)
    participant WP as Worker Pool
    participant CS as Clang (Syntax)
    participant TR as Tracer

    UI->>Srv: spawnBackend()
    Note over UI: Polls port.json
    Srv->>Srv: bindAutoPort()
    Srv->>Srv: writePortJson(port)
    Srv->>WP: initialize()
    WP-->>Srv: OK

    UI->>UI: readPortJson()
    UI->>Srv: GET /api/health
    Srv-->>UI: 200 OK (Status: ok)
    
    UI->>Srv: Socket Connect
    Srv-->>UI: Connected

    UI->>Srv: emit("debug:start", code)
    Srv->>CS: clang -fsyntax-only
    CS-->>Srv: Syntax Valid
    
    Srv->>WP: execute(task)
    WP->>TR: Run Instrumented Code
    TR-->>WP: Trace Results
    WP-->>Srv: Return Results
    
    Srv-->>UI: emit("trace:chunk", data)
    Note over UI: Renders Visualization
```

---

## 2. Connection with Fallback (Resilient Path)

This diagram shows how the system recovers when the worker pool fails to initialize, falling back to direct execution mode to maintain functionality.

```mermaid
sequenceDiagram
    participant UI as Frontend (UI)
    participant Srv as Backend (Server)
    participant CS as Clang (Syntax)
    participant TR as Tracer

    UI->>Srv: spawnBackend()
    Note over UI: Polls port.json
    
    Srv->>Srv: workerPool.initialize() (FAIL)
    Note over Srv: Log: "Continuing without worker pool"
    
    Srv->>Srv: bindAutoPort()
    Srv->>Srv: writePortJson(port)
    
    UI->>UI: readPortJson()
    UI->>Srv: GET /api/health
    Srv-->>UI: 200 OK (Status: ok)
    
    UI->>Srv: Socket Connect
    Srv-->>UI: Connected

    UI->>Srv: emit("debug:start", code)
    Srv->>CS: clang -fsyntax-only
    CS-->>Srv: Syntax Valid
    
    Note over Srv: Direct Execution Fallback
    Srv->>TR: Run Instrumented Code (In-Process)
    TR-->>Srv: Trace Results
    
    Srv-->>UI: emit("trace:chunk", data)
    Note over UI: Renders Visualization
```
