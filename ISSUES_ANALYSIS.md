# Build Issues Analysis & Fixes

## Issue 1: Icon Not Showing in Built EXE

### Root Cause
The icon file is not being properly packaged into the final portable bundle before the NSIS installer runs, or the desktop resources directory structure is incorrect.

### Location
- **Build Script**: [backend/scripts/build.js](backend/scripts/build.js#L514-L530)
- **Icon Validation**: [backend/scripts/build.js](backend/scripts/build.js#L1310-L1330)
- **NSIS Generation**: [backend/scripts/build.js](backend/scripts/build.js#L640-L700)

### Problems Identified

1. **Icon Path in NSIS Installer** (Line 679)
   - The installer hard-codes the icon path as `$INSTDIR\\desktop\\resources\\app.ico`
   - But the actual icon is copied to `desktopResourcesDir` which may not exist if frontend resources aren't properly merged

2. **Missing Icon Validation** (Lines 1310-1330)
   - If PNG file doesn't exist or ICO generation fails silently
   - The build continues without properly validating icon availability

3. **Portable Bundle Structure** (Lines 545-578)
   - Icon is copied during `buildDesktopPortable`, but only if `appIconPng` and `appIconIco` are provided
   - If user doesn't explicitly provide icon paths, defaults may not be set correctly

### Solution Required
1. Ensure default icon paths are properly resolved
2. Validate icon files exist BEFORE building portable bundle
3. Verify icon is successfully copied to `resources/` directory
4. Update NSIS script to verify icon exists in installation target

---

## Issue 2: Backend Not Closing When App Exits (Portable/EXE)

### Root Cause
Backend process is spawned with `start /B` (Windows) / `&` (Linux/Mac) which detaches it from parent process. When Neutralino exits, the backend keeps running as an orphan.

### Location
- **Bootstrap File**: [desktop/resources/neutrala-bootstrap.js](desktop/resources/neutrala-bootstrap.js#L196-L210)
- **Lifecycle Handler**: [frontend/src/bootstrap/runtimeLifecycle.ts](frontend/src/bootstrap/runtimeLifecycle.ts#L63-L85)
- **Backend Killer**: [frontend/src/bootstrap/backendSpawner.ts](frontend/src/bootstrap/backendSpawner.ts#L122-L145)

### Problems Identified

1. **Process Detachment** (desktop/resources/neutrala-bootstrap.js:196-210)
   - Backend is launched with `start "" /B` (background process)
   - This completely detaches the process from Neutralino's process group
   - Neutralino exit does NOT automatically kill the backend

2. **Exit Handler Timing** (frontend/src/bootstrap/runtimeLifecycle.ts:70-85)
   - `setupExitHandlers()` only works if Neutralino API is available
   - May fail silently if Neutralino events API has issues
   - No fallback mechanism if windowClose event doesn't fire

3. **Kill Command Issues** (frontend/src/bootstrap/backendSpawner.ts:122-145)
   - Uses `taskkill /F /T /PID` but backend PID tracking may be lost
   - The spawned process might have a different PID structure due to `start /B` wrapping

### Solution Required
1. Don't spawn backend detached - use Neutralino.os.spawnProcess() for proper tracking
2. Ensure exit handlers are always set up before spawning backend
3. Add fallback process termination in Neutralino preload/exit hooks
4. Kill backend BEFORE Neutralino exits (not after)
5. Add timeout-based watchdog: if only 1 process exists after 30s of no connections, auto-kill

---

## Recommended Fixes

### For Icon Issue:
1. Add pre-build icon validation in main()
2. Ensure icon files are in desktop/ before building portable
3. Verify desktopResourcesDir exists and contains app.ico after copy
4. Add debug logging to buildNsiInstaller() to verify icon path

### For Backend Shutdown Issue:
1. Replace `start /B` with proper Neutralino process spawning
2. Move exit handler setup to BEFORE backend spawn
3. Add N.app.exit() listener in Neutralino preload
4. Kill backend synchronously before app.exit() completes
5. Implement 10-second timeout on kill command with fallback

