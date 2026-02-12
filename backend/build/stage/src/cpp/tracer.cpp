// backend/src/cpp/tracer.cpp

/**
 * ========================================================================
 * TRACER RECURSION SAFETY ARCHITECTURE
 * ========================================================================
 * 
 * PROBLEM:
 * When compiled with -finstrument-functions, the compiler inserts calls to
 * __cyg_profile_func_enter and __cyg_profile_func_exit at every function
 * entry and exit point, including inside the tracer itself.
 *
 * This creates infinite recursion:
 *
 *   __cyg_profile_func_enter
 *    ↓
 *   demangle() [instrumented] → __cyg_profile_func_enter
 *    ↓
 *   dladdr() or other calls [instrumented] → __cyg_profile_func_enter
 *    ↓
 *   write_json_event() [instrumented] → __cyg_profile_func_enter
 *    ↓
 *   std::mutex::lock() [instrumented] → __cyg_profile_func_enter
 *    ↓
 *   STACK OVERFLOW (0xC00000FD)
 *
 * SOLUTION:
 * Two-layer defense prevent recursion:
 *
 * 1) NO_INSTRUMENT Attributes:
 *    Mark all tracer functions with __attribute__((no_instrument_function))
 *    This tells the compiler NOT to insert instrumentation hooks into these functions.
 *    Applied to: demangle, json_safe_path, write_json_event, mutex helpers,
 *                all __trace_*_loc functions, operator new/delete, etc.
 *
 * 2) Reentrancy Guard (g_inside_tracer):
 *    A thread-local boolean that tracks whether we're already inside the tracer.
 *    If we somehow enter the tracer while already inside (should not happen with
 *    NO_INSTRUMENT, but provides defense-in-depth), we skip processing and return early.
 *
 *    Guard pattern used in:
 *    - __cyg_profile_func_enter/exit (primary entry points)
 *    - write_json_event  (early exit if guard active)
 *    - operator new/new[]/delete/delete[] (allocation hooks)
 *
 * CROSS-PLATFORM:
 * - Attribute detection works on GCC, Clang, and derivatives
 * - MSVC: Attribute is silently ignored (uses fallback mechanism)
 * - No overhead when guard is not triggered (just a thread-local bool check)
 */

// ========== CROSS-PLATFORM COMPATIBILITY DEFINITIONS ==========

// Macro for marking functions that must never be instrumented
#if defined(__clang__) || defined(__GNUC__)
#define NO_INSTRUMENT __attribute__((no_instrument_function))
#else
#define NO_INSTRUMENT
#endif

// Allocation/no-instrument helper
#define NO_TRACE_ALLOC NO_INSTRUMENT

// Hard-entry guard: disable immediately on recursion or shutdown
#define TRACER_GUARD_ENTER()           \
    do {                               \
        if (g_tracer_disabled) return; \
        if (g_inside_tracer) return;   \
        g_inside_tracer = true;        \
    } while (0)

#define TRACER_GUARD_EXIT()            \
    do {                               \
        g_inside_tracer = false;       \
    } while (0)

// ========== INCLUDES ==========

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <cstddef>
#include <algorithm>
#include <string>
#include <map>
#include <set>
#include <vector>
#include <chrono>

// Threading headers for all platforms
#if __cplusplus >= 201103L
    // C++11 or later - use standard library mutex
    #include <mutex>
    #define TRACER_USE_STD_MUTEX 1
#else
    // Fallback for pre-C++11
    #ifdef _WIN32
        #include <windows.h>
        #define TRACER_USE_WIN32_CRITICAL_SECTION 1
    #else
        #include <pthread.h>
        #define TRACER_USE_PTHREAD_MUTEX 1
    #endif
#endif

#include <thread>

#ifdef _WIN32
    // Avoid requiring Windows SDK headers; use cross-platform timing APIs
#else
    #include <dlfcn.h>
    #include <cxxabi.h>
    #include <sys/time.h>
    #include <unistd.h>
#endif

#include "trace.h"

// ========== THREAD-SAFE MUTEX WRAPPER ==========

#if defined(TRACER_USE_STD_MUTEX)
    // Modern C++11+ approach: use std::mutex with RAII guard
    static std::mutex g_trace_mutex;

#elif defined(TRACER_USE_WIN32_CRITICAL_SECTION)
    // Windows fallback: use CRITICAL_SECTION
    #ifdef __cplusplus
    extern "C" {
    #endif
    static CRITICAL_SECTION g_trace_mutex_cs;
    static volatile int g_trace_mutex_initialized = 0;
    
    static NO_INSTRUMENT void init_trace_mutex() {
        if (!g_trace_mutex_initialized) {
            InitializeCriticalSection(&g_trace_mutex_cs);
            g_trace_mutex_initialized = 1;
        }
    }
    #ifdef __cplusplus
    }
    #endif

#elif defined(TRACER_USE_PTHREAD_MUTEX)
    // POSIX fallback: use pthread_mutex_t
    static pthread_mutex_t g_trace_mutex = PTHREAD_MUTEX_INITIALIZER;

#endif

static FILE* g_trace_file = nullptr;
static int g_depth = 0;
static unsigned long g_event_counter = 0;

// ========== GLOBAL REENTRANCY GUARD ==========
// Prevents infinite recursion when tracer functions are instrumented
// Cross-platform thread-local reentrancy guard
// CRITICAL: Must be checked FIRST in every entry point to prevent stack overflow
#if defined(_MSC_VER)
__declspec(thread) bool g_inside_tracer = false;
#else
static __thread bool g_inside_tracer = false;
#endif
static volatile bool g_tracer_disabled = false;
static volatile int g_tracer_depth_protect = 0;  // Additional depth protection layer

struct ArrayInfo {
    std::string name;
    std::string baseType;
    void* address;
    int dim1, dim2, dim3;
    bool isStack;
};

struct ArrayElementKey {
    std::string arrayName;
    int idx1, idx2, idx3;
    
    bool operator<(const ArrayElementKey& other) const {
        if (arrayName != other.arrayName) return arrayName < other.arrayName;
        if (idx1 != other.idx1) return idx1 < other.idx1;
        if (idx2 != other.idx2) return idx2 < other.idx2;
        return idx3 < other.idx3;
    }
};

struct PointerInfo {
    std::string pointerName;
    void* aliasedAddress;
    bool isHeap;
    void* heapAddress;
};

struct CallFrame {
    std::string functionName;
    std::map<std::string, PointerInfo> pointerAliases;
    std::vector<int> activeLoops;
    std::map<int, int> loopIterations;
};

// Construct-On-First-Use accessors
static std::map<std::string, long long>& get_variable_values() {
    static NO_INSTRUMENT std::map<std::string, long long> s_variable_values;
    return s_variable_values;
}
static std::map<void*, ArrayInfo>& get_array_registry() {
    static NO_INSTRUMENT std::map<void*, ArrayInfo> s_array_registry;
    return s_array_registry;
}
static std::map<void*, std::string>& get_address_to_name() {
    static NO_INSTRUMENT std::map<void*, std::string> s_address_to_name;
    return s_address_to_name;
}
static std::map<ArrayElementKey, long long>& get_array_element_values() {
    static NO_INSTRUMENT std::map<ArrayElementKey, long long> s_array_element_values;
    return s_array_element_values;
}
static std::set<std::string>& get_tracked_functions() {
    static NO_INSTRUMENT std::set<std::string> s_tracked_functions;
    return s_tracked_functions;
}
static std::string& get_current_function() {
    static NO_INSTRUMENT std::string s_current_function = "main";
    return s_current_function;
}
static std::map<std::string, PointerInfo>& get_pointer_registry() {
    static NO_INSTRUMENT std::map<std::string, PointerInfo> s_pointer_registry;
    return s_pointer_registry;
}
static std::vector<CallFrame>& get_call_stack() {
    static NO_INSTRUMENT std::vector<CallFrame> s_call_stack;
    return s_call_stack;
}

// Map globals to accessors to avoid mass-replace
#define g_variable_values get_variable_values()
#define g_array_registry get_array_registry()
#define g_address_to_name get_address_to_name()
#define g_array_element_values get_array_element_values()
#define g_tracked_functions get_tracked_functions()
#define g_current_function get_current_function()
#define g_pointer_registry get_pointer_registry()
#define g_call_stack get_call_stack()

static inline unsigned long NO_INSTRUMENT get_timestamp_us() {
    using namespace std::chrono;
    auto now = steady_clock::now();
    auto us = duration_cast<microseconds>(now.time_since_epoch()).count();
    return static_cast<unsigned long>(us & 0xFFFFFFFFULL);
}

// ========== OPTIONAL RAII LOCK GUARD (INSTRUMENTATION-SAFE) ==========

struct NO_INSTRUMENT TraceGuard {
    NO_INSTRUMENT TraceGuard() {
#if defined(TRACER_USE_STD_MUTEX)
        g_trace_mutex.lock();
#elif defined(TRACER_USE_WIN32_CRITICAL_SECTION)
        init_trace_mutex();
        EnterCriticalSection(&g_trace_mutex_cs);
#elif defined(TRACER_USE_PTHREAD_MUTEX)
        pthread_mutex_lock(&g_trace_mutex);
#endif
    }
    NO_INSTRUMENT ~TraceGuard() {
#if defined(TRACER_USE_STD_MUTEX)
        g_trace_mutex.unlock();
#elif defined(TRACER_USE_WIN32_CRITICAL_SECTION)
        LeaveCriticalSection(&g_trace_mutex_cs);
#elif defined(TRACER_USE_PTHREAD_MUTEX)
        pthread_mutex_unlock(&g_trace_mutex);
#endif
    }
    
    // Prevent copying to avoid double-unlock
    TraceGuard(const TraceGuard&) = delete;
    TraceGuard& operator=(const TraceGuard&) = delete;
};

static const char* NO_INSTRUMENT demangle(const char* name) {
#ifndef _WIN32
    if (!name) return "unknown";
    int status = 0;
    char* real = abi::__cxa_demangle(name, nullptr, nullptr, &status);
    if (status == 0 && real) {
        static __thread char buffer[512];
        strncpy(buffer, real, sizeof(buffer) - 1);
        buffer[sizeof(buffer) - 1] = '\0';
        free(real);
        return buffer;
    }
    return name;
#else
    return name;
#endif
}

static std::string NO_INSTRUMENT json_safe_path(const char* raw) {
    if (!raw) return "";
    std::string s(raw);
    std::replace(s.begin(), s.end(), '\\', '/');
    return s;
}

static std::string NO_INSTRUMENT normalize_function_name(const char* name) {
    if (!name) return "unknown";
    std::string s(name);
    s.erase(std::remove(s.begin(), s.end(), '\r'), s.end());
    s.erase(std::remove(s.begin(), s.end(), '\n'), s.end());
    return s;
}

static void NO_INSTRUMENT write_json_event(const char* type, void* addr,
                 const char* func_name, int depth,
                 const char* extra = nullptr);
static void NO_INSTRUMENT write_json_event(const char* type, void* addr,
                 const char* func_name, int depth,
                 const char* extra) {
    if (!g_trace_file || g_depth >= 2048) {
        return;
    }

    {
        TraceGuard guard;

        if (g_event_counter > 0) fputs(",\n", g_trace_file);

        fprintf(g_trace_file,
            "  {\"id\":%lu,\"type\":\"%s\",\"addr\":\"%p\",\"func\":\"%s\",\"depth\":%d,\"ts\":%lu",
            g_event_counter++, type, addr,
            func_name ? func_name : "unknown",
            depth, get_timestamp_us());

        if (extra) fprintf(g_trace_file, ",%s", extra);
        fputs("}", g_trace_file);
        fflush(g_trace_file);
    }
}

static PointerInfo* NO_INSTRUMENT findPointerInfo(const std::string& ptrName) {
    for (auto it = get_call_stack().rbegin(); it != get_call_stack().rend(); ++it) {
        auto pit = it->pointerAliases.find(ptrName);
        if (pit != it->pointerAliases.end()) {
            return &(pit->second);
        }
    }
    
    auto git = get_pointer_registry().find(ptrName);
    if (git != get_pointer_registry().end()) {
        return &(git->second);
    }
    
    return nullptr;
}

extern "C" void __trace_output_flush_loc(const char* file, int line) __attribute__((no_instrument_function));
extern "C" void __trace_output_flush_loc(const char* file, int line) {
    TRACER_GUARD_ENTER();
    {
        TraceGuard guard;
        fflush(stdout);
        fflush(stderr);
        if (g_trace_file) fflush(g_trace_file);
    }
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_condition_eval_loc(int conditionId, const char* expression, int result,
                                           const char* file, int line) __attribute__((no_instrument_function));
extern "C" void __trace_condition_eval_loc(int conditionId, const char* expression, int result,
                                           const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"conditionId\":%d,\"expression\":\"%s\",\"result\":%d,\"file\":\"%s\",\"line\":%d",
             conditionId, expression, result, f.c_str(), line);
    write_json_event("condition_eval", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_branch_taken_loc(int conditionId, const char* branchType,
                                         const char* file, int line) __attribute__((no_instrument_function));
extern "C" void __trace_branch_taken_loc(int conditionId, const char* branchType,
                                         const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"conditionId\":%d,\"branchType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             conditionId, branchType, f.c_str(), line);
    write_json_event("branch_taken", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_array_create_loc(const char* name, const char* baseType,
                                         void* address, int dim1, int dim2, int dim3,
                                         bool isStack, const char* file, int line) __attribute__((no_instrument_function));
extern "C" void __trace_array_create_loc(const char* name, const char* baseType,
                                         void* address, int dim1, int dim2, int dim3,
                                         bool isStack, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    get_address_to_name()[address] = name;

    const std::string f = json_safe_path(file);
    char extra[512];
    
    char dims[64];
    if (dim3 > 0) {
        snprintf(dims, sizeof(dims), "[%d,%d,%d]", dim1, dim2, dim3);
    } else if (dim2 > 0) {
        snprintf(dims, sizeof(dims), "[%d,%d]", dim1, dim2);
    } else {
        snprintf(dims, sizeof(dims), "[%d]", dim1);
    }
    
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"baseType\":\"%s\",\"dimensions\":%s,\"isStack\":%s,\"file\":\"%s\",\"line\":%d",
             name, baseType, dims, isStack ? "true" : "false", f.c_str(), line);
    
    write_json_event("array_create", address, get_current_function().c_str(), g_depth, extra);
    
    ArrayInfo info;
    info.name = name;
    info.baseType = baseType;
    info.address = address;
    info.dim1 = dim1;
    info.dim2 = dim2;
    info.dim3 = dim3;
    info.isStack = isStack;
    
    get_array_registry()[address] = info;
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_array_init_string_loc(const char* name, const char* str_literal,
                                               const char* file, int line) __attribute__((no_instrument_function));
extern "C" void __trace_array_init_string_loc(const char* name, const char* str_literal,
                                               const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    const std::string f = json_safe_path(file);
    const int len = str_literal ? strlen(str_literal) : 0;
    
    for (int i = 0; i <= len; i++) {
        char c = (i < len) ? str_literal[i] : '\0';
        char extra[256];
        snprintf(extra, sizeof(extra),
                 "\"name\":\"%s\",\"indices\":[%d],\"value\":%d,\"char\":\"\\u%04x\",\"file\":\"%s\",\"line\":%d",
                 name, i, (int)c, (unsigned char)c, f.c_str(), line);
        
        write_json_event("array_index_assign", nullptr, get_current_function().c_str(), g_depth, extra);
        
        ArrayElementKey key;
        key.arrayName = name;
        key.idx1 = i;
        key.idx2 = -1;
        key.idx3 = -1;
        get_array_element_values()[key] = (long long)c;
    }
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_array_init_loc(const char* name, void* values, int count,
                                       const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    const std::string f = json_safe_path(file);
    int* intValues = static_cast<int*>(values);
    
    for (int i = 0; i < count; i++) {
        char extra[256];
        snprintf(extra, sizeof(extra),
                 "\"name\":\"%s\",\"indices\":[%d],\"value\":%d,\"file\":\"%s\",\"line\":%d",
                 name, i, intValues[i], f.c_str(), line);
        
        write_json_event("array_index_assign", nullptr, get_current_function().c_str(), g_depth, extra);
        
        ArrayElementKey key;
        key.arrayName = name;
        key.idx1 = i;
        key.idx2 = -1;
        key.idx3 = -1;
        get_array_element_values()[key] = (long long)intValues[i];
    }
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_array_index_assign_loc(const char* name, int idx1, int idx2, int idx3,
                                                long long value, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    ArrayElementKey key;
    key.arrayName = name;
    key.idx1 = idx1;
    key.idx2 = idx2;
    key.idx3 = idx3;
    
    get_array_element_values()[key] = value;
    
    const std::string f = json_safe_path(file);
    
    char indices[64];
    if (idx3 >= 0) {
        snprintf(indices, sizeof(indices), "[%d,%d,%d]", idx1, idx2, idx3);
    } else if (idx2 >= 0) {
        snprintf(indices, sizeof(indices), "[%d,%d]", idx1, idx2);
    } else {
        snprintf(indices, sizeof(indices), "[%d]", idx1);
    }
    
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"indices\":%s,\"value\":%lld,\"file\":\"%s\",\"line\":%d",
             name, indices, value, f.c_str(), line);
    
    write_json_event("array_index_assign", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_pointer_alias_loc(const char* name, void* aliasedAddress, bool decayedFromArray,
                                          const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }

    std::string aliasOfName = "unknown";
    if (get_address_to_name().count(aliasedAddress)) {
        aliasOfName = get_address_to_name()[aliasedAddress];
    }
    
    const std::string f = json_safe_path(file);
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"aliasOf\":\"%s\",\"aliasedAddress\":\"%p\",\"decayedFromArray\":%s,\"file\":\"%s\",\"line\":%d",
             name, aliasOfName.c_str(), aliasedAddress, decayedFromArray ? "true" : "false", f.c_str(), line);
    
    write_json_event("pointer_alias", aliasedAddress, get_current_function().c_str(), g_depth, extra);
    
    PointerInfo pinfo;
    pinfo.pointerName = name;
    pinfo.aliasedAddress = aliasedAddress;
    pinfo.isHeap = false;
    pinfo.heapAddress = nullptr;
    
    if (!get_call_stack().empty()) {
        get_call_stack().back().pointerAliases[name] = pinfo;
    } else {
        get_pointer_registry()[name] = pinfo;
    }
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_pointer_deref_write_loc(const char* ptrName, long long value,
                                                const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    const std::string f = json_safe_path(file);

    PointerInfo* pinfo = findPointerInfo(ptrName);

    std::string targetName = "unknown";
    bool isHeap = false;
    void* targetAddress = nullptr;

    if (pinfo) {
        isHeap = pinfo->isHeap;
        targetAddress = pinfo->aliasedAddress;
        if (get_address_to_name().count(targetAddress)) {
            targetName = get_address_to_name()[targetAddress];
        }
    }
    
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"pointerName\":\"%s\",\"value\":%lld,\"targetName\":\"%s\",\"isHeap\":%s,\"file\":\"%s\",\"line\":%d",
             ptrName, value, targetName.c_str(), isHeap ? "true" : "false", f.c_str(), line);
    write_json_event("pointer_deref_write", targetAddress, get_current_function().c_str(), g_depth, extra);
    
    if (isHeap) {
        char heap_extra[512];
        snprintf(heap_extra, sizeof(heap_extra),
                 "\"address\":\"%p\",\"value\":%lld,\"file\":\"%s\",\"line\":%d",
                 targetAddress, value, f.c_str(), line);
        write_json_event("heap_write", targetAddress, get_current_function().c_str(), g_depth, heap_extra);
    }
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_declare_loc(const char* name, const char* type, void* address,
                                    const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }

    get_address_to_name()[address] = name;
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"varType\":\"%s\",\"value\":null,\"address\":\"%p\",\"file\":\"%s\",\"line\":%d",
             name, type, address, f.c_str(), line);
    write_json_event("declare", address, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_assign_loc(const char* name, long long value,
                                   const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    get_variable_values()[name] = value;
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%lld,\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("assign", nullptr, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_pointer_heap_init_loc(const char* ptrName, void* heapAddr,
                                               const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    PointerInfo pinfo;
    pinfo.pointerName = ptrName;
    pinfo.aliasedAddress = heapAddr;
    pinfo.isHeap = true;
    pinfo.heapAddress = heapAddr;
    
    if (!get_call_stack().empty()) {
        get_call_stack().back().pointerAliases[ptrName] = pinfo;
    }
    
    get_pointer_registry()[ptrName] = pinfo;
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_control_flow_loc(const char* controlType, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"controlType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             controlType, f.c_str(), line);
    write_json_event("control_flow", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_loop_start_loc(int loopId, const char* loopType, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    if (!get_call_stack().empty()) {
        get_call_stack().back().activeLoops.push_back(loopId);
        get_call_stack().back().loopIterations[loopId] = 0;
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"loopType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             loopId, loopType, f.c_str(), line);
    write_json_event("loop_start", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_loop_body_start_loc(int loopId, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    int iteration = 0;
    if (!get_call_stack().empty()) {
        iteration = ++get_call_stack().back().loopIterations[loopId];
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"iteration\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, iteration, f.c_str(), line);
    write_json_event("loop_body_start", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_loop_iteration_end_loc(int loopId, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    int iteration = 0;
    if (!get_call_stack().empty()) {
        iteration = get_call_stack().back().loopIterations[loopId];
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"iteration\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, iteration, f.c_str(), line);
    write_json_event("loop_iteration_end", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_loop_end_loc(int loopId, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    
    if (!get_call_stack().empty()) {
        auto& loops = get_call_stack().back().activeLoops;
        auto it = std::find(loops.begin(), loops.end(), loopId);
        if (it != loops.end()) {
            loops.erase(it);
        }
        get_call_stack().back().loopIterations.erase(loopId);
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, f.c_str(), line);
    write_json_event("loop_end", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_loop_condition_loc(int loopId, int result, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"result\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, result, f.c_str(), line);
    write_json_event("loop_condition", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_return_loc(long long value, const char* returnType, 
                                    const char* destinationSymbol, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[512];
    
    if (destinationSymbol && destinationSymbol[0] != '\0') {
        snprintf(extra, sizeof(extra),
                 "\"value\":%lld,\"returnType\":\"%s\",\"destinationSymbol\":\"%s\",\"file\":\"%s\",\"line\":%d",
                 value, returnType ? returnType : "auto", destinationSymbol, f.c_str(), line);
    } else {
        snprintf(extra, sizeof(extra),
                 "\"value\":%lld,\"returnType\":\"%s\",\"file\":\"%s\",\"line\":%d",
                 value, returnType ? returnType : "auto", f.c_str(), line);
    }
    
    write_json_event("return", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_block_enter_loc(int blockDepth, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"blockDepth\":%d,\"file\":\"%s\",\"line\":%d",
             blockDepth, f.c_str(), line);
    write_json_event("block_enter", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void __trace_block_exit_loc(int blockDepth, const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"blockDepth\":%d,\"file\":\"%s\",\"line\":%d",
             blockDepth, f.c_str(), line);
    write_json_event("block_exit", nullptr, get_current_function().c_str(), g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void trace_var_int_loc(const char* name, int value,
                                   const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%d,\"type\":\"int\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void trace_var_long_loc(const char* name, long long value,
                                    const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%lld,\"type\":\"long\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void trace_var_double_loc(const char* name, double value,
                                      const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%f,\"type\":\"double\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void trace_var_ptr_loc(const char* name, void* value,
                                  const char* file, int line) {
    TRACER_GUARD_ENTER();
    if (!g_trace_file) { TRACER_GUARD_EXIT(); return; }
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":\"%p\",\"type\":\"pointer\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
    TRACER_GUARD_EXIT();
}

extern "C" void trace_var_str_loc(const char* name, const char* value,
                                  const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char escaped[256];
    int j = 0;
    for (int i = 0; value && value[i] && i < 250; ++i) {
        if (value[i] == '"' || value[i] == '\\') escaped[j++] = '\\';
        escaped[j++] = value[i];
    }
    escaped[j] = '\0';
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":\"%s\",\"type\":\"string\",\"file\":\"%s\",\"line\":%d",
             name, escaped, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_int(const char* name, int value) {
    trace_var_int_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_long(const char* name, long long value) {
    trace_var_long_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_double(const char* name, double value) {
    trace_var_double_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_ptr(const char* name, void* value) {
    trace_var_ptr_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_str(const char* name, const char* value) {
    trace_var_str_loc(name, value, "unknown", 0);
}

extern "C" void __cyg_profile_func_enter(void* func, void* caller)
    __attribute__((no_instrument_function));
void __cyg_profile_func_enter(void* func, void* caller) {
    TRACER_GUARD_ENTER();

    // Prevent depth overflow before emitting
    if (++g_depth >= 2048) {
        --g_depth;
        TRACER_GUARD_EXIT();
        return;
    }

    const char* func_name = "main";

#ifndef _WIN32
    Dl_info dlinfo{};
    if (dladdr(func, &dlinfo) && dlinfo.dli_sname) {
        func_name = demangle(dlinfo.dli_sname);
        
        if (strstr(func_name, "GLOBAL__sub") ||
            strstr(func_name, "_static_initialization_and_destruction")) {
            --g_depth;
            TRACER_GUARD_EXIT();
            return;
        }
        
        // If symbol lives in system libraries, do not drop the event — mark as user_function
        if (dlinfo.dli_fname &&
            (strstr(dlinfo.dli_fname, "/usr/") ||
             strstr(dlinfo.dli_fname, "/lib/") ||
             strstr(dlinfo.dli_fname, "libc") ||
             strstr(dlinfo.dli_fname, "libstdc++"))) {
            func_name = "user_function";
        }
    }
#endif

    std::string fn = normalize_function_name(func_name);
    get_tracked_functions().insert(fn);
    get_current_function() = fn;
    
    // Add call frame
    CallFrame frame;
    frame.functionName = fn;
    
    // Check if we are inside a loop or function call context?
    // We maintain active loops per function frame.
    
    get_call_stack().push_back(frame);
    
    char extra[256];
    snprintf(extra, sizeof(extra), "\"caller\":\"%p\"", caller);
    write_json_event("func_enter", func, func_name, g_depth, extra);

    TRACER_GUARD_EXIT();
}

extern "C" void __cyg_profile_func_exit(void* func, void* caller)
    __attribute__((no_instrument_function));
void __cyg_profile_func_exit(void* func, void* caller) {
    TRACER_GUARD_ENTER();

    if (g_depth <= 0) {
        TRACER_GUARD_EXIT();
        return;
    }

    const char* func_name = "main";

#ifndef _WIN32
    Dl_info dlinfo{};
        if (dladdr(func, &dlinfo) && dlinfo.dli_sname) {
            func_name = demangle(dlinfo.dli_sname);
            
            if (strstr(func_name, "GLOBAL__sub") || 
                strstr(func_name, "_static_initialization_and_destruction")) {
                TRACER_GUARD_EXIT();
                return;
            }

        if (dlinfo.dli_fname &&
            (strstr(dlinfo.dli_fname, "/usr/") ||
             strstr(dlinfo.dli_fname, "/lib/"))) {
            func_name = "user_function";
        }
    }
#endif

    if (!g_call_stack.empty()) {
        auto& activeLoops = g_call_stack.back().activeLoops;
        while (!activeLoops.empty()) {
            int loopId = activeLoops.back();
            activeLoops.pop_back();
            
            char extra[128];
            snprintf(extra, sizeof(extra), "\"loopId\":%d,\"file\":\"unknown\",\"line\":0", loopId);
            write_json_event("loop_end", nullptr, g_current_function.c_str(), g_depth, extra);
        }
        
        g_call_stack.pop_back();
    }
    
    if (!g_call_stack.empty()) {
        g_current_function = g_call_stack.back().functionName;
    } else {
        g_current_function = "main";
    }

    write_json_event("func_exit", func, func_name, g_depth);
    --g_depth;

    TRACER_GUARD_EXIT();
}

void* operator new(std::size_t size) __attribute__((no_instrument_function));
void* operator new(std::size_t size) {
    if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) return std::malloc(size);

    g_inside_tracer = true;

    void* ptr = std::malloc(size);
    if (ptr && g_trace_file && !g_tracer_disabled) {
        char extra[128];
        snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
        write_json_event("heap_alloc", ptr, "operator new", g_depth, extra);
    }

    TRACER_GUARD_EXIT();
    return ptr;
}

void* operator new[](std::size_t size) __attribute__((no_instrument_function));
void* operator new[](std::size_t size) {
    if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) return std::malloc(size);

    g_inside_tracer = true;

    void* ptr = std::malloc(size);
    if (ptr && g_trace_file && !g_tracer_disabled) {
        char extra[128];
        snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
        write_json_event("heap_alloc", ptr, "operator new[]", g_depth, extra);
    }

    TRACER_GUARD_EXIT();
    return ptr;
}

void operator delete(void* ptr) noexcept __attribute__((no_instrument_function));
void operator delete(void* ptr) noexcept {
    if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) { std::free(ptr); return; }

    g_inside_tracer = true;

    if (ptr && g_trace_file && !g_tracer_disabled) {
        write_json_event("heap_free", ptr, "operator delete", g_depth);
    }
    std::free(ptr);

    TRACER_GUARD_EXIT();
}

void operator delete[](void* ptr) noexcept __attribute__((no_instrument_function));
void operator delete[](void* ptr) noexcept {
    if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) { std::free(ptr); return; }

    g_inside_tracer = true;

    if (ptr && g_trace_file && !g_tracer_disabled) {
        write_json_event("heap_free", ptr, "operator delete[]", g_depth);
    }
    std::free(ptr);

    TRACER_GUARD_EXIT();
}

#if !defined(_WIN32)
extern "C" {
    static void* (*real_malloc)(std::size_t) = nullptr;
    static void (*real_free)(void*) = nullptr;

    static void NO_INSTRUMENT init_malloc_hooks() __attribute__((constructor));
    static void NO_INSTRUMENT init_malloc_hooks() {
        real_malloc = (void*(*)(std::size_t))dlsym(RTLD_NEXT, "malloc");
        real_free   = (void(*)(void*))dlsym(RTLD_NEXT, "free");
    }

    void* malloc(std::size_t size) __attribute__((no_instrument_function));
    void* malloc(std::size_t size) {
        if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) {
            return real_malloc ? real_malloc(size) : std::malloc(size);
        }

        g_inside_tracer = true;

        if (!real_malloc) init_malloc_hooks();
        void* ptr = real_malloc ? real_malloc(size) : std::malloc(size);
        if (ptr && g_trace_file && !g_tracer_disabled) {
            char extra[128];
            snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
            write_json_event("heap_alloc", ptr, "malloc", g_depth, extra);
        }

        TRACER_GUARD_EXIT();
        return ptr;
    }

    void free(void* ptr) __attribute__((no_instrument_function));
    void free(void* ptr) {
        if (g_tracer_disabled || g_inside_tracer || g_depth >= 2048) {
            if (real_free) { real_free(ptr); } else { std::free(ptr); }
            return;
        }

        g_inside_tracer = true;

        if (!real_free) init_malloc_hooks();
        if (ptr && g_trace_file && !g_tracer_disabled) {
            write_json_event("heap_free", ptr, "free", g_depth);
        }
        if (real_free) {
            real_free(ptr);
        } else {
            std::free(ptr);
        }

        TRACER_GUARD_EXIT();
    }
}
#endif

extern "C" void __attribute__((constructor)) init_tracer()
    __attribute__((no_instrument_function));
void init_tracer() {
    // Note: No guard here because we want to allow immediate start
    if (g_depth >= 2048) { return; }

    // Initialize mutex for thread-safe operations
    #if defined(TRACER_USE_WIN32_CRITICAL_SECTION)
        init_trace_mutex();
    #endif

    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    const char* trace_path = std::getenv("TRACE_OUTPUT");
    if (!trace_path) trace_path = "trace.json";

    g_trace_file = std::fopen(trace_path, "w");
    if (g_trace_file) {
        g_tracer_disabled = false;
        setvbuf(g_trace_file, NULL, _IONBF, 0);
        std::fprintf(g_trace_file,
                     "{\"version\":\"1.0\",\"functions\":[],\"events\":[\n");
        std::fflush(g_trace_file);
    } else {
        g_tracer_disabled = true;  // Fail-safe: disable tracer if file open fails
    }
}

extern "C" void __attribute__((destructor)) finish_tracer()
    __attribute__((no_instrument_function));
void finish_tracer() {
    // PHASE 1: Entry guard
    TRACER_GUARD_ENTER();
    if (g_depth >= 2048) { TRACER_GUARD_EXIT(); return; }

    if (!g_trace_file) {
        TRACER_GUARD_EXIT();
        return;
    }

    // Disable BEFORE any further work to stop new events
    g_tracer_disabled = true;

    {
        TraceGuard guard;

        std::fprintf(g_trace_file, "\n],\"tracked_functions\":[");
        bool first = true;
        // Access the set via accessor
        for (const auto& funcName : get_tracked_functions()) {
            if (!first) std::fprintf(g_trace_file, ",");
            std::fprintf(g_trace_file, "\"%s\"", funcName.c_str());
            first = false;
        }
        std::fprintf(g_trace_file, "],\"total_events\":%lu}\n", g_event_counter);

        std::fflush(g_trace_file);
        std::fclose(g_trace_file);
        g_trace_file = nullptr;  // CRITICAL: Prevent use-after-close
    }

    std::fflush(stdout);
    std::fflush(stderr);

    TRACER_GUARD_EXIT();
}
